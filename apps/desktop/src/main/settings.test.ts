import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ home: '' }))

vi.mock('./agent', () => ({
  DEFAULT_MODEL: 'anthropic/claude-haiku-4.5',
  get lefaHome() {
    return mocks.home
  }
}))

beforeEach(async () => {
  vi.resetModules()
  mocks.home = await mkdtemp(join(tmpdir(), 'lefa-settings-'))
})

afterEach(async () => {
  await rm(mocks.home, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('settings', () => {
  it('round-trips the default model', async () => {
    const { readDefaultModel, writeDefaultModel } = await import('./settings')

    expect(await readDefaultModel()).toBe('anthropic/claude-haiku-4.5')

    await writeDefaultModel('openai/gpt-5.1-codex')

    expect(await readDefaultModel()).toBe('openai/gpt-5.1-codex')
    expect(JSON.parse(await readFile(join(mocks.home, 'settings.json'), 'utf8'))).toEqual({
      model: 'openai/gpt-5.1-codex'
    })
  })

  it('falls back to the default rather than failing on a broken file', async () => {
    const { readDefaultModel, writeDefaultModel } = await import('./settings')
    const path = join(mocks.home, 'settings.json')
    await writeDefaultModel('openai/gpt-5.1-codex')

    for (const contents of ['not json', '{}', '{"model":""}', '{"model":42}', 'null']) {
      await writeFile(path, contents)
      expect(await readDefaultModel()).toBe('anthropic/claude-haiku-4.5')
    }
  })
})
