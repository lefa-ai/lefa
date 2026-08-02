import type { ModelMessage } from 'ai'
import type { AgentEvent } from './events.ts'

type AssistantContent = Extract<ModelMessage, { role: 'assistant' }>['content']
type ToolContent = Extract<ModelMessage, { role: 'tool' }>['content']
type ToolResultOutput = Extract<ToolContent[number], { type: 'tool-result' }>['output']

function promptText(content: Extract<ModelMessage, { role: 'user' }>['content']): string {
  if (typeof content === 'string') return content

  return content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

function toolOutputEvent(toolCallId: string, output: ToolResultOutput): AgentEvent {
  switch (output.type) {
    case 'error-text':
      return { type: 'tool-error', toolCallId, message: output.value }
    case 'error-json':
      return { type: 'tool-error', toolCallId, message: JSON.stringify(output.value) }
    case 'execution-denied':
      return {
        type: 'tool-error',
        toolCallId,
        message: output.reason ?? 'Tool execution was denied.'
      }
    default:
      return { type: 'tool-result', toolCallId, output: output.value }
  }
}

function assistantEvents(content: AssistantContent): AgentEvent[] {
  if (typeof content === 'string') {
    return content ? [{ type: 'text', text: content }] : []
  }

  const events: AgentEvent[] = []

  for (const part of content) {
    if (part.type === 'text') {
      events.push({ type: 'text', text: part.text })
    } else if (part.type === 'tool-call') {
      events.push({
        type: 'tool-call',
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input
      })
    }
  }

  return events
}

/**
 * Rebuilds the event stream a stored conversation originally produced.
 *
 * Restoring replays these through the same reducer the live stream feeds, so a
 * resumed transcript and a fresh one cannot drift apart.
 */
export function toAgentEvents(messages: readonly ModelMessage[]): AgentEvent[] {
  const events: AgentEvent[] = []

  for (const message of messages) {
    switch (message.role) {
      case 'user':
        events.push({ type: 'prompt', text: promptText(message.content) })
        break
      case 'assistant':
        events.push(...assistantEvents(message.content))
        break
      case 'tool':
        for (const part of message.content) {
          if (part.type === 'tool-result') {
            events.push(toolOutputEvent(part.toolCallId, part.output))
          }
        }
        break
      default:
        break
    }
  }

  return events
}
