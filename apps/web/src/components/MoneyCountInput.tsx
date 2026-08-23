import { useCallback } from 'react'
import { CURRENCY_SYMBOL, formatMoney } from '@otomate/shared'
import { useExpressionInput } from '@/lib/use-expression-input'
import classes from './MoneyCountInput.module.css'

interface Props {
  /** Centavos, as everything server-side deals in. */
  value: number
  onChange: (cents: number) => void
  disabled?: boolean
  'aria-label'?: string
  placeholder?: string
}

const MAX_PESOS = 10_000_000

function toPesos(parsed: number): number | null {
  if (!Number.isFinite(parsed) || parsed < 0) return null
  // Round at the centavo, so 33.333 cannot drift into a fraction of a centavo.
  const cents = Math.round(parsed * 100)
  return Math.min(cents, MAX_PESOS * 100) / 100
}

// Grouped when idle, because ₱1560.00 is harder to read back than ₱1,560.00.
// Any separator the user leaves in is stripped before parsing, so editing the
// grouped text still works.
const showPesos = (pesos: number) =>
  pesos === 0 ? '' : pesos.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * The cash a cashier turned in — which is counted by denomination, so it is the
 * same sum-of-products problem as a stack of bread:
 *
 *     500*2 + 100*5 + 20*3  =  ₱1,560
 *
 * Mantine's NumberInput cannot be talked into accepting "*", hence a plain input
 * here. The UI works in pesos and the API in centavos; converting at this single
 * boundary is the same rule MoneyInput.tsx documents.
 */
export default function MoneyCountInput({ value, onChange, disabled, placeholder, ...rest }: Props) {
  const handleCommit = useCallback((pesos: number) => onChange(Math.round(pesos * 100)), [onChange])

  const field = useExpressionInput({
    value: value / 100,
    onChange: handleCommit,
    format: showPesos,
    normalise: toPesos,
  })

  return (
    <span className={classes.wrap}>
      <span className={classes.prefix} aria-hidden>{CURRENCY_SYMBOL}</span>
      <input
        {...rest}
        type="text"
        inputMode="text"
        className={`${classes.input} ${field.invalid ? classes.invalid : ''}`}
        disabled={disabled}
        value={field.text}
        placeholder={placeholder ?? '0.00'}
        autoComplete="off"
        onFocus={field.onFocus}
        onBlur={field.onBlur}
        onKeyDown={field.onKeyDown}
        onChange={e => field.onChange(e.currentTarget.value)}
      />
      {field.preview !== null && (
        <span className={classes.preview}>
          {field.text} = {formatMoney(Math.round(field.preview * 100))}
        </span>
      )}
    </span>
  )
}
