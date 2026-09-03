import { describe, expect, it } from 'vitest'
import {
  ageOn,
  formatLengthOfService,
  lengthOfService,
  probationStatus,
  updateEmployeeHrSchema,
} from './employee.js'

/**
 * Every case here fixes "today" explicitly. A test that reads the clock passes
 * on the day it is written and fails on a birthday, which is precisely the day
 * the code has to be right.
 */
describe('ageOn', () => {
  it('counts whole years', () => {
    expect(ageOn('1990-03-15', '2026-09-02')).toBe(36)
  })

  it('does not count a birthday that has not arrived yet this year', () => {
    expect(ageOn('1990-12-25', '2026-09-02')).toBe(35)
  })

  it('counts the birthday itself', () => {
    expect(ageOn('1990-09-02', '2026-09-02')).toBe(36)
  })

  it('does not count the day before the birthday', () => {
    expect(ageOn('1990-09-03', '2026-09-02')).toBe(35)
  })

  it('handles someone born on 29 February in a non-leap year', () => {
    // No 29 Feb in 2026, so the birthday counts from 1 March.
    expect(ageOn('2000-02-29', '2026-02-28')).toBe(25)
    expect(ageOn('2000-02-29', '2026-03-01')).toBe(26)
  })

  it('is null when there is no birth date, or it is unusable', () => {
    expect(ageOn(null, '2026-09-02')).toBeNull()
    expect(ageOn('', '2026-09-02')).toBeNull()
    expect(ageOn('15/03/1990', '2026-09-02')).toBeNull()
  })

  it('is null rather than negative for a date in the future', () => {
    expect(ageOn('2030-01-01', '2026-09-02')).toBeNull()
  })

  /**
   * The reason the helper works on date parts instead of Date objects: parsed as
   * a Date, this birthday is 8 hours away in Davao and would read a year young.
   */
  it('is not shifted by the local timezone', () => {
    expect(ageOn('2000-09-02', '2026-09-02')).toBe(26)
  })
})

describe('lengthOfService', () => {
  it('counts years and months', () => {
    expect(lengthOfService('2023-04-10', null, '2026-09-02')).toEqual({ years: 3, months: 4 })
  })

  it('does not count a month that is still running', () => {
    // Hired on the 10th; on the 2nd that month is incomplete.
    expect(lengthOfService('2026-02-10', null, '2026-09-02')).toEqual({ years: 0, months: 6 })
    expect(lengthOfService('2026-02-10', null, '2026-09-10')).toEqual({ years: 0, months: 7 })
  })

  it('stops counting at the separation date', () => {
    const left = lengthOfService('2020-01-01', '2022-07-01', '2026-09-02')
    expect(left).toEqual({ years: 2, months: 6 })
  })

  it('is zero on the first day, not negative', () => {
    expect(lengthOfService('2026-09-02', null, '2026-09-02')).toEqual({ years: 0, months: 0 })
  })

  it('is null for a hire date in the future or a missing one', () => {
    expect(lengthOfService('2027-01-01', null, '2026-09-02')).toBeNull()
    expect(lengthOfService(null, null, '2026-09-02')).toBeNull()
  })

  it('formats for display', () => {
    expect(formatLengthOfService({ years: 3, months: 5 })).toBe('3 yrs 5 mos')
    expect(formatLengthOfService({ years: 1, months: 1 })).toBe('1 yr 1 mo')
    expect(formatLengthOfService({ years: 0, months: 7 })).toBe('7 mos')
    expect(formatLengthOfService({ years: 0, months: 0 })).toBe('Less than a month')
    expect(formatLengthOfService(null)).toBe('—')
  })
})

