import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { asSchema } from 'ai'
import { createEditTool, type EditOutput } from './edit.ts'

interface RawEditInput {
  path: string
  oldText: string
  newText: string
}

async function executeEdit(cwd: string, input: RawEditInput): Promise<EditOutput> {
  const edit = createEditTool(cwd)
  const validation = await asSchema(edit.inputSchema).validate?.(input)

  if (validation === undefined) throw new Error('The edit tool has no input validator')
  if (!validation.success) throw validation.error

  const output = await edit.execute(validation.value, {
    toolCallId: 'test-edit',
    messages: [],
    context: {}
  })

  if (Symbol.asyncIterator in output) {
    throw new Error('The edit tool unexpectedly returned a stream')
  }

  return output
}

async function withWorkspace(
  run: (workspaceRoot: string, sandboxRoot: string) => Promise<void>
): Promise<void> {
  const sandboxRoot = await mkdtemp(join(tmpdir(), 'lefa-edit-'))
  const workspaceRoot = join(sandboxRoot, 'workspace')
  await mkdir(workspaceRoot)

  try {
    await run(workspaceRoot, sandboxRoot)
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true })
  }
}

describe('edit tool', () => {
  it('defines strict model input and text output', async () => {
    const edit = createEditTool('.')
    const schema = asSchema(edit.inputSchema)

    assert.deepEqual(
      await schema.validate?.({ path: 'notes.txt', oldText: 'before', newText: '' }),
      {
        success: true,
        value: { path: 'notes.txt', oldText: 'before', newText: '' }
      }
    )
    assert.equal(
      (await schema.validate?.({ path: 'notes.txt', oldText: '', newText: 'after' }))?.success,
      false
    )
    assert.equal(
      (
        await schema.validate?.({
          path: 'notes.txt',
          oldText: 'before',
          newText: 'after',
          extra: true
        })
      )?.success,
      false
    )
    assert.ok(edit.toModelOutput)
    assert.deepEqual(
      await edit.toModelOutput({
        toolCallId: 'test-edit',
        input: { path: 'notes.txt', oldText: 'before', newText: 'after' },
        output: { content: 'Successfully edited notes.txt' }
      }),
      { type: 'text', value: 'Successfully edited notes.txt' }
    )
  })

  it('replaces one unique exact block while preserving the rest of the file', async () => {
    await withWorkspace(async (cwd) => {
      const path = join(cwd, 'notes.txt')
      await writeFile(path, 'before\nold block 🙂\nafter\n')

      assert.deepEqual(
        await executeEdit(cwd, {
          path: 'notes.txt',
          oldText: 'old block 🙂',
          newText: 'new block'
        }),
        { content: 'Successfully edited notes.txt' }
      )
      assert.equal(await readFile(path, 'utf8'), 'before\nnew block\nafter\n')
    })
  })

  it('supports deleting the matched text', async () => {
    await withWorkspace(async (cwd) => {
      const path = join(cwd, 'notes.txt')
      await writeFile(path, 'keep\nremove me\nkeep')

      await executeEdit(cwd, {
        path: 'notes.txt',
        oldText: 'remove me\n',
        newText: ''
      })

      assert.equal(await readFile(path, 'utf8'), 'keep\nkeep')
    })
  })

  it('rejects a missing match without changing the file', async () => {
    await withWorkspace(async (cwd) => {
      const path = join(cwd, 'notes.txt')
      const content = 'unchanged'
      await writeFile(path, content)

      await assert.rejects(
        executeEdit(cwd, {
          path: 'notes.txt',
          oldText: 'missing',
          newText: 'replacement'
        }),
        /Could not find oldText in notes\.txt/
      )
      assert.equal(await readFile(path, 'utf8'), content)
    })
  })

  it('rejects a non-unique match without changing the file', async () => {
    await withWorkspace(async (cwd) => {
      const path = join(cwd, 'notes.txt')
      const content = 'same\nmiddle\nsame'
      await writeFile(path, content)

      await assert.rejects(
        executeEdit(cwd, {
          path: 'notes.txt',
          oldText: 'same',
          newText: 'different'
        }),
        /oldText must be unique in notes\.txt/
      )
      assert.equal(await readFile(path, 'utf8'), content)
    })
  })

  it('supports outside-workspace and symlinked files', async () => {
    await withWorkspace(async (cwd, sandboxRoot) => {
      const outsidePath = join(sandboxRoot, 'outside.txt')
      await writeFile(outsidePath, 'before')
      await symlink(outsidePath, join(cwd, 'linked.txt'))

      await executeEdit(cwd, {
        path: 'linked.txt',
        oldText: 'before',
        newText: 'after'
      })
      assert.equal(await readFile(outsidePath, 'utf8'), 'after')

      await executeEdit(cwd, {
        path: '../outside.txt',
        oldText: 'after',
        newText: 'done'
      })
      assert.equal(await readFile(outsidePath, 'utf8'), 'done')
    })
  })

  it('propagates missing-file failures', async () => {
    await withWorkspace(async (cwd) => {
      await assert.rejects(
        executeEdit(cwd, {
          path: 'missing.txt',
          oldText: 'before',
          newText: 'after'
        }),
        { code: 'ENOENT' }
      )
    })
  })

  it('rejects an empty path after removing the model-style prefix', async () => {
    await withWorkspace(async (cwd) => {
      await assert.rejects(
        executeEdit(cwd, { path: '@', oldText: 'before', newText: 'after' }),
        /must not be empty/
      )
    })
  })
})
