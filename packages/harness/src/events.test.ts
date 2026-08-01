import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TextStreamPart, ToolSet } from 'ai'
import { toAgentEvent } from './events.ts'

function part(value: TextStreamPart<ToolSet>): TextStreamPart<ToolSet> {
  return value
}

describe('agent events', () => {
  it('maps text deltas', () => {
    assert.deepEqual(toAgentEvent(part({ type: 'text-delta', id: 'text-1', text: 'Hello' })), {
      type: 'text',
      text: 'Hello'
    })
  })

  it('maps tool calls with their input', () => {
    const event = toAgentEvent(
      part({
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'bash',
        input: { command: 'ls' }
      })
    )

    assert.deepEqual(event, {
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: 'bash',
      input: { command: 'ls' }
    })
  })

  it('maps tool results with their output', () => {
    const event = toAgentEvent(
      part({
        type: 'tool-result',
        toolCallId: 'call-1',
        toolName: 'bash',
        input: { command: 'ls' },
        output: { content: 'README.md' }
      })
    )

    assert.deepEqual(event, {
      type: 'tool-result',
      toolCallId: 'call-1',
      output: { content: 'README.md' }
    })
  })

  it('maps tool errors to their message', () => {
    const event = toAgentEvent(
      part({
        type: 'tool-error',
        toolCallId: 'call-1',
        toolName: 'read',
        input: { path: 'missing.txt' },
        error: new Error('File not found')
      })
    )

    assert.deepEqual(event, {
      type: 'tool-error',
      toolCallId: 'call-1',
      message: 'File not found'
    })
  })

  it('maps stream errors and stringifies non-error rejections', () => {
    assert.deepEqual(toAgentEvent(part({ type: 'error', error: new Error('Rate limited') })), {
      type: 'error',
      message: 'Rate limited'
    })
    assert.deepEqual(toAgentEvent(part({ type: 'error', error: 'plain failure' })), {
      type: 'error',
      message: 'plain failure'
    })
  })

  it('maps an interrupted stream', () => {
    assert.deepEqual(toAgentEvent(part({ type: 'abort', reason: 'stopped' })), {
      type: 'aborted'
    })
    assert.deepEqual(toAgentEvent(part({ type: 'abort' })), {
      type: 'aborted'
    })
  })

  it('ignores parts the interface does not render', () => {
    assert.equal(toAgentEvent(part({ type: 'start' })), undefined)
    assert.equal(toAgentEvent(part({ type: 'text-start', id: 'text-1' })), undefined)
    assert.equal(toAgentEvent(part({ type: 'text-end', id: 'text-1' })), undefined)
    assert.equal(
      toAgentEvent(part({ type: 'tool-input-start', id: 'call-1', toolName: 'bash' })),
      undefined
    )
  })
})
