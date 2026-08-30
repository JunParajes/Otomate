import { useState } from 'react'
import {
  ActionIcon, Alert, Badge, Button, Card, Grid, Group, Modal, NumberInput, Select,
  Stack, Table, Text, TextInput, Textarea, Tooltip,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { modals } from '@mantine/modals'
import {
  IconAlertTriangle, IconCheck, IconPencil, IconPlus, IconTrash,
} from '@tabler/icons-react'
import {
  CONSUMPTION_UNITS, UTILITY_TYPES, UTILITY_TYPE_LABELS,
  billStatus, consumptionChange, formatMoney, unpaidSummary, utilityName,
  type Branch, type CreateUtilityAccountInput, type CreateUtilityBillInput,
  type UtilityAccountRecord, type UtilityBillRecord, type UtilityType,
} from '@otomate/shared'
import { adminApi } from '@/lib/admin'
import MoneyInput from './MoneyInput'

interface Props {
  branch: Branch
  canWrite: boolean
  onChange: (updated: Branch) => void
}

const EMPTY_ACCOUNT = {
  type: 'ELECTRIC' as UtilityType,
  label: '',
  provider: '',
  accountNumber: '',
  meterNumber: '',
  isActive: true,
}
type AccountForm = typeof EMPTY_ACCOUNT

const EMPTY_BILL = {
  periodStart: '',
  periodEnd: '',
  amountCents: null as number | null,
  dueDate: '',
  paidOn: '',
  consumption: null as number | null,
  referenceNo: '',
  note: '',
}
type BillForm = typeof EMPTY_BILL

/** Today, as YYYY-MM-DD — for the "mark paid" shortcut. */
function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function BillBadge({ bill }: { bill: UtilityBillRecord }) {
  const { state, daysLeft } = billStatus(bill)
  if (state === 'paid') return <Badge color="green" variant="light">Paid {bill.paidOn}</Badge>
  if (state === 'overdue') return <Badge color="red" variant="light">{Math.abs(daysLeft ?? 0)}d overdue</Badge>
  if (state === 'due') return <Badge color="orange" variant="light">due in {daysLeft}d</Badge>
  return <Badge color="gray" variant="light">unpaid</Badge>
}

/**
 * Utility accounts and their bills.
 *
 * A ledger rather than a single figure like rent: each bill is its own event
 * with a period, an amount and a due date, and last month's does not supersede
 * this month's.
 *
 * Consumption is shown next to the amount and compared with the same month a
 * year earlier, because that is where the useful signal is. A bakery's power is
 * chillers and ovens; a jump with no tariff change is a failing compressor or a
 * door left open, and the peso amount alone hides that behind rate changes.
 */
export default function BranchUtilities({ branch, canWrite, onChange }: Props) {
  const accounts = branch.utilities ?? []
  const unpaid = unpaidSummary(accounts)

  const [accountForm, setAccountForm] = useState<AccountForm | null>(null)
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null)
  const [savingAccount, setSavingAccount] = useState(false)

  const [billFor, setBillFor] = useState<UtilityAccountRecord | null>(null)
  const [billForm, setBillForm] = useState<BillForm>(EMPTY_BILL)
  const [savingBill, setSavingBill] = useState(false)

  const fail = (title: string) => (e: unknown) =>
    notifications.show({
      color: 'red',
      title,
      message: e instanceof Error ? e.message : 'Something went wrong',
    })

  function openAccount(a?: UtilityAccountRecord) {
    setEditingAccountId(a?.id ?? null)
    setAccountForm(
      a
        ? {
            type: a.type,
            label: a.label ?? '',
            provider: a.provider ?? '',
            accountNumber: a.accountNumber ?? '',
            meterNumber: a.meterNumber ?? '',
            isActive: a.isActive,
          }
        : { ...EMPTY_ACCOUNT }
    )
  }

  async function saveAccount() {
    if (!accountForm) return
    setSavingAccount(true)
    try {
      const payload = {
        type: accountForm.type,
        label: accountForm.label || null,
        provider: accountForm.provider || null,
        accountNumber: accountForm.accountNumber || null,
        meterNumber: accountForm.meterNumber || null,
        isActive: accountForm.isActive,
      } as CreateUtilityAccountInput
      onChange(
        editingAccountId
          ? await adminApi.updateUtility(branch.id, editingAccountId, payload)
          : await adminApi.addUtility(branch.id, payload)
      )
      setAccountForm(null)
      setEditingAccountId(null)
    } catch (e) {
      fail('Could not save the account')(e)
    } finally {
      setSavingAccount(false)
    }
  }

  async function saveBill() {
    if (!billFor || billForm.amountCents === null) return
    setSavingBill(true)
    try {
      const payload = {
        periodStart: billForm.periodStart,
        periodEnd: billForm.periodEnd,
        amountCents: billForm.amountCents,
        dueDate: billForm.dueDate || null,
        paidOn: billForm.paidOn || null,
        consumption: billForm.consumption,
        referenceNo: billForm.referenceNo || null,
        note: billForm.note || null,
      } as CreateUtilityBillInput
      onChange(await adminApi.addBill(branch.id, billFor.id, payload))
      setBillFor(null)
      setBillForm(EMPTY_BILL)
    } catch (e) {
      fail('Could not save the bill')(e)
    } finally {
      setSavingBill(false)
    }
  }

  function confirmRemoveAccount(a: UtilityAccountRecord) {
    modals.openConfirmModal({
      title: `Remove ${utilityName(a)}?`,
      children: (
        <Text size="sm">
          If any bills are recorded against this account it will be refused — mark
          it inactive instead, which keeps the billing history.
        </Text>
      ),
      labels: { confirm: 'Remove', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => void adminApi.removeUtility(branch.id, a.id).then(onChange).catch(fail('Could not remove')),
    })
  }

  return (
    <Card withBorder padding="lg" radius="md">
      <Group justify="space-between" mb="sm">
        <Group gap="xs">
          <Text fw={600} size="lg">Utilities</Text>
          {unpaid.state !== 'none' && (
            <Badge color={unpaid.state === 'overdue' ? 'red' : unpaid.state === 'due' ? 'orange' : 'gray'} variant="light">
              {unpaid.count} unpaid · {formatMoney(unpaid.totalCents)}
            </Badge>
          )}
        </Group>
        {canWrite && (
          <Button size="compact-sm" leftSection={<IconPlus size={16} />} onClick={() => openAccount()}>
            Add account
          </Button>
        )}
      </Group>

      {unpaid.state === 'overdue' && (
        <Alert color="red" icon={<IconAlertTriangle size={18} />} mb="sm">
          {unpaid.overdueCount} bill(s) are past their due date. Disconnection brings
          reconnection fees and a branch that cannot open.
        </Alert>
      )}

      {accounts.length === 0 ? (
        <Text size="sm" c="dimmed">No utility accounts recorded yet.</Text>
      ) : (
        <Stack gap="lg">
          {accounts.map(a => {
            const unit = CONSUMPTION_UNITS[a.type]
            return (
              <div key={a.id}>
                <Group justify="space-between" wrap="nowrap" mb={6}>
                  <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                    <Text fw={600}>{utilityName(a)}</Text>
                    {!a.isActive && <Badge color="gray" variant="light">inactive</Badge>}
                    <Text size="xs" c="dimmed">
                      {[a.provider, a.accountNumber && `acct ${a.accountNumber}`, a.meterNumber && `meter ${a.meterNumber}`]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </Group>
                  {canWrite && (
                    <Group gap={4} wrap="nowrap">
                      <Button
                        size="compact-xs"
                        variant="light"
                        leftSection={<IconPlus size={14} />}
                        onClick={() => { setBillFor(a); setBillForm(EMPTY_BILL) }}
                      >
                        Add bill
                      </Button>
                      <ActionIcon variant="subtle" color="gray" onClick={() => openAccount(a)} aria-label={`Edit ${utilityName(a)}`}>
                        <IconPencil size={16} />
                      </ActionIcon>
                      <ActionIcon variant="subtle" color="red" onClick={() => confirmRemoveAccount(a)} aria-label={`Remove ${utilityName(a)}`}>
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                  )}
                </Group>

                {a.bills.length === 0 ? (
                  <Text size="sm" c="dimmed">No bills recorded.</Text>
                ) : (
                  <Table.ScrollContainer minWidth={700}>
                    <Table verticalSpacing="xs" striped="odd">
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th w={180}>Period</Table.Th>
                          <Table.Th w={130}>Amount</Table.Th>
                          {unit && <Table.Th w={160}>Usage</Table.Th>}
                          <Table.Th w={110}>Due</Table.Th>
                          <Table.Th w={170}>Status</Table.Th>
                          {canWrite && <Table.Th w={90} />}
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {a.bills.map(b => {
                          const change = consumptionChange(a.bills, b)
                          return (
                            <Table.Tr key={b.id}>
                              <Table.Td>
                                <Text size="sm" ff="monospace" style={{ whiteSpace: 'nowrap' }}>
                                  {b.periodStart} → {b.periodEnd}
                                </Text>
                              </Table.Td>
                              <Table.Td><Text size="sm" fw={500}>{formatMoney(b.amountCents)}</Text></Table.Td>
                              {unit && (
                                <Table.Td>
                                  {b.consumption == null ? (
                                    <Text size="sm" c="dimmed">—</Text>
                                  ) : (
                                    <Group gap={6} wrap="nowrap">
                                      <Text size="sm">{b.consumption} {unit}</Text>
                                      {change && Math.abs(change.percent) >= 15 && (
                                        <Tooltip
                                          label={`${change.previous} ${unit} in the same period last year`}
                                          withArrow
                                        >
                                          <Badge
                                            size="xs"
                                            variant="light"
                                            color={change.percent > 0 ? 'red' : 'green'}
                                          >
                                            {change.percent > 0 ? '+' : ''}{change.percent}%
                                          </Badge>
                                        </Tooltip>
                                      )}
                                    </Group>
                                  )}
                                </Table.Td>
                              )}
                              <Table.Td><Text size="sm" c="dimmed">{b.dueDate ?? '—'}</Text></Table.Td>
                              <Table.Td><BillBadge bill={b} /></Table.Td>
                              {canWrite && (
                                <Table.Td>
                                  <Group gap={4} wrap="nowrap">
                                    <Tooltip label={b.paidOn ? 'Mark unpaid' : 'Mark paid today'} withArrow>
                                      <ActionIcon
                                        variant="subtle"
                                        color={b.paidOn ? 'gray' : 'green'}
                                        aria-label={b.paidOn ? 'Mark unpaid' : 'Mark paid'}
                                        onClick={() =>
                                          void adminApi
                                            .setBillPaid(branch.id, a.id, b.id, b.paidOn ? null : today())
                                            .then(onChange)
                                            .catch(fail('Could not update'))
                                        }
                                      >
                                        <IconCheck size={16} />
                                      </ActionIcon>
                                    </Tooltip>
                                    <ActionIcon
                                      variant="subtle"
                                      color="red"
                                      aria-label="Remove bill"
                                      onClick={() =>
                                        void adminApi
                                          .removeBill(branch.id, a.id, b.id)
                                          .then(onChange)
                                          .catch(fail('Could not remove'))
                                      }
                                    >
                                      <IconTrash size={14} />
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
              </div>
            )
          })}
        </Stack>
      )}

      <Modal
        opened={accountForm !== null}
        onClose={() => { setAccountForm(null); setEditingAccountId(null) }}
        title={editingAccountId ? 'Edit utility account' : 'Add utility account'}
        centered
      >
        {accountForm && (
          <Stack gap="sm">
            <Select
              label="Utility"
              data={UTILITY_TYPES.map(t => ({ value: t, label: UTILITY_TYPE_LABELS[t] }))}
              value={accountForm.type}
              onChange={v => setAccountForm(f => (f ? { ...f, type: (v as UtilityType) ?? 'OTHER' } : f))}
              allowDeselect={false}
            />
            {accountForm.type === 'OTHER' && (
              <TextInput
                label="Name"
                withAsterisk
                value={accountForm.label}
                onChange={e => setAccountForm(f => (f ? { ...f, label: e.currentTarget.value } : f))}
              />
            )}
            <TextInput
              label="Provider"
              placeholder="Davao Light, Davao City Water District…"
              value={accountForm.provider}
              onChange={e => setAccountForm(f => (f ? { ...f, provider: e.currentTarget.value } : f))}
            />
            <Grid gap="sm">
              <Grid.Col span={6}>
                <TextInput
                  label="Account number"
                  value={accountForm.accountNumber}
                  onChange={e => setAccountForm(f => (f ? { ...f, accountNumber: e.currentTarget.value } : f))}
                />
              </Grid.Col>
              <Grid.Col span={6}>
                <TextInput
                  label="Meter number"
                  value={accountForm.meterNumber}
                  onChange={e => setAccountForm(f => (f ? { ...f, meterNumber: e.currentTarget.value } : f))}
                />
              </Grid.Col>
            </Grid>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => { setAccountForm(null); setEditingAccountId(null) }}>Cancel</Button>
              <Button loading={savingAccount} onClick={() => void saveAccount()}>
                {editingAccountId ? 'Save' : 'Add'}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal
        opened={billFor !== null}
        onClose={() => setBillFor(null)}
        title={billFor ? `Add ${utilityName(billFor)} bill` : ''}
        size="lg"
        centered
      >
        {billFor && (
          <Stack gap="sm">
            <Grid gap="sm">
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <TextInput
                  label="Period from"
                  type="date"
                  withAsterisk
                  value={billForm.periodStart}
                  onChange={e => setBillForm(f => ({ ...f, periodStart: e.currentTarget.value }))}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <TextInput
                  label="Period to"
                  type="date"
                  withAsterisk
                  value={billForm.periodEnd}
                  onChange={e => setBillForm(f => ({ ...f, periodEnd: e.currentTarget.value }))}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <MoneyInput
                  label="Amount"
                  withAsterisk
                  value={billForm.amountCents}
                  onChange={c => setBillForm(f => ({ ...f, amountCents: c }))}
                />
              </Grid.Col>
              {CONSUMPTION_UNITS[billFor.type] && (
                <Grid.Col span={{ base: 12, sm: 6 }}>
                  <NumberInput
                    label={`Usage (${CONSUMPTION_UNITS[billFor.type]})`}
                    description="Optional — but it is what shows a leak or a failing chiller"
                    min={0}
                    value={billForm.consumption ?? ''}
                    onChange={v => setBillForm(f => ({ ...f, consumption: v === '' ? null : Number(v) }))}
                  />
                </Grid.Col>
              )}
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <TextInput
                  label="Due date"
                  type="date"
                  value={billForm.dueDate}
                  onChange={e => setBillForm(f => ({ ...f, dueDate: e.currentTarget.value }))}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <TextInput
                  label="Paid on"
                  type="date"
                  description="Leave blank if not yet paid"
                  value={billForm.paidOn}
                  onChange={e => setBillForm(f => ({ ...f, paidOn: e.currentTarget.value }))}
                />
              </Grid.Col>
              <Grid.Col span={12}>
                <TextInput
                  label="Reference / OR number"
                  value={billForm.referenceNo}
                  onChange={e => setBillForm(f => ({ ...f, referenceNo: e.currentTarget.value }))}
                />
              </Grid.Col>
            </Grid>
            <Textarea
              label="Note"
              autosize
              minRows={2}
              value={billForm.note}
              onChange={e => setBillForm(f => ({ ...f, note: e.currentTarget.value }))}
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setBillFor(null)}>Cancel</Button>
              <Button
                loading={savingBill}
                disabled={!billForm.periodStart || !billForm.periodEnd || billForm.amountCents === null}
                onClick={() => void saveBill()}
              >
                Add bill
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Card>
  )
}
