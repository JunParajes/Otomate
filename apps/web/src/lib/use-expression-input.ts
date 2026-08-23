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
  /**
   * Appends from an on-screen keypad; 'back' and 'clear' are the two commands.
   * Stable across renders — the keypad stores this callback when a box is
   * opened, so a closure over `draft` would freeze at whatever it was then and
   * every key would look like the first one.
   */
  press: (key: string) => void
  /** Ends the edit the way blurring does, for the keypad's Done button. Also stable. */
  finish: () => void
}

/**
 * Lets a numeric box accept "4*5+3*4" and commit 32.
 *
 * The raw text lives here only while the box is being edited; the committed
 * number stays the source of truth otherwise. Each keystroke is evaluated and
 * committed as soon as it parses, which keeps the existing live behaviour — the
 * row's derived *sold* figure moves as you type — and means a half-typed "4*"
 * simply leaves the last good value in place rather than writing nonsense.
 */
export function useExpressionInput({ value, onChange, format, normalise }: Options): ExpressionInput {
  const [draft, setDraft] = useState<string | null>(null)
  // What the box held before this edit started, so an abandoned half-typed sum
  // can be undone. See finish().
  const valueOnFocus = useRef(value)

  // Everything the stable callbacks below need, refreshed each render. They are
  // handed to the keypad once and must not go stale.
  const latest = useRef({ draft, value, format, normalise, onChange })
  latest.current = { draft, value, format, normalise, onChange }

  const applyText = useCallback((next: string) => {
    const cleaned = stripDisallowed(next)
    setDraft(cleaned)

    const result = evaluateExpression(cleaned)
    if (!result.ok) return
    const committed = latest.current.normalise(result.value)
    if (committed === null || committed === latest.current.value) return
    latest.current.onChange(committed)
  }, [])

  /**
   * The first key after opening replaces, matching what typing does — focus
   * selects the contents, so a keystroke overwrites rather than appends. An
   * operator is the exception: pressing × on a box holding 32 extends it to
   * "32*", which is how a calculator behaves.
   */
  const press = useCallback(
    (key: string) => {
      const { draft: current, value: v, format: fmt } = latest.current
      const text = current ?? fmt(v)

      if (key === 'clear') return applyText('')
      if (key === 'back') return applyText(text.slice(0, -1))

      const startFresh = current === null && /[0-9]/.test(key)
      applyText(startFresh ? key : text + key)
    },
    [applyText]
  )

  /**
   * Leaving a box mid-expression must not record the fragment that happened to
   * parse. Typing "4*5+3*4" passes through "4", which commits 4 on the way —
   * tab away at "4*" and the box would keep 4: a wrong count that looks
   * entirely ordinary once the red border goes. An incomplete sum therefore
   * puts back whatever was there before the edit began.
   */
  const finish = useCallback(() => {
    const { draft: current, value: v, normalise: norm, onChange: commit } = latest.current
    if (current !== null && current.trim() !== '') {
      const result = evaluateExpression(current)
      const usable = result.ok ? norm(result.value) : null
      if (usable === null && v !== valueOnFocus.current) commit(valueOnFocus.current)
    }
    setDraft(null)
  }, [])

  const handleFocus = useCallback(
    (e: { currentTarget: { select: () => void } }) => {
      valueOnFocus.current = latest.current.value
      e.currentTarget.select()
    },
    []
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      // Both put the box back to showing its number; the value is already
      // committed, and finish() undoes anything incomplete.
      if (e.key === 'Escape' || e.key === 'Enter') {
        finish()
        e.currentTarget.blur()
      }
    },
    [finish]
  )

  const parsed = draft === null ? null : evaluateExpression(draft)
  const normalised = parsed?.ok ? normalise(parsed.value) : null

  return {
    text: draft ?? format(value),
    // Blank is not "wrong", it is an empty box.
    invalid: draft !== null && draft.trim() !== '' && normalised === null,
    // Only worth showing for something that is actually a sum — "38" explains itself.
    preview: draft !== null && looksLikeExpression(draft) ? normalised : null,
    onChange: applyText,
    onFocus: handleFocus,
    onBlur: finish,
    onKeyDown: handleKeyDown,
    press,
    finish,
  }
}
