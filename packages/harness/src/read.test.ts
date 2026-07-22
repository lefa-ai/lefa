import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { describe, it } from 'node:test'
import { asSchema } from 'ai'
import { createReadTool, type ReadOutput } from './read.ts'

interface RawReadInput {
  path: string
  offset?: number
  limit?: number
}

function executeRead(
  cwd: string,
  input: RawReadInput,
  abortSignal?: AbortSignal
): Promise<ReadOutput> {
  return execute()

  async function execute(): Promise<ReadOutput> {
    const read = createReadTool(cwd)
    const validation = await asSchema(read.inputSchema).validate?.(input)

    if (validation === undefined) throw new Error('The read tool has no input validator')
    if (!validation.success) throw validation.error

    const output = await read.execute(validation.value, {
      toolCallId: 'test-read',
      messages: [],
      context: {},
      ...(abortSignal === undefined ? {} : { abortSignal })
    })

    if (Symbol.asyncIterator in output) {
      throw new Error('The read tool unexpectedly returned a stream')
    }

    return output
  }
}

async function withWorkspace(
  run: (workspaceRoot: string, sandboxRoot: string) => Promise<void>
): Promise<void> {
  const sandboxRoot = await mkdtemp(join(tmpdir(), 'lefa-read-'))
  const workspaceRoot = join(sandboxRoot, 'workspace')
  await mkdir(workspaceRoot)

  try {
    await run(workspaceRoot, sandboxRoot)
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true })
  }
}

