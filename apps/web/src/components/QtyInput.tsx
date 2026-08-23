import { memo, useCallback } from 'react'
import { useExpressionInput } from '@/lib/use-expression-input'
import { useKeypadField } from '@/lib/use-keypad-field'
import classes from './QtyInput.module.css'

interface Props {
  value: number
  onChange: (next: number) => void
  disabled?: boolean
  'aria-label': string
  highlight?: boolean
}

const MAX_QTY = 1_000_000

/** Counts are whole units and never negative, matching the `qty` rule in the shared schema. */
function toCount(parsed: number): number | null {
  const rounded = Math.round(parsed)
  if (!Number.isFinite(rounded) || rounded < 0) return null
  return Math.min(rounded, MAX_QTY)
}

const showCount = (value: number) => (value === 0 ? '' : String(value))

/**
 * A deliberately plain native input, not Mantine's NumberInput.
 *
 * A DSIR is ~50 rows x 5 fields. Rendering 250 fully-styled components makes
 * typing feel laggy, and the encoder does this all day from paper. Selecting the
 * content on focus means tabbing into a cell and typing REPLACES the value
 * rather than appending to it, which is what you want when copying figures.
 *
 * It also accepts arithmetic, because stock is counted in stacks: type
 * "4*5+3*4" for a 4x5 layer under a 3x4 one and it commits 32. See
 * lib/count-expression.ts for why that is not left to a calculator.
 */
function QtyInputImpl({ value, onChange, disabled, highlight, ...rest }: Props) {
  const field = useExpressionInput({
    value,
    onChange,
    format: showCount,
    normalise: toCount,
  })

  const keypad = useKeypadField({
    field,
    label: rest['aria-label'],
    formatPreview: String,
  })

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => field.onChange(e.currentTarget.value),
    [field]
  )

  return (
    <span className={classes.wrap}>
      <input
        {...rest}
        type="text"
        // Not "numeric": that keypad has no operators, and this box now takes
        // them. On touch it becomes "none" so the system keyboard stays down
        // and the app's own keypad is used instead.
        inputMode={keypad.inputMode}
        className={[
          classes.input,
          highlight ? classes.highlight : '',
          field.invalid ? classes.invalid : '',
          keypad.isActive ? classes.keypadActive : '',
        ]
          .filter(Boolean)
          .join(' ')}
        disabled={disabled}
        value={field.text}
        placeholder="0"
        autoComplete="off"
        onFocus={e => { keypad.onFocus(); field.onFocus(e) }}
        onPointerDown={keypad.onPointerDown}
        onBlur={keypad.onBlur}
        onKeyDown={field.onKeyDown}
        onChange={handleChange}
      />
      {/* Only the focused cell can have a draft, so at most one of these exists
          in the whole grid — no per-cell popover, which is exactly the cost this
          component was written to avoid. The cell is ~52px wide, far too narrow
          for "4*5+3*4" — the box scrolls and hides the start of what was
          typed, so the chip repeats the whole sum beside its answer. */}
      {field.preview !== null && !keypad.isActive && (
        <span className={classes.preview}>
          {field.text} = {field.preview}
        </span>
      )}
    </span>
  )
}

export default memo(QtyInputImpl)
