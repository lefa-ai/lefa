import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_MODEL, lefaHome } from './agent'

const path = join(lefaHome, 'settings.json')

/**
 * The model new sessions start on: whichever one was picked last.
 *
 * Anything unreadable falls back to the default rather than failing — a broken
 * preferences file must never stop the app from opening a session.
 */
export async function readDefaultModel(): Promise<string> {
  try {
    const settings: unknown = JSON.parse(await readFile(path, 'utf8'))
    const model = (settings as { model?: unknown } | null)?.model

    return typeof model === 'string' && model ? model : DEFAULT_MODEL
  } catch {
    return DEFAULT_MODEL
  }
}

export async function writeDefaultModel(model: string): Promise<void> {
  await mkdir(lefaHome, { recursive: true })
  await writeFile(path, `${JSON.stringify({ model }, null, 2)}\n`, 'utf8')
}
