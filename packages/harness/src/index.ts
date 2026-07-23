import { ToolLoopAgent, type LanguageModel, type ToolSet } from 'ai'
import { createBashTool, type BashTool } from './bash.ts'
import { createEditTool, type EditTool } from './edit.ts'
import { createReadTool, type ReadTool } from './read.ts'
import { createWriteTool, type WriteTool } from './write.ts'

export { createBashTool, type BashInput, type BashOutput, type BashTool } from './bash.ts'
export { createEditTool, type EditInput, type EditOutput, type EditTool } from './edit.ts'
export { createReadTool, type ReadInput, type ReadOutput, type ReadTool } from './read.ts'
export { createWriteTool, type WriteInput, type WriteOutput, type WriteTool } from './write.ts'

export interface HarnessTools extends ToolSet {
  bash: BashTool
  edit: EditTool
  read: ReadTool
  write: WriteTool
}

export function createTools(cwd: string): HarnessTools {
  return {
    bash: createBashTool(cwd),
    edit: createEditTool(cwd),
    read: createReadTool(cwd),
    write: createWriteTool(cwd)
  }
}

export function createAgent(model: LanguageModel, cwd: string) {
  return new ToolLoopAgent<never, HarnessTools, never>({
    instructions: `You are an expert coding assistant operating inside Lefa, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.

## Guidelines

- Use bash for file operations like ls, rg, and find
- Be concise in your responses
- Show file paths clearly when working with files

## Environment

Current working directory: ${cwd}`,
    model,
    tools: createTools(cwd)
  })
}
