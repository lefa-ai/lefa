import { contextBridge, ipcRenderer } from 'electron'
import { workspaceChannel, type LefaApi } from '../shared/api'

const api = {
  workspace: {
    selectDirectory: () => ipcRenderer.invoke(workspaceChannel) as Promise<string | null>
  }
} satisfies LefaApi

contextBridge.exposeInMainWorld('lefa', api)
