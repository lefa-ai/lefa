import type {
  RunStatus,
  SessionListing,
  SessionNotification,
  SessionSnapshot
} from '@lefa/harness/protocol'

export const sessionOpenChannel = 'session:open'
export const sessionPromptChannel = 'session:prompt'
export const sessionAbortChannel = 'session:abort'
export const sessionNotifyChannel = 'session:notify'
export const sessionListChannel = 'session:list'
export const sessionAttachChannel = 'session:attach'
export const sessionDeleteChannel = 'session:delete'
export const sessionSetModelChannel = 'session:set-model'
export const modelListChannel = 'models:list'
export const workspaceChannel = 'workspace:select-directory'

export type { RunStatus, SessionListing, SessionNotification, SessionSnapshot }

export interface SessionPromptInput {
  sessionId: string
  prompt: string
}

/** A language model offered by the AI Gateway. */
export interface ModelSummary {
  id: string
  name: string
}

export interface SetModelInput {
  sessionId: string
  model: string
}

export interface LefaApi {
  session: {
    open: (cwd: string) => Promise<SessionSnapshot>
    prompt: (input: SessionPromptInput) => Promise<void>
    abort: (sessionId: string) => Promise<void>
    list: () => Promise<readonly SessionListing[]>
    attach: (sessionId: string) => Promise<SessionSnapshot>
    delete: (sessionId: string) => Promise<void>
    setModel: (input: SetModelInput) => Promise<void>
    onNotify: (listener: (notification: SessionNotification) => void) => () => void
  }
  models: {
    list: () => Promise<readonly ModelSummary[]>
  }
  workspace: {
    selectDirectory: () => Promise<string | null>
  }
}
