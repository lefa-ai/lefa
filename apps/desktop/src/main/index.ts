import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { toAgentEvent } from '@lefa/harness'
import { join } from 'node:path'
import {
  agentEventChannel,
  agentPromptChannel,
  workspaceChannel,
  type AgentPromptInput
} from '../shared/api'
import { createWorkspaceAgent } from './agent'

function registerIpcHandlers(): void {
  ipcMain.handle(agentPromptChannel, async (event, input: AgentPromptInput) => {
    const agent = createWorkspaceAgent(input.cwd)
    const result = await agent.stream({ prompt: input.prompt })

    for await (const part of result.stream) {
      const agentEvent = toAgentEvent(part)

      if (agentEvent) event.sender.send(agentEventChannel, agentEvent)
    }
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
    width: 900,
    height: 670,
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
