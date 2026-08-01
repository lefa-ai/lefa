import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (...args: unknown[]) => unknown

const electron = vi.hoisted(() => {
  const appHandlers = new Map<string, Handler>()
  const ipcHandlers = new Map<string, Handler>()
  const windows: Array<{
    options: unknown
    ready: Map<string, Handler>
    show: ReturnType<typeof vi.fn>
    loadURL: ReturnType<typeof vi.fn>
    loadFile: ReturnType<typeof vi.fn>
    setWindowOpenHandler: ReturnType<typeof vi.fn>
    sender: object
  }> = []

  function createWindow(options: unknown) {
    const ready = new Map<string, Handler>()
    const window = {
      options,
      ready,
      show: vi.fn(),
      loadURL: vi.fn().mockResolvedValue(undefined),
      loadFile: vi.fn().mockResolvedValue(undefined),
      setWindowOpenHandler: vi.fn(),
      sender: {}
    }
    windows.push(window)
    return window
  }

  const BrowserWindow = vi.fn(function BrowserWindow(options: unknown) {
    const window = createWindow(options)
    return {
      show: window.show,
      once: vi.fn((event: string, handler: Handler) => readyHandler(window, event, handler)),
      loadURL: window.loadURL,
      loadFile: window.loadFile,
      webContents: {
        setWindowOpenHandler: window.setWindowOpenHandler
      }
    }
  })

  function readyHandler(window: (typeof windows)[number], event: string, handler: Handler): void {
    window.ready.set(event, handler)
  }

  const fromWebContents = vi.fn()
  const getAllWindows = vi.fn()
  Object.assign(BrowserWindow, { fromWebContents, getAllWindows })

  const app = {
    isPackaged: false,
    whenReady: vi.fn(),
    on: vi.fn(),
    quit: vi.fn()
  }
  const dialog = { showOpenDialog: vi.fn() }
  const ipcMain = { handle: vi.fn() }

  function reset(): void {
    appHandlers.clear()
    ipcHandlers.clear()
    windows.length = 0
    vi.clearAllMocks()
    app.isPackaged = false
    app.whenReady.mockResolvedValue(undefined)
    app.on.mockImplementation((event: string, handler: Handler) => {
      appHandlers.set(event, handler)
    })
    ipcMain.handle.mockImplementation((channel: string, handler: Handler) => {
      ipcHandlers.set(channel, handler)
    })
    getAllWindows.mockReturnValue([])
  }

  return {
    app,
    appHandlers,
    BrowserWindow,
    dialog,
    fromWebContents,
    getAllWindows,
    ipcHandlers,
    ipcMain,
    reset,
    windows
  }
})

const agent = vi.hoisted(() => ({
  createWorkspaceSession: vi.fn(),
  prompt: vi.fn(),
  abort: vi.fn()
}))
const environment = process.env as Record<string, string | undefined>

vi.mock('electron', () => ({
  app: electron.app,
  BrowserWindow: electron.BrowserWindow,
  dialog: electron.dialog,
  ipcMain: electron.ipcMain
}))
vi.mock('./agent', () => ({ createWorkspaceSession: agent.createWorkspaceSession }))

function sender(overrides: { destroyed?: boolean } = {}): {
  send: ReturnType<typeof vi.fn>
  isDestroyed: () => boolean
} {
  return { send: vi.fn(), isDestroyed: () => overrides.destroyed ?? false }
}

async function openSession(id = 'session-1'): Promise<string> {
  agent.createWorkspaceSession.mockReturnValue({
    id,
    prompt: agent.prompt,
    abort: agent.abort
  })
  const openHandler = electron.ipcHandlers.get('session:open')

  return (await openHandler?.({ sender: sender() }, '/tmp/workspace')) as string
}

async function loadMain(options: { packaged?: boolean; rendererUrl?: string } = {}): Promise<void> {
  vi.resetModules()
  electron.reset()
  agent.createWorkspaceSession.mockReset()
  agent.prompt.mockReset()
  agent.abort.mockReset()
  electron.app.isPackaged = options.packaged ?? false

  if (options.rendererUrl === undefined) {
    delete environment.ELECTRON_RENDERER_URL
  } else {
    environment.ELECTRON_RENDERER_URL = options.rendererUrl
  }

  await import('./index')
  await vi.waitFor(() => expect(electron.windows).toHaveLength(1))
}

beforeEach(() => {
  delete environment.ELECTRON_RENDERER_URL
})

afterEach(() => {
  delete environment.ELECTRON_RENDERER_URL
  vi.restoreAllMocks()
})

