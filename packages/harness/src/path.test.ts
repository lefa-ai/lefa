import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'
import { resolvePath } from './path.ts'

describe('path resolution', () => {
  it('resolves relative, parent, and absolute paths permissively', () => {
    const cwd = resolve('/tmp', 'workspace')
    const absolute = resolve('/tmp', 'outside.txt')

    assert.equal(resolvePath(cwd, 'notes.txt'), resolve(cwd, 'notes.txt'))
    assert.equal(resolvePath(cwd, '../outside.txt'), absolute)
    assert.equal(resolvePath(cwd, absolute), absolute)
  })

  it('removes one model-style @ prefix', () => {
    const cwd = resolve('/tmp', 'workspace')

    assert.equal(resolvePath(cwd, '@notes.txt'), resolve(cwd, 'notes.txt'))
    assert.equal(resolvePath(cwd, '@@notes.txt'), resolve(cwd, '@notes.txt'))
    assert.equal(resolvePath(cwd, '@/tmp/outside.txt'), resolve('/tmp/outside.txt'))
  })

  it('expands home paths', () => {
    assert.equal(resolvePath('/tmp', '~'), homedir())
    assert.equal(resolvePath('/tmp', '~/notes.txt'), resolve(homedir(), 'notes.txt'))
    assert.equal(resolvePath('/tmp', '~\\notes.txt'), resolve(homedir(), 'notes.txt'))
  })

  it('rejects paths that are empty before or after prefix removal', () => {
    assert.throws(() => resolvePath('/tmp', ''), /Path must not be empty/)
    assert.throws(() => resolvePath('/tmp', '@'), /Path must not be empty/)
  })
})
