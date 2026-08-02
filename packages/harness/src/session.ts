import { randomUUID } from 'node:crypto'
import type { ModelMessage } from 'ai'
import { createAgent, type HarnessAgent } from './agent.ts'
import { toAgentEvent, type AgentEvent } from './events.ts'
import type { SessionMeta, SessionStore } from './session-store.ts'

const TITLE_LENGTH = 80

export interface SessionOptions {
  id?: string
  createdAt?: string
  title?: string
  messages?: readonly ModelMessage[]
  store?: SessionStore
}

function toTitle(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()

  return collapsed.length > TITLE_LENGTH ? `${collapsed.slice(0, TITLE_LENGTH - 1)}…` : collapsed
}

/**
 * A single conversation with the agent in one workspace.
 *
 * The session owns the message log, so every prompt continues the conversation
 * instead of starting over, and owns the abort controller for the run in
 * flight, so the work can be interrupted.
 */
export class Session {
  readonly id: string
  readonly cwd: string
  readonly createdAt: string
  private title: string
  private currentModel: string
  private agent: HarnessAgent
  private readonly messages: ModelMessage[]
  private readonly store: SessionStore | undefined
  private controller: AbortController | undefined
  private discarded = false

  constructor(model: string, cwd: string, options: SessionOptions = {}) {
    this.id = options.id ?? randomUUID()
    this.cwd = cwd
    this.createdAt = options.createdAt ?? new Date().toISOString()
    this.title = options.title ?? ''
    this.currentModel = model
    this.messages = [...(options.messages ?? [])]
    this.store = options.store
    this.agent = createAgent(model, cwd)
  }

  get model(): string {
    return this.currentModel
  }

  /**
   * Switches the model for the rest of the conversation.
   *
   * Nothing is written here: the next turn records the model that produced it,
   * which is the only place the model is ever stored.
   */
  setModel(model: string): void {
    if (model === this.currentModel) return

    this.currentModel = model
    this.agent = createAgent(model, this.cwd)
  }

  get isRunning(): boolean {
    return this.controller !== undefined
  }

  get meta(): SessionMeta {
    return {
      id: this.id,
      cwd: this.cwd,
      createdAt: this.createdAt,
      title: this.title
    }
  }

  /** The committed conversation. Used to redraw a session already in memory. */
  get history(): readonly ModelMessage[] {
    return [...this.messages]
  }

  /**
   * Runs one turn, yielding the events it produces.
   *
   * The turn is assembled off to the side and committed only once it has
   * produced something: a failed turn leaves the history exactly as it was,
   * rather than stranding a user message with no reply. Aborting still commits
   * every completed step, so the conversation never carries a tool call without
   * its result.
   */
  async *prompt(text: string): AsyncGenerator<AgentEvent> {
    if (this.controller) throw new Error('The session is already running')

    const controller = new AbortController()
    this.controller = controller
    const turn: ModelMessage[] = [{ role: 'user', content: text }]

    try {
      const result = await this.agent.stream({
        messages: [...this.messages, ...turn],
        abortSignal: controller.signal
      })

      for await (const part of result.stream) {
        const event = toAgentEvent(part)

        if (event) yield event
      }

      try {
        turn.push(...(await result.responseMessages))
      } catch (error) {
        // Aborting before a single step completed rejects the response
        // messages. The turn simply produced nothing to remember.
        if (!controller.signal.aborted) throw error
      }

      this.messages.push(...turn)
      this.title ||= toTitle(text)
    } finally {
      this.controller = undefined
    }

    if (this.discarded) return

    // The turn already succeeded, so failing to save it must not fail the turn.
    try {
      await this.store?.append(this.meta, this.currentModel, turn)
    } catch {
      yield { type: 'error', message: 'Could not save this session to disk.' }
    }
  }

  abort(): void {
    this.controller?.abort()
  }

  /**
   * Retires the session for good.
   *
   * A run that is still unwinding would otherwise save its final turn after the
   * session was deleted, recreating the very file that was just removed.
   */
  discard(): void {
    this.discarded = true
    this.abort()
  }
}
