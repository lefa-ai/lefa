import { appendFile, mkdir, open, readFile, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ModelMessage } from 'ai'

/** Enough to hold the metadata line without ever touching the message body. */
const HEADER_BYTES = 8 * 1024
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export interface SessionMeta {
  id: string
  cwd: string
  createdAt: string
  title: string
}

export interface SessionSummary extends SessionMeta {
  updatedAt: string
}

export interface SessionRecord {
  meta: SessionMeta
  messages: ModelMessage[]
}

function isMeta(value: unknown): value is SessionMeta & { type: 'meta' } {
  if (!value || typeof value !== 'object') return false

  const line = value as Record<string, unknown>
  return (
    line.type === 'meta' &&
    typeof line.id === 'string' &&
    typeof line.cwd === 'string' &&
    typeof line.createdAt === 'string' &&
    typeof line.title === 'string'
  )
}

function parse(line: string): unknown {
  try {
    return JSON.parse(line)
  } catch {
    // A crash can leave a half-written final line. Skipping it costs one turn
    // instead of the whole session.
    return undefined
  }
}

/**
 * Append-only JSONL, one file per session.
 *
 * The first line is the session metadata, so listing reads a short header per
 * file and never the conversation body. Nothing here is an index: the logs are
 * the only source of truth, which is what keeps them safe to copy, grep, and
 * rebuild from.
 */
export class SessionStore {
  private readonly root: string

  constructor(root: string) {
    this.root = root
  }

  async append(meta: SessionMeta, messages: readonly ModelMessage[]): Promise<void> {
    await mkdir(this.root, { recursive: true })

    const path = this.pathFor(meta.id)
    const lines = messages.map((message) => JSON.stringify({ type: 'message', message }))

    if (!(await this.exists(path))) lines.unshift(JSON.stringify({ type: 'meta', ...meta }))
    if (lines.length === 0) return

    await appendFile(path, `${lines.join('\n')}\n`, 'utf8')
  }

  async load(id: string): Promise<SessionRecord> {
    const contents = await readFile(this.pathFor(id), 'utf8')
    const messages: ModelMessage[] = []
    let meta: SessionMeta | undefined

    for (const line of contents.split('\n')) {
      if (!line) continue

      const record = parse(line)

      if (isMeta(record)) {
        meta ??= {
          id: record.id,
          cwd: record.cwd,
          createdAt: record.createdAt,
          title: record.title
        }
      } else if (
        record &&
        typeof record === 'object' &&
        (record as { type?: unknown }).type === 'message'
      ) {
        messages.push((record as { message: ModelMessage }).message)
      }
    }

    if (!meta) throw new Error(`Session ${id} is missing its metadata.`)

    return { meta, messages }
  }

  async list(): Promise<SessionSummary[]> {
    const entries = await readdir(this.root).catch(() => [])
    const summaries = await Promise.all(
      entries
        .filter((entry) => entry.endsWith('.jsonl'))
        .map((entry) => this.summarize(join(this.root, entry)))
    )

    return summaries
      .filter((summary): summary is SessionSummary => summary !== undefined)
      .sort((first, second) => second.updatedAt.localeCompare(first.updatedAt))
  }

  async delete(id: string): Promise<void> {
    await rm(this.pathFor(id), { force: true })
  }

  private async summarize(path: string): Promise<SessionSummary | undefined> {
    const file = await open(path, 'r').catch(() => undefined)
    if (!file) return undefined

    try {
      const buffer = Buffer.alloc(HEADER_BYTES)
      const { bytesRead } = await file.read(buffer, 0, HEADER_BYTES, 0)
      const header = buffer.subarray(0, bytesRead).toString('utf8')
      const newline = header.indexOf('\n')
      if (newline === -1) return undefined

      const meta = parse(header.slice(0, newline))
      if (!isMeta(meta)) return undefined

      const { mtime } = await file.stat()

      return {
        id: meta.id,
        cwd: meta.cwd,
        createdAt: meta.createdAt,
        title: meta.title,
        updatedAt: mtime.toISOString()
      }
    } finally {
      await file.close()
    }
  }

  private async exists(path: string): Promise<boolean> {
    return stat(path).then(
      () => true,
      () => false
    )
  }

  /** Session ids cross a process boundary, so they are never trusted as paths. */
  private pathFor(id: string): string {
    if (!SESSION_ID.test(id)) throw new Error(`Invalid session id: ${id}`)

    return join(this.root, `${id}.jsonl`)
  }
}
