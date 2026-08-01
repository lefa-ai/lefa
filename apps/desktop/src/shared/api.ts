import type { AgentEvent } from '@lefa/harness/events'

export const sessionOpenChannel = 'session:open'
export const sessionPromptChannel = 'session:prompt'
export const sessionAbortChannel = 'session:abort'
export const sessionEventChannel = 'session:event'
export const sessionListChannel = 'session:list'
export const sessionResumeChannel = 'session:resume'
export const sessionDeleteChannel = 'session:delete'
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

export interface SessionSummary {
  id: string
  cwd: string
  createdAt: string
  updatedAt: string
  title: string
}

/** A session restored from disk, as the events that originally produced it. */
export interface RestoredSession {
  id: string
  cwd: string
  events: readonly AgentEvent[]
}

export interface LefaApi {
  session: {
    open: (cwd: string) => Promise<string>
    prompt: (input: SessionPromptInput) => Promise<void>
    abort: (sessionId: string) => Promise<void>
    list: () => Promise<readonly SessionSummary[]>
    resume: (sessionId: string) => Promise<RestoredSession>
    delete: (sessionId: string) => Promise<void>
    onEvent: (listener: (event: SessionEvent) => void) => () => void
  }
  workspace: {
    selectDirectory: () => Promise<string | null>
  }
}
