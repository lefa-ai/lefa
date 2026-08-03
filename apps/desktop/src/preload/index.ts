import { contextBridge, ipcRenderer } from 'electron'
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
  type LefaApi,
  type ModelSummary,
  type SessionNotification,
  type SessionPromptInput,
  type SessionSnapshot,
  type SessionSummary,
  type SetModelInput
} from '../shared/api'

/** Electron wraps a handler's error: `Error invoking remote method 'x': Error: real message`. */
const remotePrefix = /^Error invoking remote method '[^']*':\s*(?:[A-Za-z]*Error:\s*)?/

/**
 * Main writes messages meant for the user, so the wrapper Electron adds has to
 * come off here — otherwise every failure reaches the UI as boilerplate.
 */
async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as T
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    throw new Error(message.replace(remotePrefix, ''))
  }
}

const api = {
  session: {
    open: (cwd: string) => invoke<SessionSnapshot>(sessionOpenChannel, cwd),
    prompt: (input: SessionPromptInput) => invoke<void>(sessionPromptChannel, input),
    abort: (sessionId: string) => invoke<void>(sessionAbortChannel, sessionId),
    list: () => invoke<readonly SessionSummary[]>(sessionListChannel),
    attach: (sessionId: string) => invoke<SessionSnapshot>(sessionAttachChannel, sessionId),
    delete: (sessionId: string) => invoke<void>(sessionDeleteChannel, sessionId),
    setModel: (input: SetModelInput) => invoke<void>(sessionSetModelChannel, input),
    onNotify: (listener: (notification: SessionNotification) => void) => {
      const handler = (_event: unknown, notification: SessionNotification): void =>
        listener(notification)
      ipcRenderer.on(sessionNotifyChannel, handler)

      return () => {
        ipcRenderer.off(sessionNotifyChannel, handler)
      }
    }
  },
  models: {
    list: () => invoke<readonly ModelSummary[]>(modelListChannel)
  },
  workspace: {
    selectDirectory: () => invoke<string | null>(workspaceChannel)
  }
} satisfies LefaApi

contextBridge.exposeInMainWorld('lefa', api)
