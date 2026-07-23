import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import type { LanguageModel } from 'ai'
import { createAgent } from './index.ts'
import { MAX_BYTES } from './truncate.ts'

const model = {} as LanguageModel

async function withWorkspace(run: (workspaceRoot: string) => void | Promise<void>): Promise<void> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'lefa-agent-'))

  try {
    await run(workspaceRoot)
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
}

describe('agent instructions', () => {
  it('ignores a symlinked AGENTS.md', async () => {
    await withWorkspace(async (workspaceRoot) => {
      const target = join(workspaceRoot, 'target')
      await mkdir(target)
      await symlink(target, join(workspaceRoot, 'AGENTS.md'))

      assert.doesNotThrow(() => createAgent(model, workspaceRoot))
    })
  })

  it('rejects an oversized AGENTS.md', async () => {
    await withWorkspace(async (workspaceRoot) => {
      await writeFile(join(workspaceRoot, 'AGENTS.md'), 'x'.repeat(MAX_BYTES + 1))

      assert.throws(() => createAgent(model, workspaceRoot), /AGENTS.md exceeds the 50 KB limit/)
    })
  })
})
