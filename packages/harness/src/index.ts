import { ToolLoopAgent, type LanguageModel, type ToolSet } from 'ai'
import { createBashTool, type BashTool } from './bash.ts'
import { createEditTool, type EditTool } from './edit.ts'
import { createReadTool, type ReadTool } from './read.ts'

export { createBashTool, type BashInput, type BashOutput, type BashTool } from './bash.ts'
export { createEditTool, type EditInput, type EditOutput, type EditTool } from './edit.ts'
export { createReadTool, type ReadInput, type ReadOutput, type ReadTool } from './read.ts'

export interface HarnessTools extends ToolSet {
  bash: BashTool
  edit: EditTool
  read: ReadTool
}

export function createTools(cwd: string): HarnessTools {
  return {
    bash: createBashTool(cwd),
    edit: createEditTool(cwd),
    read: createReadTool(cwd)
  }
}

export function createAgent(model: LanguageModel, cwd: string) {
  return new ToolLoopAgent<never, HarnessTools, never>({
    model,
    tools: createTools(cwd)
  })
}
