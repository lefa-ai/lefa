import { anthropic } from '@ai-sdk/anthropic'
import { createAgent } from '@lefa/harness'

const model = anthropic('claude-haiku-4-5')

export function createWorkspaceAgent(cwd: string) {
  return createAgent(model, cwd)
}
