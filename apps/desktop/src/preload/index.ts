import { contextBridge, ipcRenderer } from 'electron'
import {
  sessionAbortChannel,
  sessionEventChannel,
  sessionOpenChannel,
  sessionPromptChannel,
  workspaceChannel,
  type LefaApi,
  type SessionEvent,
  type SessionPromptInput
} from '../shared/api'

const api = {
  session: {
    open: (cwd: string) => ipcRenderer.invoke(sessionOpenChannel, cwd) as Promise<string>,
    prompt: (input: SessionPromptInput) =>
      ipcRenderer.invoke(sessionPromptChannel, input) as Promise<void>,
    abort: (sessionId: string) =>
      ipcRenderer.invoke(sessionAbortChannel, sessionId) as Promise<void>,
    onEvent: (listener: (event: SessionEvent) => void) => {
      const handler = (_event: unknown, sessionEvent: SessionEvent): void => listener(sessionEvent)
      ipcRenderer.on(sessionEventChannel, handler)

      return () => {
        ipcRenderer.off(sessionEventChannel, handler)
      }
    }
  },
  workspace: {
    selectDirectory: () => ipcRenderer.invoke(workspaceChannel) as Promise<string | null>
  }
} satisfies LefaApi

contextBridge.exposeInMainWorld('lefa', api)
