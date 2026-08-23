import { useCallback, useEffect, useId } from 'react'
import { useKeypad } from '@/components/keypad/KeypadContext'
import type { ExpressionInput } from './use-expression-input'

interface Options {
  field: ExpressionInput
  label: string
  /** How the previewed number is rendered in the keypad readout. */
  formatPreview: (value: number) => string
}

export interface KeypadField {
  /** 'none' on touch, to keep the on-screen keyboard down; 'text' otherwise. */
  inputMode: 'none' | 'text'
  isActive: boolean
  /** Opens the keypad. Wired to pointer-down, NOT focus — see below. */
  onPointerDown: () => void
  /** Hands the keypad over when focus arrives from another box. */
  onFocus: () => void
  onBlur: (e: { relatedTarget: EventTarget | null }) => void
}

/**
 * Connects a count box to the shared on-screen keypad.
 *
 * Opens on pointer-down rather than focus, and that is the whole point: the
 * encoder tabs through hundreds of boxes typing from paper, and a panel
 * appearing on every Tab would be pure obstruction. Reaching for a mouse or a
 * finger already says "I am pointing at this", so that is the signal used.
 *
 * On touch, inputMode 'none' keeps the system keyboard down — it would cover
 * about half the screen, which on this grid is the rows being counted against.
 * It suppresses only the on-screen keyboard: a tablet with a physical keyboard
 * still types normally, which `readOnly` would have broken.
 */
export function useKeypadField({ field, label, formatPreview }: Options): KeypadField {
  const keypad = useKeypad()
  const id = useId()
  // Resolved once by the provider; see the note there.
  const isTouch = keypad?.isTouch ?? false
  const isActive = keypad?.activeId === id

  const preview = field.preview === null ? null : formatPreview(field.preview)

  const onPointerDown = useCallback(() => {
    keypad?.open({ id, label, text: field.text, preview, press: field.press, finish: field.finish })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keypad, id, label, field.text, preview, field.press, field.finish])

  // Keeps the readout in step as keys are pressed.
  useEffect(() => {
    if (isActive) keypad?.sync(id, { text: field.text, preview })
  }, [isActive, keypad, id, field.text, preview])

  /**
   * Tabbing out of a keypad-driven box left the keypad bound to it, and the box
   * went on showing "4*5+3*4" instead of 32. Whichever box focus lands on hands
   * the keypad over, settling the one being left.
   */
  const onFocus = useCallback(() => {
    if (keypad && keypad.activeId && keypad.activeId !== id) keypad.closeActive()
  }, [keypad, id])

  const onBlur = useCallback(
    (e: { relatedTarget: EventTarget | null }) => {
      if (!isActive) {
        field.onBlur()
        return
      }
      // While the keypad drives this box, losing focus is expected — tapping a
      // key can blur the input — so the draft has to survive. But focus landing
      // on something outside the keypad means the user has moved on.
      const next = e.relatedTarget as HTMLElement | null
      if (next && !next.closest('[data-count-keypad]')) keypad?.closeActive()
    },
    [isActive, field, keypad]
  )

  return {
    inputMode: isTouch ? 'none' : 'text',
    isActive,
    onPointerDown,
    onFocus,
    onBlur,
  }
}
