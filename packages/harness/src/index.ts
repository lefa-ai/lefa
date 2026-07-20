import type { ToolSet } from 'ai'
import { createReadTool, type ReadTool } from './read.ts'

export { createReadTool, type ReadInput, type ReadOutput, type ReadTool } from './read.ts'

export interface HarnessTools extends ToolSet {
  read: ReadTool
}

export function createTools(workspaceRoot: string): HarnessTools {
  return {
    read: createReadTool(workspaceRoot)
  }
}
