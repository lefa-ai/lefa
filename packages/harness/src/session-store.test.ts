import assert from 'node:assert/strict'
import { appendFile, mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import type { ModelMessage } from 'ai'
import { SessionStore, type SessionMeta } from './session-store.ts'

const idA = '11111111-1111-4111-8111-111111111111'
const idB = '22222222-2222-4222-8222-222222222222'

function meta(id: string, title = 'List the files'): SessionMeta {
  return {
    id,
    cwd: '/tmp/workspace',
    createdAt: '2026-08-01T10:00:00.000Z',
    title
  }
}

const turn: ModelMessage[] = [
  { role: 'user', content: 'List the files' },
  { role: 'assistant', content: [{ type: 'text', text: 'Two files.' }] }
]

async function withStore(run: (store: SessionStore, root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'lefa-store-'))

  try {
    await run(new SessionStore(join(root, 'sessions')), join(root, 'sessions'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe('session store', () => {
  it('round-trips a conversation across appends', async () => {
    await withStore(async (store) => {
      await store.append(meta(idA), turn)
      await store.append(meta(idA), [{ role: 'user', content: 'And now?' }])

      const record = await store.load(idA)

      assert.deepEqual(record.meta, meta(idA))
      assert.equal(record.messages.length, 3)
      assert.deepEqual(record.messages[0], turn[0])
      assert.deepEqual(record.messages[2], {
        role: 'user',
        content: 'And now?'
      })
    })
  })

  it('writes the metadata header exactly once', async () => {
    await withStore(async (store, root) => {
      await store.append(meta(idA), turn)
      await store.append(meta(idA), [{ role: 'user', content: 'Again' }])

      const lines = (await readFile(join(root, `${idA}.jsonl`), 'utf8')).trim().split('\n')

      assert.equal(lines.filter((line) => line.includes('"type":"meta"')).length, 1)
      assert.match(lines[0] ?? '', /^\{"type":"meta"/)
    })
  })

  it('lists sessions newest first without reading the conversation', async () => {
    await withStore(async (store, root) => {
      await store.append(meta(idA, 'Older'), turn)
      await store.append(meta(idB, 'Newer'), turn)
      // Make the ordering unambiguous regardless of filesystem timestamp resolution.
      await appendFile(join(root, `${idB}.jsonl`), '')
      const huge = 'x'.repeat(200_000)
      await appendFile(
        join(root, `${idB}.jsonl`),
        `${JSON.stringify({ type: 'message', message: { role: 'user', content: huge } })}\n`
      )

      const sessions = await store.list()

      assert.deepEqual(
        sessions.map((session) => session.title),
        ['Newer', 'Older']
      )
      assert.equal(sessions[0]?.cwd, '/tmp/workspace')
      assert.ok(sessions[0]?.updatedAt)
      // The 200 KB body must not appear anywhere in the summary.
      assert.ok(!JSON.stringify(sessions).includes('xxxxx'))
    })
  })

  it('survives a half-written final line', async () => {
    await withStore(async (store, root) => {
      await store.append(meta(idA), turn)
      const path = join(root, `${idA}.jsonl`)
      const size = (await readFile(path, 'utf8')).length
      await truncate(path, size - 12)

      const record = await store.load(idA)

      assert.deepEqual(record.meta, meta(idA))
      assert.equal(record.messages.length, 1, 'the torn line is skipped, the rest survives')
      assert.equal((await store.list())[0]?.title, 'List the files')
    })
  })

  it('ignores files that are not readable sessions', async () => {
    await withStore(async (store, root) => {
      await store.append(meta(idA), turn)
      await writeFile(join(root, 'notes.txt'), 'ignored')
      await writeFile(join(root, `${idB}.jsonl`), 'not json at all\n')
      await writeFile(join(root, '33333333-3333-4333-8333-333333333333.jsonl'), '')

      assert.deepEqual(
        (await store.list()).map((session) => session.id),
        [idA]
      )
      await assert.rejects(() => store.load(idB), /missing its metadata/)
    })
  })

  it('drops lines that parse as JSON but are not valid messages', async () => {
    await withStore(async (store, root) => {
      await store.append(meta(idA), turn)
      const path = join(root, `${idA}.jsonl`)

      for (const junk of [
        { type: 'message', message: { role: 'wizard', content: 'nope' } },
        { type: 'message', message: { role: 'user' } },
        { type: 'message' },
        { type: 'something-else', message: { role: 'user', content: 'ok' } },
        { hello: 'world' }
      ]) {
        await appendFile(path, `${JSON.stringify(junk)}\n`)
      }

      const record = await store.load(idA)

      assert.equal(record.messages.length, 2, 'only the two real messages survive')
      assert.deepEqual(record.messages, turn)
    })
  })

  it('keeps fields the message schema does not know about', async () => {
    await withStore(async (store) => {
      const withOptions: ModelMessage = {
        role: 'user',
        content: 'Cache me',
        providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } }
      }
      await store.append(meta(idA), [withOptions])

      assert.deepEqual((await store.load(idA)).messages[0], withOptions)
    })
  })

  it('lists nothing when no session has been saved', async () => {
    await withStore(async (store) => {
      assert.deepEqual(await store.list(), [])
    })
  })

  it('deletes a session and tolerates deleting it twice', async () => {
    await withStore(async (store) => {
      await store.append(meta(idA), turn)
      await store.delete(idA)
      await store.delete(idA)

      assert.deepEqual(await store.list(), [])
    })
  })

  it('refuses session ids that could escape the store directory', async () => {
    await withStore(async (store) => {
      for (const id of ['../escape', 'not-a-uuid', '../../etc/passwd', `${idA}/../${idB}`]) {
        await assert.rejects(() => store.load(id), /Invalid session id/)
        await assert.rejects(() => store.delete(id), /Invalid session id/)
      }
    })
  })
})
