import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionNotification } from '../shared/api'

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
  }> = []

  function createWindow(options: unknown) {
    const ready = new Map<string, Handler>()
    const window = {
      options,
      ready,
      show: vi.fn(),
      loadURL: vi.fn().mockResolvedValue(undefined),
      loadFile: vi.fn().mockResolvedValue(undefined),
      setWindowOpenHandler: vi.fn()
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
      webContents: { setWindowOpenHandler: window.setWindowOpenHandler }
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

const manager = vi.hoisted(() => ({
  open: vi.fn(),
  attach: vi.fn(),
  prompt: vi.fn(),
  abort: vi.fn(),
  setModel: vi.fn(),
  delete: vi.fn(),
  list: vi.fn(),
  subscribe: vi.fn(),
  /** The broadcaster main handed to the manager at startup. */
  watcher: undefined as ((notification: SessionNotification) => void) | undefined
}))
const support = vi.hoisted(() => ({
  listModels: vi.fn(),
  readDefaultModel: vi.fn(),
  writeDefaultModel: vi.fn()
}))
const environment = process.env as Record<string, string | undefined>

vi.mock('electron', () => ({
  app: electron.app,
  BrowserWindow: electron.BrowserWindow,
  dialog: electron.dialog,
  ipcMain: electron.ipcMain
}))
vi.mock('./agent', () => ({
  sessionManager: manager,
  lefaHome: '/tmp/lefa',
  DEFAULT_MODEL: 'anthropic/claude-haiku-4.5'
}))
vi.mock('./models', () => ({ listModels: support.listModels }))
vi.mock('./settings', () => ({
  readDefaultModel: support.readDefaultModel,
  writeDefaultModel: support.writeDefaultModel
}))

const snapshot = {
  id: 'session-1',
  cwd: '/tmp/workspace',
  model: 'anthropic/claude-haiku-4.5',
  status: 'idle' as const,
  events: []
}

/** Electron settles a handler's result — and its throw — as a promise. */
async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  return electron.ipcHandlers.get(channel)?.({ sender: {} }, ...args)
}

async function loadMain(options: { packaged?: boolean; rendererUrl?: string } = {}): Promise<void> {
  vi.resetModules()
  electron.reset()
  manager.open.mockReset()
  manager.open.mockReturnValue(snapshot)
  manager.attach.mockReset()
  manager.attach.mockResolvedValue(snapshot)
  manager.prompt.mockReset()
  manager.abort.mockReset()
  manager.setModel.mockReset()
  manager.delete.mockReset()
  manager.delete.mockResolvedValue(undefined)
  manager.list.mockReset()
  manager.list.mockResolvedValue([])
  manager.subscribe.mockReset()
  manager.watcher = undefined
  manager.subscribe.mockImplementation((watcher: (notification: SessionNotification) => void) => {
    manager.watcher = watcher
    return () => {}
  })
  support.listModels.mockReset()
  support.listModels.mockResolvedValue([])
  support.readDefaultModel.mockReset()
  support.readDefaultModel.mockResolvedValue('anthropic/claude-haiku-4.5')
  support.writeDefaultModel.mockReset()
  support.writeDefaultModel.mockResolvedValue(undefined)
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
    expect(electron.ipcHandlers.has('session:list')).toBe(true)
    expect(electron.ipcHandlers.has('session:attach')).toBe(true)
    expect(electron.ipcHandlers.has('session:delete')).toBe(true)
    expect(electron.ipcHandlers.has('session:set-model')).toBe(true)
    expect(electron.ipcHandlers.has('models:list')).toBe(true)
    expect(electron.ipcHandlers.has('workspace:select-directory')).toBe(true)
    expect(window?.options).toMatchObject({
      width: 1100,
      height: 760,
      minWidth: 640,
      minHeight: 480,
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

  it('opens a session per workspace on the remembered model', async () => {
    await loadMain()
    support.readDefaultModel.mockResolvedValue('openai/gpt-5.1-codex')

    await expect(invoke('session:open', '/tmp/workspace')).resolves.toEqual(snapshot)
    expect(manager.open).toHaveBeenCalledWith('/tmp/workspace', 'openai/gpt-5.1-codex')
  })

  it('starts a run without waiting for it to finish', async () => {
    await loadMain()

    await expect(
      invoke('session:prompt', { sessionId: 'session-1', prompt: 'Help me' })
    ).resolves.toBeUndefined()
    expect(manager.prompt).toHaveBeenCalledWith('session-1', 'Help me')
  })

  it('passes a refused run back to the window that asked for it', async () => {
    await loadMain()
    manager.prompt.mockImplementation(() => {
      throw new Error('That session is no longer open.')
    })

    await expect(
      invoke('session:prompt', { sessionId: 'missing', prompt: 'Help me' })
    ).rejects.toThrow('That session is no longer open.')
  })

  it('tells every live window about a run, and none of the dead ones', async () => {
    await loadMain()
    const live = { webContents: { send: vi.fn(), isDestroyed: () => false } }
    const alsoLive = { webContents: { send: vi.fn(), isDestroyed: () => false } }
    const gone = { webContents: { send: vi.fn(), isDestroyed: () => true } }
    electron.getAllWindows.mockReturnValue([live, gone, alsoLive])
    const notification: SessionNotification = {
      type: 'status',
      sessionId: 'session-1',
      status: 'running'
    }

    expect(manager.subscribe).toHaveBeenCalledOnce()
    manager.watcher?.(notification)

    // A run is nobody's private business: it reaches every window that is still
    // there, whichever one happened to start it.
    expect(live.webContents.send).toHaveBeenCalledWith('session:notify', notification)
    expect(alsoLive.webContents.send).toHaveBeenCalledWith('session:notify', notification)
    expect(gone.webContents.send).not.toHaveBeenCalled()
  })

  it('interrupts the addressed session', async () => {
    await loadMain()

    await expect(invoke('session:abort', 'session-1')).resolves.toBeUndefined()
    expect(manager.abort).toHaveBeenCalledWith('session-1')
  })

  it('returns null when workspace selection has no owning window', async () => {
    await loadMain()
    electron.fromWebContents.mockReturnValue(null)

    await expect(invoke('workspace:select-directory')).resolves.toBeNull()
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

    await expect(invoke('workspace:select-directory')).resolves.toBeNull()
    await expect(invoke('workspace:select-directory')).resolves.toBeNull()
    await expect(invoke('workspace:select-directory')).resolves.toBe('/tmp/workspace')
    expect(electron.dialog.showOpenDialog).toHaveBeenCalledWith(owner, {
      properties: ['openDirectory']
    })
  })

  it('lists saved sessions', async () => {
    await loadMain()
    const summaries = [{ id: 'session-1', cwd: '/tmp/workspace', title: 'A task' }]
    manager.list.mockResolvedValue(summaries)

    await expect(invoke('session:list')).resolves.toEqual(summaries)
  })

  it('attaches to a session and hands back everything needed to draw it', async () => {
    await loadMain()
    const running = {
      id: 'session-9',
      cwd: '/tmp/stored',
      model: 'openai/gpt-5.1-codex',
      status: 'running' as const,
      events: [{ type: 'prompt', text: 'Hello' }]
    }
    manager.attach.mockResolvedValue(running)

    await expect(invoke('session:attach', 'session-9')).resolves.toEqual(running)
    expect(manager.attach).toHaveBeenCalledWith('session-9')
  })

  it('removes a session for good', async () => {
    await loadMain()

    await expect(invoke('session:delete', 'session-1')).resolves.toBeUndefined()
    expect(manager.delete).toHaveBeenCalledWith('session-1')
  })

  it('switches a session model and remembers it for the next one', async () => {
    await loadMain()

    await expect(
      invoke('session:set-model', { sessionId: 'session-1', model: 'anthropic/claude-opus-5' })
    ).resolves.toBeUndefined()
    expect(manager.setModel).toHaveBeenCalledWith('session-1', 'anthropic/claude-opus-5')
    expect(support.writeDefaultModel).toHaveBeenCalledWith('anthropic/claude-opus-5')
  })

  it('does not remember a model the session refused', async () => {
    await loadMain()
    manager.setModel.mockImplementation(() => {
      throw new Error('That session is no longer open.')
    })

    await expect(
      invoke('session:set-model', { sessionId: 'missing', model: 'anthropic/claude-opus-5' })
    ).rejects.toThrow('That session is no longer open.')
    expect(support.writeDefaultModel).not.toHaveBeenCalled()
  })

  it('serves the model catalogue', async () => {
    await loadMain()
    support.listModels.mockResolvedValue([{ id: 'anthropic/claude-opus-5', name: 'Claude Opus 5' }])

    await expect(invoke('models:list')).resolves.toEqual([
      { id: 'anthropic/claude-opus-5', name: 'Claude Opus 5' }
    ])
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
