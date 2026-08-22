import { memo } from 'react'
import classes from './QtyInput.module.css'

interface Props {
  value: number
  onChange: (next: number) => void
  disabled?: boolean
  'aria-label': string
  highlight?: boolean
}

/**
 * A deliberately plain native input, not Mantine's NumberInput.
 *
 * A DSIR is ~50 rows x 5 fields. Rendering 250 fully-styled components makes
 * typing feel laggy, and the encoder does this all day from paper. Selecting the
 * content on focus means tabbing into a cell and typing REPLACES the value
 * rather than appending to it, which is what you want when copying figures.
 */
function QtyInputImpl({ value, onChange, disabled, highlight, ...rest }: Props) {
  return (
    <input
      {...rest}
      type="text"
      inputMode="numeric"
      className={`${classes.input} ${highlight ? classes.highlight : ''}`}
      disabled={disabled}
      value={value === 0 ? '' : String(value)}
      placeholder="0"
      onFocus={e => e.currentTarget.select()}
      onChange={e => {
        const digits = e.currentTarget.value.replace(/[^\d]/g, '')
        onChange(digits === '' ? 0 : Math.min(Number(digits), 1_000_000))
      }}
    />
  )
}

export default memo(QtyInputImpl)
