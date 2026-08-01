import type { ModelMessage } from 'ai'
import type { AgentEvent } from './events.ts'

type Part = Record<string, unknown>

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .filter((part: Part) => part?.type === 'text')
    .map((part: Part) => String(part.value ?? part.text ?? ''))
    .join('')
}

function toolResultEvent(part: Part): AgentEvent | undefined {
  const toolCallId = part.toolCallId
  if (typeof toolCallId !== 'string') return undefined

  const output = part.output as Part | undefined
  const type = output?.type

  if (type === 'error-text' || type === 'error-json') {
    return {
      type: 'tool-error',
      toolCallId,
      message: String(output?.value ?? 'Tool failed.')
    }
  }
  if (type === 'execution-denied') {
    return {
      type: 'tool-error',
      toolCallId,
      message: 'Tool execution was denied.'
    }
  }

  return { type: 'tool-result', toolCallId, output: output?.value ?? output }
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
    if (message.role === 'user') {
      events.push({ type: 'prompt', text: textOf(message.content) })
      continue
    }

    if (message.role === 'assistant') {
      const content = message.content

      if (typeof content === 'string') {
        if (content) events.push({ type: 'text', text: content })
        continue
      }

      for (const item of content as Part[]) {
        if (item?.type === 'text') {
          events.push({ type: 'text', text: String(item.text ?? '') })
        } else if (item?.type === 'tool-call' && typeof item.toolCallId === 'string') {
          events.push({
            type: 'tool-call',
            toolCallId: item.toolCallId,
            toolName: String(item.toolName ?? ''),
            input: item.input
          })
        }
      }
      continue
    }

    if (message.role === 'tool') {
      for (const item of message.content as Part[]) {
        if (item?.type !== 'tool-result') continue

        const event = toolResultEvent(item)
        if (event) events.push(event)
      }
    }
  }

  return events
}
