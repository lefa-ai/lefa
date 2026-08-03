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
  it('exposes session lifecycle calls through the expected IPC channels', async () => {
    const api = exposedApi()

    electron.invoke.mockResolvedValueOnce('session-1')
    await expect(api.session.open('/tmp/workspace')).resolves.toBe('session-1')
    expect(electron.invoke).toHaveBeenCalledWith('session:open', '/tmp/workspace')

    const input = { sessionId: 'session-1', prompt: 'Help me' }
    electron.invoke.mockResolvedValueOnce(undefined)
    await expect(api.session.prompt(input)).resolves.toBeUndefined()
    expect(electron.invoke).toHaveBeenCalledWith('session:prompt', input)

    electron.invoke.mockResolvedValueOnce(undefined)
    await expect(api.session.abort('session-1')).resolves.toBeUndefined()
    expect(electron.invoke).toHaveBeenCalledWith('session:abort', 'session-1')
  })

  it('exposes session history calls through the expected IPC channels', async () => {
    const api = exposedApi()

    electron.invoke.mockResolvedValueOnce([])
    await expect(api.session.list()).resolves.toEqual([])
    expect(electron.invoke).toHaveBeenCalledWith('session:list')

    const attached = {
      id: 'session-1',
      cwd: '/tmp/workspace',
      model: 'anthropic/claude-haiku-4.5',
      status: 'running' as const,
      events: []
    }
    electron.invoke.mockResolvedValueOnce(attached)
    await expect(api.session.attach('session-1')).resolves.toEqual(attached)
    expect(electron.invoke).toHaveBeenCalledWith('session:attach', 'session-1')

    electron.invoke.mockResolvedValueOnce(undefined)
    await expect(api.session.delete('session-1')).resolves.toBeUndefined()
    expect(electron.invoke).toHaveBeenCalledWith('session:delete', 'session-1')
  })

  it('forwards session notifications to the listener and unsubscribes on cleanup', () => {
    const api = exposedApi()
    const listener = vi.fn()

    const unsubscribe = api.session.onNotify(listener)
    const [channel, handler] = electron.on.mock.calls[0] as [
      string,
      (event: unknown, notification: unknown) => void
    ]

    expect(channel).toBe('session:notify')

    for (const notification of [
      { type: 'event', sessionId: 'session-1', event: { type: 'text', text: 'Hello' } },
      { type: 'status', sessionId: 'session-1', status: 'idle' }
    ]) {
      handler({ senderId: 1 }, notification)
      expect(listener).toHaveBeenCalledWith(notification)
    }

    unsubscribe()
    expect(electron.off).toHaveBeenCalledWith('session:notify', handler)
  })

  it('exposes workspace selection through the expected IPC channel', async () => {
    electron.invoke.mockResolvedValue('/tmp/workspace')
    const api = exposedApi()

    await expect(api.workspace.selectDirectory()).resolves.toBe('/tmp/workspace')
    expect(electron.invoke).toHaveBeenCalledWith('workspace:select-directory')
  })

  it('strips the wrapper Electron puts around a handler error', async () => {
    const api = exposedApi()

    for (const [wrapped, expected] of [
      [
        "Error invoking remote method 'session:prompt': Error: No AI Gateway key.",
        'No AI Gateway key.'
      ],
      ["Error invoking remote method 'session:resume': TypeError: Bad shape", 'Bad shape'],
      ["Error invoking remote method 'models:list': plain text", 'plain text'],
      ['Something else entirely', 'Something else entirely']
    ] as const) {
      electron.invoke.mockRejectedValueOnce(new Error(wrapped))

      await expect(api.session.prompt({ sessionId: 'session-1', prompt: 'hi' })).rejects.toThrow(
        expected
      )
    }
  })

  it('reports a non-error rejection as text', async () => {
    const api = exposedApi()
    electron.invoke.mockRejectedValueOnce('just a string')

    await expect(api.models.list()).rejects.toThrow('just a string')
  })
})
