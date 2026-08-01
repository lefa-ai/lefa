import type { AgentEvent } from '@lefa/harness/events'

export const sessionOpenChannel = 'session:open'
export const sessionPromptChannel = 'session:prompt'
export const sessionAbortChannel = 'session:abort'
export const sessionEventChannel = 'session:event'
export const workspaceChannel = 'workspace:select-directory'

export type { AgentEvent }

export interface SessionPromptInput {
  sessionId: string
  prompt: string
}

/** An agent event tagged with its session, so stale runs can be ignored. */
export interface SessionEvent {
  sessionId: string
  event: AgentEvent
}

export interface LefaApi {
  session: {
    open: (cwd: string) => Promise<string>
    prompt: (input: SessionPromptInput) => Promise<void>
    abort: (sessionId: string) => Promise<void>
    onEvent: (listener: (event: SessionEvent) => void) => () => void
  }
  workspace: {
    selectDirectory: () => Promise<string | null>
  }
}
