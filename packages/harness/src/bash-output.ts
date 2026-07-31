import { randomUUID } from 'node:crypto'
import { mkdir, open, readdir, rm, stat, type FileHandle } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { MAX_BYTES, MAX_LINES } from './truncate.ts'

const MAX_AGE = 7 * 24 * 60 * 60 * 1000
const OUTPUT_DIRECTORY = join(homedir(), '.cache', 'lefa', 'bash')
let outputDirectoryCleaned = false

export interface CapturedOutput {
  preview: string
  outputPath?: string
}

export class OutputCapture {
  private readonly bufferedChunks: Buffer[] = []
  private tailChunks: Buffer[] = []
  private tailBytes = 0
  private totalBytes = 0
  private newlineCount = 0
  private lastByte: number | undefined
  private outputFile: FileHandle | undefined
  private outputPath: string | undefined

  async write(chunk: Uint8Array): Promise<void> {
    if (chunk.byteLength === 0) return

    const buffer = Buffer.from(chunk)
    this.totalBytes += buffer.length
    this.lastByte = buffer[buffer.length - 1]

    for (const byte of buffer) {
      if (byte === 0x0a) this.newlineCount++
    }

    this.appendTail(buffer)

    if (this.outputFile) {
      await this.outputFile.writeFile(buffer)
      return
    }

    this.bufferedChunks.push(buffer)

    if (this.isTruncated()) await this.startSpilling()
  }

  async finish(): Promise<CapturedOutput> {
    await this.close()

    const preview = decodeTail(Buffer.concat(this.tailChunks, this.tailBytes))
    return this.outputPath === undefined ? { preview } : { preview, outputPath: this.outputPath }
  }

  async close(): Promise<void> {
    const outputFile = this.outputFile
    this.outputFile = undefined
    await outputFile?.close()
  }

  private appendTail(buffer: Buffer): void {
    if (buffer.length >= MAX_BYTES) {
      this.tailChunks = [Buffer.from(buffer.subarray(buffer.length - MAX_BYTES))]
      this.tailBytes = MAX_BYTES
      return
    }

    this.tailChunks.push(buffer)
    this.tailBytes += buffer.length

    while (this.tailBytes > MAX_BYTES) {
      const first = this.tailChunks[0]
      if (!first) break

      const excess = this.tailBytes - MAX_BYTES
      if (first.length <= excess) {
        this.tailChunks.shift()
        this.tailBytes -= first.length
      } else {
        this.tailChunks[0] = Buffer.from(first.subarray(excess))
        this.tailBytes -= excess
      }
    }
  }

  private isTruncated(): boolean {
    const lineCount =
      this.totalBytes === 0 ? 0 : this.newlineCount + (this.lastByte === 0x0a ? 0 : 1)

    return this.totalBytes > MAX_BYTES || lineCount > MAX_LINES
  }

  private async startSpilling(): Promise<void> {
    const { file, path } = await createOutputFile()
    this.outputFile = file
    this.outputPath = path

    try {
      for (const chunk of this.bufferedChunks) await file.writeFile(chunk)
      this.bufferedChunks.length = 0
    } catch (error) {
      await this.close().catch(() => undefined)
      throw error
    }
  }
}

async function createOutputFile(): Promise<{ file: FileHandle; path: string }> {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true, mode: 0o700 })

  if (!outputDirectoryCleaned) {
    outputDirectoryCleaned = true
    await removeOldOutputs().catch(() => undefined)
  }

  const path = join(OUTPUT_DIRECTORY, `${Date.now()}-${randomUUID()}.log`)
  return { file: await open(path, 'wx', 0o600), path }
}

async function removeOldOutputs(): Promise<void> {
  const cutoff = Date.now() - MAX_AGE
  const entries = await readdir(OUTPUT_DIRECTORY, { withFileTypes: true })

  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.log'))
      .map(async (entry) => {
        const path = join(OUTPUT_DIRECTORY, entry.name)
        if ((await stat(path)).mtimeMs < cutoff) await rm(path, { force: true })
      })
  )
}

function decodeTail(buffer: Buffer): string {
  let start = lineStart(buffer)

  while (start < buffer.length && ((buffer[start] as number) & 0xc0) === 0x80) start++

  return new TextDecoder().decode(buffer.subarray(start))
}

function lineStart(buffer: Buffer): number {
  let remainingLines = MAX_LINES
  let index = buffer.length - 1

  if (buffer[index] === 0x0a) index--

  for (; index >= 0; index--) {
    if (buffer[index] !== 0x0a) continue

    remainingLines--
    if (remainingLines === 0) return index + 1
  }

  return 0
}
