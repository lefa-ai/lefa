import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { tool, type Tool, type ToolExecuteFunction } from 'ai'
import * as z from 'zod'

const execAsync = promisify(exec)

const bashInputSchema = z.strictObject({
  command: z.string().min(1).describe('Bash command to execute')
})

export type BashInput = z.infer<typeof bashInputSchema>

export interface BashOutput {
  content: string
}

type BashContext = Record<string, unknown>

export type BashTool = Tool<BashInput, BashOutput, BashContext> & {
  execute: ToolExecuteFunction<BashInput, BashOutput, BashContext>
}

async function executeBash(cwd: string, { command }: BashInput): Promise<BashOutput> {
  const { stdout, stderr } = await execAsync(command, {
    cwd,
    shell: process.env.SHELL
  })
  const content = `${stdout}${stderr}`.trimEnd()

  return { content: content || '(no output)' }
}

export function createBashTool(cwd: string): BashTool {
  return tool({
    description: 'Execute a bash command in the current working directory. Returns stdout and stderr.',
    inputSchema: bashInputSchema,
    strict: true,
    execute: (input) => executeBash(cwd, input),
    toModelOutput: ({ output }) => ({ type: 'text', value: output.content })
  })
}
