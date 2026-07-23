import { exec } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { tool, type Tool, type ToolExecuteFunction } from 'ai'
import * as z from 'zod'
import { MAX_BYTES, MAX_LINES, truncateTail } from './truncate.ts'

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

interface CommandError extends Error {
  code?: number | string
  stdout?: string
  stderr?: string
}

async function formatOutput(output: string): Promise<string> {
  let content = output.trimEnd()
  const truncatedContent = truncateTail(content)

  if (truncatedContent !== undefined) {
    const directory = await mkdtemp(join(tmpdir(), 'lefa-bash-'))
    const outputPath = join(directory, 'output.log')
    await writeFile(outputPath, output)

    content = `${truncatedContent}\n\n[Output truncated to the last ${MAX_LINES} lines or ${MAX_BYTES / 1024} KB. Full output: ${outputPath}]`
  }

  return content || '(no output)'
}

async function executeBash(cwd: string, { command }: BashInput): Promise<BashOutput> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      shell: process.env.SHELL
    })

    return { content: await formatOutput(`${stdout}${stderr}`) }
  } catch (error) {
    const commandError = error as CommandError
    if (commandError.stdout === undefined && commandError.stderr === undefined) throw error

    const content = await formatOutput(`${commandError.stdout ?? ''}${commandError.stderr ?? ''}`)
    throw new Error(`${content}\n\nCommand exited with code ${commandError.code ?? 'unknown'}`)
  }
}

export function createBashTool(cwd: string): BashTool {
  return tool({
    description:
      'Execute a bash command in the current working directory. Returns stdout and stderr, limited to the last 2,000 lines or 50 KB. If truncated, full output is saved to a temporary file.',
    inputSchema: bashInputSchema,
    strict: true,
    execute: (input) => executeBash(cwd, input),
    toModelOutput: ({ output }) => ({ type: 'text', value: output.content })
  })
}
