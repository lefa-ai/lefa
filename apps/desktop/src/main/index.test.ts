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
  createWorkspaceAgent: vi.fn(),
  generate: vi.fn()
}))
const environment = process.env as Record<string, string | undefined>

vi.mock('electron', () => ({
  app: electron.app,
  BrowserWindow: electron.BrowserWindow,
  dialog: electron.dialog,
  ipcMain: electron.ipcMain
}))
vi.mock('./agent', () => ({ createWorkspaceAgent: agent.createWorkspaceAgent }))

async function loadMain(options: { packaged?: boolean; rendererUrl?: string } = {}): Promise<void> {
  vi.resetModules()
  electron.reset()
  agent.createWorkspaceAgent.mockReset()
  agent.generate.mockReset()
  agent.createWorkspaceAgent.mockReturnValue({ generate: agent.generate })
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

    expect(electron.ipcHandlers.has('agent:prompt')).toBe(true)
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

  it('returns the generated agent text over IPC', async () => {
    await loadMain()
    agent.generate.mockResolvedValue({ text: 'answer' })
    const promptHandler = electron.ipcHandlers.get('agent:prompt')

    await expect(promptHandler?.({}, { cwd: '/tmp/workspace', prompt: 'Help me' })).resolves.toBe(
      'answer'
    )
    expect(agent.createWorkspaceAgent).toHaveBeenCalledWith('/tmp/workspace')
    expect(agent.generate).toHaveBeenCalledWith({ prompt: 'Help me' })
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
