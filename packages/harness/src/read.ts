import { constants } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { tool, type Tool, type ToolExecuteFunction } from 'ai'
import * as z from 'zod'
import { resolvePath } from './path.ts'

const MAX_LINES = 2000
const MAX_BYTES = 50 * 1024

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

function truncateBytes(content: string): string | undefined {
  const buffer = Buffer.from(content)
  if (buffer.length <= MAX_BYTES) return undefined

  const lastNewline = buffer.lastIndexOf('\n', MAX_BYTES)
  if (lastNewline === -1) {
    throw new Error('The first requested line exceeds the 50 KB limit')
  }

  return buffer.subarray(0, lastNewline).toString('utf8')
}

async function readTextFile(
  cwd: string,
  { path, offset, limit }: ReadInput,
  signal?: AbortSignal
): Promise<ReadOutput> {
  const absolutePath = resolvePath(cwd, path)
  await access(absolutePath, constants.R_OK)
  const text = await readFile(absolutePath, { encoding: 'utf8', signal })

  const lines = text.split('\n')
  if (text.endsWith('\n')) lines.pop()
  const startLine = offset - 1

  if (startLine >= lines.length) {
    throw new Error(`Offset ${offset} is beyond end of file (${lines.length} lines total)`)
  }

  const selectedLines = lines.slice(startLine, startLine + limit)
  const startLineDisplay = startLine + 1
  let content = selectedLines.join('\n')
  const truncatedContent = truncateBytes(content)

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
