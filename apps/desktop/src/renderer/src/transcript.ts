import type { AgentEvent } from '../../shared/api'

export type ToolStatus = 'running' | 'done' | 'error' | 'aborted'

export type TranscriptItem =
  | { kind: 'user'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'notice'; text: string }
  | {
      kind: 'tool'
      toolCallId: string
      toolName: string
      input: string
      status: ToolStatus
      output?: string
    }

function format(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'content' in value) return format(value.content)

  return JSON.stringify(value) ?? ''
}

function updateTool(
  items: readonly TranscriptItem[],
  toolCallId: string,
  status: ToolStatus,
  output: string
): TranscriptItem[] {
  return items.map((item) =>
    item.kind === 'tool' && item.toolCallId === toolCallId ? { ...item, status, output } : item
  )
}

/** Replays stored events, so a restored transcript matches a live one exactly. */
export function buildTranscript(events: readonly AgentEvent[]): readonly TranscriptItem[] {
  return events.reduce<readonly TranscriptItem[]>(reduceTranscript, [])
}

export function reduceTranscript(
  items: readonly TranscriptItem[],
  event: AgentEvent
): readonly TranscriptItem[] {
  switch (event.type) {
    case 'prompt':
      return [...items, { kind: 'user', text: event.text }]
    case 'text': {
      const last = items.at(-1)

      if (last?.kind !== 'text') return [...items, { kind: 'text', text: event.text }]

      return [...items.slice(0, -1), { kind: 'text', text: last.text + event.text }]
    }
    case 'tool-call':
      return [
        ...items,
        {
          kind: 'tool',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          input: format(event.input),
          status: 'running'
        }
      ]
    case 'tool-result':
      return updateTool(items, event.toolCallId, 'done', format(event.output))
    case 'tool-error':
      return updateTool(items, event.toolCallId, 'error', event.message)
    case 'aborted':
      return [
        ...items.map((item) =>
          item.kind === 'tool' && item.status === 'running'
            ? { ...item, status: 'aborted' as const }
            : item
        ),
        { kind: 'notice', text: 'Stopped.' }
      ]
    default:
      return items
  }
}
