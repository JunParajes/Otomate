import { useCallback, useRef, useState, type KeyboardEvent } from 'react'
import { evaluateExpression, looksLikeExpression, stripDisallowed } from './count-expression'

interface Options {
  /** The committed value, in whatever unit the box displays (units, pesos…). */
  value: number
  onChange: (next: number) => void
  /** How a committed value is rendered when the box is not being edited. */
  format: (value: number) => string
  /**
   * Turns a parsed result into something committable, or null to refuse it —
   * counts round to whole units and reject negatives, money keeps centavos.
   */
  normalise: (parsed: number) => number | null
}

export interface ExpressionInput {
  text: string
  invalid: boolean
  /** The value that would be committed, shown as "= 32". Null when there is nothing worth previewing. */
  preview: number | null
  onChange: (raw: string) => void
  onFocus: (e: { currentTarget: { select: () => void } }) => void
  onBlur: () => void
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void
}

/**
 * Lets a numeric box accept "4*5+3*4" and commit 32.
 *
 * The raw text lives here only while the box is being edited; the committed
 * number stays the source of truth otherwise. Each keystroke is evaluated and
 * committed as soon as it parses, which keeps the existing live behaviour — the
 * row's derived *sold* figure moves as you type — and means a half-typed "4*"
 * simply leaves the last good value in place rather than writing nonsense.
 *
 * Nothing invalid is ever committed, and no box is ever left displaying text
 * that is not a real value: blur discards the draft and shows the number again.
 */
export function useExpressionInput({ value, onChange, format, normalise }: Options): ExpressionInput {
  const [draft, setDraft] = useState<string | null>(null)
  // What the box held before this edit started, so an abandoned half-typed sum
  // can be undone. See handleBlur.
  const valueOnFocus = useRef(value)

  const handleChange = useCallback(
    (raw: string) => {
      const cleaned = stripDisallowed(raw)
      setDraft(cleaned)

      const result = evaluateExpression(cleaned)
      if (!result.ok) return
      const next = normalise(result.value)
      if (next === null || next === value) return
      onChange(next)
    },
    [normalise, onChange, value]
  )

  /**
   * Leaving a box mid-expression must not record the fragment that happened to
   * parse. Typing "4*5+3*4" passes through "4", which commits 4 on the way —
   * tab away at "4*" and the cell would keep 4: a wrong count that looks
   * entirely ordinary once the red border goes. An incomplete sum therefore
   * puts back whatever was there before the edit began.
   */
  const handleBlur = useCallback(() => {
    if (draft !== null && draft.trim() !== '') {
      const result = evaluateExpression(draft)
      const usable = result.ok ? normalise(result.value) : null
      if (usable === null && value !== valueOnFocus.current) onChange(valueOnFocus.current)
    }
    setDraft(null)
  }, [draft, normalise, onChange, value])

  const handleFocus = useCallback(
    (e: { currentTarget: { select: () => void } }) => {
      valueOnFocus.current = value
      e.currentTarget.select()
    },
    [value]
  )

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      // Blur restores the pre-edit value for anything incomplete.
      setDraft(null)
      e.currentTarget.blur()
    } else if (e.key === 'Enter') {
      // The value is already committed; this just puts the box back to showing
      // the number rather than the sum that produced it.
      setDraft(null)
      e.currentTarget.blur()
    }
  }, [])

  const parsed = draft === null ? null : evaluateExpression(draft)
  const normalised = parsed?.ok ? normalise(parsed.value) : null

  return {
    text: draft ?? format(value),
    // Blank is not "wrong", it is an empty box.
    invalid: draft !== null && draft.trim() !== '' && normalised === null,
    // Only worth showing for something that is actually a sum — "38" explains itself.
    preview: draft !== null && looksLikeExpression(draft) ? normalised : null,
    onChange: handleChange,
    onFocus: handleFocus,
    onBlur: handleBlur,
    onKeyDown: handleKeyDown,
  }
}
