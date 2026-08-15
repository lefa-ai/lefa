import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  truncate,
  writeFile
} from 'node:fs/promises'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import * as z from 'zod'

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const metaSchema = z.object({
  id: z.string(),
  cwd: z.string(),
  createdAt: z.string(),
  title: z.string(),
  model: z.string()
})

/**
 * Enough of a message to trust the line, and no more.
 *
 * The parsed object is kept rather than the validated one: a schema strips what
 * it does not know, and a message has to round-trip byte for byte or provider
 * metadata — reasoning signatures among it — is quietly lost.
 */
const messageShape = z.object({
  id: z.string(),
  role: z.enum(['system', 'user', 'assistant']),
  parts: z.array(z.unknown())
})

export type SessionMeta = z.infer<typeof metaSchema>

export interface SessionSummary extends SessionMeta {
  updatedAt: string
}

export interface SessionRecord {
  meta: SessionMeta
  messages: UIMessage[]
}

/**
 * A session on disk: one file for what it is, one for what was said.
 *
 * Metadata is small and changes in place, so it is a plain JSON file. Messages
 * only ever grow, so they are an append-only log — except for the last line,
 * which is the message still being written and is rewritten as it grows. A
 * conversation is therefore never more than one line away from being on disk.
 */
export class SessionStore {
  private readonly root: string
  /** Byte offset where each session's final line begins. */
  private readonly tails = new Map<string, number>()

  constructor(root: string) {
    this.root = root
  }

  async save(meta: SessionMeta): Promise<void> {
    await mkdir(this.root, { recursive: true })
    await writeFile(this.metaPath(meta.id), `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
  }

  /**
   * Reads a session back, repairing the log if a crash damaged it.
   *
   * A half-written final line costs the message that was in flight rather than
   * the whole conversation. It is cut away here rather than skipped forever,
   * so that what is on disk is always exactly what was read.
   */
  async load(id: string): Promise<SessionRecord> {
    const meta = metaSchema.parse(JSON.parse(await readFile(this.metaPath(id), 'utf8')))
    const path = this.messagesPath(id)
    const contents = await readFile(path, 'utf8').catch(() => '')
    const lines: string[] = []
    const messages: UIMessage[] = []

    for (const line of contents.split('\n')) {
      if (!line) continue

      const parsed = safeJson(line)

      if (parsed === undefined || !messageShape.safeParse(parsed).success) continue

      lines.push(line)
      messages.push(parsed as UIMessage)
    }

    const intact = byteLength(lines)
    if ((await sizeOf(path)) > intact) await truncate(path, intact).catch(() => {})

    this.tails.set(id, byteLength(lines.slice(0, -1)))

    return { meta, messages }
  }

  /** Adds a message and makes it the one that further writes will rewrite. */
  async append(id: string, message: UIMessage): Promise<void> {
    await mkdir(this.root, { recursive: true })
    const path = this.messagesPath(id)

    this.tails.set(id, await sizeOf(path))
    await appendFile(path, `${JSON.stringify(message)}\n`, 'utf8')
  }

  /**
   * Rewrites the last message in place.
   *
   * Only the final line changes while a message is being written, so the file
   * is cut back to where that line starts rather than rewritten whole — a long
   * conversation costs the same as a short one.
   */
  async replaceLast(id: string, message: UIMessage): Promise<void> {
    const tail = this.tails.get(id)

    if (tail === undefined) return this.append(id, message)

    const path = this.messagesPath(id)
    await truncate(path, tail)
    await appendFile(path, `${JSON.stringify(message)}\n`, 'utf8')
  }

  async list(): Promise<SessionSummary[]> {
    const entries = await readdir(this.root).catch(() => [])
    const summaries = await Promise.all(
      entries.filter((entry) => entry.endsWith('.json')).map((entry) => this.summarize(entry))
    )

    return summaries
      .filter((summary): summary is SessionSummary => summary !== undefined)
      .sort((first, second) => second.updatedAt.localeCompare(first.updatedAt))
  }

  async delete(id: string): Promise<void> {
    this.tails.delete(id)
    await rm(this.metaPath(id), { force: true })
    await rm(this.messagesPath(id), { force: true })
  }

  private async summarize(entry: string): Promise<SessionSummary | undefined> {
    const path = join(this.root, entry)
    const contents = await readFile(path, 'utf8').catch(() => undefined)
    if (contents === undefined) return undefined

    const meta = metaSchema.safeParse(safeJson(contents))
    if (!meta.success) return undefined

    // The log is what changes when a session is used; its metadata rarely does.
    const written = await stat(this.messagesPath(meta.data.id)).catch(() => stat(path))

    return { ...meta.data, updatedAt: written.mtime.toISOString() }
  }

  /** Session ids cross a process boundary, so they are never trusted as paths. */
  private metaPath(id: string): string {
    return join(this.root, `${this.checked(id)}.json`)
  }

  private messagesPath(id: string): string {
    return join(this.root, `${this.checked(id)}.jsonl`)
  }

  private checked(id: string): string {
    if (!SESSION_ID.test(id)) throw new Error(`Invalid session id: ${id}`)

    return id
  }
}

/** What the given lines occupy on disk, each with its newline. */
function byteLength(lines: readonly string[]): number {
  return lines.reduce((total, line) => total + Buffer.byteLength(line, 'utf8') + 1, 0)
}

async function sizeOf(path: string): Promise<number> {
  return stat(path).then(
    ({ size }) => size,
    () => 0
  )
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
