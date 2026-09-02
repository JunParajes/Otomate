import { describe, expect, it } from 'vitest'
import { cmToFeetInches, feetInchesToCm, formatHeight } from './height.js'

describe('height conversion', () => {
  it('converts feet and inches to centimetres', () => {
    expect(feetInchesToCm(5, 7)).toBe(170)
    expect(feetInchesToCm(5, 0)).toBe(152)
    expect(feetInchesToCm(6, 0)).toBe(183)
  })

  it('converts centimetres back to feet and inches', () => {
    expect(cmToFeetInches(170)).toEqual({ feet: 5, inches: 7 })
    expect(cmToFeetInches(152)).toEqual({ feet: 5, inches: 0 })
  })

  /**
   * The property that makes centimetre storage safe.
   *
   * If any height read back an inch shorter than it was typed, the record would
   * be quietly and permanently wrong — and nobody re-measures staff to catch it.
   * So this asserts the whole human range rather than a couple of examples.
   */
  it('round-trips every height from 4 feet to 7 feet 11 inches', () => {
    const broken: string[] = []
    for (let feet = 4; feet <= 7; feet++) {
      for (let inches = 0; inches < 12; inches++) {
        const back = cmToFeetInches(feetInchesToCm(feet, inches))
        if (back?.feet !== feet || back?.inches !== inches) {
          broken.push(`${feet}'${inches}" -> ${back?.feet}'${back?.inches}"`)
        }
      }
    }
    expect(broken).toEqual([])
  })

  it('carries 12 inches over into the next foot instead of showing 5\'12"', () => {
    // 179.5cm rounds to 70.67 -> 71 inches, which is 5'11" not 5'12".
    expect(cmToFeetInches(180)).toEqual({ feet: 5, inches: 11 })
    expect(cmToFeetInches(183)).toEqual({ feet: 6, inches: 0 })
  })

  it('treats a missing or nonsensical height as not recorded', () => {
    expect(cmToFeetInches(null)).toBeNull()
    expect(cmToFeetInches(undefined)).toBeNull()
    expect(cmToFeetInches(0)).toBeNull()
    expect(cmToFeetInches(-5)).toBeNull()
    expect(cmToFeetInches(Number.NaN)).toBeNull()
  })

  it('formats for display', () => {
    expect(formatHeight(170)).toBe('5\'7"')
    expect(formatHeight(null)).toBe('—')
  })
})
