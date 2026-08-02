import { Session, SessionStore, type SessionOptions } from '@lefa/harness'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

if (existsSync('.env')) process.loadEnvFile()

/** Models are Gateway ids, so the provider is chosen per session, not at build time. */
export const DEFAULT_MODEL = 'anthropic/claude-haiku-4.5'

/**
 * Plain files under the home directory rather than Electron's userData, so the
 * logs stay inspectable and portable between the app, a future CLI, and the
 * cloud.
 */
export const lefaHome = join(homedir(), '.lefa')
export const sessionStore = new SessionStore(join(lefaHome, 'sessions'))

export function createWorkspaceSession(
  cwd: string,
  model: string,
  options: SessionOptions = {}
): Session {
  return new Session(model, cwd, { ...options, store: sessionStore })
}
