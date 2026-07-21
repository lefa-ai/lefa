import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { tool, type Tool, type ToolExecuteFunction } from 'ai'
import * as z from 'zod'
import { resolvePath } from './path.ts'

const writeInputSchema = z.strictObject({
  path: z.string().min(1).describe('Relative or absolute path'),
  content: z.string().describe('Content to write')
})

export type WriteInput = z.infer<typeof writeInputSchema>

export interface WriteOutput {
  content: string
}

type WriteContext = Record<string, unknown>

export type WriteTool = Tool<WriteInput, WriteOutput, WriteContext> & {
  execute: ToolExecuteFunction<WriteInput, WriteOutput, WriteContext>
}

async function writeTextFile(cwd: string, { path, content }: WriteInput): Promise<WriteOutput> {
  const absolutePath = resolvePath(cwd, path)
  await mkdir(dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, content, 'utf8')

  return { content: `Successfully wrote ${path}` }
}

export function createWriteTool(cwd: string): WriteTool {
  return tool({
    description:
      "Write content to a file. Creates the file if it doesn't exist, overwrites it if it does, and creates parent directories.",
    inputSchema: writeInputSchema,
    strict: true,
    execute: (input) => writeTextFile(cwd, input),
    toModelOutput: ({ output }) => ({ type: 'text', value: output.content })
  })
}
