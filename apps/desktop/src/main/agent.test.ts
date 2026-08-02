import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  Session: vi.fn(),
  SessionStore: vi.fn(),
  existsSync: vi.fn()
}))

vi.mock('@lefa/harness', () => ({ Session: mocks.Session, SessionStore: mocks.SessionStore }))
vi.mock('node:fs', () => ({ existsSync: mocks.existsSync }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('workspace session', () => {
  it('passes the chosen model and workspace straight to the harness', async () => {
    mocks.existsSync.mockReturnValue(false)
    const loadEnvFile = vi.spyOn(process, 'loadEnvFile').mockImplementation(() => {})

    const { createWorkspaceSession, sessionStore, DEFAULT_MODEL } = await import('./agent')
    const session = createWorkspaceSession('/tmp/workspace', 'openai/gpt-5.1-codex')

    expect(session).toBeInstanceOf(mocks.Session)
    expect(DEFAULT_MODEL).toBe('anthropic/claude-haiku-4.5')
    expect(mocks.Session).toHaveBeenCalledWith('openai/gpt-5.1-codex', '/tmp/workspace', {
      store: sessionStore
    })
    expect(mocks.SessionStore).toHaveBeenCalledWith(join(homedir(), '.lefa', 'sessions'))
    expect(loadEnvFile).not.toHaveBeenCalled()
  })

  it('keeps caller options while forcing the shared store', async () => {
    mocks.existsSync.mockReturnValue(false)
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => {})

    const { createWorkspaceSession, sessionStore } = await import('./agent')
    createWorkspaceSession('/tmp/workspace', 'anthropic/claude-opus-5', { title: 'Earlier work' })

    expect(mocks.Session).toHaveBeenCalledWith('anthropic/claude-opus-5', '/tmp/workspace', {
      title: 'Earlier work',
      store: sessionStore
    })
  })

  it('loads a local .env file when one exists', async () => {
    mocks.existsSync.mockReturnValue(true)
    const loadEnvFile = vi.spyOn(process, 'loadEnvFile').mockImplementation(() => {})

    await import('./agent')

    expect(mocks.existsSync).toHaveBeenCalledWith('.env')
    expect(loadEnvFile).toHaveBeenCalledOnce()
  })
})
