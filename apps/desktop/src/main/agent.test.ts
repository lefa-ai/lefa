import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  anthropic: vi.fn(),
  Session: vi.fn(),
  existsSync: vi.fn()
}))

vi.mock('@ai-sdk/anthropic', () => ({ anthropic: mocks.anthropic }))
vi.mock('@lefa/harness', () => ({ Session: mocks.Session }))
vi.mock('node:fs', () => ({ existsSync: mocks.existsSync }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('workspace session', () => {
  it('uses Claude Haiku 4.5 and passes the workspace to the harness', async () => {
    const model = { id: 'model' }
    mocks.existsSync.mockReturnValue(false)
    mocks.anthropic.mockReturnValue(model)
    const loadEnvFile = vi.spyOn(process, 'loadEnvFile').mockImplementation(() => {})

    const { createWorkspaceSession } = await import('./agent')
    const session = createWorkspaceSession('/tmp/workspace')

    expect(session).toBeInstanceOf(mocks.Session)
    expect(mocks.anthropic).toHaveBeenCalledWith('claude-haiku-4-5')
    expect(mocks.Session).toHaveBeenCalledWith(model, '/tmp/workspace')
    expect(loadEnvFile).not.toHaveBeenCalled()
  })

  it('loads a local .env file when one exists', async () => {
    mocks.existsSync.mockReturnValue(true)
    mocks.anthropic.mockReturnValue({ id: 'model' })
    const loadEnvFile = vi.spyOn(process, 'loadEnvFile').mockImplementation(() => {})

    await import('./agent')

    expect(mocks.existsSync).toHaveBeenCalledWith('.env')
    expect(loadEnvFile).toHaveBeenCalledOnce()
  })
})
