import type { TextStreamPart, ToolSet } from 'ai'

export type AgentEvent =
  /** A user turn. Produced by the UI and by replay, never by the model stream. */
  | { type: 'prompt'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool-result'; toolCallId: string; output: unknown }
  | { type: 'tool-error'; toolCallId: string; message: string }
  | { type: 'aborted' }
  | { type: 'error'; message: string }

export type RunStatus = 'idle' | 'running'

/**
 * What a watcher hears. Transcript content and run state are separate signals:
 * an event is something the conversation now contains, a status is what the
 * session is doing.
 */
export type SessionNotification =
  | { type: 'event'; sessionId: string; event: AgentEvent }
  | { type: 'status'; sessionId: string; status: RunStatus }

/** Everything needed to draw a session, whether or not a turn is in flight. */
export interface SessionSnapshot {
  id: string
  cwd: string
  model: string
  status: RunStatus
  events: readonly AgentEvent[]
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function toAgentEvent<TOOLS extends ToolSet>(
  part: TextStreamPart<TOOLS>
): AgentEvent | undefined {
  switch (part.type) {
    case 'text-delta':
      return { type: 'text', text: part.text }
    case 'tool-call':
      return {
        type: 'tool-call',
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input
      }
    case 'tool-result':
      return {
        type: 'tool-result',
        toolCallId: part.toolCallId,
        output: part.output
      }
    case 'tool-error':
      return {
        type: 'tool-error',
        toolCallId: part.toolCallId,
        message: errorMessage(part.error)
      }
    case 'abort':
      return { type: 'aborted' }
    case 'error':
      return { type: 'error', message: errorMessage(part.error) }
    default:
      return undefined
  }
}
