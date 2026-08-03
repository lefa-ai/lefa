import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { customProvider, type UIMessage } from 'ai'
import { convertArrayToReadableStream, MockLanguageModelV3 } from 'ai/test'
import { SessionStore } from './session-store.ts'
import { Session } from './session.ts'

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 }
}

type StreamResponse = Awaited<ReturnType<MockLanguageModelV3['doStream']>>
type StreamPart = StreamResponse['stream'] extends ReadableStream<infer Part> ? Part : never

function textResponse(...deltas: string[]): StreamResponse {
  return {
    stream: convertArrayToReadableStream<StreamPart>([
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 'text-1' },
      ...deltas.map((delta) => ({ type: 'text-delta' as const, id: 'text-1', delta })),
      { type: 'text-end', id: 'text-1' },
      { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage }
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
      { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage }
    ])
  }
}

/** A response the test feeds by hand, so a turn can be interrupted mid-stream. */
function openResponse(): { response: StreamResponse; push: (part: StreamPart) => void } {
  let controller!: ReadableStreamDefaultController<StreamPart>
  const stream = new ReadableStream<StreamPart>({
    start(streamController) {
      controller = streamController
    }
  })

  return { response: { stream }, push: (part) => controller.enqueue(part) }
}

function useModel(model: MockLanguageModelV3, id = 'test/model'): string {
  globalThis.AI_SDK_DEFAULT_PROVIDER = customProvider({ languageModels: { [id]: model } })

  return id
}

function textOf(message: UIMessage | undefined): string {
  return (message?.parts ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

async function withWorkspace(run: (cwd: string, root: string) => Promise<void>): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), 'lefa-session-'))
  const root = await mkdtemp(join(tmpdir(), 'lefa-session-store-'))

  try {
    await run(cwd, root)
  } finally {
    await rm(cwd, { recursive: true, force: true })
    await rm(root, { recursive: true, force: true })
  }
}

async function drain(session: Session, text: string): Promise<UIMessage[]> {
  const seen: UIMessage[] = []

  for await (const message of session.prompt(text)) seen.push(message)

  return seen
}

