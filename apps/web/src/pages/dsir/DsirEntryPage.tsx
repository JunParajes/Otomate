import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ActionIcon, Alert, Badge, Button, Card, Center, Checkbox, Divider, Group, Loader,
  NumberInput, Paper, Select, Stack, Table, Text, Textarea, TextInput, Title, Tooltip,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { modals } from '@mantine/modals'
import {
  IconAlertTriangle, IconArrowLeft, IconCheck, IconLock, IconLockOpen, IconPlus, IconTrash,
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
import MoneyCountInput from '@/components/MoneyCountInput'

type Line = DsirReport['lines'][number]
type Charge = { productId: string; employeeId: string; quantity: number }
type Transfer = { productId: string; toBranchId: string; quantity: number }
type Collection = { employeeId: string | null; label: string | null; amountCents: number }

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
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const products = useResource(catalogApi.listProducts)
  const employees = useResource(employeeApi.list)
  const branches = useResource(adminApi.listBranches)

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
  const productOptions = useMemo(
    () => (products.data ?? [])
      .filter(p => !lines.some(l => l.productId === p.id))
      .map(p => ({ value: p.id, label: `${p.name} — ${formatMoney(p.priceCents)} per ${p.unit.toLowerCase()}` })),
    [products.data, lines]
  )

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
  const computed = useMemo(
    () => lines.map(l => {
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
    [lines, chargedBy, transferredBy, receivedBy]
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

  function patchLine(productId: string, field: keyof Line, value: number) {
    setLines(prev => prev.map(l => (l.productId === productId ? { ...l, [field]: value } : l)))
    setDirty(true)
  }

  function addProduct(productId: string | null) {
    const p = (products.data ?? []).find(x => x.id === productId)
    if (!p) return
    setLines(prev => [...prev, {
      productId: p.id,
      product: { id: p.id, name: p.name, sku: p.sku, unit: p.unit, category: p.category },
      unitPriceCents: p.priceCents,
      begBal: 0, produced: 0, overEnd: 0, pulledOut: 0, endBal: 0,
      transferredIn: 0, transferredOut: 0, charged: 0, preTotal: 0, sold: 0, salesCents: 0,
    }])
    setDirty(true)
  }

  async function save(then?: 'finalize') {
    setSaving(true)
    try {
      const payload: SaveDsirInput = {
        usesCharges: uses.charges, usesPullOuts: uses.pullOuts,
        usesTransfers: uses.transfers, usesOverEnd: uses.overEnd,
        openedById, closedById, notes: notes.trim() || null,
        lines: lines.map(l => ({
          productId: l.productId, begBal: l.begBal, produced: l.produced,
          overEnd: l.overEnd, pulledOut: l.pulledOut, endBal: l.endBal,
        })),
        charges: uses.charges ? charges : [],
        transfers: uses.transfers ? transfers : [],
        collections,
      }
      let saved = await dsirApi.save(id, payload)
      if (then === 'finalize') saved = await dsirApi.finalize(id)
      hydrate(saved)
      notifications.show({ color: 'green', title: 'Saved', message: then === 'finalize' ? 'Report finalised' : 'Changes saved' })
    } catch (e) {
      notifications.show({ color: 'red', title: 'Failed', message: e instanceof Error ? e.message : 'Could not save' })
    } finally {
      setSaving(false)
    }
  }

  function confirmFinalize() {
    modals.openConfirmModal({
      title: 'Finalise this report?',
      children: (
        <Stack gap="xs">
          <Text size="sm">It will be locked from further edits. You can reopen it if you need to.</Text>
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
    <Stack gap="md">
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
        <Group gap="xs">
          {locked && can('dsir:finalize') && (
            <Button variant="default" leftSection={<IconLockOpen size={16} />} onClick={() => void dsirApi.reopen(id).then(hydrate)}>
              Reopen
            </Button>
          )}
          {canWrite && <Button variant="default" onClick={() => void save()} loading={saving}>Save draft</Button>}
          {canWrite && can('dsir:finalize') && (
            <Button leftSection={<IconLock size={16} />} onClick={confirmFinalize} loading={saving}>Finalise</Button>
          )}
        </Group>
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
                  setDirty(true)
                }}
              />
            ))}
          </Group>
          <Group gap="sm" wrap="wrap">
            <Select label="Opened by" size="xs" w={170} data={employeeOptions} value={openedById} onChange={v => { setOpenedById(v); setDirty(true) }} clearable searchable disabled={!canWrite} />
            <Select label="Closed by" size="xs" w={170} data={employeeOptions} value={closedById} onChange={v => { setClosedById(v); setDirty(true) }} clearable searchable disabled={!canWrite} />
          </Group>
        </Group>
      </Card>

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
        <Table.ScrollContainer minWidth={880}>
          <Table striped="odd" highlightOnHover withTableBorder verticalSpacing={4} horizontalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Product</Table.Th>
                <Table.Th w={78} ta="right">Beg</Table.Th>
                <Table.Th w={78} ta="right">Prod'd</Table.Th>
                {hasInbound && (
                  <Table.Th w={70} ta="right">
                    <Tooltip label="Received from another branch. Entered by the sending branch, not here.">
                      <span>In</span>
                    </Tooltip>
                  </Table.Th>
                )}
                {uses.transfers && <Table.Th w={70} ta="right">Out</Table.Th>}
                {uses.overEnd && <Table.Th w={78} ta="right">Over end</Table.Th>}
                {uses.charges && <Table.Th w={70} ta="right">Chg</Table.Th>}
                {uses.pullOuts && <Table.Th w={78} ta="right">Pulled</Table.Th>}
                <Table.Th w={78} ta="right">End</Table.Th>
                <Table.Th w={70} ta="right">Sold</Table.Th>
                <Table.Th w={104} ta="right">Sales</Table.Th>
                <Table.Th w={36} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {computed.map(({ line: l, totals, impossible }) => (
                <Table.Tr key={l.productId} bg={impossible ? 'var(--mantine-color-red-light)' : undefined}>
                  <Table.Td>
                    <Text size="sm" fw={500} lh={1.2}>{l.product.name}</Text>
                    <Text size="xs" c="dimmed" lh={1.2}>
                      {formatMoney(l.unitPriceCents)} per {l.product.unit.toLowerCase()}
                      {l.product.sku ? ` · ${l.product.sku}` : ''}
                    </Text>
                  </Table.Td>
                  <Table.Td><QtyInput aria-label={`${l.product.name} beginning balance`} value={l.begBal} disabled={!canWrite} onChange={v => patchLine(l.productId, 'begBal', v)} /></Table.Td>
                  <Table.Td><QtyInput aria-label={`${l.product.name} produced`} value={l.produced} disabled={!canWrite} onChange={v => patchLine(l.productId, 'produced', v)} /></Table.Td>
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
                    <Table.Td><QtyInput aria-label={`${l.product.name} over end`} value={l.overEnd} disabled={!canWrite} onChange={v => patchLine(l.productId, 'overEnd', v)} /></Table.Td>
                  )}
                  {uses.charges && (
                    <Table.Td ta="right"><Text size="sm" c="dimmed">{chargedBy.get(l.productId) ?? 0}</Text></Table.Td>
                  )}
                  {uses.pullOuts && (
                    <Table.Td><QtyInput aria-label={`${l.product.name} pulled out`} value={l.pulledOut} disabled={!canWrite} onChange={v => patchLine(l.productId, 'pulledOut', v)} /></Table.Td>
                  )}
                  <Table.Td><QtyInput aria-label={`${l.product.name} ending balance`} value={l.endBal} disabled={!canWrite} onChange={v => patchLine(l.productId, 'endBal', v)} /></Table.Td>
                  <Table.Td ta="right">
                    <Text size="sm" fw={600} c={impossible ? 'red' : undefined}>{totals.sold}</Text>
                  </Table.Td>
                  <Table.Td ta="right">
                    <Text size="sm" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatMoney(totals.salesCents)}</Text>
                  </Table.Td>
                  <Table.Td>
                    {canWrite && (
                      <ActionIcon variant="subtle" color="gray" size="sm" aria-label={`Remove ${l.product.name}`}
                        onClick={() => { setLines(prev => prev.filter(x => x.productId !== l.productId)); setDirty(true) }}>
                        <IconTrash size={14} />
                      </ActionIcon>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </DataState>

      {canWrite && (
        <Select
          placeholder="Add a product not listed above…"
          data={productOptions}
          value={null}
          onChange={addProduct}
          searchable
          clearable={false}
          nothingFoundMessage="No matching product"
          maw={430}
        />
      )}

      <Group align="flex-start" grow gap="md" wrap="wrap">
        {uses.charges && (
          <ListPanel
            title="Charges"
            hint="Employee mistakes, paid at full price via payroll."
            onAdd={canWrite ? () => { setCharges(p => [...p, { productId: '', employeeId: '', quantity: 1 }]); setDirty(true) } : undefined}
            rows={charges.map((c, i) => (
              <Group key={i} gap="xs" wrap="nowrap">
                <Select placeholder="Product" size="xs" style={{ flex: 2 }} searchable disabled={!canWrite}
                  data={lines.map(l => ({ value: l.productId, label: l.product.name }))}
                  value={c.productId || null}
                  onChange={v => { setCharges(p => p.map((x, j) => j === i ? { ...x, productId: v ?? '' } : x)); setDirty(true) }} />
                <Select placeholder="Who" size="xs" style={{ flex: 2 }} searchable disabled={!canWrite}
                  data={employeeOptions} value={c.employeeId || null}
                  onChange={v => { setCharges(p => p.map((x, j) => j === i ? { ...x, employeeId: v ?? '' } : x)); setDirty(true) }} />
                <NumberInput size="xs" w={70} min={1} hideControls disabled={!canWrite} value={c.quantity}
                  onChange={v => { setCharges(p => p.map((x, j) => j === i ? { ...x, quantity: Number(v) || 1 } : x)); setDirty(true) }} />
                {canWrite && (
                  <ActionIcon variant="subtle" color="red" size="sm" aria-label="Remove charge"
                    onClick={() => { setCharges(p => p.filter((_, j) => j !== i)); setDirty(true) }}>
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
            onAdd={canWrite ? () => { setTransfers(p => [...p, { productId: '', toBranchId: '', quantity: 1 }]); setDirty(true) } : undefined}
            rows={transfers.map((t, i) => (
              <Group key={i} gap="xs" wrap="nowrap">
                <Select placeholder="Product" size="xs" style={{ flex: 2 }} searchable disabled={!canWrite}
                  data={lines.map(l => ({ value: l.productId, label: l.product.name }))}
                  value={t.productId || null}
                  onChange={v => { setTransfers(p => p.map((x, j) => j === i ? { ...x, productId: v ?? '' } : x)); setDirty(true) }} />
                <Select placeholder="To branch" size="xs" style={{ flex: 2 }} searchable disabled={!canWrite}
                  data={(branches.data ?? []).filter(b => b.id !== report.branch.id).map(b => ({ value: b.id, label: b.name }))}
                  value={t.toBranchId || null}
                  onChange={v => { setTransfers(p => p.map((x, j) => j === i ? { ...x, toBranchId: v ?? '' } : x)); setDirty(true) }} />
                <NumberInput size="xs" w={70} min={1} hideControls disabled={!canWrite} value={t.quantity}
                  onChange={v => { setTransfers(p => p.map((x, j) => j === i ? { ...x, quantity: Number(v) || 1 } : x)); setDirty(true) }} />
                {canWrite && (
                  <ActionIcon variant="subtle" color="red" size="sm" aria-label="Remove transfer"
                    onClick={() => { setTransfers(p => p.filter((_, j) => j !== i)); setDirty(true) }}>
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
          onAdd={canWrite ? () => { setCollections(p => [...p, { employeeId: null, label: null, amountCents: 0 }]); setDirty(true) } : undefined}
          rows={collections.map((c, i) => (
            <Group key={i} gap="xs" wrap="nowrap">
              <Select placeholder="Cashier" size="xs" style={{ flex: 2 }} searchable clearable disabled={!canWrite}
                data={employeeOptions} value={c.employeeId}
                onChange={v => { setCollections(p => p.map((x, j) => j === i ? { ...x, employeeId: v } : x)); setDirty(true) }} />
              <TextInput placeholder="or a label" size="xs" style={{ flex: 1 }} disabled={!canWrite}
                value={c.label ?? ''}
                onChange={e => { const v = e.currentTarget.value; setCollections(p => p.map((x, j) => j === i ? { ...x, label: v || null } : x)); setDirty(true) }} />
              <MoneyCountInput
                aria-label="Amount collected"
                disabled={!canWrite}
                value={c.amountCents}
                onChange={cents => { setCollections(p => p.map((x, j) => j === i ? { ...x, amountCents: cents } : x)); setDirty(true) }} />
              {canWrite && (
                <ActionIcon variant="subtle" color="red" size="sm" aria-label="Remove collection"
                  onClick={() => { setCollections(p => p.filter((_, j) => j !== i)); setDirty(true) }}>
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
            onChange={e => { setNotes(e.currentTarget.value); setDirty(true) }} />
        </Group>
      </Card>
    </Stack>
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
