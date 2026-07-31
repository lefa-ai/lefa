import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { OutputCapture } from './bash-output.ts'
import { MAX_BYTES, MAX_LINES } from './truncate.ts'

describe('bash output capture', () => {
  it('keeps small output in memory', async () => {
    const capture = new OutputCapture()
    await capture.write(Buffer.from('Hello\n'))

    assert.deepEqual(await capture.finish(), { preview: 'Hello\n' })
  })

  it('does not spill at the byte or line limits', async () => {
    const bytes = 'x'.repeat(MAX_BYTES)
    const byteCapture = new OutputCapture()
    await byteCapture.write(Buffer.from(bytes))

    assert.deepEqual(await byteCapture.finish(), { preview: bytes })

    const lines = 'x\n'.repeat(MAX_LINES)
    const lineCapture = new OutputCapture()
    await lineCapture.write(Buffer.from(lines))

    assert.deepEqual(await lineCapture.finish(), { preview: lines })
  })

  it('deletes only stale managed output logs when spilling first starts', async () => {
    const directory = join(homedir(), '.cache', 'lefa', 'bash')
    const id = randomUUID()
    const oldLog = join(directory, `${id}-old.log`)
    const recentLog = join(directory, `${id}-recent.log`)
    const oldText = join(directory, `${id}-old.txt`)
    await mkdir(directory, { recursive: true })
    await Promise.all([
      writeFile(oldLog, 'old'),
      writeFile(recentLog, 'recent'),
      writeFile(oldText, 'old text')
    ])
    const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    await Promise.all([utimes(oldLog, oldDate, oldDate), utimes(oldText, oldDate, oldDate)])
    const capture = new OutputCapture()
    await capture.write(Buffer.from('x'.repeat(MAX_BYTES + 1)))
    const result = await capture.finish()

    try {
      await assert.rejects(stat(oldLog), { code: 'ENOENT' })
      assert.equal(await readFile(recentLog, 'utf8'), 'recent')
      assert.equal(await readFile(oldText, 'utf8'), 'old text')
    } finally {
      await Promise.all([
        rm(oldLog, { force: true }),
        rm(recentLog, { force: true }),
        rm(oldText, { force: true }),
        result.outputPath ? rm(result.outputPath, { force: true }) : Promise.resolve()
      ])
    }
  })

  it('backfills buffered output and streams later writes after spilling', async () => {
    const source = `${'x'.repeat(MAX_BYTES)}yz`
    const capture = new OutputCapture()
    await capture.write(Buffer.from(source.slice(0, MAX_BYTES)))
    await capture.write(Buffer.from('y'))
    await capture.write(Buffer.from('z'))
    const result = await capture.finish()

    try {
      assert.ok(result.outputPath)
      assert.equal(result.preview, source.slice(-MAX_BYTES))
      assert.equal(await readFile(result.outputPath, 'utf8'), source)
    } finally {
      if (result.outputPath) await rm(result.outputPath, { force: true })
    }
  })

  it('keeps the last lines and spills the complete output', async () => {
    const source = Array.from({ length: MAX_LINES + 1 }, (_, index) => `Line ${index + 1}`).join(
      '\n'
    )
    const capture = new OutputCapture()
    await capture.write(Buffer.from(source))
    const result = await capture.finish()

    try {
      assert.ok(result.outputPath)
      assert.equal(result.preview.split('\n').length, MAX_LINES)
      assert.match(result.preview, /^Line 2\n/)
      assert.match(result.preview, new RegExp(`Line ${MAX_LINES + 1}$`))
      assert.equal(await readFile(result.outputPath, 'utf8'), source)
      assert.equal((await stat(result.outputPath)).mode & 0o777, 0o600)
    } finally {
      if (result.outputPath) await rm(result.outputPath, { force: true })
    }
  })

  it('keeps a UTF-8-safe tail when writes split characters', async () => {
    const source = Buffer.from('€'.repeat(MAX_BYTES))
    const capture = new OutputCapture()

    for (let offset = 0; offset < source.length; offset += 4097) {
      await capture.write(source.subarray(offset, offset + 4097))
    }

    const result = await capture.finish()

    try {
      assert.ok(result.outputPath)
      assert.ok(Buffer.byteLength(result.preview) <= MAX_BYTES)
      assert.doesNotMatch(result.preview, /�/)
      assert.equal(result.preview, '€'.repeat(Math.floor(MAX_BYTES / 3)))
      assert.deepEqual(await readFile(result.outputPath), source)
    } finally {
      if (result.outputPath) await rm(result.outputPath, { force: true })
    }
  })

  it('keeps the final bytes of one oversized write', async () => {
    const source = Buffer.from('x'.repeat(MAX_BYTES + 100))
    const capture = new OutputCapture()
    await capture.write(source)
    const result = await capture.finish()

    try {
      assert.ok(result.outputPath)
      assert.equal(result.preview, 'x'.repeat(MAX_BYTES))
      assert.deepEqual(await readFile(result.outputPath), source)
    } finally {
      if (result.outputPath) await rm(result.outputPath, { force: true })
    }
  })
})
