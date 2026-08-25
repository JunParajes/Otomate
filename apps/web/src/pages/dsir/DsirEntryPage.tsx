import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ActionIcon, Alert, Badge, Button, Card, Center, Checkbox, Divider, Group, Loader,
  NumberInput, Paper, Select, Stack, Table, Text, Textarea, TextInput, Title, Tooltip,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { modals } from '@mantine/modals'
import {
  IconAlertTriangle, IconArrowLeft, IconArrowsSort, IconCheck, IconLock, IconLockOpen,
  IconPlus, IconTrash, IconChevronRight,
} from '@tabler/icons-react'
import {
  computeLineTotals, formatMoney, isImpossibleLine,
  type DsirReport, type SaveDsirInput,
} from '@otomate/shared'
import { dsirApi } from '@/lib/dsir'
import { catalogApi } from '@/lib/catalog'
import { employeeApi } from '@/lib/employees'
import { adminApi } from '@/lib/admin'
import { useResource } from '@/hooks/useResource'
import { useSession } from '@/lib/session'
import DataState from '@/components/DataState'
import QtyInput from '@/components/QtyInput'
import OpeningBalanceCell from '@/components/OpeningBalanceCell'
import AddProductsModal from '@/components/AddProductsModal'
import ColumnMenu, { type QtyColumn } from '@/components/ColumnMenu'
import ProductRowEditor from '@/components/ProductRowEditor'
import MoneyCountInput from '@/components/MoneyCountInput'
import { KeypadProvider } from '@/components/keypad/KeypadContext'
import classes from './DsirEntryPage.module.css'

type Line = DsirReport['lines'][number]
type Charge = { productId: string; employeeId: string; quantity: number }
type Transfer = { productId: string; toBranchId: string; quantity: number }
type Collection = { employeeId: string | null; label: string | null; amountCents: number }

/** Long enough not to save mid-word, short enough that little is ever at risk. */
const AUTOSAVE_DELAY_MS = 2000

type SortMode = 'entry' | 'name' | 'category'

const COUNT_FIELDS = ['begBal', 'produced', 'overEnd', 'pulledOut', 'endBal'] as const
type CountField = (typeof COUNT_FIELDS)[number]
const isCountField = (f: string): f is CountField => (COUNT_FIELDS as readonly string[]).includes(f)

const SORT_OPTIONS = [
  { value: 'entry', label: 'As entered' },
  { value: 'category', label: 'By category' },
  { value: 'name', label: 'A – Z' },
]

