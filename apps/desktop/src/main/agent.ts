import { GatewayAuthenticationError } from '@ai-sdk/gateway'
import { SessionManager, SessionStore } from '@lefa/harness'
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

/** Only `.message` survives IPC, so a missing key must say what to do about it. */
function describeError(error: unknown): string {
  if (GatewayAuthenticationError.isInstance(error)) {
    return 'No AI Gateway key. Set AI_GATEWAY_API_KEY in apps/desktop/.env.'
  }

  return error instanceof Error ? error.message : String(error)
}

/**
 * Every session and every run in this app, in one place.
 *
 * Runs belong to the manager rather than to a window, so closing or switching
 * one leaves the work alone.
 */
export const sessionManager = new SessionManager({
  store: new SessionStore(join(lefaHome, 'sessions')),
  describeError
})
