import { describe, expect, it } from 'vitest'
import { deadlineStatus, effectiveOn } from './effective-dated.js'

/**
 * These decide which pay rate and which rent applied on a given date. Getting
 * them wrong rewrites history quietly, which is the whole reason the records are
 * effective-dated rather than a single mutable field.
 */

const rates = [
  { effectiveFrom: '2026-06-01', label: 'june' },
  { effectiveFrom: '2026-03-01', label: 'march' },
  { effectiveFrom: '2026-09-01', label: 'september' },
]

describe('effectiveOn', () => {
  it('picks the latest record starting on or before the date', () => {
    expect(effectiveOn(rates, '2026-07-15')?.label).toBe('june')
  })

  it('does not assume the caller sorted the history', () => {
    // Deliberately shuffled above. A caller that sorted differently must not get
    // a different answer.
    expect(effectiveOn([...rates].reverse(), '2026-07-15')?.label).toBe('june')
  })

  it('ignores future-dated records', () => {
    // A raise agreed in advance is entered the day it is agreed and must not
    // apply until its own start date.
    expect(effectiveOn(rates, '2026-08-31')?.label).toBe('june')
    expect(effectiveOn(rates, '2026-09-01')?.label).toBe('september')
  })

  it('treats the start date itself as in force', () => {
    expect(effectiveOn(rates, '2026-06-01')?.label).toBe('june')
    // The day before belongs to the previous rate.
    expect(effectiveOn(rates, '2026-05-31')?.label).toBe('march')
  })

  it('returns null before any record starts, rather than the earliest one', () => {
    // "No rate had been set yet" is a real state and must not read as zero pay.
    expect(effectiveOn(rates, '2026-01-01')).toBeNull()
  })

  it('returns null for an empty history', () => {
    expect(effectiveOn([], '2026-07-15')).toBeNull()
  })
})

describe('deadlineStatus', () => {
  const today = '2026-08-30'

  it('is quiet when the deadline is far away', () => {
    expect(deadlineStatus('2026-12-31', 30, today)).toEqual({ state: 'none', daysLeft: 123 })
  })

  it('warns once inside the window', () => {
    expect(deadlineStatus('2026-09-20', 30, today)).toEqual({ state: 'due', daysLeft: 21 })
  })

  it('treats the window edge as due, not clear', () => {
    // Exactly 30 days out with a 30-day window. An off-by-one here means the
    // warning never appears on the day it is meant to.
    expect(deadlineStatus('2026-09-29', 30, today).state).toBe('due')
  })

  it('treats the deadline day itself as still due, not overdue', () => {
    expect(deadlineStatus(today, 30, today)).toEqual({ state: 'due', daysLeft: 0 })
  })

  it('reports overdue with a negative count once past', () => {
    expect(deadlineStatus('2026-08-20', 30, today)).toEqual({ state: 'overdue', daysLeft: -10 })
  })

  it('respects a caller-chosen window', () => {
    // Permits use 60 days, probation 30. The same date reads differently.
    expect(deadlineStatus('2026-10-15', 30, today).state).toBe('none')
    expect(deadlineStatus('2026-10-15', 60, today).state).toBe('due')
  })

  it('says nothing when there is no deadline recorded', () => {
    // Absent is unknown, not fine — but it is also not actionable here, and the
    // UI flags the missing date separately.
    expect(deadlineStatus(null, 30, today)).toEqual({ state: 'none', daysLeft: null })
  })
})
