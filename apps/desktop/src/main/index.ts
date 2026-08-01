import { app, BrowserWindow, dialog, ipcMain, type WebContents } from 'electron'
import type { Session } from '@lefa/harness'
import { join } from 'node:path'
import {
  sessionAbortChannel,
  sessionEventChannel,
  sessionOpenChannel,
  sessionPromptChannel,
  workspaceChannel,
  type AgentEvent,
  type SessionPromptInput
} from '../shared/api'
import { createWorkspaceSession } from './agent'

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
