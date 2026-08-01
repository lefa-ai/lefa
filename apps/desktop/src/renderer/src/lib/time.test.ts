import { describe, expect, it } from 'vitest'
import { relativeTime } from './time'

const now = Date.parse('2026-08-01T12:00:00.000Z')

function ago(milliseconds: number): string {
  return relativeTime(new Date(now - milliseconds).toISOString(), now)
}

describe('relativeTime', () => {
  it('describes recent timestamps in the largest useful unit', () => {
    expect(ago(5_000)).toBe('just now')
    expect(ago(3 * 60_000)).toBe('3m ago')
    expect(ago(5 * 60 * 60_000)).toBe('5h ago')
    expect(ago(3 * 24 * 60 * 60_000)).toBe('3d ago')
  })

  it('falls back to a date once a week has passed', () => {
    expect(ago(30 * 24 * 60 * 60_000)).toBe(
      new Date(Date.parse('2026-07-02T12:00:00Z')).toLocaleDateString()
    )
  })

  it('returns nothing for a timestamp it cannot read', () => {
    expect(relativeTime('not a date', now)).toBe('')
  })
})
