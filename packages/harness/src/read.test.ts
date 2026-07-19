import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { createReadTool, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from './read.ts'

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
  it('reads a text file relative to the workspace', async () => {
    await withWorkspace(async (workspaceRoot) => {
      await writeFile(join(workspaceRoot, 'notes.txt'), 'Hello\nfrom Lefa')

      const result = await createReadTool(workspaceRoot).execute({ path: 'notes.txt' })

      assert.equal(result.content, 'Hello\nfrom Lefa')
      assert.equal(result.details, undefined)
    })
  })

  it('strips the model-style @ path prefix used by Pi', async () => {
    await withWorkspace(async (workspaceRoot) => {
      await writeFile(join(workspaceRoot, 'notes.txt'), 'content')

      const result = await createReadTool(workspaceRoot).execute({ path: '@notes.txt' })

      assert.equal(result.content, 'content')
    })
  })

  it('supports 1-indexed offset and limit with a continuation hint', async () => {
    await withWorkspace(async (workspaceRoot) => {
      const lines = Array.from({ length: 10 }, (_, index) => `Line ${index + 1}`)
      await writeFile(join(workspaceRoot, 'lines.txt'), lines.join('\n'))

      const result = await createReadTool(workspaceRoot).execute({
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

  it("truncates at Pi's default line limit", async () => {
    await withWorkspace(async (workspaceRoot) => {
      const lines = Array.from({ length: DEFAULT_MAX_LINES + 1 }, (_, index) => `Line ${index + 1}`)
      await writeFile(join(workspaceRoot, 'large.txt'), lines.join('\n'))

      const result = await createReadTool(workspaceRoot).execute({ path: 'large.txt' })

      assert.match(result.content, /Line 2000/)
      assert.doesNotMatch(result.content, /Line 2001/)
      assert.match(result.content, /Use offset=2001 to continue/)
      assert.equal(result.details?.truncation?.truncatedBy, 'lines')
    })
  })

  it("truncates at Pi's default byte limit without returning partial lines", async () => {
    await withWorkspace(async (workspaceRoot) => {
      const lines = Array.from(
        { length: 400 },
        (_, index) => `Line ${index + 1}: ${'x'.repeat(200)}`
      )
      await writeFile(join(workspaceRoot, 'large.txt'), lines.join('\n'))

      const result = await createReadTool(workspaceRoot).execute({ path: 'large.txt' })

      assert.equal(result.details?.truncation?.truncatedBy, 'bytes')
      assert.ok(
        (result.details?.truncation?.outputBytes ?? DEFAULT_MAX_BYTES + 1) <= DEFAULT_MAX_BYTES
      )
      assert.match(result.content, /50\.0KB limit/)
    })
  })

  it('rejects an offset beyond the end of the file', async () => {
    await withWorkspace(async (workspaceRoot) => {
      await writeFile(join(workspaceRoot, 'short.txt'), 'Line 1\nLine 2')

      await assert.rejects(
        createReadTool(workspaceRoot).execute({ path: 'short.txt', offset: 3 }),
        /Offset 3 is beyond end of file \(2 lines total\)/
      )
    })
  })

  it('rejects absolute paths', async () => {
    await withWorkspace(async (workspaceRoot, sandboxRoot) => {
      const outsidePath = join(sandboxRoot, 'outside.txt')
      await writeFile(outsidePath, 'outside')

      await assert.rejects(
        createReadTool(workspaceRoot).execute({ path: outsidePath }),
        /relative to the workspace/
      )
    })
  })

  it('rejects parent traversal', async () => {
    await withWorkspace(async (workspaceRoot, sandboxRoot) => {
      await writeFile(join(sandboxRoot, 'outside.txt'), 'outside')

      await assert.rejects(
        createReadTool(workspaceRoot).execute({ path: '../outside.txt' }),
        /must not traverse outside the workspace/
      )
    })
  })

  it('rejects symlinks that resolve outside the workspace', async () => {
    await withWorkspace(async (workspaceRoot, sandboxRoot) => {
      const outsidePath = join(sandboxRoot, 'outside.txt')
      await writeFile(outsidePath, 'outside')
      await symlink(outsidePath, join(workspaceRoot, 'linked.txt'))

      await assert.rejects(
        createReadTool(workspaceRoot).execute({ path: 'linked.txt' }),
        /resolves outside the workspace/
      )
    })
  })

  it('honors an already-aborted signal', async () => {
    await withWorkspace(async (workspaceRoot) => {
      await writeFile(join(workspaceRoot, 'notes.txt'), 'content')
      const controller = new AbortController()
      controller.abort()

      await assert.rejects(
        createReadTool(workspaceRoot).execute({ path: 'notes.txt' }, controller.signal),
        { name: 'AbortError' }
      )
    })
  })
})
