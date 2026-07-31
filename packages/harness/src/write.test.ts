import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { asSchema } from 'ai'
import { createWriteTool, type WriteOutput } from './write.ts'

interface RawWriteInput {
  path: string
  content: string
}

async function executeWrite(cwd: string, input: RawWriteInput): Promise<WriteOutput> {
  const write = createWriteTool(cwd)
  const validation = await asSchema(write.inputSchema).validate?.(input)

  if (validation === undefined) throw new Error('The write tool has no input validator')
  if (!validation.success) throw validation.error

  const output = await write.execute(validation.value, {
    toolCallId: 'test-write',
    messages: [],
    context: {}
  })

  if (Symbol.asyncIterator in output) {
    throw new Error('The write tool unexpectedly returned a stream')
  }

  return output
}

async function withWorkspace(
  run: (workspaceRoot: string, sandboxRoot: string) => Promise<void>
): Promise<void> {
  const sandboxRoot = await mkdtemp(join(tmpdir(), 'lefa-write-'))
  const workspaceRoot = join(sandboxRoot, 'workspace')
  await mkdir(workspaceRoot)

  try {
    await run(workspaceRoot, sandboxRoot)
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true })
  }
}

describe('write tool', () => {
  it('defines strict model input and text output', async () => {
    const write = createWriteTool('.')
    const schema = asSchema(write.inputSchema)

    assert.deepEqual(await schema.validate?.({ path: 'notes.txt', content: '' }), {
      success: true,
      value: { path: 'notes.txt', content: '' }
    })
    assert.equal((await schema.validate?.({ path: '', content: 'text' }))?.success, false)
    assert.equal(
      (await schema.validate?.({ path: 'notes.txt', content: 'text', extra: true }))?.success,
      false
    )
    assert.ok(write.toModelOutput)
    assert.deepEqual(
      await write.toModelOutput({
        toolCallId: 'test-write',
        input: { path: 'notes.txt', content: 'Hello' },
        output: { content: 'Successfully wrote notes.txt' }
      }),
      { type: 'text', value: 'Successfully wrote notes.txt' }
    )
  })

  it('creates parent directories and writes exact UTF-8 content', async () => {
    await withWorkspace(async (cwd) => {
      const content = 'Hello, Lefa 🙂\n'

      assert.deepEqual(
        await executeWrite(cwd, {
          path: 'nested/deep/notes.txt',
          content
        }),
        { content: 'Successfully wrote nested/deep/notes.txt' }
      )
      assert.equal(await readFile(join(cwd, 'nested/deep/notes.txt'), 'utf8'), content)
    })
  })

  it('overwrites and truncates an existing file, including to empty content', async () => {
    await withWorkspace(async (cwd) => {
      const path = join(cwd, 'notes.txt')
      await writeFile(path, 'long existing content')

      await executeWrite(cwd, { path: 'notes.txt', content: 'short' })
      assert.equal(await readFile(path, 'utf8'), 'short')

      await executeWrite(cwd, { path: 'notes.txt', content: '' })
      assert.equal(await readFile(path, 'utf8'), '')
    })
  })

  it('supports model-style and outside-workspace paths', async () => {
    await withWorkspace(async (cwd, sandboxRoot) => {
      await executeWrite(cwd, { path: '@inside.txt', content: 'inside' })
      await executeWrite(cwd, { path: '../outside.txt', content: 'outside' })

      assert.equal(await readFile(join(cwd, 'inside.txt'), 'utf8'), 'inside')
      assert.equal(await readFile(join(sandboxRoot, 'outside.txt'), 'utf8'), 'outside')
    })
  })

  it('follows symlinked directories outside the workspace', async () => {
    await withWorkspace(async (cwd, sandboxRoot) => {
      const outside = join(sandboxRoot, 'outside')
      await mkdir(outside)
      await symlink(outside, join(cwd, 'linked'))

      await executeWrite(cwd, { path: 'linked/notes.txt', content: 'outside' })

      assert.equal(await readFile(join(outside, 'notes.txt'), 'utf8'), 'outside')
    })
  })

  it('propagates filesystem failures', async () => {
    await withWorkspace(async (cwd) => {
      await mkdir(join(cwd, 'directory'))

      await assert.rejects(executeWrite(cwd, { path: 'directory', content: 'text' }), {
        code: 'EISDIR'
      })
    })
  })

  it('rejects an empty path after removing the model-style prefix', async () => {
    await withWorkspace(async (cwd) => {
      await assert.rejects(executeWrite(cwd, { path: '@', content: 'text' }), /must not be empty/)
    })
  })
})