describe('probationStatus with an extension', () => {
  const base = {
    employmentType: 'PROBATIONARY' as const,
    separatedAt: null,
    isActive: true,
  }

  it('warns against the extended date, not the original', () => {
    const status = probationStatus(
      { ...base, probationEndDate: '2026-08-01', probationExtendedTo: '2026-11-01' },
      '2026-09-02'
    )
    // Overdue against the original date; still comfortably ahead of the extension.
    expect(status.state).toBe('none')
    expect(status.daysLeft).toBe(60)
  })

  it('goes overdue once the extension itself passes', () => {
    const status = probationStatus(
      { ...base, probationEndDate: '2026-05-01', probationExtendedTo: '2026-08-01' },
      '2026-09-02'
    )
    expect(status.state).toBe('overdue')
  })

  it('falls back to the original date when there is no extension', () => {
    const status = probationStatus(
      { ...base, probationEndDate: '2026-09-20', probationExtendedTo: null },
      '2026-09-02'
    )
    expect(status.state).toBe('due')
    expect(status.daysLeft).toBe(18)
  })
})

describe('the new 201 fields validate', () => {
  it('accepts a filled-in record', () => {
    const parsed = updateEmployeeHrSchema.parse({
      email: 'baker@example.com',
      gender: 'FEMALE',
      birthPlace: 'Davao City',
      religion: 'Roman Catholic',
      heightCm: 158,
      weightGrams: 62500,
      educationLevel: 'COLLEGE',
      educationDetail: 'BS Hotel and Restaurant Management',
      remarks: 'Transferred from Matina branch.',
      confidentialityAgreementOn: '2026-01-15',
      probationExtendedTo: '2026-11-01',
      probationExtensionReason: 'Extended one month over uniform hygiene.',
    })
    expect(parsed.weightGrams).toBe(62500)
    expect(parsed.gender).toBe('FEMALE')
  })

  it('rejects a malformed email but allows it to be cleared', () => {
    expect(updateEmployeeHrSchema.safeParse({ email: 'not-an-email' }).success).toBe(false)
    expect(updateEmployeeHrSchema.safeParse({ email: '' }).success).toBe(true)
    expect(updateEmployeeHrSchema.safeParse({ email: null }).success).toBe(true)
  })

  it('rejects a height that is really a weight, and vice versa', () => {
    // 1.58 typed into centimetres, or kilos typed into a grams field.
    expect(updateEmployeeHrSchema.safeParse({ heightCm: 1 }).success).toBe(false)
    expect(updateEmployeeHrSchema.safeParse({ heightCm: 158.5 }).success).toBe(false)
    expect(updateEmployeeHrSchema.safeParse({ weightGrams: 62 }).success).toBe(false)
  })
})

/**
 * Being made regular ends probation.
 *
 * The employment type is typed by hand and lags behind: someone regularised on
 * the day but still marked PROBATIONARY was warned about a deadline they had
 * already met. A warning that is wrong teaches people to dismiss the ones that
 * are not.
 */
describe('probation after regularisation', () => {
  const base = {
    employmentType: 'PROBATIONARY' as const,
    separatedAt: null,
    isActive: true,
  }

  it('stops warning once they are regularised, even if still typed probationary', () => {
    const overdue = { ...base, probationEndDate: '2026-05-01', probationExtendedTo: null }
    // Without a regularisation date this is overdue...
    expect(probationStatus(overdue, '2026-09-04').state).toBe('overdue')
    // ...and with one there is nothing left to miss.
    expect(probationStatus({ ...overdue, regularizedAt: '2026-05-01' }, '2026-09-04').state).toBe('none')
  })

  it('stops warning about an extension once they are regularised', () => {
    const extended = {
      ...base,
      probationEndDate: '2026-05-01',
      probationExtendedTo: '2026-09-10',
      regularizedAt: '2026-08-20',
    }
    expect(probationStatus(extended, '2026-09-04').state).toBe('none')
  })

  it('still warns while they have not been regularised', () => {
    const due = {
      ...base, probationEndDate: '2026-09-20', probationExtendedTo: null, regularizedAt: null,
    }
    expect(probationStatus(due, '2026-09-04').state).toBe('due')
  })
})