describe('desktop main process', () => {
  it('registers secure IPC handlers and creates the development window', async () => {
    await loadMain({ rendererUrl: 'http://localhost:5173' })
    const window = electron.windows[0]

    expect(electron.ipcHandlers.has('session:open')).toBe(true)
    expect(electron.ipcHandlers.has('session:prompt')).toBe(true)
    expect(electron.ipcHandlers.has('session:abort')).toBe(true)
    expect(electron.ipcHandlers.has('workspace:select-directory')).toBe(true)
    expect(window?.options).toMatchObject({
      width: 900,
      height: 670,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#09090b',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    expect(window?.loadURL).toHaveBeenCalledWith('http://localhost:5173')
    expect(window?.loadFile).not.toHaveBeenCalled()

    window?.ready.get('ready-to-show')?.()
    expect(window?.show).toHaveBeenCalledOnce()
    const openHandler = window?.setWindowOpenHandler.mock.calls[0]?.[0] as Handler
    expect(openHandler()).toEqual({ action: 'deny' })
  })

  it('opens a session per workspace and streams its events to the requesting window', async () => {
    await loadMain()
    const sessionId = await openSession()
    agent.prompt.mockReturnValue(
      (async function* () {
        yield { type: 'text', text: 'Hello' }
        yield {
          type: 'tool-call',
          toolCallId: 'call-1',
          toolName: 'bash',
          input: { command: 'ls' }
        }
      })()
    )
    const target = sender()
    const promptHandler = electron.ipcHandlers.get('session:prompt')

    expect(sessionId).toBe('session-1')
    expect(agent.createWorkspaceSession).toHaveBeenCalledWith('/tmp/workspace')

    await expect(
      promptHandler?.({ sender: target }, { sessionId, prompt: 'Help me' })
    ).resolves.toBeUndefined()
    expect(agent.prompt).toHaveBeenCalledWith('Help me')
    expect(target.send.mock.calls).toEqual([
      ['session:event', { sessionId, event: { type: 'text', text: 'Hello' } }],
      [
        'session:event',
        {
          sessionId,
          event: {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'bash',
            input: { command: 'ls' }
          }
        }
      ]
    ])
  })

  it('drops events once the requesting window is gone', async () => {
    await loadMain()
    const sessionId = await openSession()
    agent.prompt.mockReturnValue(
      (async function* () {
        yield { type: 'text', text: 'Hello' }
      })()
    )
    const target = sender({ destroyed: true })

    await electron.ipcHandlers.get('session:prompt')?.(
      { sender: target },
      { sessionId, prompt: 'Help me' }
    )

    expect(target.send).not.toHaveBeenCalled()
  })

  it('rejects a prompt for a session that is not open', async () => {
    await loadMain()
    const promptHandler = electron.ipcHandlers.get('session:prompt')

    await expect(
      promptHandler?.({ sender: sender() }, { sessionId: 'missing', prompt: 'Help me' })
    ).rejects.toThrow('That session is no longer open.')
    expect(agent.prompt).not.toHaveBeenCalled()
  })

  it('interrupts the addressed session and ignores unknown ones', async () => {
    await loadMain()
    const sessionId = await openSession()
    const abortHandler = electron.ipcHandlers.get('session:abort')

    expect(abortHandler?.({ sender: sender() }, 'missing')).toBeUndefined()
    expect(agent.abort).not.toHaveBeenCalled()

    abortHandler?.({ sender: sender() }, sessionId)
    expect(agent.abort).toHaveBeenCalledOnce()
  })

  it('returns null when workspace selection has no owning window', async () => {
    await loadMain()
    electron.fromWebContents.mockReturnValue(null)
    const workspaceHandler = electron.ipcHandlers.get('workspace:select-directory')

    await expect(workspaceHandler?.({ sender: {} })).resolves.toBeNull()
    expect(electron.dialog.showOpenDialog).not.toHaveBeenCalled()
  })

  it('handles canceled, empty, and successful workspace selections', async () => {
    await loadMain()
    const owner = { id: 'window' }
    electron.fromWebContents.mockReturnValue(owner)
    electron.dialog.showOpenDialog
      .mockResolvedValueOnce({ canceled: true, filePaths: ['/ignored'] })
      .mockResolvedValueOnce({ canceled: false, filePaths: [] })
      .mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/workspace'] })
    const workspaceHandler = electron.ipcHandlers.get('workspace:select-directory')
    const event = { sender: {} }

    await expect(workspaceHandler?.(event)).resolves.toBeNull()
    await expect(workspaceHandler?.(event)).resolves.toBeNull()
    await expect(workspaceHandler?.(event)).resolves.toBe('/tmp/workspace')
    expect(electron.dialog.showOpenDialog).toHaveBeenCalledWith(owner, {
      properties: ['openDirectory']
    })
  })

  it('creates a window on activation only when none remain', async () => {
    await loadMain()
    const activate = electron.appHandlers.get('activate')
    electron.getAllWindows.mockReturnValue([{}])

    activate?.()
    expect(electron.BrowserWindow).toHaveBeenCalledOnce()

    electron.getAllWindows.mockReturnValue([])
    activate?.()
    expect(electron.BrowserWindow).toHaveBeenCalledTimes(2)
  })

  it('quits on window close outside macOS', async () => {
    await loadMain()
    const close = electron.appHandlers.get('window-all-closed')
    const originalPlatform = process.platform

    try {
      Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' })
      close?.()
      expect(electron.app.quit).toHaveBeenCalledOnce()

      Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' })
      close?.()
      expect(electron.app.quit).toHaveBeenCalledOnce()
    } finally {
      Object.defineProperty(process, 'platform', {
        configurable: true,
        value: originalPlatform
      })
    }
  })

  it('loads the packaged renderer file instead of a development URL', async () => {
    await loadMain({ packaged: true, rendererUrl: 'http://localhost:5173' })
    const window = electron.windows[0]

    expect(window?.loadURL).not.toHaveBeenCalled()
    expect(window?.loadFile).toHaveBeenCalledOnce()
    expect(window?.loadFile.mock.calls[0]?.[0]).toMatch(/renderer\/index\.html$/)
  })
})
