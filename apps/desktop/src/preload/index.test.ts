import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LefaApi } from '../shared/api'

const electron = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn()
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  ipcRenderer: { invoke: electron.invoke }
}))

await import('./index')

function exposedApi(): LefaApi {
  expect(electron.exposeInMainWorld).toHaveBeenCalledOnce()
  expect(electron.exposeInMainWorld.mock.calls[0]?.[0]).toBe('lefa')
  return electron.exposeInMainWorld.mock.calls[0]?.[1] as LefaApi
}

beforeEach(() => {
  electron.invoke.mockReset()
})

describe('preload bridge', () => {
  it('exposes agent prompts through the expected IPC channel', async () => {
    electron.invoke.mockResolvedValue('answer')
    const api = exposedApi()
    const input = { cwd: '/tmp/workspace', prompt: 'Help me' }

    await expect(api.agent.prompt(input)).resolves.toBe('answer')
    expect(electron.invoke).toHaveBeenCalledWith('agent:prompt', input)
  })

  it('exposes workspace selection through the expected IPC channel', async () => {
    electron.invoke.mockResolvedValue('/tmp/workspace')
    const api = exposedApi()

    await expect(api.workspace.selectDirectory()).resolves.toBe('/tmp/workspace')
    expect(electron.invoke).toHaveBeenCalledWith('workspace:select-directory')
  })
})
