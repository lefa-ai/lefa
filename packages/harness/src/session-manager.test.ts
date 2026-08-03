import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { customProvider, type UIMessage } from 'ai'
import { convertArrayToReadableStream, MockLanguageModelV3 } from 'ai/test'
import type { SessionNotification } from './protocol.ts'
import { SessionManager } from './session-manager.ts'
import { SessionStore } from './session-store.ts'

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
      { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage }
    ])
  }
}

/** A response the test feeds by hand, so a turn can be inspected mid-flight. */
function openResponse(): {
  response: StreamResponse
  push: (part: StreamPart) => void
  finish: () => void
} {
  let controller!: ReadableStreamDefaultController<StreamPart>
  const stream = new ReadableStream<StreamPart>({
    start(streamController) {
      controller = streamController
    }
  })

  return {
    response: { stream },
    push: (part) => controller.enqueue(part),
    finish: () => {
      controller.enqueue({
        type: 'finish',
        finishReason: { unified: 'stop', raw: undefined },
        usage
      })
      controller.close()
    }
  }
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

/** What the conversation looks like: who said what, in order. */
function transcript(messages: readonly UIMessage[]): string[] {
  return messages.map((message) => `${message.role}: ${textOf(message)}`)
}

async function waitFor(check: () => boolean | Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 5_000

  while (Date.now() < deadline) {
    if (await check()) return

    await new Promise((resolve) => setTimeout(resolve, 1))
  }

  throw new Error(`Timed out waiting for ${what}.`)
}

interface Harness {
  cwd: string
  store: SessionStore
  manager: SessionManager
  heard: SessionNotification[]
  /** Waits for the session's `times`-th finished turn, not just any past one. */
  idle: (sessionId: string, times?: number) => Promise<void>
}

async function withManager(
  run: (harness: Harness) => Promise<void>,
  options: { describeError?: (error: unknown) => string } = {}
): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), 'lefa-manager-'))
  const root = await mkdtemp(join(tmpdir(), 'lefa-manager-store-'))

  try {
    const store = new SessionStore(root)
    const manager = new SessionManager({ store, ...options })
    const heard: SessionNotification[] = []
    manager.subscribe((notification) => heard.push(notification))

    await run({
      cwd,
      store,
      manager,
      heard,
      idle: (sessionId, times = 1) =>
        waitFor(
          () =>
            heard.filter(
              (notification) =>
                notification.type === 'status' &&
                notification.sessionId === sessionId &&
                notification.status === 'idle'
            ).length >= times,
          `session ${sessionId} to finish ${times} turn(s)`
        )
    })
  } finally {
    await rm(cwd, { recursive: true, force: true })
    await rm(root, { recursive: true, force: true })
  }
}

