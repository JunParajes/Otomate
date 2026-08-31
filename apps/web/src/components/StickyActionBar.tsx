import { Group, Paper } from '@mantine/core'
import type { ReactNode } from 'react'
import classes from './StickyActionBar.module.css'

/** Add to the page's root element, or the last field hides behind the bar. */
export const pageWithActionBar = classes.page

interface Props {
  /** Left side: status — "Unsaved changes", "Saved 14:32". */
  status?: ReactNode
  /** Right side: the buttons. */
  children: ReactNode
}

/**
 * A bar pinned to the bottom of the viewport, holding whatever must stay
 * reachable while scrolling.
 *
 * Extracted from the DSIR entry page, which needed it first and for the same
 * reason: on a form long enough to scroll, a Save button at the end is one the
 * encoder cannot see while working, and unsaved work gets lost on a stray tap.
 * Keeping the status alongside it is half the point — a button that is always
 * visible but never says anything still leaves you guessing whether you saved.
 */
export default function StickyActionBar({ status, children }: Props) {
  return (
    <Paper className={classes.bar} withBorder shadow="sm" p="sm" radius={0}>
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>{status}</Group>
        <Group gap="xs" wrap="nowrap">{children}</Group>
      </Group>
    </Paper>
  )
}
