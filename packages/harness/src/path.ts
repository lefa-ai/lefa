import { homedir } from 'node:os'
import { resolve } from 'node:path'

export function resolvePath(cwd: string, filePath: string): string {
  const path = filePath.startsWith('@') ? filePath.slice(1) : filePath

  if (path.length === 0) throw new Error('Path must not be empty')
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) {
    return resolve(homedir(), path.slice(2))
  }

  return resolve(cwd, path)
}
