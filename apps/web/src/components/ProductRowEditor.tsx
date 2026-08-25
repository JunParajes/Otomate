import { useEffect } from 'react'
import {
  ActionIcon, Badge, Divider, Grid, Group, Modal, Paper, Stack, Text, Tooltip,
} from '@mantine/core'
import { IconAlertTriangle, IconChevronLeft, IconChevronRight } from '@tabler/icons-react'
import { formatMoney, type DsirLine } from '@otomate/shared'
import { useKeypad } from './keypad/KeypadContext'
import CountKeypad from './keypad/CountKeypad'
import QtyInput from './QtyInput'
import OpeningBalanceCell from './OpeningBalanceCell'
import classes from './ProductRowEditor.module.css'

interface Totals {
  preTotal: number
  sold: number
  salesCents: number
  impossible: boolean
}

interface Props {
  line: DsirLine | null
  totals: Totals | null
  /** Position in the list as currently sorted, for "12 of 48". */
  index: number
  count: number
  carriedFromDate: string | null
  uses: { charges: boolean; pullOuts: boolean; transfers: boolean; overEnd: boolean }
  transferredIn: number
  transferredOut: number
  charged: number
  canWrite: boolean
  onClose: () => void
  onStep: (delta: number) => void
  onPatch: (field: 'begBal' | 'produced' | 'overEnd' | 'pulledOut' | 'endBal', value: number) => void
  onRecount: () => void
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Group justify="space-between" wrap="nowrap">
      <Text size="sm" c="dimmed">{label}</Text>
      <Tooltip label={hint} disabled={!hint} withArrow>
        <Text size="sm" fw={600} style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</Text>
      </Tooltip>
    </Group>
  )
}

/**
 * One product, given the whole screen.
 *
 * The grid is right for working down a column quickly, but on a tablet a single
 * row is a strip of ~50px boxes. Here the figures get room, the derived sold and
 * sales update as you type, and the keypad sits alongside instead of covering
 * what you are editing.
 *
 * Prev/next matter more than they look: without them a form of 48 products means
 * opening and closing this 48 times, which would be slower than the grid it is
 * meant to improve on.
 */
