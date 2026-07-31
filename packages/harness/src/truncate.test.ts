import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MAX_BYTES, MAX_LINES, splitLines, truncateHead, truncateTail } from './truncate.ts'

describe('line splitting', () => {
  it('handles empty content and trailing newlines without adding a line', () => {
    assert.deepEqual(splitLines(''), [''])
    assert.deepEqual(splitLines('one\ntwo'), ['one', 'two'])
    assert.deepEqual(splitLines('one\ntwo\n'), ['one', 'two'])
    assert.deepEqual(splitLines('\n'), [''])
  })
})

describe('head truncation', () => {
  it('does not truncate at the exact line or byte limits', () => {
    assert.equal(truncateHead('x\n'.repeat(MAX_LINES)), undefined)
    assert.equal(truncateHead('x'.repeat(MAX_BYTES)), undefined)
  })

  it('keeps the first lines when the line limit is exceeded', () => {
    const lines = Array.from({ length: MAX_LINES + 1 }, (_, index) => `Line ${index + 1}`)

    assert.equal(truncateHead(lines.join('\n')), lines.slice(0, MAX_LINES).join('\n'))
  })

  it('keeps complete leading lines within the byte limit', () => {
    const line = 'x'.repeat(1024)
    const source = Array.from({ length: 60 }, () => line).join('\n')
    const result = truncateHead(source)

    assert.ok(result)
    assert.ok(Buffer.byteLength(result) <= MAX_BYTES)
    assert.equal(result, Array.from({ length: 49 }, () => line).join('\n'))
  })

  it('rejects a first line that exceeds the byte limit', () => {
    assert.throws(
      () => truncateHead('x'.repeat(MAX_BYTES + 1)),
      /first requested line exceeds the 50 KB limit/
    )
  })
})

describe('tail truncation', () => {
  it('does not truncate at the exact line or byte limits', () => {
    assert.equal(truncateTail('x\n'.repeat(MAX_LINES)), undefined)
    assert.equal(truncateTail('x'.repeat(MAX_BYTES)), undefined)
  })

  it('keeps the last lines when the line limit is exceeded', () => {
    const lines = Array.from({ length: MAX_LINES + 1 }, (_, index) => `Line ${index + 1}`)

    assert.equal(truncateTail(lines.join('\n')), lines.slice(1).join('\n'))
  })

  it('keeps complete trailing lines within the byte limit', () => {
    const line = 'x'.repeat(30 * 1024)
    const source = `${'d'.repeat(30 * 1024)}\n${line}`

    assert.equal(truncateTail(source), line)
  })

  it('keeps a valid UTF-8 suffix from one oversized line', () => {
    const source = '€'.repeat(18_000)
    const result = truncateTail(source)

    assert.equal(result, '€'.repeat(Math.floor(MAX_BYTES / 3)))
    assert.doesNotMatch(result ?? '', /�/)
    assert.ok(Buffer.byteLength(result ?? '') <= MAX_BYTES)
  })
})
