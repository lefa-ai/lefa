import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { customProvider, type ModelMessage } from 'ai'
import { convertArrayToReadableStream, MockLanguageModelV3 } from 'ai/test'
import type { SessionNotification } from './events.ts'
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

/** A store whose writes can be held open, to catch a snapshot mid-save. */
class HeldStore extends SessionStore {
  private gate: Promise<void> | undefined
  private release: (() => void) | undefined
  private started: (() => void) | undefined
  saving: Promise<void> = Promise.resolve()

  hold(): void {
    this.gate = new Promise((resolve) => {
      this.release = resolve
    })
    this.saving = new Promise((resolve) => {
      this.started = resolve
    })
  }

  resume(): void {
    this.release?.()
  }

  override async append(
    meta: Parameters<SessionStore['append']>[0],
    model: string,
    messages: readonly ModelMessage[]
  ): Promise<void> {
    this.started?.()
    await this.gate
    await super.append(meta, model, messages)
  }
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
  store: HeldStore
  manager: SessionManager
  heard: SessionNotification[]
  events: (sessionId: string) => unknown[]
  idle: (sessionId: string) => Promise<void>
}

async function withManager(
  run: (harness: Harness) => Promise<void>,
  options: { describeError?: (error: unknown) => string } = {}
): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), 'lefa-manager-'))
  const root = await mkdtemp(join(tmpdir(), 'lefa-manager-store-'))

  try {
    const store = new HeldStore(root)
    const manager = new SessionManager({ store, ...options })
    const heard: SessionNotification[] = []
    manager.subscribe((notification) => heard.push(notification))

    await run({
      cwd,
      store,
      manager,
      heard,
      events: (sessionId) =>
        heard
          .filter(
            (notification) => notification.type === 'event' && notification.sessionId === sessionId
          )
          .map((notification) => (notification as { event: unknown }).event),
      idle: (sessionId) =>
        waitFor(
          () =>
            heard.some(
              (notification) =>
                notification.type === 'status' &&
                notification.sessionId === sessionId &&
                notification.status === 'idle'
            ),
          `session ${sessionId} to go idle`
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
      assert.deepEqual(opened.events, [])
    })
  })

  it('returns from a prompt before the turn it started has finished', async () => {
    await withManager(async ({ cwd, manager, heard }) => {
      const turn = openResponse()
      const model = new MockLanguageModelV3({ doStream: [turn.response] })
      const { id } = manager.open(cwd, useModel(model))

      manager.prompt(id, 'Take your time')

      // The call has already returned while the model is still streaming.
      assert.deepEqual(heard[0], { type: 'status', sessionId: id, status: 'running' })
      assert.deepEqual(heard[1], {
        type: 'event',
        sessionId: id,
        event: { type: 'prompt', text: 'Take your time' }
      })
      assert.equal((await manager.attach(id)).status, 'running')

      turn.push({ type: 'stream-start', warnings: [] })
      turn.push({ type: 'text-start', id: 'text-1' })
      turn.push({ type: 'text-delta', id: 'text-1', delta: 'Done.' })
      turn.push({ type: 'text-end', id: 'text-1' })
      turn.finish()

      await waitFor(
        () => heard.some((n) => n.type === 'status' && n.status === 'idle'),
        'the turn to finish'
      )
      assert.equal((await manager.attach(id)).status, 'idle')
    })
  })

  it('shows the committed conversation and the turn in flight together', async () => {
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

      await waitFor(async () => {
        const events = (await manager.attach(id)).events
        return events.some((event) => event.type === 'text' && event.text === 'It holds ')
      }, 'the partial answer to arrive')

      const attached = await manager.attach(id)

      assert.equal(attached.status, 'running')
      assert.deepEqual(attached.events, [
        { type: 'prompt', text: 'List the files' },
        { type: 'text', text: 'Two files.' },
        { type: 'prompt', text: 'Read the first' },
        { type: 'text', text: 'It holds ' }
      ])

      second.push({ type: 'text-end', id: 'text-2' })
      second.finish()
      await idle(id)
    })
  })

  it('does not show the turn twice while it is being saved', async () => {
    await withManager(async ({ cwd, manager, store, idle }) => {
      const model = new MockLanguageModelV3({ doStream: [textResponse('Saved soon.')] })
      const { id } = manager.open(cwd, useModel(model))

      // The session commits the turn to its history and only then writes it, so
      // a snapshot taken during the write is the one that could double up.
      store.hold()
      manager.prompt(id, 'Write it down')
      await store.saving

      const attached = await manager.attach(id)

      assert.equal(attached.status, 'running')
      assert.deepEqual(attached.events, [
        { type: 'prompt', text: 'Write it down' },
        { type: 'text', text: 'Saved soon.' }
      ])

      store.resume()
      await idle(id)
      assert.deepEqual((await manager.attach(id)).events, attached.events)
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

      assert.deepEqual(
        late.filter((n) => n.type === 'event').map((n) => n.event),
        [{ type: 'text', text: 'Still here.' }]
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

  it('reports a run failure as an event and returns to idle', async () => {
    await withManager(
      async ({ cwd, manager, heard, idle }) => {
        const model = new MockLanguageModelV3({
          doStream: () => Promise.reject(new Error('unauthorized'))
        })
        const { id } = manager.open(cwd, useModel(model))

        manager.prompt(id, 'Help me')
        await idle(id)

        assert.deepEqual(heard.at(-2), {
          type: 'event',
          sessionId: id,
          event: { type: 'error', message: 'No key. Set one.' }
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
        type: 'event',
        sessionId: id,
        event: { type: 'error', message: 'model is overloaded' }
      })
    })
  })

  it('refuses to start a second turn while one is running', async () => {
    await withManager(async ({ cwd, manager, idle }) => {
      const turn = openResponse()
      const model = new MockLanguageModelV3({ doStream: [turn.response] })
      const { id } = manager.open(cwd, useModel(model))

      manager.prompt(id, 'First')
      assert.throws(() => manager.prompt(id, 'Second'), /already running/)

      turn.push({ type: 'stream-start', warnings: [] })
      turn.finish()
      await idle(id)
    })
  })

  it('interrupts a running turn', async () => {
    await withManager(async ({ cwd, manager, events, idle }) => {
      const turn = openResponse()
      const model = new MockLanguageModelV3({ doStream: [turn.response] })
      const { id } = manager.open(cwd, useModel(model))

      manager.prompt(id, 'Take a while')
      turn.push({ type: 'stream-start', warnings: [] })
      turn.push({ type: 'text-start', id: 'text-1' })
      turn.push({ type: 'text-delta', id: 'text-1', delta: 'Still working' })
      await waitFor(() => events(id).length === 2, 'the turn to start speaking')

      manager.abort(id)
      // Wake the reader so the abort is observed and the stream closes.
      turn.push({ type: 'text-delta', id: 'text-1', delta: ' on it' })
      await idle(id)

      assert.deepEqual(events(id).at(-1), { type: 'aborted' })
      assert.equal((await manager.attach(id)).status, 'idle')
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
      await waitFor(async () => (await manager.attach(id)).events.length === 4, 'the second turn')

      assert.deepEqual((await manager.attach(id)).events, [
        { type: 'prompt', text: 'First' },
        { type: 'text', text: 'Stored' },
        { type: 'prompt', text: 'Second' },
        { type: 'text', text: 'Newer' }
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
      assert.deepEqual(attached.events, [
        { type: 'prompt', text: 'List the files' },
        { type: 'text', text: 'Two files.' }
      ])
      assert.deepEqual(
        (await reopened.list()).map((summary) => summary.title),
        ['List the files']
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
