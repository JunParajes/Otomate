/**
 * Evaluates the little arithmetic people use when counting stacked stock.
 *
 * Bread is stacked to make it countable — 4x5 on the bottom layer, 3x4 above
 * it, 2x3 above that — so a count is a sum of products:
 *
 *     4*5 + 3*4 + 2*3  =  20 + 12 + 6  =  38
 *
 * A four-function calculator evaluates strictly left to right and answers 92,
 * because it multiplies the running total by 4 instead of multiplying 3 by 4
 * first. That is the whole reason this exists: normal precedence, so each layer
 * is worked out before anything is added.
 *
 * Hand-written rather than `eval` or `new Function`, and not only for the
 * obvious injection reasons: this decides stock counts, and a wrong count
 * becomes a variance that is deducted from an employee's wages (docs/DOMAIN.md).
 * A parser that can only ever do these four operations is worth more here than
 * a clever one-liner.
 *
 *     expr   := term (('+' | '-') term)*
 *     term   := factor (('*' | 'x' | 'X' | '×' | '/' | '÷') factor)*
 *     factor := number | '(' expr ')' | ('+' | '-') factor
 */

export type ExpressionResult = { ok: true; value: number } | { ok: false }

/**
 * Characters a count box will accept. Anything else is dropped as it is typed.
 *
 * The real multiplication and division signs are included deliberately. Tablet
 * keyboards offer them, and pasted text can carry them — and without them
 * "4×5" would be stripped to "45", a silently wrong count that looks entirely
 * plausible. Far better to understand the character than to quietly mangle it.
 */
const DISALLOWED = /[^0-9+\-*/xX×÷().\s]/g

export function stripDisallowed(input: string): string {
  return input.replace(DISALLOWED, '')
}

/**
 * Whether this looks like a sum rather than a plain number, used to decide if
 * the "= 32" preview is worth showing. A bare "38" needs no explaining.
 */
export function looksLikeExpression(input: string): boolean {
  return /[+\-*/xX×÷()]/.test(input)
}

interface Cursor {
  readonly text: string
  index: number
}

function skipSpace(c: Cursor): void {
  while (c.index < c.text.length && /\s/.test(c.text[c.index]!)) c.index++
}

/** null means "not a valid number here", which unwinds the whole parse. */
function parseNumber(c: Cursor): number | null {
  skipSpace(c)
  const start = c.index
  while (c.index < c.text.length && /[0-9]/.test(c.text[c.index]!)) c.index++
  if (c.text[c.index] === '.') {
    c.index++
    while (c.index < c.text.length && /[0-9]/.test(c.text[c.index]!)) c.index++
  }
  if (c.index === start) return null
  const value = Number(c.text.slice(start, c.index))
  return Number.isFinite(value) ? value : null
}

function parseFactor(c: Cursor): number | null {
  skipSpace(c)
  const char = c.text[c.index]

  if (char === '(') {
    c.index++
    const inner = parseExpr(c)
    if (inner === null) return null
    skipSpace(c)
    if (c.text[c.index] !== ')') return null
    c.index++
    return inner
  }

  // Unary signs, so "-5" and "+5" parse rather than failing outright.
  if (char === '-' || char === '+') {
    c.index++
    const operand = parseFactor(c)
    if (operand === null) return null
    return char === '-' ? -operand : operand
  }

  return parseNumber(c)
}

function parseTerm(c: Cursor): number | null {
  let left = parseFactor(c)
  if (left === null) return null

  for (;;) {
    skipSpace(c)
    const op = c.text[c.index]
    // x, X and × all alias *; ÷ aliases /. "4x5" is how people write it by
    // hand, x is far easier to reach than * on a tablet keyboard, and × and ÷
    // are what those keyboards actually insert.
    const isMultiply = op === '*' || op === 'x' || op === 'X' || op === '×'
    const isDivide = op === '/' || op === '÷'
    if (!isMultiply && !isDivide) return left

    c.index++
    const right = parseFactor(c)
    if (right === null) return null
    if (isDivide) {
      // Division by zero would yield Infinity and quietly poison a count.
      if (right === 0) return null
      left = left / right
    } else {
      left = left * right
    }
  }
}

function parseExpr(c: Cursor): number | null {
  let left = parseTerm(c)
  if (left === null) return null

  for (;;) {
    skipSpace(c)
    const op = c.text[c.index]
    if (op !== '+' && op !== '-') return left

    c.index++
    const right = parseTerm(c)
    if (right === null) return null
    left = op === '+' ? left + right : left - right
  }
}

/**
 * Never throws — this runs on every keystroke, and half-typed input like "4*"
 * is an ordinary state rather than an error. An empty box is 0, matching what
 * clearing a cell has always meant.
 */
export function evaluateExpression(input: string): ExpressionResult {
  const text = input.trim()
  if (text === '') return { ok: true, value: 0 }

  const cursor: Cursor = { text, index: 0 }
  const value = parseExpr(cursor)
  skipSpace(cursor)

  // Trailing junk means the whole thing is unusable: "4*5)" must not quietly
  // evaluate to 20.
  if (value === null || cursor.index !== text.length) return { ok: false }
  if (!Number.isFinite(value)) return { ok: false }

  return { ok: true, value }
}
