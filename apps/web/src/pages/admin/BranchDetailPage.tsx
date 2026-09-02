import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ActionIcon, Alert, Badge, Button, Card, Center, Divider, Grid, Group, Loader,
  Modal, NumberInput, Select, Stack, Table, Text, TextInput, Textarea, Title, Tooltip,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { modals } from '@mantine/modals'
import { IconAlertTriangle, IconArrowLeft, IconCheck, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react'
import {
  PERMIT_TYPES, PERMIT_TYPE_LABELS,
  branchPermitStatus, currentRent, formatMoney, leaseStatus, permitName, permitStatus,
  type Branch, type BranchPermitRecord, type CreatePermitInput, type PermitType,
  type UpdateBranchLeaseInput,
} from '@otomate/shared'
import { adminApi } from '@/lib/admin'
import { useSession } from '@/lib/session'
import MoneyInput from '@/components/MoneyInput'
import StickyActionBar, { pageWithActionBar } from '@/components/StickyActionBar'
import BranchUtilities from '@/components/BranchUtilities'

/** A blank permit form — also what "Add permit" opens with. */
const EMPTY_PERMIT = {
  type: 'MAYORS_PERMIT' as PermitType,
  label: '',
  number: '',
  issuedOn: '',
  expiresOn: '',
  // Every branch is in Davao, so this is right far more often than it is wrong.
  authority: 'Davao City',
  note: '',
}
type PermitForm = typeof EMPTY_PERMIT

type LeaseForm = { [K in keyof UpdateBranchLeaseInput]-?: string }

function toLeaseForm(b: Branch): LeaseForm {
  const l = b.lease
  return {
    address: l?.address ?? '',
    lessorName: l?.lessorName ?? '',
    lessorContact: l?.lessorContact ?? '',
    lessorAddress: l?.lessorAddress ?? '',
    contractStart: l?.contractStart ?? '',
    contractEnd: l?.contractEnd ?? '',
    renewalNoticeDays: l?.renewalNoticeDays == null ? '' : String(l.renewalNoticeDays),
    depositCents: l?.depositCents == null ? '' : String(l.depositCents),
    advanceCents: l?.advanceCents == null ? '' : String(l.advanceCents),
  }
}

function StatusBadge({ state, daysLeft }: { state: 'none' | 'due' | 'overdue'; daysLeft: number | null }) {
  if (state === 'overdue') {
    return <Badge color="red" variant="light">Expired {Math.abs(daysLeft ?? 0)}d ago</Badge>
  }
  if (state === 'due') return <Badge color="orange" variant="light">{daysLeft}d left</Badge>
  return null
}

/**
 * One branch: what it holds from government, and what it costs to occupy.
 *
 * A route rather than a modal, for the reasons the employee record moved —
 * permits are linkable, printable and about to grow. The two halves answer to
 * different permissions and are shown or hidden independently: a manager can be
 * given permit expiry without being shown the rent.
 */
export default function BranchDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { can } = useSession()

  const canSeePermits = can('branches:permits:read')
  const canWritePermits = can('branches:permits:write')
  const canSeeUtilities = can('branches:utilities:read')
  const canWriteUtilities = can('branches:utilities:write')
  const canSeeLease = can('branches:lease:read')
  const canWriteLease = can('branches:lease:write')

  const [branch, setBranch] = useState<Branch | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [lease, setLease] = useState<LeaseForm | null>(null)
  const [savingLease, setSavingLease] = useState(false)
  /**
   * The lease form as it was loaded or last saved. Only the lease is deferred —
   * permits, rent and utility bills each save the moment you confirm them, so
   * the bar speaks for the lease alone.
   */
  const [savedLease, setSavedLease] = useState<string | null>(null)
  const [leaseSavedAt, setLeaseSavedAt] = useState<Date | null>(null)
  /** Read by the beforeunload guard, which is declared before `leaseDirty`. */
  const dirtyRef = useRef(false)

  // Permit editor, doubling as add and renew.
  const [permitForm, setPermitForm] = useState<PermitForm | null>(null)
  const [editingPermitId, setEditingPermitId] = useState<string | null>(null)
  const [savingPermit, setSavingPermit] = useState(false)

  const [rentCents, setRentCents] = useState<number | null>(null)
  const [rentFrom, setRentFrom] = useState('')
  const [rentNote, setRentNote] = useState('')
  const [addingRent, setAddingRent] = useState(false)

  const apply = useCallback((b: Branch) => {
    setBranch(b)
    const next = toLeaseForm(b)
    setLease(next)
    setSavedLease(JSON.stringify(next))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      apply(await adminApi.getBranch(id))
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load this branch')
    } finally {
      setLoading(false)
    }
  }, [id, apply])

  useEffect(() => { void load() }, [load])

  // Lease terms are transcribed from a contract; closing the tab should not
  // throw a half-entered one away. Same guard as the employee record.
  useEffect(() => {
    if (!dirtyRef.current) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  })

  const fail = (title: string) => (e: unknown) =>
    notifications.show({
      color: 'red',
      title,
      message: e instanceof Error ? e.message : 'Something went wrong',
    })

  if (loading) return <Center py="xl"><Loader /></Center>
  if (loadError || !branch) {
    return (
      <Stack gap="md">
        <Group gap="sm">
          <ActionIcon variant="subtle" color="gray" onClick={() => navigate('/admin/branches')} aria-label="Back">
            <IconArrowLeft size={18} />
          </ActionIcon>
          <Title order={2} size="h4">Branch</Title>
        </Group>
        <Alert color="red" title="Could not load">{loadError ?? 'That branch does not exist.'}</Alert>
      </Stack>
    )
  }

  const permits = branch.permits ?? []
  const rents = branch.rentHistory ?? []
  const rent = currentRent(rents)
  const permitSummary = branchPermitStatus(permits)
  const leaseState = branch.lease
    ? leaseStatus({ contractEnd: branch.lease.contractEnd, renewalNoticeDays: branch.lease.renewalNoticeDays })
    : { state: 'none' as const, daysLeft: null }

  const setL = (key: keyof LeaseForm, value: string) =>
    setLease(f => (f ? { ...f, [key]: value } : f))
  const leaseField = (key: keyof LeaseForm) => ({
    value: lease?.[key] ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setL(key, e.currentTarget.value),
    disabled: !canWriteLease,
  })

  async function saveLease() {
    if (!lease || !branch) return
    setSavingLease(true)
    try {
      // '' means "not set"; the numeric fields have to go back as numbers or null.
      const payload: UpdateBranchLeaseInput = {
        address: lease.address || null,
        lessorName: lease.lessorName || null,
        lessorContact: lease.lessorContact || null,
        lessorAddress: lease.lessorAddress || null,
        contractStart: lease.contractStart || null,
        contractEnd: lease.contractEnd || null,
        renewalNoticeDays: lease.renewalNoticeDays === '' ? null : Number(lease.renewalNoticeDays),
        depositCents: lease.depositCents === '' ? null : Number(lease.depositCents),
        advanceCents: lease.advanceCents === '' ? null : Number(lease.advanceCents),
      }
      apply(await adminApi.updateLease(branch.id, payload))
      setLeaseSavedAt(new Date())
      notifications.show({ color: 'green', title: 'Saved', message: 'Lease details updated' })
    } catch (e) {
      fail('Could not save the lease')(e)
    } finally {
      setSavingLease(false)
    }
  }

  function openPermit(p?: BranchPermitRecord) {
    setEditingPermitId(p?.id ?? null)
    setPermitForm(
      p
        ? {
            type: p.type,
            label: p.label ?? '',
            number: p.number ?? '',
            issuedOn: p.issuedOn ?? '',
            expiresOn: p.expiresOn ?? '',
            authority: p.authority ?? '',
            note: p.note ?? '',
          }
        : { ...EMPTY_PERMIT }
    )
  }

  async function savePermit() {
    if (!permitForm || !branch) return
    setSavingPermit(true)
    try {
      const payload = {
        type: permitForm.type,
        label: permitForm.label || null,
        number: permitForm.number || null,
        issuedOn: permitForm.issuedOn || null,
        expiresOn: permitForm.expiresOn || null,
        authority: permitForm.authority || null,
        note: permitForm.note || null,
      } as CreatePermitInput
      apply(
        editingPermitId
          ? await adminApi.updatePermit(branch.id, editingPermitId, payload)
          : await adminApi.addPermit(branch.id, payload)
      )
      setPermitForm(null)
      setEditingPermitId(null)
      notifications.show({ color: 'green', title: editingPermitId ? 'Permit updated' : 'Permit added', message: '' })
    } catch (e) {
      fail('Could not save the permit')(e)
    } finally {
      setSavingPermit(false)
    }
  }

  function confirmRemovePermit(p: BranchPermitRecord) {
    if (!branch) return
    modals.openConfirmModal({
      title: `Remove ${permitName(p)}?`,
      children: (
        <Text size="sm">
          This deletes the record of the permit, not the permit itself. To record a
          renewal, edit it and change the number and expiry instead.
        </Text>
      ),
      labels: { confirm: 'Remove', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => void adminApi.removePermit(branch.id, p.id).then(apply).catch(fail('Could not remove')),
    })
  }

  async function addRent() {
    if (!branch || rentCents === null || !rentFrom) return
    setAddingRent(true)
    try {
      apply(await adminApi.setRent(branch.id, { amountCents: rentCents, effectiveFrom: rentFrom, note: rentNote || null }))
      setRentCents(null)
      setRentFrom('')
      setRentNote('')
      notifications.show({ color: 'green', title: 'Rent recorded', message: `Effective ${rentFrom}` })
    } catch (e) {
      fail('Could not record the rent')(e)
    } finally {
      setAddingRent(false)
    }
  }

  const leaseDirty = savedLease !== null && lease !== null && JSON.stringify(lease) !== savedLease
  dirtyRef.current = leaseDirty

  return (
    <Stack gap="md" className={canWriteLease ? pageWithActionBar : undefined}>
      <Group gap="sm" wrap="nowrap">
        <ActionIcon variant="subtle" color="gray" onClick={() => navigate('/admin/branches')} aria-label="Back to branches">
          <IconArrowLeft size={18} />
        </ActionIcon>
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Group gap="xs" wrap="nowrap">
            <Title order={2} size="h4">{branch.name}</Title>
            <Badge variant="light" color={branch.isActive ? 'green' : 'gray'}>
              {branch.isActive ? 'Active' : 'Inactive'}
            </Badge>
          </Group>
          {branch.lease?.address && <Text size="sm" c="dimmed">{branch.lease.address}</Text>}
        </Stack>
      </Group>

      {canSeePermits && permitSummary.state !== 'none' && (
        <Alert
          color={permitSummary.state === 'overdue' ? 'red' : 'orange'}
          icon={<IconAlertTriangle size={18} />}
        >
          {permitSummary.state === 'overdue'
            ? `${permitSummary.count} permit(s) have expired. Several are prerequisites for each other — a lapsed Barangay Clearance or Fire Safety certificate blocks the Mayor's Permit renewal.`
            : `${permitSummary.count} permit(s) expire within 60 days.`}
        </Alert>
      )}

      {canSeeLease && leaseState.state !== 'none' && (
        <Alert color={leaseState.state === 'overdue' ? 'red' : 'orange'} icon={<IconAlertTriangle size={18} />}>
          {leaseState.state === 'overdue'
            ? `The lease ended ${Math.abs(leaseState.daysLeft ?? 0)} day(s) ago.`
            : `The lease ends in ${leaseState.daysLeft} day(s) — inside the notice period on this contract.`}
        </Alert>
      )}

      {canSeePermits && (
        <Card withBorder padding="lg" radius="md">
          <Group justify="space-between" mb="sm">
            <Title order={3} size="h5">Permits</Title>
            {canWritePermits && (
              <Button size="compact-sm" leftSection={<IconPlus size={16} />} onClick={() => openPermit()}>
                Add permit
              </Button>
            )}
          </Group>

          {permits.length === 0 ? (
            <Text size="sm" c="dimmed">No permits recorded yet.</Text>
          ) : (
            <Table.ScrollContainer minWidth={720}>
              <Table verticalSpacing="sm" highlightOnHover striped="odd">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Permit</Table.Th>
                    <Table.Th w={150}>Number</Table.Th>
                    <Table.Th w={130}>Issued</Table.Th>
                    <Table.Th w={260}>Expires</Table.Th>
                    <Table.Th w={150}>Authority</Table.Th>
                    {canWritePermits && <Table.Th w={90} />}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {permits.map(p => {
                    const st = permitStatus(p)
                    return (
                      <Table.Tr key={p.id}>
                        <Table.Td><Text size="sm" fw={500}>{permitName(p)}</Text></Table.Td>
                        <Table.Td><Text size="sm" ff="monospace">{p.number ?? '—'}</Text></Table.Td>
                        <Table.Td><Text size="sm" c="dimmed">{p.issuedOn ?? '—'}</Text></Table.Td>
                        <Table.Td>
                          <Group gap="xs" wrap="nowrap">
                            <Text size="sm" ff="monospace" style={{ whiteSpace: 'nowrap' }}>{p.expiresOn ?? '—'}</Text>
                            <StatusBadge {...st} />
                            {!p.expiresOn && (
                              <Tooltip label="No expiry recorded — this cannot be tracked" withArrow>
                                <Badge color="gray" variant="light">unknown</Badge>
                              </Tooltip>
                            )}
                          </Group>
                        </Table.Td>
                        <Table.Td><Text size="sm" c="dimmed">{p.authority ?? '—'}</Text></Table.Td>
                        {canWritePermits && (
                          <Table.Td>
                            <Group gap={4} wrap="nowrap">
                              <ActionIcon variant="subtle" color="gray" onClick={() => openPermit(p)} aria-label={`Edit ${permitName(p)}`}>
                                <IconPencil size={16} />
                              </ActionIcon>
                              <ActionIcon variant="subtle" color="red" onClick={() => confirmRemovePermit(p)} aria-label={`Remove ${permitName(p)}`}>
                                <IconTrash size={16} />
                              </ActionIcon>
                            </Group>
                          </Table.Td>
                        )}
                      </Table.Tr>
                    )
                  })}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </Card>
      )}

      {canSeeUtilities && (
        <BranchUtilities branch={branch} canWrite={canWriteUtilities} onChange={apply} />
      )}

      {canSeeLease && lease && (
        <Card withBorder padding="lg" radius="md">
          <Title order={3} size="h5" mb="sm">Lease</Title>
          <Grid gap="sm">
            <Grid.Col span={12}>
              <Textarea label="Branch address" autosize minRows={2} {...leaseField('address')} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <TextInput label="Lessor" {...leaseField('lessorName')} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <TextInput label="Lessor contact" {...leaseField('lessorContact')} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <TextInput label="Lessor address" {...leaseField('lessorAddress')} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 3 }}>
              <TextInput label="Contract starts" type="date" {...leaseField('contractStart')} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 3 }}>
              <TextInput label="Contract ends" type="date" {...leaseField('contractEnd')} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 3 }}>
              <NumberInput
                label="Notice required"
                description="Days before the end"
                min={0}
                max={365}
                value={lease.renewalNoticeDays === '' ? '' : Number(lease.renewalNoticeDays)}
                onChange={v => setL('renewalNoticeDays', v === '' ? '' : String(v))}
                disabled={!canWriteLease}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 3 }}>
              <MoneyInput
                label="Deposit"
                value={lease.depositCents === '' ? null : Number(lease.depositCents)}
                onChange={c => setL('depositCents', c === null ? '' : String(c))}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 3 }}>
              <MoneyInput
                label="Advance"
                value={lease.advanceCents === '' ? null : Number(lease.advanceCents)}
                onChange={c => setL('advanceCents', c === null ? '' : String(c))}
              />
            </Grid.Col>
          </Grid>

          <Divider label="Rent" labelPosition="left" my="md" />

          {rent ? (
            <Group gap="xs">
              <Text size="sm">Currently</Text>
              <Text size="sm" fw={700}>{formatMoney(rent.amountCents)}</Text>
              <Text size="sm" c="dimmed">per month</Text>
              <Badge size="sm" variant="light">since {rent.effectiveFrom}</Badge>
            </Group>
          ) : (
            <Text size="sm" c="dimmed">No rent recorded yet.</Text>
          )}

          {rents.length > 0 && (
            <Table verticalSpacing="xs" striped="odd" mt="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={120}>From</Table.Th>
                  <Table.Th w={140}>Amount</Table.Th>
                  <Table.Th>Note</Table.Th>
                  {canWriteLease && <Table.Th w={50} />}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rents.map(r => (
                  <Table.Tr key={r.id}>
                    <Table.Td><Text size="sm" ff="monospace">{r.effectiveFrom}</Text></Table.Td>
                    <Table.Td><Text size="sm">{formatMoney(r.amountCents)}</Text></Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {r.note}
                        {r.recordedBy && (r.note ? ` — ${r.recordedBy.name}` : r.recordedBy.name)}
                      </Text>
                    </Table.Td>
                    {canWriteLease && (
                      <Table.Td>
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          onClick={() => branch && void adminApi.removeRent(branch.id, r.id).then(apply).catch(fail('Could not remove'))}
                          aria-label={`Remove the rent effective ${r.effectiveFrom}`}
                        >
                          <IconTrash size={14} />
                        </ActionIcon>
                      </Table.Td>
                    )}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}

          {canWriteLease && (
            <Grid gap="sm" align="flex-end" mt="sm">
              <Grid.Col span={{ base: 12, sm: 3 }}>
                <MoneyInput label="Monthly rent" value={rentCents} onChange={setRentCents} />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 3 }}>
                <TextInput label="Effective from" type="date" value={rentFrom} onChange={e => setRentFrom(e.currentTarget.value)} />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 4 }}>
                <TextInput label="Why it changed" placeholder="Annual escalation, renewed lease…" value={rentNote} onChange={e => setRentNote(e.currentTarget.value)} />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 2 }}>
                <Button
                  fullWidth
                  leftSection={<IconPlus size={16} />}
                  disabled={rentCents === null || rentCents <= 0 || !rentFrom}
                  loading={addingRent}
                  onClick={() => void addRent()}
                >
                  Add
                </Button>
              </Grid.Col>
            </Grid>
          )}

          <Text size="xs" c="dimmed" mt="xs">
            Rent is kept as history. A new figure never rewrites an old one, so past
            months keep the rent actually paid.
          </Text>
        </Card>
      )}

      {!canSeePermits && !canSeeUtilities && !canSeeLease && (
        <Alert color="gray">You do not have permission to see permit or lease records for this branch.</Alert>
      )}

      <Modal
        opened={permitForm !== null}
        onClose={() => { setPermitForm(null); setEditingPermitId(null) }}
        title={editingPermitId ? 'Edit permit' : 'Add permit'}
        size="lg"
        centered
      >
        {permitForm && (
          <Stack gap="sm">
            <Select
              label="Permit"
              data={PERMIT_TYPES.map(t => ({ value: t, label: PERMIT_TYPE_LABELS[t] }))}
              value={permitForm.type}
              onChange={v => setPermitForm(f => (f ? { ...f, type: (v as PermitType) ?? 'OTHER' } : f))}
              allowDeselect={false}
            />
            {permitForm.type === 'OTHER' && (
              <TextInput
                label="Name of permit"
                withAsterisk
                value={permitForm.label}
                onChange={e => { const v = e.currentTarget.value; setPermitForm(f => (f ? { ...f, label: v } : f)) }}
              />
            )}
            <Grid gap="sm">
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <TextInput
                  label="Permit number"
                  value={permitForm.number}
                  onChange={e => { const v = e.currentTarget.value; setPermitForm(f => (f ? { ...f, number: v } : f)) }}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <TextInput
                  label="Issuing authority"
                  value={permitForm.authority}
                  onChange={e => { const v = e.currentTarget.value; setPermitForm(f => (f ? { ...f, authority: v } : f)) }}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <TextInput
                  label="Issued on"
                  type="date"
                  value={permitForm.issuedOn}
                  onChange={e => { const v = e.currentTarget.value; setPermitForm(f => (f ? { ...f, issuedOn: v } : f)) }}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <TextInput
                  label="Expires on"
                  type="date"
                  description="What the reminder is based on"
                  value={permitForm.expiresOn}
                  onChange={e => { const v = e.currentTarget.value; setPermitForm(f => (f ? { ...f, expiresOn: v } : f)) }}
                />
              </Grid.Col>
            </Grid>
            <Textarea
              label="Note"
              autosize
              minRows={2}
              value={permitForm.note}
              onChange={e => { const v = e.currentTarget.value; setPermitForm(f => (f ? { ...f, note: v } : f)) }}
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => { setPermitForm(null); setEditingPermitId(null) }}>Cancel</Button>
              <Button loading={savingPermit} onClick={() => void savePermit()}>
                {editingPermitId ? 'Save' : 'Add permit'}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      {canWriteLease && (
        <StickyActionBar
          status={
            leaseDirty ? (
              <Text size="sm" c="orange">Unsaved lease changes</Text>
            ) : leaseSavedAt ? (
              <Group gap={4} wrap="nowrap">
                <IconCheck size={14} color="var(--mantine-color-green-6)" />
                <Text size="sm" c="dimmed">
                  Saved {leaseSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </Group>
            ) : (
              // Permits, rent and bills save as you confirm them; only the lease
              // form waits for this button.
              <Text size="sm" c="dimmed">Permits and bills save as you add them</Text>
            )
          }
        >
          <Button variant="default" onClick={() => navigate('/admin/branches')}>Back</Button>
          <Button loading={savingLease} disabled={!leaseDirty} onClick={() => void saveLease()}>
            Save lease
          </Button>
        </StickyActionBar>
      )}
    </Stack>
  )
}
