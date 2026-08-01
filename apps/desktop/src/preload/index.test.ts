import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LefaApi } from '../shared/api'

const electron = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  off: vi.fn()
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  ipcRenderer: { invoke: electron.invoke, on: electron.on, off: electron.off }
}))

await import('./index')

function exposedApi(): LefaApi {
  expect(electron.exposeInMainWorld).toHaveBeenCalledOnce()
  expect(electron.exposeInMainWorld.mock.calls[0]?.[0]).toBe('lefa')
  return electron.exposeInMainWorld.mock.calls[0]?.[1] as LefaApi
}

beforeEach(() => {
  electron.invoke.mockReset()
  electron.on.mockReset()
  electron.off.mockReset()
})

describe('preload bridge', () => {
  it('exposes agent prompts through the expected IPC channel', async () => {
    electron.invoke.mockResolvedValue(undefined)
    const api = exposedApi()
    const input = { cwd: '/tmp/workspace', prompt: 'Help me' }

    await expect(api.agent.prompt(input)).resolves.toBeUndefined()
    expect(electron.invoke).toHaveBeenCalledWith('agent:prompt', input)
  })

  it('forwards agent events to the listener and unsubscribes on cleanup', () => {
    const api = exposedApi()
    const listener = vi.fn()

    const unsubscribe = api.agent.onEvent(listener)
    const [channel, handler] = electron.on.mock.calls[0] as [
      string,
      (event: unknown, agentEvent: unknown) => void
    ]

    expect(channel).toBe('agent:event')

    handler({ senderId: 1 }, { type: 'text', text: 'Hello' })
    expect(listener).toHaveBeenCalledWith({ type: 'text', text: 'Hello' })

    unsubscribe()
    expect(electron.off).toHaveBeenCalledWith('agent:event', handler)
  })

  it('exposes workspace selection through the expected IPC channel', async () => {
    electron.invoke.mockResolvedValue('/tmp/workspace')
    const api = exposedApi()

    await expect(api.workspace.selectDirectory()).resolves.toBe('/tmp/workspace')
    expect(electron.invoke).toHaveBeenCalledWith('workspace:select-directory')
  })
})