describe('session manager', () => {
  it('opens an empty session that is not doing anything', async () => {
    await withManager(async ({ cwd, manager }) => {
      useModel(new MockLanguageModelV3())
      const opened = manager.open(cwd, 'test/model')

      assert.match(opened.id, /^[0-9a-f-]{36}$/)
      assert.equal(opened.cwd, cwd)
      assert.equal(opened.model, 'test/model')
      assert.equal(opened.status, 'idle')
      assert.deepEqual(opened.messages, [])
      assert.deepEqual(opened.queued, [])
    })
  })

  it('returns from a prompt before the turn it started has finished', async () => {
    await withManager(async ({ cwd, manager, heard, idle }) => {
      const turn = openResponse()
      const model = new MockLanguageModelV3({ doStream: [turn.response] })
      const { id } = manager.open(cwd, useModel(model))

      manager.prompt(id, 'Take your time')

      // The call has already returned while the model is still streaming.
      assert.deepEqual(heard[0], { type: 'status', sessionId: id, status: 'running' })
      assert.equal((await manager.attach(id)).status, 'running')

      turn.push({ type: 'stream-start', warnings: [] })
      turn.push({ type: 'text-start', id: 'text-1' })
      turn.push({ type: 'text-delta', id: 'text-1', delta: 'Done.' })
      turn.push({ type: 'text-end', id: 'text-1' })
      turn.finish()
      await idle(id)

      assert.equal((await manager.attach(id)).status, 'idle')
    })
  })

  it('shows the conversation and the reply in flight together', async () => {
    await withManager(async ({ cwd, manager, idle }) => {
      const second = openResponse()
      const model = new MockLanguageModelV3({
        doStream: [textResponse('Two files.'), second.response]
      })
      const { id } = manager.open(cwd, useModel(model))

      manager.prompt(id, 'List the files')
      await idle(id)

      manager.prompt(id, 'Read the first')
      second.push({ type: 'stream-start', warnings: [] })
      second.push({ type: 'text-start', id: 'text-2' })
      second.push({ type: 'text-delta', id: 'text-2', delta: 'It holds ' })

      await waitFor(
        async () => textOf((await manager.attach(id)).messages.at(-1)) === 'It holds ',
        'the partial answer to arrive'
      )

      const attached = await manager.attach(id)

      assert.equal(attached.status, 'running')
      assert.deepEqual(transcript(attached.messages), [
        'user: List the files',
        'assistant: Two files.',
        'user: Read the first',
        'assistant: It holds '
      ])

      second.push({ type: 'text-end', id: 'text-2' })
      second.finish()
      await idle(id)
    })
  })

  it('sends the same message again as it grows, never a second copy', async () => {
    await withManager(async ({ cwd, manager, heard, idle }) => {
      const model = new MockLanguageModelV3({ doStream: [textResponse('Growing')] })
      const { id } = manager.open(cwd, useModel(model))

      manager.prompt(id, 'Go')
      await idle(id)

      const sent = heard.filter((notification) => notification.type === 'message')
      const ids = new Set(sent.map((notification) => notification.message.id))

      assert.equal(ids.size, 2, 'one message asked, one answered — however many updates')
      assert.deepEqual(transcript((await manager.attach(id)).messages), [
        'user: Go',
        'assistant: Growing'
      ])
    })
  })

  it('keeps running for a watcher that arrives late', async () => {
    await withManager(async ({ cwd, manager, idle }) => {
      const turn = openResponse()
      const model = new MockLanguageModelV3({ doStream: [turn.response] })
      const { id } = manager.open(cwd, useModel(model))
      manager.prompt(id, 'Start')

      const late: SessionNotification[] = []
      manager.subscribe((notification) => late.push(notification))

      turn.push({ type: 'stream-start', warnings: [] })
      turn.push({ type: 'text-start', id: 'text-1' })
      turn.push({ type: 'text-delta', id: 'text-1', delta: 'Still here.' })
      turn.push({ type: 'text-end', id: 'text-1' })
      turn.finish()
      await idle(id)

      assert.ok(
        late.some(
          (notification) =>
            notification.type === 'message' && textOf(notification.message) === 'Still here.'
        ),
        'it heard the rest of the turn it walked in on'
      )
    })
  })

  it('stops telling a watcher that has unsubscribed', async () => {
    await withManager(async ({ cwd, manager, idle }) => {
      const model = new MockLanguageModelV3({ doStream: [textResponse('One')] })
      const { id } = manager.open(cwd, useModel(model))
      const seen: SessionNotification[] = []
      const stop = manager.subscribe((notification) => seen.push(notification))

      stop()
      manager.prompt(id, 'Go')
      await idle(id)

      assert.deepEqual(seen, [])
    })
  })

  it('reports a run failure and returns to idle', async () => {
    await withManager(
      async ({ cwd, manager, heard, idle }) => {
        const model = new MockLanguageModelV3({
          doStream: () => Promise.reject(new Error('unauthorized'))
        })
        const { id } = manager.open(cwd, useModel(model))

        manager.prompt(id, 'Help me')
        await idle(id)

        assert.deepEqual(heard.at(-2), {
          type: 'error',
          sessionId: id,
          error: 'No key. Set one.'
        })
        assert.deepEqual(heard.at(-1), { type: 'status', sessionId: id, status: 'idle' })
        assert.equal((await manager.attach(id)).status, 'idle')
      },
      { describeError: () => 'No key. Set one.' }
    )
  })

  it('reports a failure in the provider’s own words by default', async () => {
    await withManager(async ({ cwd, manager, heard, idle }) => {
      const model = new MockLanguageModelV3({
        doStream: () => Promise.reject(new Error('model is overloaded'))
      })
      const { id } = manager.open(cwd, useModel(model))

      manager.prompt(id, 'Help me')
      await idle(id)

      assert.deepEqual(heard.at(-2), {
        type: 'error',
        sessionId: id,
        error: 'model is overloaded'
      })
    })
  })

  it('queues a prompt sent into a turn already running, and runs it next', async () => {
    await withManager(async ({ cwd, manager, heard, idle }) => {
      const turn = openResponse()
      const model = new MockLanguageModelV3({
        doStream: [turn.response, textResponse('On it.'), textResponse('That too.')]
      })
      const { id } = manager.open(cwd, useModel(model))

      manager.prompt(id, 'Start')
      manager.prompt(id, 'Also do this')
      manager.prompt(id, 'And this')

      assert.deepEqual(heard.at(-1), {
        type: 'queued',
        sessionId: id,
        prompts: ['Also do this', 'And this']
      })
      assert.deepEqual((await manager.attach(id)).queued, ['Also do this', 'And this'])

      turn.push({ type: 'stream-start', warnings: [] })
      turn.push({ type: 'text-start', id: 'text-1' })
      turn.push({ type: 'text-delta', id: 'text-1', delta: 'Started.' })
      turn.push({ type: 'text-end', id: 'text-1' })
      turn.finish()
      await idle(id)

      // One stretch of work: the session never blinks idle between turns.
      assert.deepEqual(
        heard.filter((n) => n.type === 'status').map((n) => n.status),
        ['running', 'idle']
      )
      assert.deepEqual(transcript((await manager.attach(id)).messages), [
        'user: Start',
        'assistant: Started.',
        'user: Also do this',
        'assistant: On it.',
        'user: And this',
        'assistant: That too.'
      ])
      assert.deepEqual((await manager.attach(id)).queued, [])
    })
  })

  it('drops the queue when the turn it was written for is interrupted', async () => {
    await withManager(async ({ cwd, manager, idle }) => {
      const turn = openResponse()
      const model = new MockLanguageModelV3({ doStream: [turn.response, textResponse('Unused')] })
      const { id } = manager.open(cwd, useModel(model))

      manager.prompt(id, 'Take a while')
      turn.push({ type: 'stream-start', warnings: [] })
      turn.push({ type: 'text-start', id: 'text-1' })
      turn.push({ type: 'text-delta', id: 'text-1', delta: 'Still working' })
      manager.prompt(id, 'Follow up on that')
      await waitFor(
        async () => textOf((await manager.attach(id)).messages.at(-1)) === 'Still working',
        'the turn to start speaking'
      )

      manager.abort(id)
      // Wake the reader so the abort is observed and the stream closes.
      turn.push({ type: 'text-delta', id: 'text-1', delta: ' on it' })
      await idle(id)

      assert.equal(model.doStreamCalls.length, 1, 'the follow-up was written for a plan that ended')
      assert.deepEqual((await manager.attach(id)).queued, [])
    })
  })

  it('ignores an interruption for a session it does not have', async () => {
    await withManager(async ({ manager }) => {
      assert.equal(manager.abort('missing'), undefined)
    })
  })

  it('refuses to prompt or re-model a session it does not have', async () => {
    await withManager(async ({ manager }) => {
      assert.throws(() => manager.prompt('missing', 'Hello'), /no longer open/)
      assert.throws(() => manager.setModel('missing', 'test/other'), /no longer open/)
    })
  })

  it('switches the model a session runs on', async () => {
    await withManager(async ({ cwd, manager, idle }) => {
      const first = new MockLanguageModelV3({ doStream: [textResponse('From the first')] })
      const second = new MockLanguageModelV3({ doStream: [textResponse('From the second')] })
      globalThis.AI_SDK_DEFAULT_PROVIDER = customProvider({
        languageModels: { 'test/first': first, 'test/second': second }
      })
      const { id } = manager.open(cwd, 'test/first')

      manager.setModel(id, 'test/second')
      assert.equal((await manager.attach(id)).model, 'test/second')

      manager.prompt(id, 'Go')
      await idle(id)

      assert.equal(first.doStreamCalls.length, 0)
      assert.equal(second.doStreamCalls.length, 1)
    })
  })

  it('prefers a session already in memory over the one on disk', async () => {
    await withManager(async ({ cwd, manager, idle }) => {
      const model = new MockLanguageModelV3({
        doStream: [textResponse('Stored'), textResponse('Newer')]
      })
      const { id } = manager.open(cwd, useModel(model))

      manager.prompt(id, 'First')
      await idle(id)
      manager.prompt(id, 'Second')
      await idle(id, 2)

      assert.deepEqual(transcript((await manager.attach(id)).messages), [
        'user: First',
        'assistant: Stored',
        'user: Second',
        'assistant: Newer'
      ])
    })
  })

  it('loads a session from disk and lists what is saved', async () => {
    await withManager(async ({ cwd, store, manager, idle }) => {
      const model = new MockLanguageModelV3({ doStream: [textResponse('Two files.')] })
      const { id } = manager.open(cwd, useModel(model))

      manager.prompt(id, 'List the files')
      await idle(id)

      const reopened = new SessionManager({ store })
      const attached = await reopened.attach(id)

      assert.equal(attached.id, id)
      assert.equal(attached.cwd, cwd)
      assert.equal(attached.model, 'test/model')
      assert.equal(attached.status, 'idle')
      assert.deepEqual(transcript(attached.messages), [
        'user: List the files',
        'assistant: Two files.'
      ])
      assert.deepEqual(
        (await reopened.list()).map((listing) => [listing.title, listing.status]),
        [['List the files', 'idle']]
      )
    })
  })

  it('says which of the saved sessions are working', async () => {
    await withManager(async ({ cwd, manager, idle }) => {
      const second = openResponse()
      const model = new MockLanguageModelV3({
        doStream: [textResponse('Done'), textResponse('Done'), second.response]
      })
      const quiet = manager.open(cwd, useModel(model))
      const busy = manager.open(cwd, 'test/model')

      // Both need a saved turn before the store knows about them at all.
      manager.prompt(quiet.id, 'Finish quickly')
      await idle(quiet.id)
      manager.prompt(busy.id, 'Finish quickly')
      await idle(busy.id)

      manager.prompt(busy.id, 'Now take a while')

      assert.deepEqual(
        Object.fromEntries((await manager.list()).map((listing) => [listing.id, listing.status])),
        { [quiet.id]: 'idle', [busy.id]: 'running' }
      )

      second.push({ type: 'stream-start', warnings: [] })
      second.finish()
      await idle(busy.id, 2)

      assert.ok(
        (await manager.list()).every((listing) => listing.status === 'idle'),
        'a finished turn leaves nothing marked as working'
      )
    })
  })

  it('stops a session and removes it for good', async () => {
    await withManager(async ({ cwd, manager, idle }) => {
      const model = new MockLanguageModelV3({ doStream: [textResponse('Gone soon')] })
      const { id } = manager.open(cwd, useModel(model))

      manager.prompt(id, 'Something')
      await idle(id)
      await manager.delete(id)

      assert.deepEqual(await manager.list(), [])
      assert.throws(() => manager.prompt(id, 'Again'), /no longer open/)
      await assert.rejects(manager.attach(id))
    })
  })
})
