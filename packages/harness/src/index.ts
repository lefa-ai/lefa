import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs'
import { join } from 'node:path'
import { ToolLoopAgent, type LanguageModel, type ToolSet } from 'ai'
import { createBashTool, type BashTool } from './bash.ts'
import { createEditTool, type EditTool } from './edit.ts'
import { createReadTool, type ReadTool } from './read.ts'
import { MAX_BYTES } from './truncate.ts'
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

function readProjectInstructions(cwd: string): string {
  let file: number

  try {
    file = openSync(join(cwd, 'AGENTS.md'), constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ELOOP') return ''
    throw error
  }

  try {
    const stats = fstatSync(file)
    if (!stats.isFile()) return ''

    const content = Buffer.alloc(MAX_BYTES + 1)
    const bytesRead = readSync(file, content, 0, content.length, 0)
    if (bytesRead > MAX_BYTES) throw new Error('AGENTS.md exceeds the 50 KB limit')

    return content.subarray(0, bytesRead).toString().trim()
  } finally {
    closeSync(file)
  }
}

export function createAgent(model: LanguageModel, cwd: string) {
  const projectInstructions = readProjectInstructions(cwd)
  const projectContext = projectInstructions
    ? `\n\n## Project Instructions\n\n${projectInstructions}`
    : ''

  return new ToolLoopAgent<never, HarnessTools, never>({
    instructions: `You are an expert coding assistant operating inside Lefa, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.

## Guidelines

- Use bash for file operations like ls, rg, and find
- Be concise in your responses
- Show file paths clearly when working with files

## Environment

Current working directory: ${cwd}${projectContext}`,
    model,
    tools: createTools(cwd)
  })
}
