import { randomUUID } from 'node:crypto'
import type { LanguageModel, ModelMessage } from 'ai'
import { createAgent, type HarnessAgent } from './agent.ts'
import { toAgentEvent, type AgentEvent } from './events.ts'

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
  private readonly agent: HarnessAgent
  private readonly messages: ModelMessage[] = []
  private controller: AbortController | undefined

  constructor(model: LanguageModel, cwd: string) {
    this.id = randomUUID()
    this.cwd = cwd
    this.agent = createAgent(model, cwd)
  }

  get isRunning(): boolean {
    return this.controller !== undefined
  }

  /**
   * Runs one turn, yielding the events it produces.
   *
   * Aborting keeps every completed step in the history and discards the step in
   * flight, so the conversation never carries a tool call without its result.
   */
  async *prompt(text: string): AsyncGenerator<AgentEvent> {
    if (this.controller) throw new Error('The session is already running')

    const controller = new AbortController()
    this.controller = controller
    this.messages.push({ role: 'user', content: text })

    try {
      const result = await this.agent.stream({
        messages: [...this.messages],
        abortSignal: controller.signal
      })

      for await (const part of result.stream) {
        const event = toAgentEvent(part)

        if (event) yield event
      }

      try {
        this.messages.push(...(await result.responseMessages))
      } catch (error) {
        // Aborting before a single step completed rejects the response
        // messages. The turn simply produced nothing to remember.
        if (!controller.signal.aborted) throw error
      }
    } finally {
      this.controller = undefined
    }
  }

  abort(): void {
    this.controller?.abort()
  }
}
