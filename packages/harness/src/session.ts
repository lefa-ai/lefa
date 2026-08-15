import { randomUUID } from 'node:crypto'
import { convertToModelMessages, readUIMessageStream, toUIMessageStream, type UIMessage } from 'ai'
import { createAgent, createTools, type HarnessAgent, type HarnessTools } from './agent.ts'
import type { SessionMeta, SessionStore } from './session-store.ts'

const TITLE_LENGTH = 80
/** How often a message still being written is pushed to disk. */
const FLUSH_INTERVAL = 100

export interface SessionOptions {
  id?: string
  createdAt?: string
  title?: string
  messages?: readonly UIMessage[]
  store?: SessionStore
}

function toTitle(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()

  return collapsed.length > TITLE_LENGTH ? `${collapsed.slice(0, TITLE_LENGTH - 1)}…` : collapsed
}

/**
 * A single conversation with the agent in one workspace.
 *
 * The session owns the messages, so every prompt continues the conversation
 * instead of starting over, and owns the abort controller for the turn in
 * flight, so the work can be interrupted.
 *
 * Messages are the only thing it keeps. What the model is sent is derived from
 * them at the moment of the call, so there are not two things to keep in step.
 */
export class Session {
  readonly id: string
  readonly cwd: string
  readonly createdAt: string
  private title: string
  private currentModel: string
  private readonly tools: HarnessTools
  private agent: HarnessAgent
  private readonly conversation: UIMessage[]
  private readonly store: SessionStore | undefined
  private controller: AbortController | undefined
  private discarded = false

  constructor(model: string, cwd: string, options: SessionOptions = {}) {
    this.id = options.id ?? randomUUID()
    this.cwd = cwd
    this.createdAt = options.createdAt ?? new Date().toISOString()
    this.title = options.title ?? ''
    this.currentModel = model
    this.conversation = [...(options.messages ?? [])]
    this.store = options.store
    this.tools = createTools(cwd)
    this.agent = createAgent(model, cwd, this.tools)
  }

  get model(): string {
    return this.currentModel
  }

  setModel(model: string): void {
    if (model === this.currentModel) return

    this.currentModel = model
    this.agent = createAgent(model, this.cwd, this.tools)
    void this.save()
  }

  get isRunning(): boolean {
    return this.controller !== undefined
  }

  get meta(): SessionMeta {
    return {
      id: this.id,
      cwd: this.cwd,
      createdAt: this.createdAt,
      title: this.title,
      model: this.currentModel
    }
  }

  get messages(): readonly UIMessage[] {
    return this.conversation
  }

  /**
   * Runs one turn, yielding each message as it grows.
   *
   * The same message is yielded repeatedly — the same id, further along each
   * time — and is written to disk as it goes, so an interrupted turn keeps
   * whatever it managed to say.
   */
  async *prompt(text: string): AsyncGenerator<UIMessage> {
    if (this.controller) throw new Error('The session is already running')

    const controller = new AbortController()
    this.controller = controller

    try {
      const asked: UIMessage = { id: randomUUID(), role: 'user', parts: [{ type: 'text', text }] }
      this.conversation.push(asked)
      this.title ||= toTitle(text)
      await this.save()
      await this.write(asked, true)
      yield asked

      // An interrupted turn can leave a tool call with no result behind it.
      // That is a fine thing to have said and an impossible thing to send, so
      // it is dropped on the way to the model rather than on the way to disk.
      const result = await this.agent.stream({
        messages: await convertToModelMessages(this.conversation, {
          ignoreIncompleteToolCalls: true
        }),
        abortSignal: controller.signal
      })

      // Two different things end up at an error handler here, and only one of
      // them means the turn failed.
      //
      // A tool that throws is ordinary: it becomes a failed tool part, the
      // model reads it and carries on. Only a stream-level failure — a missing
      // key, an unreachable provider — ends the turn, and that is what the
      // reader reports. The writer's handler is a formatter, called for both,
      // so it keeps the error itself without deciding anything: the reader has
      // no access to the original, and only the original still knows what kind
      // of failure it was.
      let seen: unknown
      let failed = false

      const replies = readUIMessageStream({
        stream: toUIMessageStream({
          stream: result.stream,
          tools: this.tools,
          generateMessageId: () => randomUUID(),
          messageMetadata: () => ({ model: this.currentModel }),
          onError: (error) => {
            seen = error

            return error instanceof Error ? error.message : String(error)
          }
        }),
        onError: () => {
          failed = true
        }
      })

      let started = false
      let flushed = 0

      for await (const reply of replies) {
        // A reply that has not said anything yet is not worth remembering; a
        // failed turn would otherwise leave an empty message behind.
        if (reply.parts.length === 0) continue

        this.remember(reply)

        const now = Date.now()
        if (!started || now - flushed >= FLUSH_INTERVAL) {
          await this.write(reply, !started)
          started = true
          flushed = now
        }

        yield reply
      }

      const last = this.conversation.at(-1)
      if (started && last?.role === 'assistant') await this.write(last, false)

      if (failed) throw seen ?? new Error('The model stopped without answering.')
    } finally {
      this.controller = undefined
    }
  }

  abort(): void {
    this.controller?.abort()
  }

  /**
   * Retires the session for good.
   *
   * A turn that is still unwinding would otherwise write its last message after
   * the session was deleted, recreating the very files that were just removed.
   */
  discard(): void {
    this.discarded = true
    this.abort()
  }

  /** Replaces the message with this id, or adds it if it is new. */
  private remember(message: UIMessage): void {
    const at = this.conversation.findIndex((current) => current.id === message.id)

    if (at === -1) this.conversation.push(message)
    else this.conversation[at] = message
  }

  private async save(): Promise<void> {
    if (this.discarded || !this.store) return

    // Failing to save must not fail the turn: the conversation is in memory,
    // and the next write carries it.
    await this.store.save(this.meta).catch(() => {})
  }

  private async write(message: UIMessage, isNew: boolean): Promise<void> {
    if (this.discarded || !this.store) return

    const written = isNew
      ? this.store.append(this.id, message)
      : this.store.replaceLast(this.id, message)

    await written.catch(() => {})
  }
}
