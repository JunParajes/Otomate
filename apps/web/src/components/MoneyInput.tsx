import { NumberInput } from '@mantine/core'
import { CURRENCY_SYMBOL } from '@otomate/shared'

interface Props {
  label: string
  description?: string
  placeholder?: string
  withAsterisk?: boolean
  error?: React.ReactNode
  /** Value in CENTAVOS — the component handles peso display internally. */
  value: number | null
  onChange: (cents: number | null) => void
}

/**
 * The UI works in pesos, the API works in centavos. Converting at this single
 * boundary keeps every other layer honest — nothing downstream ever sees a
 * fractional peso.
 */
export default function MoneyInput({ value, onChange, ...props }: Props) {
  return (
    <NumberInput
      {...props}
      prefix={CURRENCY_SYMBOL}
      decimalScale={2}
      fixedDecimalScale
      min={0}
      max={10_000_000}
      thousandSeparator=","
      value={value === null ? '' : value / 100}
      onChange={next => {
        if (next === '' || next === null) {
          onChange(null)
          return
        }
        const pesos = typeof next === 'number' ? next : Number(next)
        onChange(Number.isFinite(pesos) ? Math.round(pesos * 100) : null)
      }}
    />
  )
}
