import { constants } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { tool, type Tool, type ToolExecuteFunction } from 'ai'
import * as z from 'zod'
import { resolvePath } from './path.ts'
import { MAX_LINES, splitLines, truncateHead } from './truncate.ts'

const readInputSchema = z.strictObject({
  path: z.string().min(1).describe('Relative or absolute path'),
  offset: z.number().default(1).describe('First line, starting at 1'),
  limit: z.number().default(MAX_LINES).describe('Maximum lines')
})

export type ReadInput = z.infer<typeof readInputSchema>

export interface ReadOutput {
  content: string
}

type ReadContext = Record<string, unknown>

export type ReadTool = Tool<ReadInput, ReadOutput, ReadContext> & {
  execute: ToolExecuteFunction<ReadInput, ReadOutput, ReadContext>
}

async function readTextFile(
  cwd: string,
  { path, offset, limit }: ReadInput,
  signal?: AbortSignal
): Promise<ReadOutput> {
  const absolutePath = resolvePath(cwd, path)
  await access(absolutePath, constants.R_OK)
  const text = await readFile(absolutePath, { encoding: 'utf8', signal })

  const lines = splitLines(text)
  const startLine = offset - 1

  if (startLine >= lines.length) {
    throw new Error(`Offset ${offset} is beyond end of file (${lines.length} lines total)`)
  }

  const selectedLines = lines.slice(startLine, startLine + Math.min(limit, MAX_LINES))
  const startLineDisplay = startLine + 1
  let content = selectedLines.join('\n')
  const truncatedContent = truncateHead(content)

  if (truncatedContent !== undefined) {
    content = truncatedContent
    const returnedLines = content.split('\n').length
    const endLineDisplay = startLineDisplay + returnedLines - 1
    const nextOffset = endLineDisplay + 1

    content += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${lines.length}. Use offset=${nextOffset} to continue.]`
  } else if (startLine + selectedLines.length < lines.length) {
    const remaining = lines.length - (startLine + selectedLines.length)
    const nextOffset = startLine + selectedLines.length + 1
    content += `\n\n[${remaining} more lines in file. Use offset=${nextOffset} to continue.]`
  }

  return { content }
}

export function createReadTool(cwd: string): ReadTool {
  return tool({
    description:
      'Read a UTF-8 text file. Paths may be relative to the current working directory or absolute. Output is limited to 2,000 lines or 50 KB; use offset and limit to continue reading large files.',
    inputSchema: readInputSchema,
    strict: true,
    execute: (input, { abortSignal }) => readTextFile(cwd, input, abortSignal),
    toModelOutput: ({ output }) => ({ type: 'text', value: output.content })
  })
}
