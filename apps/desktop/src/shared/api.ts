import type { AgentEvent } from '@lefa/harness/events'

export const agentPromptChannel = 'agent:prompt'
export const agentEventChannel = 'agent:event'
export const workspaceChannel = 'workspace:select-directory'

export type { AgentEvent }

export interface AgentPromptInput {
  cwd: string
  prompt: string
}

export interface LefaApi {
  agent: {
    prompt: (input: AgentPromptInput) => Promise<void>
    onEvent: (listener: (event: AgentEvent) => void) => () => void
  }
  workspace: {
    selectDirectory: () => Promise<string | null>
  }
}
