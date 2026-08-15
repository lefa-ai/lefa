import type { UIMessage } from 'ai'
import type { SessionListing, SessionNotification, SessionSnapshot } from './protocol.ts'
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

/** The turn in flight. Its messages are already in the session. */
interface Run {
  /** Prompts to run, in order, once this turn is done. */
  queue: string[]
}

function defaultDescribeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Owns every open session and the turns happening inside them.
 *
 * A turn belongs to the manager, not to whoever started it: it keeps going when
 * the window looking at it moves on, and every watcher sees the same messages.
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
   * memory. A session already open may hold messages newer than the files it
   * came from, so it is always preferred.
   */
  async attach(sessionId: string): Promise<SessionSnapshot> {
    const open = this.sessions.get(sessionId)

    if (open) return this.snapshot(open)

    const { meta, messages } = await this.store.load(sessionId)
    const session = new Session(meta.model, meta.cwd, {
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
   * The turn outlives this call: it reports itself through notifications, so
   * nothing has to stay and wait for it. A prompt sent into a turn already
   * running joins the queue rather than being refused — steering an agent
   * mid-task is the point, and waiting for a stopping place to type is not.
   */
  prompt(sessionId: string, text: string): void {
    const session = this.require(sessionId)
    const running = this.runs.get(sessionId)

    if (running) {
      running.queue.push(text)
      this.publish({ type: 'queued', sessionId, prompts: [...running.queue] })

      return
    }

    const run: Run = { queue: [] }
    this.runs.set(sessionId, run)
    this.publish({ type: 'status', sessionId, status: 'running' })
    void this.drain(session, run, text)
  }

  /**
   * Stops the turn in flight and drops whatever was lined up behind it.
   *
   * Interrupting means the plan changed, so running the follow-ups written for
   * the old one would be the opposite of what was asked.
   */
  abort(sessionId: string): void {
    const run = this.runs.get(sessionId)

    if (run?.queue.length) {
      run.queue.length = 0
      this.publish({ type: 'queued', sessionId, prompts: [] })
    }

    this.sessions.get(sessionId)?.abort()
  }

  setModel(sessionId: string, model: string): void {
    this.require(sessionId).setModel(model)
  }

  async delete(sessionId: string): Promise<void> {
    // Discard rather than abort: a turn still unwinding would otherwise write
    // its last message and bring the deleted files back.
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
      id: summary.id,
      cwd: summary.cwd,
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
      title: summary.title,
      status: this.runs.has(summary.id) ? ('running' as const) : ('idle' as const)
    }))
  }

  /**
   * Runs the turn, then whatever queued up behind it.
   *
   * The session stays running the whole way through: a queue emptying is one
   * stretch of work, not a series of them blinking idle between turns.
   */
  private async drain(session: Session, run: Run, first: string): Promise<void> {
    let text: string | undefined = first

    try {
      while (text !== undefined) {
        try {
          for await (const message of session.prompt(text)) this.send(session.id, message)
        } catch (error) {
          this.publish({
            type: 'error',
            sessionId: session.id,
            error: this.describeError(error)
          })
        }

        text = run.queue.shift()

        if (text !== undefined) {
          this.publish({ type: 'queued', sessionId: session.id, prompts: [...run.queue] })
        }
      }
    } finally {
      this.runs.delete(session.id)
      this.publish({ type: 'status', sessionId: session.id, status: 'idle' })
    }
  }

  private send(sessionId: string, message: UIMessage): void {
    this.publish({ type: 'message', sessionId, message })
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
      messages: [...session.messages],
      queued: run ? [...run.queue] : []
    }
  }

  private require(sessionId: string): Session {
    const session = this.sessions.get(sessionId)

    if (!session) throw new Error('That session is no longer open.')

    return session
  }
}
