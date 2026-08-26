import { Modal, Stack, Text, UnstyledButton, Group } from '@mantine/core'
import type { KeyboardEvent, ReactNode } from 'react'
import classes from './RowActionsSheet.module.css'

/**
 * Makes a table row open its action sheet, from a tap or from the keyboard.
 *
 * The row replaced a real `<button>`, and a bare `onClick` on a `<tr>` cannot be
 * reached by Tab or fired by Enter — so without this, moving the actions onto
 * the row would take them away from anyone not using a pointer.
 *
 * No `role="button"`: that would override the row's own `row` role and cost a
 * screen reader the table structure. Focusable and Enter/Space-activatable is
 * the useful half; the row stays a row.
 *
 * `enabled: false` returns nothing at all — a row with no available actions
 * should not be focusable, nor claim to be pressable with a pointer cursor.
 */
export function rowActionProps(enabled: boolean, open: () => void) {
  if (!enabled) return {}
  return {
    tabIndex: 0,
    className: classes.clickableRow,
    onClick: open,
    onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault() // Space would otherwise scroll the page.
      open()
    },
  }
}

export interface RowAction {
  label: string
  icon: ReactNode
  onClick: () => void
  /** Red, and separated from the rest — deactivating, deleting. */
  destructive?: boolean
  /** Shown greyed with the reason, rather than hidden: absence is confusing. */
  disabled?: boolean
  disabledReason?: string
}

interface Props {
  opened: boolean
  onClose: () => void
  /** Which record this is about — the row is no longer visible once this covers it. */
  title: string
  subtitle?: string
  actions: RowAction[]
}

/**
 * What to do with one row, opened by tapping the row itself.
 *
 * Replaces the three-dot menu in a trailing column. That column was a ~36px
 * target at the far edge of a wide table — on a tablet you aim for it, and on a
 * narrow screen it is the first thing to scroll out of reach. Tapping anywhere
 * on the row is a target the width of the table.
 *
 * It also buys back a column on every list, and settles an inconsistency: three
 * pages used a dropdown, three used bare icons, for the same job.
 *
 * The record is named at the top because the sheet covers the row it came from,
 * and "Deactivate" with nothing else on screen is not a question anyone should
 * be answering.
 */
export default function RowActionsSheet({ opened, onClose, title, subtitle, actions }: Props) {
  const ordinary = actions.filter(a => !a.destructive)
  const destructive = actions.filter(a => a.destructive)

  const render = (action: RowAction) => (
    <UnstyledButton
      key={action.label}
      className={[
        classes.action,
        action.destructive ? classes.destructive : '',
        action.disabled ? classes.disabled : '',
      ]
        .filter(Boolean)
        .join(' ')}
      disabled={action.disabled}
      onClick={() => {
        if (action.disabled) return
        onClose()
        action.onClick()
      }}
    >
      <Group gap="sm" wrap="nowrap">
        {action.icon}
        <Stack gap={0} style={{ minWidth: 0 }}>
          <Text size="sm" fw={600}>{action.label}</Text>
          {action.disabled && action.disabledReason && (
            <Text size="xs" c="dimmed">{action.disabledReason}</Text>
          )}
        </Stack>
      </Group>
    </UnstyledButton>
  )

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Stack gap={0}>
          <Text fw={700}>{title}</Text>
          {subtitle && <Text size="xs" c="dimmed">{subtitle}</Text>}
        </Stack>
      }
      centered
      size="sm"
    >
      <Stack gap={6}>
        {ordinary.map(render)}
        {destructive.length > 0 && ordinary.length > 0 && <div className={classes.separator} />}
        {destructive.map(render)}
      </Stack>
    </Modal>
  )
}
