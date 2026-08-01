import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { convertArrayToReadableStream, MockLanguageModelV3 } from 'ai/test'
import type { AgentEvent } from './events.ts'
import { SessionStore } from './session-store.ts'
import { Session } from './session.ts'

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 }
}

type StreamResponse = Awaited<ReturnType<MockLanguageModelV3['doStream']>>
type StreamPart = StreamResponse['stream'] extends ReadableStream<infer Part> ? Part : never

function textResponse(text: string): StreamResponse {
  return {
    stream: convertArrayToReadableStream<StreamPart>([
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 'text-1' },
      { type: 'text-delta', id: 'text-1', delta: text },
      { type: 'text-end', id: 'text-1' },
      {
        type: 'finish',
        finishReason: { unified: 'stop', raw: undefined },
        usage
      }
    ])
  }
}

function writeResponse(path: string, content: string): StreamResponse {
  return {
    stream: convertArrayToReadableStream<StreamPart>([
      { type: 'stream-start', warnings: [] },
      {
        type: 'tool-call',
        toolCallId: 'write-1',
        toolName: 'write',
        input: JSON.stringify({ path, content })
      },
      {
        type: 'finish',
        finishReason: { unified: 'tool-calls', raw: undefined },
        usage
      }
    ])
  }
}

/** A model response the test feeds by hand, so a run can be interrupted mid-stream. */
function openResponse(): {
  response: StreamResponse
  push: (part: StreamPart) => void
} {
  let controller!: ReadableStreamDefaultController<StreamPart>
  const stream = new ReadableStream<StreamPart>({
    start(streamController) {
      controller = streamController
    }
  })

  return { response: { stream }, push: (part) => controller.enqueue(part) }
}

async function withWorkspace(run: (cwd: string) => Promise<void>): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), 'lefa-session-'))

  try {
    await run(cwd)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}

function promptText(prompt: unknown): string {
  return JSON.stringify(prompt)
}