describe('read tool', () => {
  it('reads a text file relative to the current working directory', async () => {
    await withWorkspace(async (cwd) => {
      await writeFile(join(cwd, 'notes.txt'), 'Hello\nfrom Lefa')

      const result = await executeRead(cwd, {
        path: 'notes.txt'
      })

      assert.equal(result.content, 'Hello\nfrom Lefa')
    })
  })

  it('strips the model-style @ path prefix used by Pi', async () => {
    await withWorkspace(async (workspaceRoot) => {
      await writeFile(join(workspaceRoot, 'notes.txt'), 'content')

      const result = await executeRead(workspaceRoot, {
        path: '@notes.txt'
      })

      assert.equal(result.content, 'content')
    })
  })

  it('supports 1-indexed offset and limit with a continuation hint', async () => {
    await withWorkspace(async (workspaceRoot) => {
      const lines = Array.from({ length: 10 }, (_, index) => `Line ${index + 1}`)
      await writeFile(join(workspaceRoot, 'lines.txt'), lines.join('\n'))

      const result = await executeRead(workspaceRoot, {
        path: 'lines.txt',
        offset: 4,
        limit: 3
      })

      assert.equal(
        result.content,
        'Line 4\nLine 5\nLine 6\n\n[4 more lines in file. Use offset=7 to continue.]'
      )
    })
  })

  it('does not count a trailing newline as an extra line', async () => {
    await withWorkspace(async (workspaceRoot) => {
      await writeFile(join(workspaceRoot, 'lines.txt'), 'Line 1\nLine 2\n')

      const result = await executeRead(workspaceRoot, {
        path: 'lines.txt',
        limit: 2
      })

      assert.equal(result.content, 'Line 1\nLine 2')
    })
  })

  it('defines the model input and text output', async () => {
    const read = createReadTool('.')
    const schema = asSchema(read.inputSchema)
    const validation = await schema.validate?.({ path: 'notes.txt' })

    assert.deepEqual(validation, {
      success: true,
      value: { path: 'notes.txt', offset: 1, limit: 2000 }
    })
    assert.ok(read.toModelOutput)
    assert.deepEqual(
      await read.toModelOutput({
        toolCallId: 'test-read',
        input: { path: 'notes.txt', offset: 1, limit: 2000 },
        output: { content: 'Hello' }
      }),
      { type: 'text', value: 'Hello' }
    )
  })

  it("truncates at Pi's default line limit", async () => {
    await withWorkspace(async (workspaceRoot) => {
      const lines = Array.from({ length: 2001 }, (_, index) => `Line ${index + 1}`)
      await writeFile(join(workspaceRoot, 'large.txt'), lines.join('\n'))

      const result = await executeRead(workspaceRoot, {
        path: 'large.txt'
      })

      assert.match(result.content, /Line 2000/)
      assert.doesNotMatch(result.content, /Line 2001/)
      assert.match(result.content, /Use offset=2001 to continue/)
    })
  })

  it("truncates at Pi's default byte limit without returning partial lines", async () => {
    await withWorkspace(async (workspaceRoot) => {
      const lines = Array.from(
        { length: 400 },
        (_, index) => `Line ${index + 1}: ${'x'.repeat(200)}`
      )
      await writeFile(join(workspaceRoot, 'large.txt'), lines.join('\n'))

      const result = await executeRead(workspaceRoot, {
        path: 'large.txt'
      })
      const returnedText = result.content.split('\n\n[')[0] ?? ''

      assert.ok(Buffer.byteLength(returnedText, 'utf8') <= 50 * 1024)
      assert.match(result.content, /Use offset=\d+ to continue/)
    })
  })

  it('rejects a line that exceeds the byte limit', async () => {
    await withWorkspace(async (workspaceRoot) => {
      await writeFile(join(workspaceRoot, 'long-line.txt'), 'x'.repeat(50 * 1024 + 1))

      await assert.rejects(
        executeRead(workspaceRoot, { path: 'long-line.txt' }),
        /first requested line exceeds the 50 KB limit/
      )
    })
  })

  it('rejects an offset beyond the end of the file', async () => {
    await withWorkspace(async (workspaceRoot) => {
      await writeFile(join(workspaceRoot, 'short.txt'), 'Line 1\nLine 2')

      await assert.rejects(
        executeRead(workspaceRoot, { path: 'short.txt', offset: 3 }),
        /Offset 3 is beyond end of file \(2 lines total\)/
      )
    })
  })

  it('reads absolute paths', async () => {
    await withWorkspace(async (cwd, sandboxRoot) => {
      const outsidePath = join(sandboxRoot, 'outside.txt')
      await writeFile(outsidePath, 'outside')

      const result = await executeRead(cwd, { path: outsidePath })

      assert.equal(result.content, 'outside')
    })
  })

  it('reads paths outside the current working directory', async () => {
    await withWorkspace(async (cwd, sandboxRoot) => {
      await writeFile(join(sandboxRoot, 'outside.txt'), 'outside')

      const result = await executeRead(cwd, { path: '../outside.txt' })

      assert.equal(result.content, 'outside')
    })
  })

  it('follows symlinks outside the current working directory', async () => {
    await withWorkspace(async (cwd, sandboxRoot) => {
      const outsidePath = join(sandboxRoot, 'outside.txt')
      await writeFile(outsidePath, 'outside')
      await symlink(outsidePath, join(cwd, 'linked.txt'))

      const result = await executeRead(cwd, { path: 'linked.txt' })

      assert.equal(result.content, 'outside')
    })
  })

  it('expands home-relative paths', async () => {
    const sandboxRoot = await mkdtemp(join(homedir(), 'lefa-read-'))

    try {
      await writeFile(join(sandboxRoot, 'notes.txt'), 'from home')

      const result = await executeRead(tmpdir(), {
        path: `~/${basename(sandboxRoot)}/notes.txt`
      })

      assert.equal(result.content, 'from home')
    } finally {
      await rm(sandboxRoot, { recursive: true, force: true })
    }
  })

  it('honors an already-aborted signal', async () => {
    await withWorkspace(async (workspaceRoot) => {
      await writeFile(join(workspaceRoot, 'notes.txt'), 'content')
      const controller = new AbortController()
      controller.abort()

      await assert.rejects(executeRead(workspaceRoot, { path: 'notes.txt' }, controller.signal), {
        name: 'AbortError'
      })
    })
  })
})
