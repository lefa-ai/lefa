import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MAX_BYTES, truncateTail } from './truncate.ts'

describe('output truncation', () => {
  it('keeps the fitting suffix of an oversized preceding line', () => {
    const result = truncateTail(`${'x'.repeat(MAX_BYTES * 2)}\nERROR`)

    assert.ok(result)
    assert.equal(Buffer.byteLength(result), MAX_BYTES)
    assert.ok(result.endsWith('\nERROR'))
  })
})