describe('session', () => {
  it('identifies itself and its workspace', async () => {
    await withWorkspace(async (cwd) => {
      const session = new Session(new MockLanguageModelV3(), cwd)

      assert.equal(session.cwd, cwd)
      assert.match(session.id, /^[0-9a-f-]{36}$/)
      assert.equal(session.isRunning, false)
      assert.notEqual(session.id, new Session(new MockLanguageModelV3(), cwd).id)
    })
  })

  it('carries the conversation into the next turn', async () => {
    await withWorkspace(async (cwd) => {
      const model = new MockLanguageModelV3({
        doStream: [textResponse('Two files.'), textResponse('It holds the readme.')]
      })
      const session = new Session(model, cwd)

      for await (const _event of session.prompt('List the files')) void _event
      for await (const _event of session.prompt('What is in the first one?')) void _event

      assert.equal(model.doStreamCalls.length, 2)
      const secondTurn = promptText(model.doStreamCalls[1]?.prompt)

      assert.match(secondTurn, /List the files/)
      assert.match(secondTurn, /Two files\./)
      assert.match(secondTurn, /What is in the first one\?/)
    })
  })

  it('reports that it is running only while a turn is in flight', async () => {
    await withWorkspace(async (cwd) => {
      const model = new MockLanguageModelV3({
        doStream: [textResponse('Done')]
      })
      const session = new Session(model, cwd)
      const run = session.prompt('Help me')

      await run.next()
      assert.equal(session.isRunning, true)

      for await (const _event of run) void _event
      assert.equal(session.isRunning, false)
    })
  })

  it('refuses a second turn while one is already running', async () => {
    await withWorkspace(async (cwd) => {
      const model = new MockLanguageModelV3({
        doStream: [textResponse('Done')]
      })
      const session = new Session(model, cwd)
      const run = session.prompt('Help me')
      await run.next()

      await assert.rejects(async () => {
        for await (const _event of session.prompt('And this')) void _event
      }, /The session is already running/)

      for await (const _event of run) void _event
    })
  })

  it('keeps completed steps when a run is interrupted', { timeout: 10_000 }, async () => {
    await withWorkspace(async (cwd) => {
      const interrupted = openResponse()
      const model = new MockLanguageModelV3({
        doStream: [
          writeResponse('created.txt', 'from the agent'),
          interrupted.response,
          textResponse('Picking up where we left off.')
        ]
      })
      const session = new Session(model, cwd)
      const events: AgentEvent[] = []

      interrupted.push({ type: 'stream-start', warnings: [] })
      interrupted.push({ type: 'text-start', id: 'text-1' })
      interrupted.push({
        type: 'text-delta',
        id: 'text-1',
        delta: 'Still working'
      })

      for await (const event of session.prompt('Create the file')) {
        events.push(event)

        if (event.type === 'text') {
          session.abort()
          // Wake the reader so the abort is observed and the stream closes.
          interrupted.push({
            type: 'text-delta',
            id: 'text-1',
            delta: ' on it'
          })
        }
      }

      assert.equal(session.isRunning, false)
      assert.equal(events.at(-1)?.type, 'aborted')
      assert.ok(events.some((event) => event.type === 'tool-result'))

      for await (const _event of session.prompt('Carry on')) void _event

      const finalTurn = promptText(model.doStreamCalls[2]?.prompt)
      assert.match(finalTurn, /Create the file/)
      assert.match(finalTurn, /created\.txt/, 'the completed write step survives the interrupt')
      assert.doesNotMatch(finalTurn, /Still working/, 'the interrupted step is discarded')
      assert.match(finalTurn, /Carry on/)
    })
  })

  it(
    'remembers only the prompt when no step completed before the interrupt',
    { timeout: 10_000 },
    async () => {
      await withWorkspace(async (cwd) => {
        const interrupted = openResponse()
        const model = new MockLanguageModelV3({
          doStream: [interrupted.response, textResponse('Ready')]
        })
        const session = new Session(model, cwd)
        const events: AgentEvent[] = []

        interrupted.push({ type: 'stream-start', warnings: [] })
        interrupted.push({ type: 'text-start', id: 'text-1' })
        interrupted.push({
          type: 'text-delta',
          id: 'text-1',
          delta: 'Thinking'
        })

        for await (const event of session.prompt('Start something')) {
          events.push(event)

          if (event.type === 'text') {
            session.abort()
            interrupted.push({
              type: 'text-delta',
              id: 'text-1',
              delta: ' about it'
            })
          }
        }

        assert.equal(events.at(-1)?.type, 'aborted')
        assert.equal(session.isRunning, false)

        for await (const _event of session.prompt('Try again')) void _event

        const secondTurn = promptText(model.doStreamCalls[1]?.prompt)

        assert.match(secondTurn, /Start something/)
        assert.match(secondTurn, /Try again/)
        assert.doesNotMatch(secondTurn, /Thinking/, 'nothing completed, so nothing is remembered')
      })
    }
  )

  it('propagates a failure that is not an interruption', async () => {
    await withWorkspace(async (cwd) => {
      const model = new MockLanguageModelV3({
        doStream: () => {
          throw new Error('Rate limited')
        }
      })
      const session = new Session(model, cwd)

      await assert.rejects(async () => {
        for await (const _event of session.prompt('Help me')) void _event
      }, /Rate limited/)
      assert.equal(session.isRunning, false)
    })
  })

  it('leaves the history untouched when a turn fails', async () => {
    await withWorkspace(async (cwd) => {
      let attempts = 0
      const model = new MockLanguageModelV3({
        doStream: async () => {
          attempts += 1
          if (attempts === 1) throw new Error('Rate limited')

          return textResponse('Recovered')
        }
      })
      const session = new Session(model, cwd)

      await assert.rejects(async () => {
        for await (const _event of session.prompt('First attempt')) void _event
      }, /Rate limited/)

      for await (const _event of session.prompt('Second attempt')) void _event

      const prompt = promptText(model.doStreamCalls[1]?.prompt)

      assert.doesNotMatch(prompt, /First attempt/, 'the failed turn must not be remembered')
      assert.match(prompt, /Second attempt/)
    })
  })

  it('persists each committed turn and restores it into a new session', async () => {
    await withWorkspace(async (cwd) => {
      const root = await mkdtemp(join(tmpdir(), 'lefa-session-store-'))

      try {
        const store = new SessionStore(root)
        const model = new MockLanguageModelV3({
          doStream: [textResponse('Two files.')]
        })
        const session = new Session(model, cwd, { store })

        for await (const _event of session.prompt('List the files')) void _event

        const saved = await store.load(session.id)

        assert.equal(saved.meta.cwd, cwd)
        assert.equal(saved.meta.title, 'List the files', 'the first prompt titles the session')
        assert.equal(saved.messages.length, 2)

        const resumedModel = new MockLanguageModelV3({
          doStream: [textResponse('The readme.')]
        })
        const resumed = new Session(resumedModel, saved.meta.cwd, {
          id: saved.meta.id,
          messages: saved.messages,
          store
        })

        for await (const _event of resumed.prompt('Which was first?')) void _event

        const prompt = promptText(resumedModel.doStreamCalls[0]?.prompt)

        assert.equal(resumed.id, session.id)
        assert.match(prompt, /List the files/, 'the restored session carries prior context')
        assert.match(prompt, /Two files\./)
        assert.equal((await store.load(session.id)).messages.length, 4)
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    })
  })

  it('writes nothing more once the session is discarded', { timeout: 10_000 }, async () => {
    await withWorkspace(async (cwd) => {
      const root = await mkdtemp(join(tmpdir(), 'lefa-discard-'))

      try {
        const store = new SessionStore(root)
        const interrupted = openResponse()
        const model = new MockLanguageModelV3({ doStream: [interrupted.response] })
        const session = new Session(model, cwd, { store })

        interrupted.push({ type: 'stream-start', warnings: [] })
        interrupted.push({ type: 'text-start', id: 'text-1' })
        interrupted.push({ type: 'text-delta', id: 'text-1', delta: 'Working' })

        for await (const event of session.prompt('Start something')) {
          if (event.type !== 'text') continue

          // Stands in for deleting the session while its run is still going.
          session.discard()
          interrupted.push({ type: 'text-delta', id: 'text-1', delta: ' on it' })
        }

        assert.deepEqual(
          await store.list(),
          [],
          'a discarded session must not resurrect its file'
        )
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    })
  })

  it('reports a failure to save without losing the turn', async () => {
    await withWorkspace(async (cwd) => {
      const store = new SessionStore('/dev/null/not-a-directory')
      const model = new MockLanguageModelV3({
        doStream: [textResponse('Done'), textResponse('Still here')]
      })
      const session = new Session(model, cwd, { store })
      const events: AgentEvent[] = []

      for await (const event of session.prompt('Help me')) events.push(event)

      assert.deepEqual(events.at(-1), {
        type: 'error',
        message: 'Could not save this session to disk.'
      })

      for await (const _event of session.prompt('And again')) void _event

      assert.match(promptText(model.doStreamCalls[1]?.prompt), /Help me/)
    })
  })
})
