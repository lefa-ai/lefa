import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { OutputCapture } from './bash-output.ts'
import { MAX_BYTES, MAX_LINES } from './truncate.ts'

async function withTempDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'lefa-bash-output-'))

  try {
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

describe('bash output capture', () => {
  it('keeps small output in memory', async () => {
    const capture = new OutputCapture()
    await capture.write(Buffer.from('Hello\n'))

    assert.deepEqual(await capture.finish(), { preview: 'Hello\n' })
  })

  it('keeps the last lines and spills the complete output', async () => {
    await withTempDirectory(async (directory) => {
      const source = Array.from({ length: MAX_LINES + 1 }, (_, index) => `Line ${index + 1}`).join(
        '\n'
      )
      const capture = new OutputCapture({ directory })
      await capture.write(Buffer.from(source))
      const result = await capture.finish()

      assert.ok(result.outputPath)
      assert.equal(result.preview.split('\n').length, MAX_LINES)
      assert.match(result.preview, /^Line 2\n/)
      assert.match(result.preview, new RegExp(`Line ${MAX_LINES + 1}$`))
      assert.equal(await readFile(result.outputPath, 'utf8'), source)
      assert.equal((await stat(result.outputPath)).mode & 0o777, 0o600)
    })
  })

  it('keeps a UTF-8-safe tail of one oversized line', async () => {
    await withTempDirectory(async (directory) => {
      const source = '🙂'.repeat(MAX_BYTES / 4 + 100)
      const capture = new OutputCapture({ directory })
      await capture.write(Buffer.from(source))
      const result = await capture.finish()

      assert.ok(result.outputPath)
      assert.ok(Buffer.byteLength(result.preview) <= MAX_BYTES)
      assert.doesNotMatch(result.preview, /�/)
      assert.match(result.preview, /🙂$/)
      assert.equal(await readFile(result.outputPath, 'utf8'), source)
    })
  })

  it('reports output storage failures', async () => {
    await withTempDirectory(async (directory) => {
      const outputDirectory = join(directory, 'not-a-directory')
      await writeFile(outputDirectory, 'file')
      const capture = new OutputCapture({ directory: outputDirectory })

      await assert.rejects(capture.write(Buffer.alloc(MAX_BYTES + 1)))
    })
  })
})
