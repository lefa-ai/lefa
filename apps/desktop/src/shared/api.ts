export const agentPromptChannel = 'agent:prompt'
export const workspaceChannel = 'workspace:select-directory'

export interface AgentPromptInput {
  cwd: string
  prompt: string
}

export interface LefaApi {
  agent: {
    prompt: (input: AgentPromptInput) => Promise<string>
  }
  workspace: {
    selectDirectory: () => Promise<string | null>
  }
}
