import { describe, expect, it } from 'vitest'
import { evaluateExpression, looksLikeExpression, stripDisallowed } from './count-expression'

/**
 * This parser exists because stock is counted in stacks — a pyramid of 4×5 with
 * 3×4 on top is 32, and a four-function calculator gets it wrong by evaluating
 * left to right. Its answer becomes a stock count, and a wrong stock count
 * becomes a shortage deducted from someone's wages, so precedence and refusal
 * both matter more than they look.
 */

const value = (input: string) => {
  const r = evaluateExpression(input)
  return r.ok ? r.value : null
}

describe('evaluateExpression — the case it was written for', () => {
  it('multiplies before adding, unlike a calculator', () => {
    // A four-function calculator gives (4x5+3)x4 = 92.
    expect(value('4*5+3*4')).toBe(32)
  })

  it('handles a three-layer stack', () => {
    expect(value('4*5+3*4+2*3')).toBe(38)
  })

  it('counts cash the same way', () => {
    expect(value('500*2+100*5+20*3')).toBe(1560)
  })
})

describe('evaluateExpression — ordinary input', () => {
  it('accepts a plain number, which is the common case', () => {
    expect(value('20')).toBe(20)
  })

  it('treats an empty box as zero, as clearing a cell always has', () => {
    expect(value('')).toBe(0)
    expect(value('   ')).toBe(0)
  })

  it('ignores spacing', () => {
    expect(value(' 4 * 5  +  3 ')).toBe(23)
  })

  it('does subtraction and parentheses', () => {
    expect(value('20-8')).toBe(12)
    expect(value('2*(3+4)')).toBe(14)
    expect(value('(2+3)*(4+1)')).toBe(25)
  })

  it('divides', () => {
    expect(value('20/4')).toBe(5)
  })

  it('accepts decimals, which cash needs', () => {
    expect(value('500.50*2')).toBe(1001)
  })
})

describe('evaluateExpression — the aliases a tablet produces', () => {
  it.each([
    ['4x5', 20],
    ['4X5', 20],
    ['4×5', 20],
  ])('reads %s as multiplication', (input, expected) => {
    expect(value(input)).toBe(expected)
  })

  it('reads ÷ as division', () => {
    expect(value('20÷4')).toBe(5)
  })

  it('never silently turns 4×5 into 45', () => {
    // Stripping the × instead of understanding it would produce 45: a wrong
    // count that looks entirely plausible on the page.
    expect(value('4×5')).not.toBe(45)
  })
})

describe('evaluateExpression — refusing rather than guessing', () => {
  it('refuses a half-typed sum', () => {
    // Reached on every keystroke while typing "4*5". Committing 4 here would
    // leave a wrong count behind the moment focus moves.
    expect(evaluateExpression('4*').ok).toBe(false)
    expect(evaluateExpression('4+').ok).toBe(false)
  })

  it('refuses division by zero rather than yielding Infinity', () => {
    expect(evaluateExpression('4/0').ok).toBe(false)
    expect(evaluateExpression('4÷0').ok).toBe(false)
  })

  it('refuses trailing junk instead of evaluating the good part', () => {
    // "4*5)" must not quietly become 20.
    expect(evaluateExpression('4*5)').ok).toBe(false)
    expect(evaluateExpression('(4*5').ok).toBe(false)
  })

  it('refuses an operator with nothing before it', () => {
    expect(evaluateExpression('*5').ok).toBe(false)
  })

  it('never throws, whatever is typed', () => {
    for (const input of ['', '(', ')', '()', '**', '4**5', '.', '4..5', '-', '4*(', '1+', '/', 'x']) {
      expect(() => evaluateExpression(input)).not.toThrow()
    }
  })

  it('allows a negative result — the caller decides if that is valid', () => {
    // The parser is arithmetic; refusing negatives is the count box's job, and
    // money fields legitimately allow them.
    expect(value('5-8')).toBe(-3)
  })
})

describe('stripDisallowed', () => {
  it('removes characters that are not arithmetic', () => {
    expect(stripDisallowed('4a*5b')).toBe('4*5')
  })

  it('keeps the operator aliases rather than mangling them', () => {
    expect(stripDisallowed('4×5÷2')).toBe('4×5÷2')
    expect(stripDisallowed('4x5')).toBe('4x5')
  })

  it('keeps parentheses, decimals and spaces', () => {
    expect(stripDisallowed('(4.5 + 2)')).toBe('(4.5 + 2)')
  })
})

describe('looksLikeExpression', () => {
  it('is true for a sum, so the preview is worth showing', () => {
    expect(looksLikeExpression('4*5+3')).toBe(true)
    expect(looksLikeExpression('4×5')).toBe(true)
  })

  it('is false for a plain number, which explains itself', () => {
    expect(looksLikeExpression('38')).toBe(false)
    expect(looksLikeExpression('')).toBe(false)
  })
})
