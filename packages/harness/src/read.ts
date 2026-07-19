import { constants } from 'node:fs'
import { access, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep, win32 } from 'node:path'

const MAX_LINES = 2000
const MAX_BYTES = 50 * 1024

interface ReadToolInput {
  path: string
  offset?: number
  limit?: number
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

function validateWindow(offset: number | undefined, limit: number | undefined): void {
  if (offset !== undefined && (!Number.isInteger(offset) || offset < 1)) {
    throw new Error('Offset must be a positive integer')
  }

  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error('Limit must be a positive integer')
  }
}

async function readTextFile(
  workspaceRoot: string,
  { path, offset, limit }: ReadToolInput,
  signal?: AbortSignal
) {
  validateWindow(offset, limit)
  signal?.throwIfAborted()

  const absolutePath = await resolveWorkspacePath(workspaceRoot, path)
  signal?.throwIfAborted()

  await access(absolutePath, constants.R_OK)
  signal?.throwIfAborted()

  const text = (await readFile(absolutePath, { signal })).toString('utf8')
  signal?.throwIfAborted()

  const lines = text.split('\n')
  const startLine = offset === undefined ? 0 : offset - 1

  if (startLine >= lines.length) {
    throw new Error(`Offset ${offset} is beyond end of file (${lines.length} lines total)`)
  }

  const selectedLines =
    limit === undefined ? lines.slice(startLine) : lines.slice(startLine, startLine + limit)
  const selectedContent = selectedLines.join('\n')
  const truncatedLines = truncateHead(selectedContent)
  const startLineDisplay = startLine + 1
  let content = truncatedLines?.join('\n') ?? selectedContent

  if (truncatedLines !== undefined) {
    const endLineDisplay = startLineDisplay + truncatedLines.length - 1
    const nextOffset = endLineDisplay + 1

    content += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${lines.length}. Use offset=${nextOffset} to continue.]`
  } else if (limit !== undefined && startLine + selectedLines.length < lines.length) {
    const remaining = lines.length - (startLine + selectedLines.length)
    const nextOffset = startLine + selectedLines.length + 1
    content += `\n\n[${remaining} more lines in file. Use offset=${nextOffset} to continue.]`
  }

  return { content }
}

export function createReadTool(workspaceRoot: string) {
  return {
    execute: (input: ReadToolInput, signal?: AbortSignal) =>
      readTextFile(workspaceRoot, input, signal)
  }
}
