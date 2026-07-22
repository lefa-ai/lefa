import { contextBridge, ipcRenderer } from 'electron'
import {
  agentPromptChannel,
  workspaceChannel,
  type AgentPromptInput,
  type LefaApi
} from '../shared/api'

const api = {
  agent: {
    prompt: (input: AgentPromptInput) =>
      ipcRenderer.invoke(agentPromptChannel, input) as Promise<string>
  },
  workspace: {
    selectDirectory: () => ipcRenderer.invoke(workspaceChannel) as Promise<string | null>
  }
} satisfies LefaApi

contextBridge.exposeInMainWorld('lefa', api)
