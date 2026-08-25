import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMediaQuery } from '@mantine/hooks'
import CountKeypad from './CountKeypad'

export interface KeypadField {
  id: string
  /** Named in the keypad header, so it is obvious which box is being edited. */
  label: string
  text: string
  preview: string | null
  press: (key: string) => void
  finish: () => void
}

interface KeypadApi {
  /** The field being driven, so a panel can render its own keypad for it. */
  field: KeypadField | null
  /**
   * Set while something else owns the keypad — the product editor renders one
   * inside itself, and a second floating copy over the top would be absurd.
   */
  dockHidden: boolean
  setDockHidden: (hidden: boolean) => void
  /**
   * Whether this is a touch device. Resolved once here rather than in each
   * count box — a DSIR is ~275 boxes, and that many matchMedia listeners is
   * measurable in typing latency for a value that is identical in all of them.
   */
  isTouch: boolean
  activeId: string | null
  open: (field: KeypadField) => void
  /** Pushes the latest text/preview up as the field is edited. */
  sync: (id: string, patch: Pick<KeypadField, 'text' | 'preview'>) => void
  /**
   * Ends the current field the way Done does, then closes. Used when focus
   * leaves for another box — otherwise the keypad stays bound to the box you
   * left, and that box goes on showing the raw sum instead of its total.
   */
  closeActive: () => void
  close: () => void
}

const KeypadContext = createContext<KeypadApi | null>(null)

/**
 * A single on-screen keypad shared by every count box on the page.
 *
 * The active field is held here rather than in the input, deliberately: on a
 * touchscreen, tapping a key can blur the field that key is meant to be typing
 * into. Keeping the target in context means the keypad keeps working whether or
 * not the input still holds focus, instead of depending on preventDefault
 * tricks that behave differently across touch and mouse.
 *
 * Optional by design — `useKeypad()` returns null outside a provider, so the
 * count boxes still work anywhere else in the app.
 */
export function KeypadProvider({ children }: { children: ReactNode }) {
  const isTouch = useMediaQuery('(pointer: coarse)') ?? false
  const [field, setField] = useState<KeypadField | null>(null)
  const [dockHidden, setDockHidden] = useState(false)
  // Read by the callbacks below. finish() is a side effect, so it must not run
  // inside a state updater — StrictMode calls those twice.
  const fieldRef = useRef<KeypadField | null>(null)
  fieldRef.current = field

  const open = useCallback((next: KeypadField) => {
    // Moving straight from one box to another must settle the first.
    const previous = fieldRef.current
    if (previous && previous.id !== next.id) previous.finish()
    setField(next)
  }, [])

  const close = useCallback(() => setField(null), [])

  const closeActive = useCallback(() => {
    fieldRef.current?.finish()
    setField(null)
  }, [])

  const sync = useCallback((id: string, patch: Pick<KeypadField, 'text' | 'preview'>) => {
    setField(current => (current && current.id === id ? { ...current, ...patch } : current))
  }, [])

  const api = useMemo<KeypadApi>(
    () => ({ isTouch, field, dockHidden, setDockHidden, activeId: field?.id ?? null, open, sync, closeActive, close }),
    [isTouch, field, dockHidden, open, sync, closeActive, close]
  )

  return (
    <KeypadContext.Provider value={api}>
      {children}
      {field && !dockHidden && (
        <CountKeypad
          label={field.label}
          text={field.text}
          preview={field.preview}
          onPress={field.press}
          onDone={() => {
            field.finish()
            close()
          }}
        />
      )}
    </KeypadContext.Provider>
  )
}

export function useKeypad(): KeypadApi | null {
  return useContext(KeypadContext)
}
