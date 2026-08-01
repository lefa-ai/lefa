import { describe, expect, it } from 'vitest'
import { reduceTranscript, type TranscriptItem } from './transcript'

function reduceAll(events: Parameters<typeof reduceTranscript>[1][]): readonly TranscriptItem[] {
  return events.reduce<readonly TranscriptItem[]>(
    (items, event) => reduceTranscript(items, event),
    []
  )
}

describe('transcript', () => {
  it('merges consecutive text deltas into a single message', () => {
    const items = reduceAll([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world' }
    ])

    expect(items).toEqual([{ kind: 'text', text: 'Hello world' }])
  })

  it('starts a new message after a tool call interrupts the text', () => {
    const items = reduceAll([
      { type: 'text', text: 'Looking' },
      { type: 'tool-call', toolCallId: 'call-1', toolName: 'bash', input: { command: 'ls' } },
      { type: 'text', text: 'Found it' }
    ])

    expect(items).toEqual([
      { kind: 'text', text: 'Looking' },
      {
        kind: 'tool',
        toolCallId: 'call-1',
        toolName: 'bash',
        input: '{"command":"ls"}',
        status: 'running'
      },
      { kind: 'text', text: 'Found it' }
    ])
  })

  it('completes a tool with the text content of its output', () => {
    const items = reduceAll([
      { type: 'tool-call', toolCallId: 'call-1', toolName: 'read', input: { path: 'a.txt' } },
      { type: 'tool-result', toolCallId: 'call-1', output: { content: 'file body' } }
    ])

    expect(items).toEqual([
      {
        kind: 'tool',
        toolCallId: 'call-1',
        toolName: 'read',
        input: '{"path":"a.txt"}',
        status: 'done',
        output: 'file body'
      }
    ])
  })

  it('marks a failed tool with its message and leaves other tools untouched', () => {
    const items = reduceAll([
      { type: 'tool-call', toolCallId: 'call-1', toolName: 'read', input: 'a.txt' },
      { type: 'tool-call', toolCallId: 'call-2', toolName: 'read', input: 'b.txt' },
      { type: 'tool-error', toolCallId: 'call-2', message: 'File not found' }
    ])

    expect(items).toEqual([
      { kind: 'tool', toolCallId: 'call-1', toolName: 'read', input: 'a.txt', status: 'running' },
      {
        kind: 'tool',
        toolCallId: 'call-2',
        toolName: 'read',
        input: 'b.txt',
        status: 'error',
        output: 'File not found'
      }
    ])
  })

  it('formats plain string and unserializable tool output', () => {
    const items = reduceAll([
      { type: 'tool-call', toolCallId: 'call-1', toolName: 'bash', input: 'ls' },
      { type: 'tool-result', toolCallId: 'call-1', output: undefined }
    ])

    expect(items).toEqual([
      {
        kind: 'tool',
        toolCallId: 'call-1',
        toolName: 'bash',
        input: 'ls',
        status: 'done',
        output: ''
      }
    ])
  })

  it('keeps the transcript unchanged for events it does not render', () => {
    const items: readonly TranscriptItem[] = [{ kind: 'text', text: 'Hello' }]

    expect(reduceTranscript(items, { type: 'error', message: 'Rate limited' })).toBe(items)
  })
})
