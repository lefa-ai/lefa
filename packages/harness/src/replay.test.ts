import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ModelMessage } from 'ai'
import { toAgentEvents } from './replay.ts'

describe('replay', () => {
  it('rebuilds a conversation as the events that produced it', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'List the files' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me look.' },
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'bash',
            input: { command: 'ls' }
          }
        ]
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'bash',
            output: { type: 'text', value: 'README.md' }
          }
        ]
      },
      { role: 'assistant', content: 'One file.' }
    ]

    assert.deepEqual(toAgentEvents(messages), [
      { type: 'prompt', text: 'List the files' },
      { type: 'text', text: 'Let me look.' },
      {
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'bash',
        input: { command: 'ls' }
      },
      { type: 'tool-result', toolCallId: 'call-1', output: 'README.md' },
      { type: 'text', text: 'One file.' }
    ])
  })

  it('reports failed and denied tool results as tool errors', () => {
    const messages: ModelMessage[] = [
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'read',
            output: { type: 'error-text', value: 'File not found' }
          },
          {
            type: 'tool-result',
            toolCallId: 'call-2',
            toolName: 'bash',
            output: { type: 'error-json', value: { message: 'boom' } }
          },
          {
            type: 'tool-result',
            toolCallId: 'call-3',
            toolName: 'bash',
            output: { type: 'execution-denied' }
          }
        ]
      }
    ]

    assert.deepEqual(toAgentEvents(messages), [
      { type: 'tool-error', toolCallId: 'call-1', message: 'File not found' },
      { type: 'tool-error', toolCallId: 'call-2', message: '[object Object]' },
      {
        type: 'tool-error',
        toolCallId: 'call-3',
        message: 'Tool execution was denied.'
      }
    ])
  })

  it('keeps json tool output and multi-part user prompts intact', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'Read it' }] },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'read',
            output: { type: 'json', value: { content: 'body' } }
          }
        ]
      }
    ]

    assert.deepEqual(toAgentEvents(messages), [
      { type: 'prompt', text: 'Read it' },
      {
        type: 'tool-result',
        toolCallId: 'call-1',
        output: { content: 'body' }
      }
    ])
  })

  it('skips system messages and content it cannot render', () => {
    const messages: ModelMessage[] = [
      { role: 'system', content: 'You are an agent' },
      { role: 'assistant', content: '' },
      { role: 'assistant', content: [{ type: 'reasoning', text: 'thinking' }] },
      { role: 'tool', content: [] }
    ]

    assert.deepEqual(toAgentEvents(messages), [])
  })
})
