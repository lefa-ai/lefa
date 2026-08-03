import type { UIMessage } from 'ai'

/**
 * What anything driving the harness speaks.
 *
 * Deliberately free of Node imports: a renderer, a browser, or a phone can
 * name these types without pulling the harness's internals along with them.
 */

export type RunStatus = 'idle' | 'running'

/**
 * What a watcher hears.
 *
 * A message arrives repeatedly as it grows — the same id, further along each
 * time — so a watcher keeps the latest by id and never reassembles anything.
 */
export type SessionNotification =
  | { type: 'message'; sessionId: string; message: UIMessage }
  | { type: 'status'; sessionId: string; status: RunStatus }
  | { type: 'queued'; sessionId: string; prompts: readonly string[] }
  | { type: 'error'; sessionId: string; error: string }

/** Everything needed to draw a session, whether or not a turn is in flight. */
export interface SessionSnapshot {
  id: string
  cwd: string
  model: string
  status: RunStatus
  messages: readonly UIMessage[]
  /** Prompts waiting for the current turn to finish. Sent, but not yet said. */
  queued: readonly string[]
}

/**
 * A saved session as a list of them shows it: what is on disk, plus what it is
 * doing right now. Only the manager can answer the second half.
 */
export interface SessionListing {
  id: string
  cwd: string
  createdAt: string
  updatedAt: string
  title: string
  status: RunStatus
}
