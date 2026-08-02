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
  abort: vi.fn(),
  discard: vi.fn(),
  history: [] as unknown[],
  setModel: vi.fn(),
  meta: {} as Record<string, unknown>,
  store: { list: vi.fn(), load: vi.fn(), delete: vi.fn() }
}))
const harness = vi.hoisted(() => ({ toAgentEvents: vi.fn() }))
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
  createWorkspaceSession: agent.createWorkspaceSession,
  sessionStore: agent.store,
  lefaHome: '/tmp/lefa',
  DEFAULT_MODEL: 'anthropic/claude-haiku-4.5'
}))
vi.mock('./models', () => ({ listModels: support.listModels }))
vi.mock('./settings', () => ({
  readDefaultModel: support.readDefaultModel,
  writeDefaultModel: support.writeDefaultModel
}))
vi.mock('@lefa/harness', () => ({ toAgentEvents: harness.toAgentEvents }))
vi.mock('@ai-sdk/gateway', () => ({
  GatewayAuthenticationError: { isInstance: (error: unknown) => (error as Error)?.name === 'Auth' }
}))

function sender(overrides: { destroyed?: boolean } = {}): {
  send: ReturnType<typeof vi.fn>
  isDestroyed: () => boolean
} {
  return { send: vi.fn(), isDestroyed: () => overrides.destroyed ?? false }
}

async function openSession(id = 'session-1'): Promise<string> {
  agent.createWorkspaceSession.mockReturnValue({
    id,
    cwd: '/tmp/workspace',
    history: agent.history,
    meta: agent.meta,
    prompt: agent.prompt,
    abort: agent.abort,
    discard: agent.discard,
    setModel: agent.setModel
  })
  const openHandler = electron.ipcHandlers.get('session:open')
  const opened = (await openHandler?.({ sender: sender() }, '/tmp/workspace')) as { id: string }

  return opened.id
}

