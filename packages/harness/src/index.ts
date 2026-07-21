import { ToolLoopAgent, type LanguageModel, type ToolSet } from 'ai'
import { createReadTool, type ReadTool } from './read.ts'

export { createReadTool, type ReadInput, type ReadOutput, type ReadTool } from './read.ts'

export interface HarnessTools extends ToolSet {
  read: ReadTool
}

export function createTools(cwd: string): HarnessTools {
  return {
    read: createReadTool(cwd)
  }
}

export function createAgent(model: LanguageModel, cwd: string) {
  return new ToolLoopAgent<never, HarnessTools, never>({
    model,
    tools: createTools(cwd)
  })
}