export default function ProductRowEditor({
  line, totals, index, count, carriedFromDate, uses,
  transferredIn, transferredOut, charged, canWrite,
  onClose, onStep, onPatch, onRecount,
}: Props) {
  const keypad = useKeypad()

  // This panel renders its own keypad, so the floating one must stand down —
  // two keypads, one of them over the top of this modal, would be nonsense.
  useEffect(() => {
    if (!line) return
    keypad?.setDockHidden(true)
    return () => keypad?.setDockHidden(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line !== null])

  if (!line || !totals) return null

  const field = keypad?.field ?? null

  return (
    <Modal
      opened
      onClose={onClose}
      size="92%"
      centered
      withCloseButton={false}
      classNames={{ body: classes.body }}
    >
      <Group justify="space-between" wrap="nowrap" mb="sm">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
          <ActionIcon
            variant="default"
            size="lg"
            aria-label="Previous product"
            disabled={index <= 0}
            onClick={() => onStep(-1)}
          >
            <IconChevronLeft size={18} />
          </ActionIcon>
          <ActionIcon
            variant="default"
            size="lg"
            aria-label="Next product"
            disabled={index >= count - 1}
            onClick={() => onStep(1)}
          >
            <IconChevronRight size={18} />
          </ActionIcon>
          <Stack gap={0} style={{ minWidth: 0 }}>
            <Text fw={700} size="lg" lineClamp={1}>{line.product.name}</Text>
            <Text size="xs" c="dimmed">
              {formatMoney(line.unitPriceCents)} per {line.product.unit.toLowerCase()} · {index + 1} of {count}
            </Text>
          </Stack>
        </Group>
        <ActionIcon variant="subtle" color="gray" size="lg" onClick={onClose} aria-label="Close">
          <Text size="lg">✕</Text>
        </ActionIcon>
      </Group>

      <Grid gap={0} className={classes.split}>
        {/* Figures */}
        <Grid.Col span={{ base: 12, sm: 7 }} className={classes.left}>
          <Stack gap="sm">
            <Group justify="space-between" wrap="nowrap">
              <Stack gap={2} style={{ minWidth: 0 }}>
                <Text size="sm" fw={600}>Beginning balance</Text>
                <Text size="xs" c="dimmed">
                  {line.begBalRecounted
                    ? 'Recounted by the opener'
                    : carriedFromDate
                      ? `Carried from ${carriedFromDate}`
                      : 'No finalised report to carry from'}
                </Text>
              </Stack>
              <OpeningBalanceCell
                productName={line.product.name}
                value={line.begBal}
                recounted={line.begBalRecounted}
                carried={line.carriedBegBal}
                carriedFromDate={carriedFromDate}
                disabled={!canWrite}
                onChange={v => onPatch('begBal', v)}
                onRecount={onRecount}
              />
            </Group>

            <Divider />

            <Group justify="space-between" wrap="nowrap">
              <Text size="sm" fw={600}>Produced</Text>
              <div className={classes.input}>
                <QtyInput
                  aria-label={`${line.product.name} produced`}
                  value={line.produced}
                  disabled={!canWrite}
                  onChange={v => onPatch('produced', v)}
                />
              </div>
            </Group>

            {uses.overEnd && (
              <Group justify="space-between" wrap="nowrap">
                <Text size="sm" fw={600}>Over end</Text>
                <div className={classes.input}>
                  <QtyInput
                    aria-label={`${line.product.name} over end`}
                    value={line.overEnd}
                    disabled={!canWrite}
                    onChange={v => onPatch('overEnd', v)}
                  />
                </div>
              </Group>
            )}

            {uses.pullOuts && (
              <Group justify="space-between" wrap="nowrap">
                <Text size="sm" fw={600}>Pulled out</Text>
                <div className={classes.input}>
                  <QtyInput
                    aria-label={`${line.product.name} pulled out`}
                    value={line.pulledOut}
                    disabled={!canWrite}
                    onChange={v => onPatch('pulledOut', v)}
                  />
                </div>
              </Group>
            )}

            <Group justify="space-between" wrap="nowrap">
              <Text size="sm" fw={600}>Ending balance</Text>
              <div className={classes.input}>
                <QtyInput
                  aria-label={`${line.product.name} ending balance`}
                  value={line.endBal}
                  disabled={!canWrite}
                  onChange={v => onPatch('endBal', v)}
                />
              </div>
            </Group>

            <Divider label="Not typed here" labelPosition="center" />

            {/* Read-only, but shown: they are part of the arithmetic and their
                absence is what makes a line look impossible. */}
            {transferredIn > 0 && <Figure label="Received from another branch" value={String(transferredIn)} />}
            {uses.transfers && <Figure label="Sent to another branch" value={String(transferredOut)} />}
            {uses.charges && (
              <Figure label="Charged to staff" value={String(charged)} hint="Entered in the charges list below the grid" />
            )}

            <Paper withBorder p="sm" radius="md" bg={totals.impossible ? 'var(--mantine-color-red-light)' : undefined}>
              <Stack gap={6}>
                <Figure label="Available" value={String(totals.preTotal)} hint="Opening + produced + received − sent + over end" />
                <Figure label="Sold" value={String(totals.sold)} hint="What is left once everything else is accounted for" />
                <Group justify="space-between" wrap="nowrap">
                  <Text size="sm" fw={700}>Sales</Text>
                  <Text size="lg" fw={700} style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatMoney(totals.salesCents)}
                  </Text>
                </Group>
                {totals.impossible && (
                  <Badge color="red" variant="light" leftSection={<IconAlertTriangle size={12} />}>
                    More stock left than was ever available
                  </Badge>
                )}
              </Stack>
            </Paper>
          </Stack>
        </Grid.Col>

        {/* Keypad */}
        <Grid.Col span={{ base: 12, sm: 5 }} className={classes.right}>
          <CountKeypad
            embedded
            disabled={!field || !canWrite}
            label={field?.label ?? 'Tap a figure to edit it'}
            text={field?.text ?? ''}
            preview={field?.preview ?? null}
            onPress={key => field?.press(key)}
            onDone={() => field?.finish()}
          />
        </Grid.Col>
      </Grid>
    </Modal>
  )
}
