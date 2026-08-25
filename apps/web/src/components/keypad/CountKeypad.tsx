import { ActionIcon, Button, Group, Paper, SimpleGrid, Text } from '@mantine/core'
import { IconBackspace, IconX } from '@tabler/icons-react'
import classes from './CountKeypad.module.css'

interface Props {
  label: string
  text: string
  preview: string | null
  onPress: (key: string) => void
  onDone: () => void
  /** Rendered inside a panel rather than floating over the page. */
  embedded?: boolean
  /** No field is being edited yet — the keys are inert until one is tapped. */
  disabled?: boolean
}

interface Key {
  label: string
  /** What is actually inserted. See the note below. */
  insert: string
  operator?: boolean
  ariaLabel?: string
}

/**
 * One 4-column grid in reading order, so every key is the same width and the
 * pad fills the dock evenly — two grids side by side left the digits squeezed
 * into ~20px, which is no use to a fingertip.
 *
 * Keys are labelled the way they are read and insert the way the parser reads
 * them: × and − are shown because that is what a calculator shows, but "*" and
 * an ASCII "-" are inserted. A typographic minus (U+2212) would be stripped out
 * and quietly change the sum.
 */
const KEYS: Key[] = [
  { label: '7', insert: '7' },
  { label: '8', insert: '8' },
  { label: '9', insert: '9' },
  { label: '⌫', insert: 'back', operator: true, ariaLabel: 'Backspace' },

  { label: '4', insert: '4' },
  { label: '5', insert: '5' },
  { label: '6', insert: '6' },
  { label: '×', insert: '*', operator: true, ariaLabel: 'Multiply' },

  { label: '1', insert: '1' },
  { label: '2', insert: '2' },
  { label: '3', insert: '3' },
  { label: '+', insert: '+', operator: true, ariaLabel: 'Add' },

  { label: '0', insert: '0' },
  { label: '.', insert: '.', ariaLabel: 'Decimal point' },
  { label: 'C', insert: 'clear', ariaLabel: 'Clear' },
  { label: '−', insert: '-', operator: true, ariaLabel: 'Subtract' },
]

/**
 * Docked bottom-right rather than anchored to the cell: it stays in one place
 * the eye can learn, and never covers the row being counted — which an anchored
 * popover does on a grid this tall.
 */
export default function CountKeypad({
  label, text, preview, onPress, onDone, embedded = false, disabled = false,
}: Props) {
  return (
    <Paper
      className={embedded ? classes.embedded : classes.dock}
      data-count-keypad
      withBorder={!embedded}
      shadow={embedded ? undefined : 'lg'}
      radius="md"
      p="sm"
    >
      <Group justify="space-between" wrap="nowrap" mb={6} gap="xs">
        <Text size="xs" c="dimmed" fw={600} lineClamp={1}>{label}</Text>
        {!embedded && (
          <ActionIcon variant="subtle" color="gray" size="sm" onClick={onDone} aria-label="Close keypad">
            <IconX size={14} />
          </ActionIcon>
        )}
      </Group>

      {/* The running sum and its total, so a stack can be checked before it is
          committed — the box itself is far too narrow to show both. */}
      <Paper className={classes.readout} radius="sm" p="xs" mb="xs">
        <Text size="sm" ff="monospace" c="dimmed" lineClamp={1}>{text || '0'}</Text>
        <Text size="xl" fw={700} ff="monospace" c={preview === null ? 'dimmed' : undefined} lineClamp={1}>
          {preview ?? '—'}
        </Text>
      </Paper>

      <SimpleGrid cols={4} spacing={6}>
        {KEYS.map(k => (
          <Button
            key={k.label}
            variant={k.operator ? 'light' : 'default'}
            color={k.operator ? 'crust' : undefined}
            size="md"
            px={0}
            h={46}
            className={classes.key}
            // Never a tab stop: the grid already has hundreds, and the encoder
            // must not have to tab past a keypad to reach the next box.
            tabIndex={-1}
            disabled={disabled}
            aria-label={k.ariaLabel}
            onMouseDown={e => e.preventDefault()}
            onClick={() => onPress(k.insert)}
          >
            {k.label === '⌫' ? <IconBackspace size={18} /> : k.label}
          </Button>
        ))}
      </SimpleGrid>

      <Button fullWidth mt="xs" disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={onDone}>
        Done
      </Button>
    </Paper>
  )
}