export default function DsirEntryPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { can } = useSession()

  const [report, setReport] = useState<DsirReport | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [charges, setCharges] = useState<Charge[]>([])
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [collections, setCollections] = useState<Collection[]>([])
  const [uses, setUses] = useState({ charges: false, pullOuts: false, transfers: false, overEnd: false })
  const [openedById, setOpenedById] = useState<string | null>(null)
  const [closedById, setClosedById] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [dirty, setDirty] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [sortBy, setSortBy] = useState<SortMode>('entry')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  /** Product being edited in the full-screen editor, by id. */
  const [editingProductId, setEditingProductId] = useState<string | null>(null)
  /**
   * Bumped by every edit. A save compares this against the value it started
   * with: if they differ the user has typed during the round trip, and applying
   * the server's response would wipe what they just entered.
   */
  const editSeq = useRef(0)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const products = useResource(catalogApi.listProducts)
  const employees = useResource(employeeApi.list)
  const branches = useResource(adminApi.listBranches)

  /** Single funnel for "the user changed something". */
  const markEdited = useCallback(() => {
    editSeq.current += 1
    setDirty(true)
  }, [])

  const hydrate = useCallback((r: DsirReport) => {
    setReport(r)
    setLines(r.lines)
    setCharges(r.charges.map(c => ({ productId: c.productId, employeeId: c.employeeId, quantity: c.quantity })))
    setTransfers(r.transfers.map(t => ({ productId: t.productId, toBranchId: t.toBranchId, quantity: t.quantity })))
    setCollections(r.collections.map(c => ({ employeeId: c.employeeId, label: c.label, amountCents: c.amountCents })))
    setUses({ charges: r.usesCharges, pullOuts: r.usesPullOuts, transfers: r.usesTransfers, overEnd: r.usesOverEnd })
    setOpenedById(r.openedBy?.id ?? null)
    setClosedById(r.closedBy?.id ?? null)
    setNotes(r.notes ?? '')
    setDirty(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    dsirApi.get(id)
      .then(r => { if (!cancelled) { hydrate(r); setError(null) } })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the report') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id, hydrate])

  // Warn before losing a half-typed form — this is 50+ rows of manual entry.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const locked = report?.status === 'FINALIZED'
  const canWrite = can('dsir:write') && !locked
  const employeeOptions = (employees.data ?? []).filter(e => e.isActive).map(e => ({ value: e.id, label: e.name }))

  /** Price and unit are shown because the catalogue has duplicate names at
   *  different price points — 'cheese dog' at ₱5 and at ₱50. */
  /**
   * A view over the rows, not a reordering of them. `lines` stays in the
   * encoder's order, so switching to A–Z to find something and switching back
   * cannot quietly rewrite what gets saved.
   */
  const visibleLines = useMemo(() => {
    if (sortBy === 'entry') return lines
    const copy = [...lines]
    if (sortBy === 'name') {
      copy.sort((a, b) => a.product.name.localeCompare(b.product.name))
    } else {
      copy.sort(
        (a, b) =>
          a.product.category.name.localeCompare(b.product.category.name) ||
          a.product.name.localeCompare(b.product.name)
      )
    }
    return copy
  }, [lines, sortBy])

  const chargedBy = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of charges) m.set(c.productId, (m.get(c.productId) ?? 0) + c.quantity)
    return m
  }, [charges])

  /** Sent to us by other branches today. Read-only: it is their record. */
  const receivedBy = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of report?.inboundTransfers ?? []) m.set(t.productId, (m.get(t.productId) ?? 0) + t.quantity)
    return m
  }, [report])

  const transferredBy = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of transfers) m.set(t.productId, (m.get(t.productId) ?? 0) + t.quantity)
    return m
  }, [transfers])

  /** Same shared formula the server uses, so the screen can never disagree with it. */
  // Built from the sorted view so the grid renders in the chosen order; the
  // totals below are sums, which sorting cannot change.
  const computed = useMemo(
    () => visibleLines.map(l => {
      const totals = computeLineTotals(
        {
          begBal: l.begBal, produced: l.produced,
          transferredIn: receivedBy.get(l.productId) ?? 0,
          transferredOut: transferredBy.get(l.productId) ?? 0,
          overEnd: l.overEnd,
          charged: chargedBy.get(l.productId) ?? 0,
          pulledOut: l.pulledOut, endBal: l.endBal,
        },
        l.unitPriceCents
      )
      return { line: l, totals, impossible: isImpossibleLine(totals) }
    }),
    [visibleLines, chargedBy, transferredBy, receivedBy]
  )

  const salesCents = computed.reduce((s, c) => s + c.totals.salesCents, 0)
  // The spreadsheet's "Total Prod. Sale", plus the two figures it computed per
  // row but never totalled: what was thrown away, and what staff owe for.
  const producedValueCents = computed.reduce((s, c) => s + c.line.produced * c.line.unitPriceCents, 0)
  const receivedValueCents = computed.reduce((s, c) => s + (receivedBy.get(c.line.productId) ?? 0) * c.line.unitPriceCents, 0)
  const pulledOutCents = computed.reduce((s, c) => s + c.line.pulledOut * c.line.unitPriceCents, 0)
  const overEndCents = computed.reduce((s, c) => s + c.line.overEnd * c.line.unitPriceCents, 0)
  const overEndUnits = computed.reduce((s, c) => s + c.line.overEnd, 0)
  const chargedValueCents = charges.reduce((s, c) => {
    const line = lines.find(l => l.productId === c.productId)
    return s + c.quantity * (line?.unitPriceCents ?? 0)
  }, 0)
  const collectionsCents = collections.reduce((s, c) => s + c.amountCents, 0)
  const varianceCents = collectionsCents - salesCents
  const impossibleCount = computed.filter(c => c.impossible).length
  const hasInbound = (report?.inboundTransfers.length ?? 0) > 0

  /**
   * Openings the opener recounted differently from the previous close. Overnight
   * loss or a miscount by one of two named people — docs/DOMAIN.md calls this
   * real signal, and it is only signal if somebody sees it.
   */
  const recountGaps = lines.filter(
    l => l.begBalRecounted && l.carriedBegBal !== null && l.begBal !== l.carriedBegBal
  )

  /**
   * `enteredAs` is the sum behind the figure, or null when it was typed plainly.
   * Storing null must actually remove the old entry: a stale "4*5+3*4" sitting
   * beside a figure someone has since retyped would explain a number that no
   * longer came from it, which is worse than showing nothing.
   */
  function patchLine(productId: string, field: keyof Line, value: number, enteredAs?: string | null) {
    setLines(prev =>
      prev.map(l => {
        if (l.productId !== productId) return l
        const next = { ...l, [field]: value }
        if (enteredAs !== undefined && isCountField(field)) {
          const entries = { ...(l.enteredAs ?? {}) }
          if (enteredAs) entries[field] = enteredAs
          else delete entries[field]
          next.enteredAs = Object.keys(entries).length > 0 ? entries : null
        }
        return next
      })
    )
    markEdited()
  }

  /** Declares that the opener counted this shelf themselves, unlocking the box. */
  /**
   * Which quantity columns are on the form right now. Beginning balance is
   * absent on purpose: it is carried from the previous finalised report and
   * locked, so a bulk action must not be able to overwrite it wholesale — that
   * is exactly the tampering the lock exists to prevent.
   */
  const bulkColumns = useMemo(() => {
    const cols: { column: QtyColumn; label: string }[] = [{ column: 'produced', label: "Prod'd" }]
    if (uses.overEnd) cols.push({ column: 'overEnd', label: 'Over end' })
    if (uses.pullOuts) cols.push({ column: 'pulledOut', label: 'Pulled' })
    cols.push({ column: 'endBal', label: 'End' })
    return cols
  }, [uses.overEnd, uses.pullOuts])

  function toggleSelected(productId: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(productId)) next.delete(productId)
      else next.add(productId)
      return next
    })
  }

  function removeSelected() {
    setLines(prev => prev.filter(l => !selected.has(l.productId)))
    setSelected(new Set())
    markEdited()
  }

  /** Drops the sum recorded for a field, used when a bulk action replaces it. */
  function withoutEntry(line: Line, field: CountField): Line['enteredAs'] {
    if (!line.enteredAs) return null
    const rest = { ...line.enteredAs }
    delete rest[field]
    return Object.keys(rest).length > 0 ? rest : null
  }

  function clearColumn(column: QtyColumn) {
    setLines(prev => prev.map(l => ({ ...l, [column]: 0, enteredAs: withoutEntry(l, column) })))
    markEdited()
  }

  function copyColumn(from: QtyColumn, to: QtyColumn) {
    // The copied figure was not counted here, so it carries no explanation.
    setLines(prev => prev.map(l => ({ ...l, [to]: l[from], enteredAs: withoutEntry(l, to) })))
    markEdited()
  }

  function recountOpening(productId: string) {
    setLines(prev => prev.map(l => (l.productId === productId ? { ...l, begBalRecounted: true } : l)))
    markEdited()
  }

  function addProducts(productIds: string[]) {
    const chosen = (products.data ?? []).filter(p => productIds.includes(p.id))
    if (chosen.length === 0) return
    setLines(prev => [...prev, ...chosen.map(p => ({
      productId: p.id,
      product: { id: p.id, name: p.name, sku: p.sku, unit: p.unit, category: p.category },
      unitPriceCents: p.priceCents,
      // Starts locked like any other line. If this product was on the previous
      // finalised report the server supplies its closing figure on save; if it
      // genuinely needs an opening typed, that is a recount.
      begBalRecounted: false,
      carriedBegBal: null,
      enteredAs: null,
      begBal: 0, produced: 0, overEnd: 0, pulledOut: 0, endBal: 0,
      transferredIn: 0, transferredOut: 0, charged: 0, preTotal: 0, sold: 0, salesCents: 0,
    }))])
    markEdited()
  }

  async function save(then?: 'finalize', options?: { silent?: boolean }) {
    const startedAt = editSeq.current
    setSaving(true)
    try {
      const payload: SaveDsirInput = {
        usesCharges: uses.charges, usesPullOuts: uses.pullOuts,
        usesTransfers: uses.transfers, usesOverEnd: uses.overEnd,
        openedById, closedById, notes: notes.trim() || null,
        lines: lines.map(l => ({
          productId: l.productId, begBal: l.begBal, begBalRecounted: l.begBalRecounted,
          enteredAs: l.enteredAs, produced: l.produced,
          overEnd: l.overEnd, pulledOut: l.pulledOut, endBal: l.endBal,
        })),
        charges: uses.charges ? charges : [],
        transfers: uses.transfers ? transfers : [],
        collections,
      }
      let saved = await dsirApi.save(id, payload)
      if (then === 'finalize') saved = await dsirApi.finalize(id)

      // Only take the server's version if nothing was typed while it was in
      // flight. Otherwise keep what is on screen — the next autosave reconciles
      // it — because hydrating here would silently undo those keystrokes.
      if (editSeq.current === startedAt) {
        hydrate(saved)
      } else {
        setReport(saved)
      }
      setSavedAt(new Date())

      // Autosave stays quiet: a toast every few seconds is noise. The status
      // beside the buttons says what happened. Failures always speak up.
      if (!options?.silent) {
        notifications.show({ color: 'green', title: 'Saved', message: then === 'finalize' ? 'Report finalised' : 'Changes saved' })
      }
    } catch (e) {
      notifications.show({ color: 'red', title: 'Could not save', message: e instanceof Error ? e.message : 'Something went wrong' })
    } finally {
      setSaving(false)
    }
  }

  /**
   * Autosaves a draft a couple of seconds after typing stops.
   *
   * The encoder works down ~50 rows on a tablet, and the report is long enough
   * that Save was off-screen for most of it. Worse, tapping a sidebar link ends
   * the page without warning: the beforeunload guard only covers closing or
   * reloading the tab, and intercepting in-app navigation would mean rewriting
   * how routing works. Saving continuously removes the problem instead of
   * warning about it.
   *
   * Finalising stays deliberate — this only ever saves a draft.
   */
  useEffect(() => {
    if (!dirty || locked || !canWrite || saving) return
    const timer = setTimeout(() => { void save(undefined, { silent: true }) }, AUTOSAVE_DELAY_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, locked, canWrite, saving, lines, charges, transfers, collections, uses, openedById, closedById, notes])

  function confirmFinalize() {
    modals.openConfirmModal({
      title: 'Finalise this report?',
      children: (
        <Stack gap="xs">
          <Text size="sm">It will be locked from further edits. You can reopen it if you need to.</Text>
          {/* Worth saying at the moment it stops being editable. */}
          {recountGaps.length > 0 && (
            <Alert color="orange" icon={<IconAlertTriangle size={16} />}>
              {recountGaps.length} opening{recountGaps.length === 1 ? '' : 's'} were recounted differently
              from what the previous report left.
            </Alert>
          )}
          {impossibleCount > 0 && (
            <Alert color="red" icon={<IconAlertTriangle size={16} />}>
              {impossibleCount} line{impossibleCount === 1 ? '' : 's'} show more stock leaving than was
              ever available. That is always a miscount or a missing entry — worth checking first.
            </Alert>
          )}
        </Stack>
      ),
      labels: { confirm: 'Finalise', cancel: 'Cancel' },
      confirmProps: { color: 'green' },
      onConfirm: () => void save('finalize'),
    })
  }

  if (loading) return <Center py="xl"><Loader /></Center>
  if (error || !report) return <Alert color="red" title="Could not load">{error}</Alert>

  return (
    <KeypadProvider>
      <Stack gap="md" className={classes.page}>
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <Group gap="sm">
          <ActionIcon variant="subtle" color="gray" onClick={() => navigate('/dsir')} aria-label="Back">
            <IconArrowLeft size={18} />
          </ActionIcon>
          <Stack gap={2}>
            <Group gap="xs">
              <Title order={2} size="h4">{report.branch.name}</Title>
              <Badge variant="light" color={locked ? 'green' : 'yellow'}>{locked ? 'Finalised' : 'Draft'}</Badge>
              {dirty && <Badge variant="light" color="orange">Unsaved</Badge>}
            </Group>
            <Text size="sm" c="dimmed" ff="monospace">{report.reportDate}</Text>
          </Stack>
        </Group>
        {locked && can('dsir:finalize') && (
          <Button variant="default" leftSection={<IconLockOpen size={16} />} onClick={() => void dsirApi.reopen(id).then(hydrate)}>
            Reopen
          </Button>
        )}
      </Group>

      {locked && (
        <Alert color="green" icon={<IconCheck size={18} />}>
          This report is finalised and read-only. Reopen it to make changes.
        </Alert>
      )}

      {/* Declared, never inferred: an unticked box means "checked, there were none". */}
      <Card withBorder padding="sm" radius="md">
        <Group justify="space-between" wrap="wrap" gap="md">
          <Group gap="lg" wrap="wrap">
            <Text size="sm" fw={500}>This form has:</Text>
            {([['charges', 'Charges'], ['pullOuts', 'Pull-outs'], ['transfers', 'Transfers'], ['overEnd', 'Over end']] as const).map(([key, label]) => (
              <Checkbox
                key={key}
                size="sm"
                label={label}
                disabled={!canWrite}
                checked={uses[key]}
                // Capture BEFORE the updater: a functional setState runs later, by
                // which time React has nulled currentTarget.
                onChange={e => {
                  const checked = e.currentTarget.checked
                  setUses(u => ({ ...u, [key]: checked }))
                  markEdited()
                }}
              />
            ))}
          </Group>
          <Group gap="sm" wrap="wrap">
            <Select label="Opened by" size="xs" w={170} data={employeeOptions} value={openedById} onChange={v => { setOpenedById(v); markEdited() }} clearable searchable disabled={!canWrite} />
            <Select label="Closed by" size="xs" w={170} data={employeeOptions} value={closedById} onChange={v => { setClosedById(v); markEdited() }} clearable searchable disabled={!canWrite} />
          </Group>
        </Group>
      </Card>

      {recountGaps.length > 0 && (
        <Alert
          color="orange"
          icon={<IconAlertTriangle size={18} />}
          title={`${recountGaps.length} opening${recountGaps.length === 1 ? '' : 's'} recounted differently`}
        >
          The opener counted something other than {report.carriedFromDate ?? 'the previous report'} left
          on the shelf. Worth explaining — it is either overnight loss or a miscount by one of two
          named people.
          <Text size="sm" mt={4}>
            {recountGaps
              .map(l => `${l.product.name}: counted ${l.begBal}, carried ${l.carriedBegBal}`)
              .join(' · ')}
          </Text>
        </Alert>
      )}

      {impossibleCount > 0 && (
        <Alert color="red" icon={<IconAlertTriangle size={18} />} title={`${impossibleCount} impossible line${impossibleCount === 1 ? '' : 's'}`}>
          More stock left than was ever available. Always a miscount or a missing entry — the rows are marked below.
        </Alert>
      )}

      {/* Otherwise invisible: nobody types "*" into a box that has only ever
          taken digits. */}
      <Text size="xs" c="dimmed">
        Counting a stack? Type <Text span ff="monospace" fw={600}>4*5+3*4</Text> in any count box and it
        works out 32 — layers are multiplied before they are added, unlike on a calculator.
      </Text>

      <DataState loading={products.loading} error={products.error}>
        {/* Not Table.ScrollContainer. Its overflow-x makes it the containing
            block for position:sticky, so the column names would stick to a box
            that never scrolls vertically and simply never move. Nesting a
            vertical scroller inside it does not help either: scrolling the page
            then slides the whole grid up behind the fixed app header.

            So the horizontal scroller only exists on screens too narrow for the
            table (see the CSS). At the widths this is actually used at — iPad
            landscape and up — there is no overflow container, and the header
            sticks to the page under the app bar. */}
        <div className={classes.gridScroll}>
          <Table
            striped="odd"
            highlightOnHover
            withTableBorder
            verticalSpacing={4}
            horizontalSpacing="xs"
            stickyHeader
            stickyHeaderOffset={56}
            className={classes.grid}
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Product</Table.Th>
                <Table.Th w={78} ta="right">Beg</Table.Th>
                <Table.Th w={96} ta="right">
                  <Group gap={2} justify="flex-end" wrap="nowrap">
                    <span>Prod'd</span>
                    {canWrite && (
                      <ColumnMenu
                        label="Prod'd"
                        column="produced"
                        sources={bulkColumns.filter(c => c.column !== 'produced')}
                        onClear={clearColumn}
                        onCopy={copyColumn}
                      />
                    )}
                  </Group>
                </Table.Th>
                {hasInbound && (
                  <Table.Th w={70} ta="right">
                    <Tooltip label="Received from another branch. Entered by the sending branch, not here.">
                      <span>In</span>
                    </Tooltip>
                  </Table.Th>
                )}
                {uses.transfers && <Table.Th w={70} ta="right">Out</Table.Th>}
                {uses.overEnd && <Table.Th w={108} ta="right">
                  <Group gap={2} justify="flex-end" wrap="nowrap">
                    <span>Over end</span>
                    {canWrite && (
                      <ColumnMenu
                        label="Over end"
                        column="overEnd"
                        sources={bulkColumns.filter(c => c.column !== 'overEnd')}
                        onClear={clearColumn}
                        onCopy={copyColumn}
                      />
                    )}
                  </Group>
                </Table.Th>}
                {uses.charges && <Table.Th w={70} ta="right">Chg</Table.Th>}
                {uses.pullOuts && <Table.Th w={100} ta="right">
                  <Group gap={2} justify="flex-end" wrap="nowrap">
                    <span>Pulled</span>
                    {canWrite && (
                      <ColumnMenu
                        label="Pulled"
                        column="pulledOut"
                        sources={bulkColumns.filter(c => c.column !== 'pulledOut')}
                        onClear={clearColumn}
                        onCopy={copyColumn}
                      />
                    )}
                  </Group>
                </Table.Th>}
                <Table.Th w={96} ta="right">
                  <Group gap={2} justify="flex-end" wrap="nowrap">
                    <span>End</span>
                    {canWrite && (
                      <ColumnMenu
                        label="End"
                        column="endBal"
                        sources={bulkColumns.filter(c => c.column !== 'endBal')}
                        onClear={clearColumn}
                        onCopy={copyColumn}
                      />
                    )}
                  </Group>
                </Table.Th>
                <Table.Th w={70} ta="right">Sold</Table.Th>
                <Table.Th w={104} ta="right">Sales</Table.Th>
                <Table.Th w={68} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {computed.map(({ line: l, totals, impossible }) => (
                <Table.Tr key={l.productId} bg={impossible ? 'var(--mantine-color-red-light)' : undefined}>
                  {/* The name opens the roomy editor; the figures beside it still
                      edit in place, so a quick single correction stays quick. */}
                  <Table.Td
                    onClick={() => setEditingProductId(l.productId)}
                    style={{ cursor: 'pointer' }}
                  >
                    <Group gap={4} wrap="nowrap">
                      <Stack gap={0} style={{ minWidth: 0 }}>
                        <Text size="sm" fw={500} lh={1.2}>{l.product.name}</Text>
                        <Text size="xs" c="dimmed" lh={1.2}>
                          {formatMoney(l.unitPriceCents)} per {l.product.unit.toLowerCase()}
                          {l.product.sku ? ` · ${l.product.sku}` : ''}
                        </Text>
                      </Stack>
                      <IconChevronRight size={14} opacity={0.35} />
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <OpeningBalanceCell
                      productName={l.product.name}
                      value={l.begBal}
                      recounted={l.begBalRecounted}
                      carried={l.carriedBegBal}
                      carriedFromDate={report.carriedFromDate}
                      disabled={!canWrite}
                      onChange={(v, e) => patchLine(l.productId, 'begBal', v, e)}
                      onRecount={() => recountOpening(l.productId)}
                    />
                  </Table.Td>
                  <Table.Td><QtyInput aria-label={`${l.product.name} produced`} value={l.produced} disabled={!canWrite} onChange={(v, e) => patchLine(l.productId, 'produced', v, e)} enteredAs={l.enteredAs?.produced} /></Table.Td>
                  {hasInbound && (
                    <Table.Td ta="right">
                      <Text size="sm" c={receivedBy.get(l.productId) ? 'crust.7' : 'dimmed'} fw={receivedBy.get(l.productId) ? 600 : 400}>
                        {receivedBy.get(l.productId) ?? 0}
                      </Text>
                    </Table.Td>
                  )}
                  {uses.transfers && (
                    <Table.Td ta="right"><Text size="sm" c="dimmed">{transferredBy.get(l.productId) ?? 0}</Text></Table.Td>
                  )}
                  {uses.overEnd && (
                    <Table.Td><QtyInput aria-label={`${l.product.name} over end`} value={l.overEnd} disabled={!canWrite} onChange={(v, e) => patchLine(l.productId, 'overEnd', v, e)} enteredAs={l.enteredAs?.overEnd} /></Table.Td>
                  )}
                  {uses.charges && (
                    <Table.Td ta="right"><Text size="sm" c="dimmed">{chargedBy.get(l.productId) ?? 0}</Text></Table.Td>
                  )}
                  {uses.pullOuts && (
                    <Table.Td><QtyInput aria-label={`${l.product.name} pulled out`} value={l.pulledOut} disabled={!canWrite} onChange={(v, e) => patchLine(l.productId, 'pulledOut', v, e)} enteredAs={l.enteredAs?.pulledOut} /></Table.Td>
                  )}
                  <Table.Td><QtyInput aria-label={`${l.product.name} ending balance`} value={l.endBal} disabled={!canWrite} onChange={(v, e) => patchLine(l.productId, 'endBal', v, e)} enteredAs={l.enteredAs?.endBal} /></Table.Td>
                  <Table.Td ta="right">
                    <Text size="sm" fw={600} c={impossible ? 'red' : undefined}>{totals.sold}</Text>
                  </Table.Td>
                  <Table.Td ta="right">
                    <Text size="sm" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatMoney(totals.salesCents)}</Text>
                  </Table.Td>
                  <Table.Td>
                    {canWrite && (
                      <Group gap={2} wrap="nowrap" justify="flex-end">
                        {/* Ticking rows is for clearing several at once; the bin
                            stays for the common case of dropping just one. */}
                        <Checkbox
                          size="xs"
                          checked={selected.has(l.productId)}
                          onChange={() => toggleSelected(l.productId)}
                          aria-label={`Select ${l.product.name}`}
                          tabIndex={-1}
                        />
                        <ActionIcon variant="subtle" color="gray" size="sm" aria-label={`Remove ${l.product.name}`}
                          onClick={() => { setLines(prev => prev.filter(x => x.productId !== l.productId)); markEdited() }}>
                          <IconTrash size={14} />
                        </ActionIcon>
                      </Group>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </div>
      </DataState>

      {canWrite && (
        <Group justify="space-between" wrap="wrap" gap="sm">
          <Group gap="sm" wrap="wrap">
            <Button
              variant="default"
              leftSection={<IconPlus size={16} />}
              onClick={() => setPickerOpen(true)}
            >
              Add products
            </Button>
            {selected.size > 0 && (
              <Button
                variant="light"
                color="red"
                leftSection={<IconTrash size={16} />}
                onClick={removeSelected}
              >
                Remove {selected.size}
              </Button>
            )}
            <Text size="sm" c="dimmed">{lines.length} on this form</Text>
          </Group>
          <Select
            size="xs"
            w={150}
            data={SORT_OPTIONS}
            value={sortBy}
            onChange={v => setSortBy((v as SortMode) ?? 'entry')}
            allowDeselect={false}
            leftSection={<IconArrowsSort size={14} />}
            aria-label="Sort products"
          />
        </Group>
      )}

      {/* Driven off the sorted view, so prev/next walks the order on screen. */}
      {(() => {
        const idx = computed.findIndex(c => c.line.productId === editingProductId)
        const current = idx >= 0 ? computed[idx] : null
        return (
          <ProductRowEditor
            line={current?.line ?? null}
            totals={current ? { ...current.totals, impossible: current.impossible } : null}
            index={idx}
            count={computed.length}
            carriedFromDate={report.carriedFromDate}
            uses={uses}
            transferredIn={receivedBy.get(editingProductId ?? '') ?? 0}
            transferredOut={transferredBy.get(editingProductId ?? '') ?? 0}
            charged={chargedBy.get(editingProductId ?? '') ?? 0}
            canWrite={canWrite}
            onClose={() => setEditingProductId(null)}
            onStep={delta => {
              const next = computed[idx + delta]
              if (next) setEditingProductId(next.line.productId)
            }}
            onPatch={(field, value, enteredAs) => editingProductId && patchLine(editingProductId, field, value, enteredAs)}
            onRecount={() => editingProductId && recountOpening(editingProductId)}
          />
        )
      })()}

      <AddProductsModal
        opened={pickerOpen}
        onClose={() => setPickerOpen(false)}
        products={products.data ?? []}
        alreadyAdded={new Set(lines.map(l => l.productId))}
        onAdd={addProducts}
      />

      <Group align="flex-start" grow gap="md" wrap="wrap">
        {uses.charges && (
          <ListPanel
            title="Charges"
            hint="Employee mistakes, paid at full price via payroll."
            onAdd={canWrite ? () => { setCharges(p => [...p, { productId: '', employeeId: '', quantity: 1 }]); markEdited() } : undefined}
            rows={charges.map((c, i) => (
              <Group key={i} gap="xs" wrap="nowrap">
                <Select placeholder="Product" size="xs" style={{ flex: 2 }} searchable disabled={!canWrite}
                  data={lines.map(l => ({ value: l.productId, label: l.product.name }))}
                  value={c.productId || null}
                  onChange={v => { setCharges(p => p.map((x, j) => j === i ? { ...x, productId: v ?? '' } : x)); markEdited() }} />
                <Select placeholder="Who" size="xs" style={{ flex: 2 }} searchable disabled={!canWrite}
                  data={employeeOptions} value={c.employeeId || null}
                  onChange={v => { setCharges(p => p.map((x, j) => j === i ? { ...x, employeeId: v ?? '' } : x)); markEdited() }} />
                <NumberInput size="xs" w={70} min={1} hideControls disabled={!canWrite} value={c.quantity}
                  onChange={v => { setCharges(p => p.map((x, j) => j === i ? { ...x, quantity: Number(v) || 1 } : x)); markEdited() }} />
                {canWrite && (
                  <ActionIcon variant="subtle" color="red" size="sm" aria-label="Remove charge"
                    onClick={() => { setCharges(p => p.filter((_, j) => j !== i)); markEdited() }}>
                    <IconTrash size={14} />
                  </ActionIcon>
                )}
              </Group>
            ))}
          />
        )}

        {uses.transfers && (
          <ListPanel
            title="Transfers out"
            hint="Stock moved to another branch."
            onAdd={canWrite ? () => { setTransfers(p => [...p, { productId: '', toBranchId: '', quantity: 1 }]); markEdited() } : undefined}
            rows={transfers.map((t, i) => (
              <Group key={i} gap="xs" wrap="nowrap">
                <Select placeholder="Product" size="xs" style={{ flex: 2 }} searchable disabled={!canWrite}
                  data={lines.map(l => ({ value: l.productId, label: l.product.name }))}
                  value={t.productId || null}
                  onChange={v => { setTransfers(p => p.map((x, j) => j === i ? { ...x, productId: v ?? '' } : x)); markEdited() }} />
                <Select placeholder="To branch" size="xs" style={{ flex: 2 }} searchable disabled={!canWrite}
                  data={(branches.data ?? []).filter(b => b.id !== report.branch.id).map(b => ({ value: b.id, label: b.name }))}
                  value={t.toBranchId || null}
                  onChange={v => { setTransfers(p => p.map((x, j) => j === i ? { ...x, toBranchId: v ?? '' } : x)); markEdited() }} />
                <NumberInput size="xs" w={70} min={1} hideControls disabled={!canWrite} value={t.quantity}
                  onChange={v => { setTransfers(p => p.map((x, j) => j === i ? { ...x, quantity: Number(v) || 1 } : x)); markEdited() }} />
                {canWrite && (
                  <ActionIcon variant="subtle" color="red" size="sm" aria-label="Remove transfer"
                    onClick={() => { setTransfers(p => p.filter((_, j) => j !== i)); markEdited() }}>
                    <IconTrash size={14} />
                  </ActionIcon>
                )}
              </Group>
            ))}
          />
        )}

        {hasInbound && (
          <ListPanel
            title="Received from other branches"
            hint="Entered by the sending branch — shown here so both sides agree."
            rows={(report?.inboundTransfers ?? []).map(t => (
              <Group key={t.id} gap="xs" wrap="nowrap" justify="space-between">
                <Text size="sm">{t.productName}</Text>
                <Group gap="xs" wrap="nowrap">
                  <Text size="xs" c="dimmed">from {t.fromBranchName}</Text>
                  <Badge size="sm" variant="light">{t.quantity}</Badge>
                </Group>
              </Group>
            ))}
          />
        )}

        <ListPanel
          title="Cash collected"
          hint="One row per cashier — not fixed slots."
          onAdd={canWrite ? () => { setCollections(p => [...p, { employeeId: null, label: null, amountCents: 0 }]); markEdited() } : undefined}
          rows={collections.map((c, i) => (
            <Group key={i} gap="xs" wrap="nowrap">
              <Select placeholder="Cashier" size="xs" style={{ flex: 2 }} searchable clearable disabled={!canWrite}
                data={employeeOptions} value={c.employeeId}
                onChange={v => { setCollections(p => p.map((x, j) => j === i ? { ...x, employeeId: v } : x)); markEdited() }} />
              <TextInput placeholder="or a label" size="xs" style={{ flex: 1 }} disabled={!canWrite}
                value={c.label ?? ''}
                onChange={e => { const v = e.currentTarget.value; setCollections(p => p.map((x, j) => j === i ? { ...x, label: v || null } : x)); markEdited() }} />
              <MoneyCountInput
                aria-label="Amount collected"
                disabled={!canWrite}
                value={c.amountCents}
                onChange={cents => { setCollections(p => p.map((x, j) => j === i ? { ...x, amountCents: cents } : x)); markEdited() }} />
              {canWrite && (
                <ActionIcon variant="subtle" color="red" size="sm" aria-label="Remove collection"
                  onClick={() => { setCollections(p => p.filter((_, j) => j !== i)); markEdited() }}>
                  <IconTrash size={14} />
                </ActionIcon>
              )}
            </Group>
          ))}
        />
      </Group>

      <Card withBorder padding="md" radius="md">
        <Group justify="space-between" wrap="wrap" gap="lg">
          <Stack gap="sm">
            <Group gap="xl" wrap="wrap">
              <Stat label="Derived sales" value={formatMoney(salesCents)} />
              <Stat label="Cash collected" value={formatMoney(collectionsCents)} />
              <Stat
                label={varianceCents < 0 ? 'Shortage' : 'Overage'}
                value={formatMoney(Math.abs(varianceCents))}
                color={varianceCents === 0 ? undefined : varianceCents < 0 ? 'red' : 'green'}
                hint={varianceCents < 0 ? 'Deducted from staff — check before finalising' : undefined}
              />
            </Group>
            <Divider />
            <Group gap="lg" wrap="wrap">
              <Stat
                small
                label="Production value"
                value={formatMoney(producedValueCents)}
                hint="Retail value of what this branch produced today. Excludes stock received from other branches."
              />
              {receivedValueCents > 0 && (
                <Stat small label="Received value" value={formatMoney(receivedValueCents)} hint="Retail value of stock sent here by other branches." />
              )}
              <Stat
                small
                label="Waste (pulled out)"
                value={formatMoney(pulledOutCents)}
                color={pulledOutCents > 0 ? 'orange' : undefined}
                hint="Discarded stock — the only figure here that is a genuine loss."
              />
              <Stat
                small
                label="Charged to staff"
                value={formatMoney(chargedValueCents)}
                hint="Recovered through payroll at full selling price, so not a loss."
              />
              {overEndUnits > 0 && (
                <Stat
                  small
                  label={`Over end (${overEndUnits} units)`}
                  value={formatMoney(overEndCents)}
                  color="red"
                  hint="Stock found in excess of what the books allow. Usually a miscount — but it is also what undeclared production looks like, so it is worth explaining."
                />
              )}
            </Group>
          </Stack>
          <Textarea placeholder="Notes (optional)" size="xs" autosize minRows={1} maxRows={3} w={280}
            disabled={!canWrite} value={notes}
            onChange={e => { setNotes(e.currentTarget.value); markEdited() }} />
        </Group>
      </Card>

      {/* Always reachable. The report runs to ~50 rows, and having Save only at
          the top meant scrolling the whole way back to keep work. */}
      {canWrite && (
        <Paper className={classes.actionBar} withBorder shadow="sm" p="sm" radius={0}>
          <Group justify="space-between" wrap="nowrap" gap="sm">
            <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
              {saving ? (
                <Text size="sm" c="dimmed">Saving…</Text>
              ) : dirty ? (
                <Text size="sm" c="orange">Unsaved changes</Text>
              ) : savedAt ? (
                <Group gap={4} wrap="nowrap">
                  <IconCheck size={14} color="var(--mantine-color-green-6)" />
                  <Text size="sm" c="dimmed">
                    Saved {savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </Group>
              ) : (
                <Text size="sm" c="dimmed">All changes save automatically</Text>
              )}
            </Group>
            <Group gap="xs" wrap="nowrap">
              <Button variant="default" onClick={() => void save()} loading={saving}>Save now</Button>
              {can('dsir:finalize') && (
                <Button leftSection={<IconLock size={16} />} onClick={confirmFinalize} loading={saving}>
                  Finalise
                </Button>
              )}
            </Group>
          </Group>
        </Paper>
      )}
      </Stack>
    </KeypadProvider>
  )
}

function Stat({ label, value, color, hint, small }: { label: string; value: string; color?: string; hint?: string; small?: boolean }) {
  return (
    <Stack gap={0}>
      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>{label}</Text>
      <Tooltip label={hint} disabled={!hint} multiline w={260}>
        <Text size={small ? 'sm' : 'lg'} fw={small ? 600 : 700} c={color}>{value}</Text>
      </Tooltip>
    </Stack>
  )
}

function ListPanel({ title, hint, rows, onAdd }: { title: string; hint: string; rows: React.ReactNode[]; onAdd?: () => void }) {
  return (
    <Paper withBorder p="sm" radius="md" miw={330}>
      <Group justify="space-between" mb="xs">
        <Stack gap={0}>
          <Text size="sm" fw={600}>{title}</Text>
          <Text size="xs" c="dimmed">{hint}</Text>
        </Stack>
        {onAdd && (
          <Button size="compact-xs" variant="light" leftSection={<IconPlus size={12} />} onClick={onAdd}>Add</Button>
        )}
      </Group>
      {rows.length === 0
        ? <Text size="xs" c="dimmed" py="xs">None</Text>
        : <Stack gap="xs">{rows}</Stack>}
      <Divider mt="xs" />
    </Paper>
  )
}
