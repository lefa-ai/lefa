import { constants } from 'node:fs'
import { access, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep, win32 } from 'node:path'
import { tool, type Tool, type ToolExecuteFunction } from 'ai'
import * as z from 'zod'

const MAX_LINES = 2000
const MAX_BYTES = 50 * 1024

const readInputSchema = z.strictObject({
  path: z.string().min(1).describe('Workspace-relative path'),
  offset: z.int().positive().default(1).describe('First line, starting at 1'),
  limit: z.int().positive().default(MAX_LINES).describe('Maximum lines')
})

export type ReadInput = z.infer<typeof readInputSchema>

export interface ReadOutput {
  content: string
}

type ReadContext = Record<string, unknown>

export type ReadTool = Tool<ReadInput, ReadOutput, ReadContext> & {
  execute: ToolExecuteFunction<ReadInput, ReadOutput, ReadContext>
}

function splitLinesForCounting(content: string): string[] {
  if (content.length === 0) return []

  const lines = content.split('\n')
  if (content.endsWith('\n')) lines.pop()
  return lines
}

function truncateHead(content: string): string[] | undefined {
  const lines = splitLinesForCounting(content)

  if (lines.length <= MAX_LINES && Buffer.byteLength(content, 'utf8') <= MAX_BYTES) {
    return undefined
  }

  if (Buffer.byteLength(lines[0] ?? '', 'utf8') > MAX_BYTES) {
    throw new Error('The first requested line exceeds the 50 KB limit')
  }

  const output: string[] = []
  let outputBytes = 0

  for (let index = 0; index < lines.length && index < MAX_LINES; index += 1) {
    const line = lines[index] ?? ''
    const lineBytes = Buffer.byteLength(line, 'utf8') + (index > 0 ? 1 : 0)

    if (outputBytes + lineBytes > MAX_BYTES) break

    output.push(line)
    outputBytes += lineBytes
  }

  return output
}

function normalizePath(filePath: string): string {
  const normalized = filePath.startsWith('@') ? filePath.slice(1) : filePath

  if (normalized.length === 0) throw new Error('Path must not be empty')

  if (isAbsolute(normalized) || win32.isAbsolute(normalized)) {
    throw new Error(`Path must be relative to the workspace: ${filePath}`)
  }

  if (normalized.split(/[\\/]+/).includes('..')) {
    throw new Error(`Path must not traverse outside the workspace: ${filePath}`)
  }

  return normalized
}

async function resolveWorkspacePath(workspaceRoot: string, filePath: string): Promise<string> {
  const canonicalRoot = await realpath(workspaceRoot)
  const canonicalPath = await realpath(resolve(canonicalRoot, normalizePath(filePath)))
  const relativePath = relative(canonicalRoot, canonicalPath)

  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`Path resolves outside the workspace: ${filePath}`)
  }

  return canonicalPath
}

async function readTextFile(
  workspaceRoot: string,
  { path, offset, limit }: ReadInput,
  signal?: AbortSignal
): Promise<ReadOutput> {
  signal?.throwIfAborted()

  const absolutePath = await resolveWorkspacePath(workspaceRoot, path)
  signal?.throwIfAborted()

  await access(absolutePath, constants.R_OK)
  signal?.throwIfAborted()

  const text = (await readFile(absolutePath, { signal })).toString('utf8')
  signal?.throwIfAborted()

  const lines = text.split('\n')
  const startLine = offset - 1

  if (startLine >= lines.length) {
    throw new Error(`Offset ${offset} is beyond end of file (${lines.length} lines total)`)
  }

  const selectedLines = lines.slice(startLine, startLine + limit)
  const selectedContent = selectedLines.join('\n')
  const truncatedLines = truncateHead(selectedContent)
  const startLineDisplay = startLine + 1
  let content = truncatedLines?.join('\n') ?? selectedContent

  if (truncatedLines !== undefined) {
    const endLineDisplay = startLineDisplay + truncatedLines.length - 1
    const nextOffset = endLineDisplay + 1

    content += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${lines.length}. Use offset=${nextOffset} to continue.]`
  } else if (startLine + selectedLines.length < lines.length) {
    const remaining = lines.length - (startLine + selectedLines.length)
    const nextOffset = startLine + selectedLines.length + 1
    content += `\n\n[${remaining} more lines in file. Use offset=${nextOffset} to continue.]`
  }

  return { content }
}

export function createReadTool(workspaceRoot: string): ReadTool {
  return tool({
    description:
      'Read a UTF-8 text file inside the workspace. Paths must be relative. Output is limited to 2,000 lines or 50 KB; use offset and limit to continue reading large files.',
    inputSchema: readInputSchema,
    strict: true,
    execute: (input, { abortSignal }) => readTextFile(workspaceRoot, input, abortSignal),
    toModelOutput: ({ output }) => ({ type: 'text', value: output.content })
  })
}