async function loadMain(options: { packaged?: boolean; rendererUrl?: string } = {}): Promise<void> {
  vi.resetModules()
  electron.reset()
  agent.createWorkspaceSession.mockReset()
  agent.prompt.mockReset()
  agent.abort.mockReset()
  agent.discard.mockReset()
  agent.store.list.mockReset()
  agent.store.load.mockReset()
  agent.store.delete.mockReset()
  agent.store.delete.mockResolvedValue(undefined)
  harness.toAgentEvents.mockReset()
  harness.toAgentEvents.mockReturnValue([])
  agent.setModel.mockReset()
  agent.setModel.mockResolvedValue(undefined)
  agent.meta = {}
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
    expect(electron.ipcHandlers.has('session:resume')).toBe(true)
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
    expect(agent.createWorkspaceSession).toHaveBeenCalledWith(
      '/tmp/workspace',
      'anthropic/claude-haiku-4.5'
    )

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

  it('lists saved sessions from the store', async () => {
    await loadMain()
    const summaries = [{ id: 'session-1', cwd: '/tmp/workspace', title: 'A task' }]
    agent.store.list.mockResolvedValue(summaries)

    await expect(electron.ipcHandlers.get('session:list')?.({ sender: sender() })).resolves.toEqual(
      summaries
    )
  })

  it('resumes a stored session and replays it as events', async () => {
    await loadMain()
    const messages = [{ role: 'user', content: 'Hello' }]
    const events = [{ type: 'prompt', text: 'Hello' }]
    agent.store.load.mockResolvedValue({
      meta: {
        id: 'session-9',
        cwd: '/tmp/stored',
        createdAt: '2026-08-01T10:00:00.000Z',
        title: 'Stored',
        model: 'openai/gpt-5.1-codex'
      },
      messages
    })
    agent.createWorkspaceSession.mockReturnValue({
      id: 'session-9',
      cwd: '/tmp/stored',
      history: messages,
      prompt: agent.prompt,
      abort: agent.abort
    })
    harness.toAgentEvents.mockReturnValue(events)

    const restored = await electron.ipcHandlers.get('session:resume')?.(
      { sender: sender() },
      'session-9'
    )

    expect(agent.createWorkspaceSession).toHaveBeenCalledWith(
      '/tmp/stored',
      'openai/gpt-5.1-codex',
      {
        id: 'session-9',
        createdAt: '2026-08-01T10:00:00.000Z',
        title: 'Stored',
        messages
      }
    )
    expect(restored).toEqual({
      id: 'session-9',
      cwd: '/tmp/stored',
      model: 'openai/gpt-5.1-codex',
      events
    })
  })

  it('redraws an already-open session from memory rather than from disk', async () => {
    await loadMain()
    agent.history = [{ role: 'user', content: 'In memory' }]
    const sessionId = await openSession()
    harness.toAgentEvents.mockReturnValue([{ type: 'prompt', text: 'In memory' }])

    const restored = await electron.ipcHandlers.get('session:resume')?.(
      { sender: sender() },
      sessionId
    )

    expect(agent.store.load).not.toHaveBeenCalled()
    expect(harness.toAgentEvents).toHaveBeenCalledWith(agent.history)
    expect(restored).toEqual({
      id: sessionId,
      cwd: '/tmp/workspace',
      model: 'anthropic/claude-haiku-4.5',
      events: [{ type: 'prompt', text: 'In memory' }]
    })
    agent.history = []
  })

  it('stops and forgets a session when it is deleted', async () => {
    await loadMain()
    const sessionId = await openSession()

    await electron.ipcHandlers.get('session:delete')?.({ sender: sender() }, sessionId)

    expect(agent.discard).toHaveBeenCalledOnce()
    expect(agent.store.delete).toHaveBeenCalledWith(sessionId)
    await expect(
      electron.ipcHandlers.get('session:prompt')?.(
        { sender: sender() },
        { sessionId, prompt: 'Hi' }
      )
    ).rejects.toThrow('That session is no longer open.')
  })

  it('opens new sessions on the remembered model', async () => {
    await loadMain()
    support.readDefaultModel.mockResolvedValue('openai/gpt-5.1-codex')

    agent.createWorkspaceSession.mockReturnValue({ id: 'session-1', cwd: '/tmp/workspace' })
    const opened = await electron.ipcHandlers.get('session:open')?.(
      { sender: sender() },
      '/tmp/workspace'
    )

    expect(opened).toEqual({ id: 'session-1', model: 'openai/gpt-5.1-codex' })
    expect(agent.createWorkspaceSession).toHaveBeenCalledWith(
      '/tmp/workspace',
      'openai/gpt-5.1-codex'
    )
  })

  it('switches a session model and remembers it for the next one', async () => {
    await loadMain()
    const sessionId = await openSession()

    await electron.ipcHandlers.get('session:set-model')?.(
      { sender: sender() },
      { sessionId, model: 'anthropic/claude-opus-5' }
    )

    expect(agent.setModel).toHaveBeenCalledWith('anthropic/claude-opus-5')
    expect(support.writeDefaultModel).toHaveBeenCalledWith('anthropic/claude-opus-5')
  })

  it('rejects a model switch for a session that is not open', async () => {
    await loadMain()

    await expect(
      electron.ipcHandlers.get('session:set-model')?.(
        { sender: sender() },
        { sessionId: 'missing', model: 'anthropic/claude-opus-5' }
      )
    ).rejects.toThrow('That session is no longer open.')
    expect(support.writeDefaultModel).not.toHaveBeenCalled()
  })

  it('serves the model catalogue', async () => {
    await loadMain()
    support.listModels.mockResolvedValue([{ id: 'anthropic/claude-opus-5', name: 'Claude Opus 5' }])

    await expect(electron.ipcHandlers.get('models:list')?.({ sender: sender() })).resolves.toEqual([
      { id: 'anthropic/claude-opus-5', name: 'Claude Opus 5' }
    ])
  })

  it('turns a missing gateway key into an actionable message', async () => {
    await loadMain()
    const sessionId = await openSession()
    const authError = Object.assign(new Error('unauthorized'), { name: 'Auth' })
    agent.prompt.mockReturnValue(
      (async function* () {
        yield { type: 'text', text: 'starting' }
        throw authError
      })()
    )

    await expect(
      electron.ipcHandlers.get('session:prompt')?.(
        { sender: sender() },
        { sessionId, prompt: 'Help me' }
      )
    ).rejects.toThrow('No AI Gateway key. Set AI_GATEWAY_API_KEY in apps/desktop/.env.')
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
