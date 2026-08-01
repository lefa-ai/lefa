import { describe, expect, it } from 'vitest'
import { buildTranscript, reduceTranscript, type TranscriptItem } from './transcript'

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

  it('appends a prompt as its own turn without merging into the reply', () => {
    const items = reduceAll([
      { type: 'text', text: 'Two files.' },
      { type: 'prompt', text: 'List them' },
      { type: 'prompt', text: 'Read the first' }
    ])

    expect(items).toEqual([
      { kind: 'text', text: 'Two files.' },
      { kind: 'user', text: 'List them' },
      { kind: 'user', text: 'Read the first' }
    ])
  })

  it('builds a restored transcript identical to the live one', () => {
    const events: Parameters<typeof reduceTranscript>[1][] = [
      { type: 'prompt', text: 'List the files' },
      { type: 'text', text: 'Let me look.' },
      { type: 'tool-call', toolCallId: 'call-1', toolName: 'bash', input: { command: 'ls' } },
      { type: 'tool-result', toolCallId: 'call-1', output: 'README.md' }
    ]

    expect(buildTranscript(events)).toEqual(reduceAll(events))
    expect(buildTranscript(events)).toEqual([
      { kind: 'user', text: 'List the files' },
      { kind: 'text', text: 'Let me look.' },
      {
        kind: 'tool',
        toolCallId: 'call-1',
        toolName: 'bash',
        input: '{"command":"ls"}',
        status: 'done',
        output: 'README.md'
      }
    ])
  })

  it('settles unfinished tools and marks the stop when a run is interrupted', () => {
    const items = reduceAll([
      { type: 'tool-call', toolCallId: 'call-1', toolName: 'bash', input: 'ls' },
      { type: 'tool-result', toolCallId: 'call-1', output: 'README.md' },
      { type: 'tool-call', toolCallId: 'call-2', toolName: 'bash', input: 'sleep 60' },
      { type: 'aborted' }
    ])

    expect(items).toEqual([
      {
        kind: 'tool',
        toolCallId: 'call-1',
        toolName: 'bash',
        input: 'ls',
        status: 'done',
        output: 'README.md'
      },
      {
        kind: 'tool',
        toolCallId: 'call-2',
        toolName: 'bash',
        input: 'sleep 60',
        status: 'aborted'
      },
      { kind: 'notice', text: 'Stopped.' }
    ])
  })
})
