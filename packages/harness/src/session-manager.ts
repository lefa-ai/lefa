import type { ModelMessage } from 'ai'
import type { AgentEvent, SessionListing, SessionNotification, SessionSnapshot } from './events.ts'
import { toAgentEvents } from './replay.ts'
import type { SessionStore } from './session-store.ts'
import { Session } from './session.ts'

export interface SessionManagerOptions {
  store: SessionStore
  /**
   * Turns a thrown run failure into the sentence the user reads. Providers
   * carry the only actionable detail — a missing key, an unavailable model —
   * but the remediation is worded by whoever is hosting the harness.
   */
  describeError?: (error: unknown) => string
}

/** The turn in flight, kept apart from the conversation it has not joined yet. */
interface Run {
  /** Everything this turn has produced so far. */
  buffer: AgentEvent[]
  /**
   * The conversation as it stood when the turn began.
   *
   * A snapshot reads from here rather than from the live history: the session
   * commits the turn to its history and only then awaits the store, so during
   * that write the turn would otherwise appear twice — once from history and
   * once from the buffer.
   */
  baseline: readonly ModelMessage[]
}

function defaultDescribeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Owns every open session and the runs happening inside them.
 *
 * A run belongs to the manager, not to whoever started it: it keeps going when
 * the window looking at it moves on, and every watcher sees the same stream.
 * Reattaching is a snapshot plus the notifications that follow it, which is the
 * same shape a server would expose over the wire.
 */
export class SessionManager {
  private readonly store: SessionStore
  private readonly describeError: (error: unknown) => string
  private readonly sessions = new Map<string, Session>()
  private readonly runs = new Map<string, Run>()
  private readonly watchers = new Set<(notification: SessionNotification) => void>()

  constructor({ store, describeError = defaultDescribeError }: SessionManagerOptions) {
    this.store = store
    this.describeError = describeError
  }

  /** Watches every session at once. Returns the function that stops watching. */
  subscribe(watcher: (notification: SessionNotification) => void): () => void {
    this.watchers.add(watcher)

    return () => {
      this.watchers.delete(watcher)
    }
  }

  open(cwd: string, model: string): SessionSnapshot {
    const session = new Session(model, cwd, { store: this.store })
    this.sessions.set(session.id, session)

    return this.snapshot(session)
  }

  /**
   * Opens a session for watching, loading it from disk if it is not already in
   * memory. A session already open may hold a turn newer than the file it came
   * from, so it is always preferred.
   */
  async attach(sessionId: string): Promise<SessionSnapshot> {
    const open = this.sessions.get(sessionId)

    if (open) return this.snapshot(open)

    const { meta, model, messages } = await this.store.load(sessionId)
    const session = new Session(model, meta.cwd, {
      id: meta.id,
      createdAt: meta.createdAt,
      title: meta.title,
      messages,
      store: this.store
    })
    this.sessions.set(session.id, session)

    return this.snapshot(session)
  }

  /**
   * Starts a turn and returns as soon as it is under way.
   *
   * The run outlives this call: it reports itself through notifications, so
   * nothing has to stay and wait for it.
   */
  prompt(sessionId: string, text: string): void {
    const session = this.require(sessionId)

    if (this.runs.has(sessionId)) throw new Error('The session is already running.')

    const run: Run = { buffer: [], baseline: session.history }
    this.runs.set(sessionId, run)
    this.publish({ type: 'status', sessionId, status: 'running' })
    void this.drain(session, run, text)
  }

  abort(sessionId: string): void {
    this.sessions.get(sessionId)?.abort()
  }

  setModel(sessionId: string, model: string): void {
    this.require(sessionId).setModel(model)
  }

  async delete(sessionId: string): Promise<void> {
    // Discard rather than abort: a run still unwinding would otherwise save its
    // last turn and bring the deleted file back.
    this.sessions.get(sessionId)?.discard()
    this.sessions.delete(sessionId)
    await this.store.delete(sessionId)
  }

  /**
   * Every saved session, each one saying whether it is working.
   *
   * The store only knows what was written down; which sessions are busy is the
   * manager's alone to answer, so it is added here rather than persisted.
   */
  async list(): Promise<SessionListing[]> {
    const summaries = await this.store.list()

    return summaries.map((summary) => ({
      ...summary,
      status: this.runs.has(summary.id) ? ('running' as const) : ('idle' as const)
    }))
  }

  private async drain(session: Session, run: Run, text: string): Promise<void> {
    // The prompt is echoed by the manager rather than by the caller, so every
    // watcher sees it and a replayed transcript matches a live one.
    this.emit(session.id, run, { type: 'prompt', text })

    try {
      for await (const event of session.prompt(text)) this.emit(session.id, run, event)
    } catch (error) {
      this.emit(session.id, run, { type: 'error', message: this.describeError(error) })
    } finally {
      this.runs.delete(session.id)
      this.publish({ type: 'status', sessionId: session.id, status: 'idle' })
    }
  }

  private emit(sessionId: string, run: Run, event: AgentEvent): void {
    run.buffer.push(event)
    this.publish({ type: 'event', sessionId, event })
  }

  private publish(notification: SessionNotification): void {
    for (const watcher of this.watchers) watcher(notification)
  }

  private snapshot(session: Session): SessionSnapshot {
    const run = this.runs.get(session.id)

    return {
      id: session.id,
      cwd: session.cwd,
      model: session.model,
      status: run ? 'running' : 'idle',
      events: run ? [...toAgentEvents(run.baseline), ...run.buffer] : toAgentEvents(session.history)
    }
  }

  private require(sessionId: string): Session {
    const session = this.sessions.get(sessionId)

    if (!session) throw new Error('That session is no longer open.')

    return session
  }
}
