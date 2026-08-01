import { app, BrowserWindow, dialog, ipcMain, type WebContents } from 'electron'
import { toAgentEvents, type Session } from '@lefa/harness'
import { join } from 'node:path'
import {
  sessionAbortChannel,
  sessionDeleteChannel,
  sessionEventChannel,
  sessionListChannel,
  sessionOpenChannel,
  sessionPromptChannel,
  sessionResumeChannel,
  workspaceChannel,
  type AgentEvent,
  type RestoredSession,
  type SessionPromptInput,
  type SessionSummary
} from '../shared/api'
import { createWorkspaceSession, sessionStore } from './agent'

const sessions = new Map<string, Session>()

function send(sender: WebContents, sessionId: string, event: AgentEvent): void {
  if (sender.isDestroyed()) return

  sender.send(sessionEventChannel, { sessionId, event })
}

function registerIpcHandlers(): void {
  ipcMain.handle(sessionOpenChannel, (_event, cwd: string) => {
    const session = createWorkspaceSession(cwd)
    sessions.set(session.id, session)

    return session.id
  })

  ipcMain.handle(sessionPromptChannel, async (event, input: SessionPromptInput) => {
    const session = sessions.get(input.sessionId)

    if (!session) throw new Error('That session is no longer open.')

    for await (const agentEvent of session.prompt(input.prompt)) {
      send(event.sender, input.sessionId, agentEvent)
    }
  })

  ipcMain.handle(sessionAbortChannel, (_event, sessionId: string) => {
    sessions.get(sessionId)?.abort()
  })

  ipcMain.handle(sessionListChannel, (): Promise<SessionSummary[]> => sessionStore.list())

  ipcMain.handle(sessionResumeChannel, async (_event, sessionId): Promise<RestoredSession> => {
    // A session already in memory may hold turns newer than the file it was
    // loaded from, so it redraws from itself rather than from disk.
    const open = sessions.get(sessionId)
    if (open) return { id: open.id, cwd: open.cwd, events: toAgentEvents(open.history) }

    const { meta, messages } = await sessionStore.load(sessionId)
    const session = createWorkspaceSession(meta.cwd, {
      id: meta.id,
      createdAt: meta.createdAt,
      title: meta.title,
      messages
    })
    sessions.set(session.id, session)

    return { id: session.id, cwd: session.cwd, events: toAgentEvents(messages) }
  })

  ipcMain.handle(sessionDeleteChannel, async (_event, sessionId: string) => {
    // Discard rather than abort: a run still unwinding would otherwise save its
    // last turn and bring the deleted file back.
    sessions.get(sessionId)?.discard()
    sessions.delete(sessionId)
    await sessionStore.delete(sessionId)
  })

  ipcMain.handle(workspaceChannel, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)

    if (!window) return null

    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory']
    })

    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 640,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#09090b',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  const rendererUrl = process.env.ELECTRON_RENDERER_URL

  if (!app.isPackaged && rendererUrl) {
    void mainWindow.loadURL(rendererUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
