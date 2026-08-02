import { contextBridge, ipcRenderer } from 'electron'
import {
  modelListChannel,
  sessionAbortChannel,
  sessionDeleteChannel,
  sessionEventChannel,
  sessionListChannel,
  sessionOpenChannel,
  sessionPromptChannel,
  sessionResumeChannel,
  sessionSetModelChannel,
  workspaceChannel,
  type LefaApi,
  type ModelSummary,
  type OpenedSession,
  type RestoredSession,
  type SessionEvent,
  type SessionPromptInput,
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
    open: (cwd: string) => invoke<OpenedSession>(sessionOpenChannel, cwd),
    prompt: (input: SessionPromptInput) => invoke<void>(sessionPromptChannel, input),
    abort: (sessionId: string) => invoke<void>(sessionAbortChannel, sessionId),
    list: () => invoke<readonly SessionSummary[]>(sessionListChannel),
    resume: (sessionId: string) => invoke<RestoredSession>(sessionResumeChannel, sessionId),
    delete: (sessionId: string) => invoke<void>(sessionDeleteChannel, sessionId),
    setModel: (input: SetModelInput) => invoke<void>(sessionSetModelChannel, input),
    onEvent: (listener: (event: SessionEvent) => void) => {
      const handler = (_event: unknown, sessionEvent: SessionEvent): void => listener(sessionEvent)
      ipcRenderer.on(sessionEventChannel, handler)

      return () => {
        ipcRenderer.off(sessionEventChannel, handler)
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