describe('session', () => {
  it('identifies itself and its workspace', async () => {
    await withWorkspace(async (cwd) => {
      const session = new Session(useModel(new MockLanguageModelV3()), cwd)

      assert.equal(session.cwd, cwd)
      assert.match(session.id, /^[0-9a-f-]{36}$/)
      assert.equal(session.isRunning, false)
      assert.deepEqual(session.messages, [])
    })
  })

  it('says what was asked before it says anything back', async () => {
    await withWorkspace(async (cwd) => {
      const model = new MockLanguageModelV3({ doStream: [textResponse('Two files.')] })
      const session = new Session(useModel(model), cwd)

      const seen = await drain(session, 'List the files')

      assert.equal(seen[0]?.role, 'user')
      assert.equal(textOf(seen[0]), 'List the files')
      assert.equal(seen.at(-1)?.role, 'assistant')
      assert.equal(textOf(seen.at(-1)), 'Two files.')
    })
  })

  it('yields the same reply again as it grows', async () => {
    await withWorkspace(async (cwd) => {
      const model = new MockLanguageModelV3({ doStream: [textResponse('It ', 'holds ', 'these.')] })
      const session = new Session(useModel(model), cwd)

      const replies = (await drain(session, 'What is in it?')).filter(
        (message) => message.role === 'assistant'
      )
      const ids = new Set(replies.map((reply) => reply.id))

      assert.ok(replies.length > 1, 'the reply arrived in pieces')
      assert.equal(ids.size, 1, 'every piece was the same message, further along')
      assert.deepEqual(
        replies.map(textOf),
        replies.map(textOf).toSorted((first, second) => first.length - second.length),
        'it only ever grew'
      )
      assert.equal(textOf(replies.at(-1)), 'It holds these.')
      assert.equal(session.messages.length, 2, 'the conversation kept one reply, not several')
    })
  })

  it('carries the conversation into the next turn', async () => {
    await withWorkspace(async (cwd) => {
      const model = new MockLanguageModelV3({
        doStream: [textResponse('Two files.'), textResponse('It holds the readme.')]
      })
      const session = new Session(useModel(model), cwd)

      await drain(session, 'List the files')
      await drain(session, 'What is in the first one?')

      assert.equal(model.doStreamCalls.length, 2)
      assert.match(JSON.stringify(model.doStreamCalls[1]?.prompt), /Two files\./)
      assert.deepEqual(
        session.messages.map((message) => message.role),
        ['user', 'assistant', 'user', 'assistant']
      )
    })
  })

  it('records what produced each reply', async () => {
    await withWorkspace(async (cwd) => {
      const model = new MockLanguageModelV3({ doStream: [textResponse('Done')] })
      const session = new Session(useModel(model), cwd)

      await drain(session, 'Go')

      assert.deepEqual(session.messages.at(-1)?.metadata, { model: 'test/model' })
    })
  })

  it('writes each message as it goes', async () => {
    await withWorkspace(async (cwd, root) => {
      const store = new SessionStore(root)
      const model = new MockLanguageModelV3({ doStream: [textResponse('Saved.')] })
      const session = new Session(useModel(model), cwd, { store })

      await drain(session, 'Write it down')

      const reloaded = await store.load(session.id)

      assert.equal(reloaded.meta.title, 'Write it down')
      assert.equal(reloaded.meta.model, 'test/model')
      // Through JSON on both sides: a key set to undefined does not survive the
      // trip, and neither side is wrong about that.
      assert.deepEqual(reloaded.messages, JSON.parse(JSON.stringify(session.messages)))
    })
  })

  it('keeps what an interrupted turn managed to say', async () => {
    await withWorkspace(async (cwd, root) => {
      const store = new SessionStore(root)
      const interrupted = openResponse()
      const model = new MockLanguageModelV3({ doStream: [interrupted.response] })
      const session = new Session(useModel(model), cwd, { store })

      interrupted.push({ type: 'stream-start', warnings: [] })
      interrupted.push({ type: 'text-start', id: 'text-1' })
      interrupted.push({ type: 'text-delta', id: 'text-1', delta: 'Still working' })

      for await (const message of session.prompt('Take a while')) {
        if (message.role === 'assistant' && textOf(message)) {
          session.abort()
          // Wake the reader so the abort is observed and the stream closes.
          interrupted.push({ type: 'text-delta', id: 'text-1', delta: ' on it' })
        }
      }

      assert.equal(session.isRunning, false)
      const saved = await store.load(session.id)
      assert.match(textOf(saved.messages.at(-1)), /Still working/)
      assert.equal(saved.messages.length, 2, 'the half-finished reply is on disk with the prompt')
    })
  })

  it('sends an interrupted tool call to nobody', async () => {
    await withWorkspace(async (cwd) => {
      const interrupted = openResponse()
      const model = new MockLanguageModelV3({
        doStream: [interrupted.response, textResponse('Carrying on.')]
      })
      const session = new Session(useModel(model), cwd)

      interrupted.push({ type: 'stream-start', warnings: [] })
      interrupted.push({
        type: 'tool-input-start',
        id: 'call-1',
        toolName: 'bash'
      })
      interrupted.push({ type: 'tool-input-delta', id: 'call-1', delta: '{"command":"sleep' })

      for await (const message of session.prompt('Run something slow')) {
        if (message.role === 'assistant') {
          session.abort()
          interrupted.push({ type: 'tool-input-delta', id: 'call-1', delta: ' 60"}' })
        }
      }

      // A tool call with no result is a fine thing to have said and an
      // impossible thing to send, so the next turn must still go through.
      await drain(session, 'Never mind, carry on')

      assert.equal(model.doStreamCalls.length, 2)
    })
  })

  it('runs a tool and remembers what it returned', async () => {
    await withWorkspace(async (cwd) => {
      const model = new MockLanguageModelV3({
        doStream: [writeResponse('created.txt', 'from the agent'), textResponse('Created it.')]
      })
      const session = new Session(useModel(model), cwd)

      await drain(session, 'Create the file')

      assert.equal(await readFile(join(cwd, 'created.txt'), 'utf8'), 'from the agent')
      const parts = session.messages.flatMap((message) => message.parts)
      const tool = parts.find((part) => part.type.startsWith('tool-'))
      assert.equal((tool as { state?: string })?.state, 'output-available')
    })
  })

  it('refuses to start a second turn while one is running', async () => {
    await withWorkspace(async (cwd) => {
      const model = new MockLanguageModelV3({ doStream: [textResponse('Only once')] })
      const session = new Session(useModel(model), cwd)
      const turn = session.prompt('First')

      await turn.next()
      await assert.rejects(async () => {
        for await (const _ of session.prompt('Second')) void _
      }, /already running/)

      for await (const _ of turn) void _
      assert.equal(model.doStreamCalls.length, 1)
    })
  })

  it('switches model mid-conversation and keeps the history', async () => {
    await withWorkspace(async (cwd, root) => {
      const store = new SessionStore(root)
      const first = new MockLanguageModelV3({ doStream: [textResponse('From the first')] })
      const second = new MockLanguageModelV3({ doStream: [textResponse('From the second')] })
      globalThis.AI_SDK_DEFAULT_PROVIDER = customProvider({
        languageModels: { 'test/first': first, 'test/second': second }
      })
      const session = new Session('test/first', cwd, { store })

      await drain(session, 'Start here')
      session.setModel('test/second')
      await drain(session, 'And now')

      assert.equal(second.doStreamCalls.length, 1, 'the next turn runs on the new model')
      assert.match(JSON.stringify(second.doStreamCalls[0]?.prompt), /Start here/)
      assert.equal((await store.load(session.id)).meta.model, 'test/second')
      assert.deepEqual(session.messages.at(-1)?.metadata, { model: 'test/second' })
    })
  })

  it('writes nothing more once the session is discarded', async () => {
    await withWorkspace(async (cwd, root) => {
      const store = new SessionStore(root)
      const model = new MockLanguageModelV3({
        doStream: [textResponse('One'), textResponse('Two')]
      })
      const session = new Session(useModel(model), cwd, { store })

      await drain(session, 'Remember this')
      session.discard()
      await drain(session, 'But not this')

      assert.deepEqual((await store.load(session.id)).messages.map(textOf), [
        'Remember this',
        'One'
      ])
    })
  })

  it('survives a store that cannot be written to', async () => {
    await withWorkspace(async (cwd) => {
      const store = new SessionStore('/dev/null/not-a-directory')
      const model = new MockLanguageModelV3({ doStream: [textResponse('Still fine')] })
      const session = new Session(useModel(model), cwd, { store })

      const seen = await drain(session, 'Help me')

      assert.equal(textOf(seen.at(-1)), 'Still fine', 'the turn survived the failure to save')
    })
  })
})
