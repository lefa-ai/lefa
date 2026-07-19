import { constants } from 'node:fs'
import { access, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep, win32 } from 'node:path'

export const DEFAULT_MAX_LINES = 2000
export const DEFAULT_MAX_BYTES = 50 * 1024

export interface ReadToolInput {
  path: string
  offset?: number
  limit?: number
}

export interface ReadTextFileInput extends ReadToolInput {
  workspaceRoot: string
}

export interface TruncationResult {
  content: string
  truncated: boolean
  truncatedBy: 'lines' | 'bytes' | null
  totalLines: number
  totalBytes: number
  outputLines: number
  outputBytes: number
  lastLinePartial: false
  firstLineExceedsLimit: boolean
  maxLines: number
  maxBytes: number
}

export interface ReadToolDetails {
  truncation?: TruncationResult
}

export interface ReadToolResult {
  content: string
  details?: ReadToolDetails
}

export interface ReadTool {
  execute: (input: ReadToolInput, signal?: AbortSignal) => Promise<ReadToolResult>
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function splitLinesForCounting(content: string): string[] {
  if (content.length === 0) return []

  const lines = content.split('\n')
  if (content.endsWith('\n')) lines.pop()
  return lines
}

function truncateHead(content: string): TruncationResult {
  const totalBytes = Buffer.byteLength(content, 'utf8')
  const lines = splitLinesForCounting(content)
  const totalLines = lines.length

  if (totalLines <= DEFAULT_MAX_LINES && totalBytes <= DEFAULT_MAX_BYTES) {
    return {
      content,
      truncated: false,
      truncatedBy: null,
      totalLines,
      totalBytes,
      outputLines: totalLines,
      outputBytes: totalBytes,
      lastLinePartial: false,
      firstLineExceedsLimit: false,
      maxLines: DEFAULT_MAX_LINES,
      maxBytes: DEFAULT_MAX_BYTES
    }
  }

  const firstLineBytes = Buffer.byteLength(lines[0] ?? '', 'utf8')

  if (firstLineBytes > DEFAULT_MAX_BYTES) {
    return {
      content: '',
      truncated: true,
      truncatedBy: 'bytes',
      totalLines,
      totalBytes,
      outputLines: 0,
      outputBytes: 0,
      lastLinePartial: false,
      firstLineExceedsLimit: true,
      maxLines: DEFAULT_MAX_LINES,
      maxBytes: DEFAULT_MAX_BYTES
    }
  }

  const output: string[] = []
  let outputBytes = 0
  let truncatedBy: 'lines' | 'bytes' = 'lines'

  for (let index = 0; index < lines.length && index < DEFAULT_MAX_LINES; index += 1) {
    const line = lines[index] ?? ''
    const lineBytes = Buffer.byteLength(line, 'utf8') + (index > 0 ? 1 : 0)

    if (outputBytes + lineBytes > DEFAULT_MAX_BYTES) {
      truncatedBy = 'bytes'
      break
    }

    output.push(line)
    outputBytes += lineBytes
  }

  const outputContent = output.join('\n')

  return {
    content: outputContent,
    truncated: true,
    truncatedBy,
    totalLines,
    totalBytes,
    outputLines: output.length,
    outputBytes: Buffer.byteLength(outputContent, 'utf8'),
    lastLinePartial: false,
    firstLineExceedsLimit: false,
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES
  }
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

export async function readTextFile(
  { workspaceRoot, path, offset, limit }: ReadTextFileInput,
  signal?: AbortSignal
): Promise<ReadToolResult> {
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
  const truncation = truncateHead(selectedContent)
  const startLineDisplay = startLine + 1
  let content = truncation.content
  let details: ReadToolDetails | undefined

  if (truncation.firstLineExceedsLimit) {
    const firstLineSize = formatSize(Buffer.byteLength(lines[startLine] ?? '', 'utf8'))
    content = `[Line ${startLineDisplay} is ${firstLineSize}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit.]`
    details = { truncation }
  } else if (truncation.truncated) {
    const endLineDisplay = startLineDisplay + truncation.outputLines - 1
    const nextOffset = endLineDisplay + 1
    const byteLimit =
      truncation.truncatedBy === 'bytes' ? ` (${formatSize(DEFAULT_MAX_BYTES)} limit)` : ''

    content += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${lines.length}${byteLimit}. Use offset=${nextOffset} to continue.]`
    details = { truncation }
  } else if (limit !== undefined && startLine + selectedLines.length < lines.length) {
    const remaining = lines.length - (startLine + selectedLines.length)
    const nextOffset = startLine + selectedLines.length + 1
    content += `\n\n[${remaining} more lines in file. Use offset=${nextOffset} to continue.]`
  }

  return details === undefined ? { content } : { content, details }
}

export function createReadTool(workspaceRoot: string): ReadTool {
  return {
    execute: (input, signal) => readTextFile({ workspaceRoot, ...input }, signal)
  }
}
