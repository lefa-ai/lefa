import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import {
  modelListChannel,
  sessionAbortChannel,
  sessionAttachChannel,
  sessionDeleteChannel,
  sessionListChannel,
  sessionNotifyChannel,
  sessionOpenChannel,
  sessionPromptChannel,
  sessionSetModelChannel,
  workspaceChannel,
  type ModelSummary,
  type SessionNotification,
  type SessionPromptInput,
  type SessionSnapshot,
  type SessionSummary,
  type SetModelInput
} from '../shared/api'
import { sessionManager } from './agent'
import { listModels } from './models'
import { readDefaultModel, writeDefaultModel } from './settings'

/**
 * A run reports to every window, not to the one that started it.
 *
 * Nothing here knows which session a window is looking at: a watcher that has
 * moved on simply ignores what it does not need.
 */
function broadcast(notification: SessionNotification): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.webContents.isDestroyed())
      window.webContents.send(sessionNotifyChannel, notification)
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle(sessionOpenChannel, async (_event, cwd: string): Promise<SessionSnapshot> => {
    return sessionManager.open(cwd, await readDefaultModel())
  })

  ipcMain.handle(sessionPromptChannel, (_event, input: SessionPromptInput) => {
    // Returns as soon as the turn is under way; the run reports itself.
    sessionManager.prompt(input.sessionId, input.prompt)
  })

  ipcMain.handle(sessionAbortChannel, (_event, sessionId: string) => {
    sessionManager.abort(sessionId)
  })

  ipcMain.handle(sessionListChannel, (): Promise<SessionSummary[]> => sessionManager.list())

  ipcMain.handle(sessionAttachChannel, (_event, sessionId: string): Promise<SessionSnapshot> =>
    sessionManager.attach(sessionId)
  )

  ipcMain.handle(sessionSetModelChannel, async (_event, input: SetModelInput) => {
    sessionManager.setModel(input.sessionId, input.model)
    // The latest choice also becomes the default for the next new session.
    await writeDefaultModel(input.model)
  })

  ipcMain.handle(modelListChannel, (): Promise<readonly ModelSummary[]> => listModels())

  ipcMain.handle(sessionDeleteChannel, (_event, sessionId: string): Promise<void> =>
    sessionManager.delete(sessionId)
  )

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
  sessionManager.subscribe(broadcast)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
