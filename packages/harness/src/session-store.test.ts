import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import type { UIMessage } from 'ai'
import { SessionStore, type SessionMeta } from './session-store.ts'

const ID = '11111111-2222-3333-4444-555555555555'
const OTHER = '66666666-7777-8888-9999-aaaaaaaaaaaa'

function meta(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: ID,
    cwd: '/tmp/workspace',
    createdAt: '2026-08-01T10:00:00.000Z',
    title: 'A task',
    model: 'anthropic/claude-haiku-4.5',
    ...overrides
  }
}

function said(id: string, text: string, role: UIMessage['role'] = 'assistant'): UIMessage {
  return { id, role, parts: [{ type: 'text', text }] }
}

async function withStore(run: (store: SessionStore, root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'lefa-store-'))

  try {
    await run(new SessionStore(root), root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe('session store', () => {
  it('keeps what a session is apart from what was said', async () => {
    await withStore(async (store, root) => {
      await store.save(meta())
      await store.append(ID, said('m1', 'Hello', 'user'))
      await store.append(ID, said('m2', 'Hi there'))

      const record = await store.load(ID)

      assert.deepEqual(record.meta, meta())
      assert.deepEqual(record.messages, [said('m1', 'Hello', 'user'), said('m2', 'Hi there')])
      assert.match(await readFile(join(root, `${ID}.json`), 'utf8'), /"title": "A task"/)
      assert.equal(
        (await readFile(join(root, `${ID}.jsonl`), 'utf8')).trimEnd().split('\n').length,
        2
      )
    })
  })

  it('rewrites only the last line as a message grows', async () => {
    await withStore(async (store, root) => {
      await store.save(meta())
      await store.append(ID, said('m1', 'Settled'))
      await store.append(ID, said('m2', 'Wor'))
      await store.replaceLast(ID, said('m2', 'Working'))
      await store.replaceLast(ID, said('m2', 'Working on it.'))

      const lines = (await readFile(join(root, `${ID}.jsonl`), 'utf8')).trimEnd().split('\n')

      assert.equal(lines.length, 2, 'the message was rewritten, not appended again')
      assert.deepEqual((await store.load(ID)).messages, [
        said('m1', 'Settled'),
        said('m2', 'Working on it.')
      ])
    })
  })

  it('counts the last line in bytes, not characters', async () => {
    await withStore(async (store) => {
      await store.save(meta())
      // Emoji and accents take more bytes than characters; an offset measured
      // in characters would cut the previous line in half.
      await store.append(ID, said('m1', 'héllo 🌍 première'))
      await store.append(ID, said('m2', 'partial'))
      await store.replaceLast(ID, said('m2', 'complete 🎉'))

      assert.deepEqual((await store.load(ID)).messages, [
        said('m1', 'héllo 🌍 première'),
        said('m2', 'complete 🎉')
      ])
    })
  })

  it('picks up rewriting where a reload left off', async () => {
    await withStore(async (store, root) => {
      await store.save(meta())
      await store.append(ID, said('m1', 'First'))
      await store.append(ID, said('m2', 'Second'))

      // A fresh store has never written this session, so it learns where the
      // last line starts by reading it.
      const reopened = new SessionStore(root)
      await reopened.load(ID)
      await reopened.replaceLast(ID, said('m2', 'Second, revised'))

      assert.deepEqual((await reopened.load(ID)).messages, [
        said('m1', 'First'),
        said('m2', 'Second, revised')
      ])
    })
  })

  it('appends when it has never seen the session before', async () => {
    await withStore(async (store) => {
      await store.save(meta())
      await store.replaceLast(ID, said('m1', 'Only'))

      assert.deepEqual((await store.load(ID)).messages, [said('m1', 'Only')])
    })
  })

  it('drops a half-written final line and writes over it', async () => {
    await withStore(async (store, root) => {
      await store.save(meta())
      await store.append(ID, said('m1', 'Survives'))
      // A crash mid-rewrite leaves the last line truncated.
      await writeFile(
        join(root, `${ID}.jsonl`),
        `${JSON.stringify(said('m1', 'Survives'))}\n{"id":"m2","role":"assi`,
        'utf8'
      )

      const reopened = new SessionStore(root)
      assert.deepEqual((await reopened.load(ID)).messages, [said('m1', 'Survives')])
      assert.equal(
        await readFile(join(root, `${ID}.jsonl`), 'utf8'),
        `${JSON.stringify(said('m1', 'Survives'))}\n`,
        'the wreckage was cut away rather than skipped forever'
      )

      // The next turn carries on from the last message that survived.
      await reopened.append(ID, said('m3', 'Carrying on'))

      assert.deepEqual((await reopened.load(ID)).messages, [
        said('m1', 'Survives'),
        said('m3', 'Carrying on')
      ])
    })
  })

  it('keeps a message exactly as it was written', async () => {
    await withStore(async (store) => {
      await store.save(meta())
      // Provider metadata is not something the store understands, and losing it
      // would cost the model its own reasoning signatures.
      const rich = {
        id: 'm1',
        role: 'assistant',
        metadata: { model: 'anthropic/claude-opus-5' },
        parts: [
          { type: 'reasoning', text: 'Thinking', providerMetadata: { anthropic: { sig: 'abc' } } },
          { type: 'text', text: 'Done' }
        ]
      } as unknown as UIMessage

      await store.append(ID, rich)

      assert.deepEqual((await store.load(ID)).messages, [rich])
    })
  })

  it('lists sessions newest first and ignores what it cannot read', async () => {
    await withStore(async (store, root) => {
      await store.save(meta({ title: 'Older' }))
      await store.append(ID, said('m1', 'One'))
      await new Promise((resolve) => setTimeout(resolve, 10))
      await store.save(meta({ id: OTHER, title: 'Newer' }))
      await store.append(OTHER, said('m2', 'Two'))
      await writeFile(join(root, 'not-a-session.json'), '{"nope":true}', 'utf8')
      await writeFile(join(root, 'broken.json'), 'not json at all', 'utf8')

      assert.deepEqual(
        (await store.list()).map((summary) => summary.title),
        ['Newer', 'Older']
      )
    })
  })

  it('lists a session that has not said anything yet', async () => {
    await withStore(async (store) => {
      await store.save(meta({ title: '' }))

      const [summary] = await store.list()

      assert.equal(summary?.id, ID)
      assert.match(summary?.updatedAt ?? '', /^\d{4}-/)
    })
  })

  it('has nothing to list before anything is saved', async () => {
    await withStore(async (store) => {
      assert.deepEqual(await store.list(), [])
    })
  })

  it('removes both files and forgets where it was writing', async () => {
    await withStore(async (store) => {
      await store.save(meta())
      await store.append(ID, said('m1', 'Gone soon'))
      await store.delete(ID)

      assert.deepEqual(await store.list(), [])
      await assert.rejects(store.load(ID))
    })
  })

  it('never trusts an id as a path', async () => {
    await withStore(async (store) => {
      await assert.rejects(store.load('../escape'), /Invalid session id/)
      await assert.rejects(store.append('../escape', said('m1', 'no')), /Invalid session id/)
      await assert.rejects(store.replaceLast('../escape', said('m1', 'no')), /Invalid session id/)
      await assert.rejects(store.delete('../escape'), /Invalid session id/)
      await assert.rejects(store.save(meta({ id: 'not-a-uuid' })), /Invalid session id/)
    })
  })
})
