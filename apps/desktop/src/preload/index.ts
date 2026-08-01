import { contextBridge, ipcRenderer } from 'electron'
import {
  sessionAbortChannel,
  sessionDeleteChannel,
  sessionEventChannel,
  sessionListChannel,
  sessionOpenChannel,
  sessionPromptChannel,
  sessionResumeChannel,
  workspaceChannel,
  type LefaApi,
  type RestoredSession,
  type SessionEvent,
  type SessionPromptInput,
  type SessionSummary
} from '../shared/api'

const api = {
  session: {
    open: (cwd: string) => ipcRenderer.invoke(sessionOpenChannel, cwd) as Promise<string>,
    prompt: (input: SessionPromptInput) =>
      ipcRenderer.invoke(sessionPromptChannel, input) as Promise<void>,
    abort: (sessionId: string) =>
      ipcRenderer.invoke(sessionAbortChannel, sessionId) as Promise<void>,
    list: () => ipcRenderer.invoke(sessionListChannel) as Promise<readonly SessionSummary[]>,
    resume: (sessionId: string) =>
      ipcRenderer.invoke(sessionResumeChannel, sessionId) as Promise<RestoredSession>,
    delete: (sessionId: string) =>
      ipcRenderer.invoke(sessionDeleteChannel, sessionId) as Promise<void>,
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
