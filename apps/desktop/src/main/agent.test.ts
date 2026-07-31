import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  anthropic: vi.fn(),
  createAgent: vi.fn(),
  existsSync: vi.fn()
}))

vi.mock('@ai-sdk/anthropic', () => ({ anthropic: mocks.anthropic }))
vi.mock('@lefa/harness', () => ({ createAgent: mocks.createAgent }))
vi.mock('node:fs', () => ({ existsSync: mocks.existsSync }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('workspace agent', () => {
  it('uses Claude Haiku 4.5 and passes the workspace to the harness', async () => {
    const model = { id: 'model' }
    const agent = { id: 'agent' }
    mocks.existsSync.mockReturnValue(false)
    mocks.anthropic.mockReturnValue(model)
    mocks.createAgent.mockReturnValue(agent)
    const loadEnvFile = vi.spyOn(process, 'loadEnvFile').mockImplementation(() => {})

    const { createWorkspaceAgent } = await import('./agent')

    expect(createWorkspaceAgent('/tmp/workspace')).toBe(agent)
    expect(mocks.anthropic).toHaveBeenCalledWith('claude-haiku-4-5')
    expect(mocks.createAgent).toHaveBeenCalledWith(model, '/tmp/workspace')
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
