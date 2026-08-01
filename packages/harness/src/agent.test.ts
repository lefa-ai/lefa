import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { convertArrayToReadableStream, MockLanguageModelV3 } from 'ai/test'
import { createAgent, createTools } from './agent.ts'
import { toAgentEvent, type AgentEvent } from './events.ts'

const usage = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: 0,
    cacheWrite: 0
  },
  outputTokens: {
    total: 1,
    text: 1,
    reasoning: 0
  }
}

function textResult(text: string) {
  return {
    content: [{ type: 'text' as const, text }],
    finishReason: { unified: 'stop' as const, raw: undefined },
    usage,
    warnings: []
  }
}

async function withWorkspace(run: (cwd: string) => Promise<void>): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), 'lefa-agent-'))

  try {
    await run(cwd)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}

function systemText(model: MockLanguageModelV3): string {
  const message = model.doGenerateCalls[0]?.prompt[0]

  assert.equal(message?.role, 'system')
  assert.equal(typeof message.content, 'string')
  return message.content as string
}

describe('agent', () => {
  it('creates the complete tool set', () => {
    const tools = createTools('/tmp/workspace')

    assert.deepEqual(Object.keys(tools).sort(), ['bash', 'edit', 'read', 'write'])
    for (const tool of Object.values(tools)) assert.equal(typeof tool.execute, 'function')
  })

  it('runs an AI SDK agent with the base instructions and workspace', async () => {
    await withWorkspace(async (cwd) => {
      const model = new MockLanguageModelV3({ doGenerate: textResult('Done') })
      const agent = createAgent(model, cwd)
      const result = await agent.generate({ prompt: 'Help me' })
      const instructions = systemText(model)

      assert.equal(result.text, 'Done')
      assert.match(instructions, /You are an expert coding assistant operating inside Lefa/)
      assert.match(instructions, new RegExp(`Current working directory: ${cwd}`))
      assert.doesNotMatch(instructions, /## Project Instructions/)
      const userMessage = model.doGenerateCalls[0]?.prompt.at(-1)
      assert.equal(userMessage?.role, 'user')
      assert.deepEqual(userMessage.content, [{ type: 'text', text: 'Help me' }])
    })
  })

  it('trims and appends project instructions from AGENTS.md', async () => {
    await withWorkspace(async (cwd) => {
      await writeFile(join(cwd, 'AGENTS.md'), '\n  Keep changes small.  \n')
      const model = new MockLanguageModelV3({ doGenerate: textResult('Done') })

      await createAgent(model, cwd).generate({ prompt: 'Help me' })

      assert.match(systemText(model), /## Project Instructions\n\nKeep changes small\.$/)
    })
  })

  it('ignores an AGENTS.md directory and an empty instructions file', async () => {
    await withWorkspace(async (cwd) => {
      await mkdir(join(cwd, 'AGENTS.md'))
      const directoryModel = new MockLanguageModelV3({ doGenerate: textResult('Done') })

      await createAgent(directoryModel, cwd).generate({ prompt: 'Help me' })
      assert.doesNotMatch(systemText(directoryModel), /## Project Instructions/)

      await rm(join(cwd, 'AGENTS.md'), { recursive: true })
      await writeFile(join(cwd, 'AGENTS.md'), ' \n ')
      const emptyModel = new MockLanguageModelV3({ doGenerate: textResult('Done') })

      await createAgent(emptyModel, cwd).generate({ prompt: 'Help me' })
      assert.doesNotMatch(systemText(emptyModel), /## Project Instructions/)
    })
  })

  it('executes tools through the real AI SDK tool loop', async () => {
    await withWorkspace(async (cwd) => {
      const model = new MockLanguageModelV3({
        doGenerate: [
          {
            content: [
              {
                type: 'tool-call',
                toolCallId: 'write-1',
                toolName: 'write',
                input: JSON.stringify({ path: 'created.txt', content: 'from the agent' })
              }
            ],
            finishReason: { unified: 'tool-calls', raw: undefined },
            usage,
            warnings: []
          },
          textResult('File created')
        ]
      })

      const result = await createAgent(model, cwd).generate({ prompt: 'Create the file' })

      assert.equal(result.text, 'File created')
      assert.equal(await readFile(join(cwd, 'created.txt'), 'utf8'), 'from the agent')
      assert.equal(model.doGenerateCalls.length, 2)
      assert.match(
        JSON.stringify(model.doGenerateCalls[1]?.prompt),
        /Successfully wrote created\.txt/
      )
    })
  })

  it('streams tool activity and text deltas as agent events', async () => {
    await withWorkspace(async (cwd) => {
      const model = new MockLanguageModelV3({
        doStream: [
          {
            stream: convertArrayToReadableStream([
              { type: 'stream-start', warnings: [] },
              {
                type: 'tool-call',
                toolCallId: 'write-1',
                toolName: 'write',
                input: JSON.stringify({ path: 'streamed.txt', content: 'from the stream' })
              },
              { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage }
            ])
          },
          {
            stream: convertArrayToReadableStream([
              { type: 'stream-start', warnings: [] },
              { type: 'text-start', id: 'text-1' },
              { type: 'text-delta', id: 'text-1', delta: 'File ' },
              { type: 'text-delta', id: 'text-1', delta: 'created' },
              { type: 'text-end', id: 'text-1' },
              { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage }
            ])
          }
        ]
      })

      const result = await createAgent(model, cwd).stream({ prompt: 'Create the file' })
      const events: AgentEvent[] = []

      for await (const part of result.stream) {
        const event = toAgentEvent(part)
        if (event) events.push(event)
      }

      assert.deepEqual(events, [
        {
          type: 'tool-call',
          toolCallId: 'write-1',
          toolName: 'write',
          input: { path: 'streamed.txt', content: 'from the stream' }
        },
        {
          type: 'tool-result',
          toolCallId: 'write-1',
          output: { content: 'Successfully wrote streamed.txt' }
        },
        { type: 'text', text: 'File ' },
        { type: 'text', text: 'created' }
      ])
      assert.equal(await readFile(join(cwd, 'streamed.txt'), 'utf8'), 'from the stream')
    })
  })
})
