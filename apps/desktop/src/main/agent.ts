import { anthropic } from '@ai-sdk/anthropic'
import { Session } from '@lefa/harness'
import { existsSync } from 'node:fs'

if (existsSync('.env')) process.loadEnvFile()

const model = anthropic('claude-haiku-4-5')

export function createWorkspaceSession(cwd: string): Session {
  return new Session(model, cwd)
}
