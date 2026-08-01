import type { TextStreamPart, ToolSet } from 'ai'

export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool-result'; toolCallId: string; output: unknown }
  | { type: 'tool-error'; toolCallId: string; message: string }
  | { type: 'error'; message: string }

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
      return { type: 'tool-result', toolCallId: part.toolCallId, output: part.output }
    case 'tool-error':
      return {
        type: 'tool-error',
        toolCallId: part.toolCallId,
        message: errorMessage(part.error)
      }
    case 'error':
      return { type: 'error', message: errorMessage(part.error) }
    default:
      return undefined
  }
}
