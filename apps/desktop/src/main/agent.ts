import { anthropic } from '@ai-sdk/anthropic'
import { Session, SessionStore, type SessionOptions } from '@lefa/harness'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

if (existsSync('.env')) process.loadEnvFile()

const model = anthropic('claude-haiku-4-5')

/**
 * Plain files under the home directory rather than Electron's userData, so the
 * logs stay inspectable and portable between the app, a future CLI, and the
 * cloud.
 */
export const sessionStore = new SessionStore(join(homedir(), '.lefa', 'sessions'))

export function createWorkspaceSession(cwd: string, options: SessionOptions = {}): Session {
  return new Session(model, cwd, { ...options, store: sessionStore })
}
