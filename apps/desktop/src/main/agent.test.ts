import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  SessionManager: vi.fn(),
  SessionStore: vi.fn(),
  existsSync: vi.fn()
}))

vi.mock('@lefa/harness', () => ({
  SessionManager: mocks.SessionManager,
  SessionStore: mocks.SessionStore
}))
vi.mock('node:fs', () => ({ existsSync: mocks.existsSync }))
vi.mock('@ai-sdk/gateway', () => ({
  GatewayAuthenticationError: { isInstance: (error: unknown) => (error as Error)?.name === 'Auth' }
}))

/** The wording the manager will use for a run that failed. */
function describeError(): (error: unknown) => string {
  const options = mocks.SessionManager.mock.calls[0]?.[0] as {
    describeError: (error: unknown) => string
  }

  return options.describeError
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.existsSync.mockReturnValue(false)
  vi.spyOn(process, 'loadEnvFile').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('session ownership', () => {
  it('keeps every session and run behind one manager over a plain home directory', async () => {
    const { sessionManager, lefaHome, DEFAULT_MODEL } = await import('./agent')

    expect(DEFAULT_MODEL).toBe('anthropic/claude-haiku-4.5')
    expect(lefaHome).toBe(join(homedir(), '.lefa'))
    expect(mocks.SessionStore).toHaveBeenCalledWith(join(homedir(), '.lefa', 'sessions'))
    expect(sessionManager).toBeInstanceOf(mocks.SessionManager)
    expect(mocks.SessionManager).toHaveBeenCalledWith({
      store: mocks.SessionStore.mock.instances[0],
      describeError: expect.any(Function)
    })
  })

  it('loads a local .env file when one exists', async () => {
    mocks.existsSync.mockReturnValue(true)

    await import('./agent')

    expect(mocks.existsSync).toHaveBeenCalledWith('.env')
    expect(process.loadEnvFile).toHaveBeenCalledOnce()
  })

  it('turns a missing gateway key into an actionable message', async () => {
    await import('./agent')

    expect(describeError()(Object.assign(new Error('unauthorized'), { name: 'Auth' }))).toBe(
      'No AI Gateway key. Set AI_GATEWAY_API_KEY in apps/desktop/.env.'
    )
  })

  it('passes any other failure through in the provider’s own words', async () => {
    await import('./agent')

    expect(describeError()(new Error('model is overloaded'))).toBe('model is overloaded')
    expect(describeError()('just a string')).toBe('just a string')
  })
})
