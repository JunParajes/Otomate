import { ActionIcon, Text, Tooltip } from '@mantine/core'
import { IconLock, IconPencil } from '@tabler/icons-react'
import QtyInput from './QtyInput'
import classes from './OpeningBalanceCell.module.css'

interface Props {
  productName: string
  value: number
  recounted: boolean
  /** What the previous finalised report closed at. Null when there is no history. */
  carried: number | null
  carriedFromDate: string | null
  disabled?: boolean
  onChange: (next: number, enteredAs: string | null) => void
  onRecount: () => void
}

/**
 * The opening balance: carried from the previous finalised report and locked,
 * until the opener's own recount is declared.
 *
 * Locked because an opening that can be quietly adjusted is the easiest way to
 * make a day balance — and this figure is the start of the arithmetic that
 * decides whether a cashier is short.
 *
 * Unlockable because the opener genuinely does recount the shelf, and their
 * count disagreeing with last night's close is real signal: overnight loss, or
 * a miscount by one of two named people (docs/DOMAIN.md). Forcing that
 * correction into the previous report instead would erase the closer's count
 * and hide the loss entirely, so the recount is recorded here and the gap is
 * shown rather than resolved away.
 */
export default function OpeningBalanceCell({
  productName,
  value,
  recounted,
  carried,
  carriedFromDate,
  disabled,
  onChange,
  onRecount,
}: Props) {
  if (recounted) {
    const differs = carried !== null && value !== carried
    return (
      <div className={classes.wrap}>
        <QtyInput
          aria-label={`${productName} beginning balance`}
          value={value}
          disabled={disabled}
          onChange={onChange}
          highlight={differs}
        />
        {differs && (
          <Tooltip
            label={`Opener counted ${value}; ${carriedFromDate ?? 'the previous report'} closed at ${carried}`}
            withArrow
          >
            <Text component="span" size="10px" c="orange" fw={700} className={classes.note}>
              was {carried}
            </Text>
          </Tooltip>
        )}
      </div>
    )
  }

  const label =
    carriedFromDate === null
      ? 'No finalised report to carry from — declare a count to enter one'
      : `Carried from ${carriedFromDate}. Change it only if the opener recounted the shelf.`

  return (
    <div className={classes.wrap}>
      <Tooltip label={label} withArrow multiline w={240}>
        <span className={classes.locked}>{value}</span>
      </Tooltip>
      {!disabled && (
        <Tooltip label="Opener recounted this" withArrow>
          <ActionIcon
            variant="subtle"
            color="gray"
            size="xs"
            className={classes.unlock}
            aria-label={`Recount ${productName} beginning balance`}
            onClick={onRecount}
          >
            <IconPencil size={12} />
          </ActionIcon>
        </Tooltip>
      )}
      {disabled && <IconLock size={11} className={classes.lockIcon} />}
    </div>
  )
}
