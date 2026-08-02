import { appendFile, mkdir, open, readFile, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { modelMessageSchema, type ModelMessage } from 'ai'
import * as z from 'zod'

/** Enough to hold the metadata line without ever touching the message body. */
const HEADER_BYTES = 8 * 1024
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const metaSchema = z.object({
  type: z.literal('meta'),
  id: z.string(),
  cwd: z.string(),
  createdAt: z.string(),
  title: z.string(),
  // Optional on purpose: sessions written before models were selectable, and
  // any session built on a test model, carry no id. Requiring it would make
  // those files unloadable.
  model: z.string().optional()
})

/**
 * Switching model mid-conversation appends a record rather than rewriting the
 * header, so the log stays append-only and listing still reads only line one.
 */
const modelLineSchema = z.object({
  type: z.literal('model'),
  model: z.string()
})

/**
 * The message shape is the AI SDK's own schema rather than one we maintain, so
 * a stored conversation can never drift from what the model call accepts.
 */
const messageLineSchema = z.object({
  type: z.literal('message'),
  message: modelMessageSchema
})

export type SessionMeta = Omit<z.infer<typeof metaSchema>, 'type'>

export interface SessionSummary extends SessionMeta {
  updatedAt: string
}

export interface SessionRecord {
  meta: SessionMeta
  messages: ModelMessage[]
}

function parseJson(line: string): unknown {
  try {
    return JSON.parse(line)
  } catch {
    // A crash can leave a half-written final line. Skipping it costs one turn
    // instead of the whole session.
    return undefined
  }
}

function readMeta(line: string): SessionMeta | undefined {
  const parsed = metaSchema.safeParse(parseJson(line))
  if (!parsed.success) return undefined

  const { type: _type, ...meta } = parsed.data
  return meta
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

  /** Records a mid-conversation model change. No-op until the session exists. */
  async appendModel(id: string, model: string): Promise<void> {
    const path = this.pathFor(id)
    if (!(await this.exists(path))) return

    await appendFile(path, `${JSON.stringify({ type: 'model', model })}\n`, 'utf8')
  }

  async load(id: string): Promise<SessionRecord> {
    const contents = await readFile(this.pathFor(id), 'utf8')
    const messages: ModelMessage[] = []
    let meta: SessionMeta | undefined

    for (const line of contents.split('\n')) {
      if (!line) continue

      const record = parseJson(line)
      if (record === undefined) continue

      if (meta === undefined) {
        const parsedMeta = metaSchema.safeParse(record)

        if (parsedMeta.success) {
          const { type: _type, ...rest } = parsedMeta.data
          meta = rest
          continue
        }
      }

      const parsedModel = modelLineSchema.safeParse(record)

      if (parsedModel.success) {
        // The newest record wins, so the session reopens on the model it ended on.
        if (meta) meta = { ...meta, model: parsedModel.data.model }
        continue
      }

      // Validate the shape, then keep the original: zod strips unknown keys, and
      // a message must round-trip byte for byte or provider options are lost.
      if (messageLineSchema.safeParse(record).success) {
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

      const meta = readMeta(header.slice(0, newline))
      if (!meta) return undefined

      const { mtime } = await file.stat()

      return { ...meta, updatedAt: mtime.toISOString() }
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
