import { tool, type Tool, type ToolExecuteFunction } from 'ai'
import * as z from 'zod'
import { runBashProcess, type BashProcessResult } from './bash-process.ts'

const bashInputSchema = z.strictObject({
  command: z.string()
})

export type BashInput = z.infer<typeof bashInputSchema>

export interface BashOutput {
  content: string
}

type BashContext = Record<string, unknown>

export type BashTool = Tool<BashInput, BashOutput, BashContext> & {
  execute: ToolExecuteFunction<BashInput, BashOutput, BashContext>
}

async function executeBash(
  cwd: string,
  { command }: BashInput,
  abortSignal?: AbortSignal
): Promise<BashOutput> {
  const result = await runBashProcess({
    command,
    cwd,
    ...(abortSignal === undefined ? {} : { abortSignal })
  })

  return { content: formatOutput(result) }
}

function formatOutput(result: BashProcessResult): string {
  const parts: string[] = []

  if (result.output.outputPath) {
    parts.push(`[Output truncated. Full output: ${result.output.outputPath}]`)
  }

  const preview = result.output.preview.trimEnd()
  if (preview) parts.push(preview)

  if (result.status === 'timed-out') {
    parts.push('Command timed out.')
  } else if (result.status === 'signaled') {
    parts.push(`Command terminated by ${result.signal}.`)
  } else if (result.exitCode !== 0) {
    parts.push(`Command exited with code ${result.exitCode}.`)
  }

  return parts.join('\n\n') || 'Command completed successfully.'
}

export function createBashTool(cwd: string): BashTool {
  return tool({
    description:
      'Execute a Bash command. Returns combined stdout and stderr, limited to the last 2,000 lines or 50 KB. If truncated, the complete output is saved to a temporary file.',
    inputSchema: bashInputSchema,
    strict: true,
    execute: (input, { abortSignal }) => executeBash(cwd, input, abortSignal),
    toModelOutput: ({ output }) => ({ type: 'text', value: output.content })
  })
}
