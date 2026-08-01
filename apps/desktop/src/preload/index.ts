import { contextBridge, ipcRenderer } from 'electron'
import {
  agentEventChannel,
  agentPromptChannel,
  workspaceChannel,
  type AgentEvent,
  type AgentPromptInput,
  type LefaApi
} from '../shared/api'

const api = {
  agent: {
    prompt: (input: AgentPromptInput) =>
      ipcRenderer.invoke(agentPromptChannel, input) as Promise<void>,
    onEvent: (listener: (event: AgentEvent) => void) => {
      const handler = (_event: unknown, agentEvent: AgentEvent): void => listener(agentEvent)
      ipcRenderer.on(agentEventChannel, handler)

      return () => {
        ipcRenderer.off(agentEventChannel, handler)
      }
    }
  },
  workspace: {
    selectDirectory: () => ipcRenderer.invoke(workspaceChannel) as Promise<string | null>
  }
} satisfies LefaApi

contextBridge.exposeInMainWorld('lefa', api)
