import { useEffect, useState } from 'react'
import {
  Alert, Badge, Button, Divider, Grid, Group, Modal, Select, Stack, Table, Text,
  TextInput, Textarea, Tooltip,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { modals } from '@mantine/modals'
import { IconAlertTriangle, IconPlus, IconTrash } from '@tabler/icons-react'
import {
  CIVIL_STATUSES, CIVIL_STATUS_LABELS,
  EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABELS,
  PAYOUT_METHODS, PAYOUT_METHOD_LABELS,
  SALARY_RATE_TYPES, SALARY_RATE_LABELS,
  currentSalary, formatMoney, probationStatus,
  type CivilStatus, type Employee, type EmploymentType, type PayoutMethod,
  type SalaryRateType, type UpdateEmployeeHrInput,
} from '@otomate/shared'
import { employeeApi } from '@/lib/employees'
import { useSession } from '@/lib/session'
import MoneyInput from './MoneyInput'

interface Props {
  employee: Employee | null
  onClose: () => void
  onSaved: (updated: Employee) => void
}

/** Every field starts as a string so an empty box round-trips as "not set". */
type HrForm = {
  [K in keyof UpdateEmployeeHrInput]-?: string
}

function toForm(e: Employee): HrForm {
  const hr = e.hr
  return {
    birthDate: hr?.birthDate ?? '',
    civilStatus: hr?.civilStatus ?? '',
    address: hr?.address ?? '',
    contactNumber: hr?.contactNumber ?? '',
    emergencyName: hr?.emergencyName ?? '',
    emergencyRelation: hr?.emergencyRelation ?? '',
    emergencyContact: hr?.emergencyContact ?? '',
    sssNumber: hr?.sssNumber ?? '',
    philhealthNumber: hr?.philhealthNumber ?? '',
    pagibigNumber: hr?.pagibigNumber ?? '',
    tin: hr?.tin ?? '',
    dateHired: hr?.dateHired ?? '',
    employmentType: hr?.employmentType ?? 'PROBATIONARY',
    probationEndDate: hr?.probationEndDate ?? '',
    regularizedAt: hr?.regularizedAt ?? '',
    separatedAt: hr?.separatedAt ?? '',
    separationReason: hr?.separationReason ?? '',
    payoutMethod: hr?.payoutMethod ?? 'CASH',
    payoutAccount: hr?.payoutAccount ?? '',
  }
}

/**
 * The 201 file, and pay.
 *
 * Separate from the Edit modal because the two answer to different permissions:
 * adding staff is an everyday branch task, while government IDs and salary are
 * not. Splitting them at the screen means the split is visible, rather than a
 * form that silently drops half of what you typed.
 */
export default function EmployeeHrModal({ employee, onClose, onSaved }: Props) {
  const { can } = useSession()
  const canWriteHr = can('hr:write')
  const canSeeSalary = can('hr:salary:read')
  const canWriteSalary = can('hr:salary:write')

  const [form, setForm] = useState<HrForm | null>(null)
  const [saving, setSaving] = useState(false)

  // New-rate fields, kept apart from the 201 form: they post to a different
  // endpoint and must not be swept into a Save of the rest.
  const [basicCents, setBasicCents] = useState<number | null>(null)
  const [allowanceCents, setAllowanceCents] = useState<number | null>(null)
  const [rateType, setRateType] = useState<SalaryRateType>('DAILY')
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [rateNote, setRateNote] = useState('')
  const [addingRate, setAddingRate] = useState(false)

  useEffect(() => {
    setForm(employee ? toForm(employee) : null)
    setBasicCents(null)
    setAllowanceCents(null)
    setRateType('DAILY')
    setEffectiveFrom('')
    setRateNote('')
    setAddingRate(false)
  }, [employee?.id])

  if (!employee || !form) return null

  const set = (key: keyof HrForm) => (value: string) => setForm(f => (f ? { ...f, [key]: value } : f))
  const field = (key: keyof HrForm) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(key)(e.currentTarget.value),
    disabled: !canWriteHr,
  })

  const probation = probationStatus({
    employmentType: form.employmentType as EmploymentType,
    probationEndDate: form.probationEndDate || null,
    separatedAt: form.separatedAt || null,
    isActive: employee.isActive,
  })

  async function save() {
    if (!form || !employee) return
    setSaving(true)
    try {
      // '' means "not set" — sent as null so clearing a field actually clears it.
      const payload = Object.fromEntries(
        Object.entries(form).map(([k, v]) => [k, v === '' ? null : v])
      ) as UpdateEmployeeHrInput
      // These two are enums with a default and are never null.
      payload.employmentType = form.employmentType as EmploymentType
      payload.payoutMethod = form.payoutMethod as PayoutMethod

      const updated = await employeeApi.updateHr(employee.id, payload)
      onSaved(updated)
      notifications.show({ color: 'green', title: 'Saved', message: `${employee.name}'s record updated` })
      onClose()
    } catch (e) {
      notifications.show({
        color: 'red',
        title: 'Could not save',
        message: e instanceof Error ? e.message : 'Something went wrong',
      })
    } finally {
      setSaving(false)
    }
  }

  async function addRate() {
    if (!employee || basicCents === null || !effectiveFrom) return
    setAddingRate(true)
    try {
      const updated = await employeeApi.setSalary(employee.id, {
        basicCents,
        allowanceCents: allowanceCents ?? 0,
        rateType,
        effectiveFrom,
        note: rateNote.trim() || null,
      })
      onSaved(updated)
      setBasicCents(null)
      setAllowanceCents(null)
      setEffectiveFrom('')
      setRateNote('')
      notifications.show({ color: 'green', title: 'Pay rate recorded', message: `Effective ${effectiveFrom}` })
    } catch (e) {
      notifications.show({
        color: 'red',
        title: 'Could not record the rate',
        message: e instanceof Error ? e.message : 'Something went wrong',
      })
    } finally {
      setAddingRate(false)
    }
  }

  function confirmRemoveRate(salaryId: string, from: string) {
    if (!employee) return
    modals.openConfirmModal({
      title: 'Remove this pay rate?',
      children: (
        <Text size="sm">
          The rate effective {from} will be deleted. Use this only for a rate entered
          by mistake — correcting an amount is done by re-entering the same start date.
        </Text>
      ),
      labels: { confirm: 'Remove', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => void employeeApi
        .removeSalary(employee.id, salaryId)
        .then(onSaved)
        .catch((e: unknown) => notifications.show({
          color: 'red',
          title: 'Could not remove',
          message: e instanceof Error ? e.message : 'Something went wrong',
        })),
    })
  }

  const history = employee.salaryHistory ?? []
  const current = currentSalary(history)

  return (
    <Modal
      opened
      onClose={onClose}
      title={
        <Stack gap={0}>
          <Text fw={700}>{employee.name}</Text>
          <Text size="xs" c="dimmed">HR record</Text>
        </Stack>
      }
      size="80%"
      centered
    >
      <Stack gap="md">
        {probation.state !== 'none' && (
          <Alert
            color={probation.state === 'overdue' ? 'red' : 'orange'}
            icon={<IconAlertTriangle size={18} />}
          >
            {probation.state === 'overdue'
              ? `Probation ended ${Math.abs(probation.daysLeft ?? 0)} day(s) ago and this record is still probationary. ` +
                'Staff not acted on by the deadline become regular by operation of law.'
              : `Probation ends in ${probation.daysLeft} day(s). Decide before the deadline — ` +
                'after it, regularisation happens whether or not it was intended.'}
          </Alert>
        )}

        <Divider label="Employment" labelPosition="left" />
        <Grid gap="sm">
          <Grid.Col span={{ base: 12, sm: 4 }}>
            <TextInput label="Date hired" type="date" {...field('dateHired')} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 4 }}>
            <Select
              label="Employment type"
              data={EMPLOYMENT_TYPES.map(t => ({ value: t, label: EMPLOYMENT_TYPE_LABELS[t] }))}
              value={form.employmentType}
              onChange={v => set('employmentType')(v ?? 'PROBATIONARY')}
              disabled={!canWriteHr}
              allowDeselect={false}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 4 }}>
            <TextInput
              label="Probation ends"
              type="date"
              description="Caps at six months by law"
              {...field('probationEndDate')}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 4 }}>
            <TextInput label="Regularised on" type="date" {...field('regularizedAt')} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 4 }}>
            <TextInput label="Separated on" type="date" {...field('separatedAt')} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 4 }}>
            <TextInput label="Reason for leaving" {...field('separationReason')} />
          </Grid.Col>
        </Grid>

        <Divider label="Government IDs" labelPosition="left" />
        <Grid gap="sm">
          <Grid.Col span={{ base: 12, sm: 3 }}>
            <TextInput label="SSS" placeholder="34-1234567-8" {...field('sssNumber')} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 3 }}>
            <TextInput label="PhilHealth" {...field('philhealthNumber')} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 3 }}>
            <TextInput label="Pag-IBIG" {...field('pagibigNumber')} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 3 }}>
            <TextInput label="TIN" {...field('tin')} />
          </Grid.Col>
        </Grid>

        <Divider label="Personal" labelPosition="left" />
        <Grid gap="sm">
          <Grid.Col span={{ base: 12, sm: 3 }}>
            <TextInput label="Date of birth" type="date" {...field('birthDate')} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 3 }}>
            <Select
              label="Civil status"
              data={CIVIL_STATUSES.map(c => ({ value: c, label: CIVIL_STATUS_LABELS[c] }))}
              value={form.civilStatus || null}
              onChange={v => set('civilStatus')((v as CivilStatus) ?? '')}
              disabled={!canWriteHr}
              clearable
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6 }}>
            <TextInput label="Contact number" {...field('contactNumber')} />
          </Grid.Col>
          <Grid.Col span={12}>
            <Textarea label="Address" autosize minRows={2} {...field('address')} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 4 }}>
            <TextInput label="Emergency contact" {...field('emergencyName')} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 4 }}>
            <TextInput label="Relationship" {...field('emergencyRelation')} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 4 }}>
            <TextInput label="Their number" {...field('emergencyContact')} />
          </Grid.Col>
        </Grid>

        <Divider label="How they are paid" labelPosition="left" />
        <Grid gap="sm">
          <Grid.Col span={{ base: 12, sm: 4 }}>
            <Select
              label="Payout method"
              data={PAYOUT_METHODS.map(m => ({ value: m, label: PAYOUT_METHOD_LABELS[m] }))}
              value={form.payoutMethod}
              onChange={v => set('payoutMethod')(v ?? 'CASH')}
              disabled={!canWriteHr}
              allowDeselect={false}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 8 }}>
            <TextInput
              label="Account"
              description="Bank account or e-wallet number, if not paid in cash"
              {...field('payoutAccount')}
            />
          </Grid.Col>
        </Grid>

        {canSeeSalary && (
          <>
            <Divider label="Pay rate" labelPosition="left" />
            {current ? (
              <Group gap="xs">
                <Text size="sm">Currently</Text>
                <Text size="sm" fw={700}>{formatMoney(current.basicCents)}</Text>
                <Text size="sm" c="dimmed">{SALARY_RATE_LABELS[current.rateType]}</Text>
                {current.allowanceCents > 0 && (
                  <Text size="sm" c="dimmed">+ {formatMoney(current.allowanceCents)} allowance</Text>
                )}
                <Badge size="sm" variant="light">since {current.effectiveFrom}</Badge>
              </Group>
            ) : (
              <Text size="sm" c="dimmed">No pay rate recorded yet.</Text>
            )}

            {history.length > 0 && (
              <Table.ScrollContainer minWidth={520}>
                <Table verticalSpacing="xs" striped="odd">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th w={120}>From</Table.Th>
                      <Table.Th w={130}>Basic</Table.Th>
                      <Table.Th w={130}>Allowance</Table.Th>
                      <Table.Th>Note</Table.Th>
                      {canWriteSalary && <Table.Th w={50} />}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {history.map(s => (
                      <Table.Tr key={s.id}>
                        <Table.Td><Text size="sm" ff="monospace">{s.effectiveFrom}</Text></Table.Td>
                        <Table.Td>
                          <Text size="sm">{formatMoney(s.basicCents)}</Text>
                          <Text size="xs" c="dimmed">{SALARY_RATE_LABELS[s.rateType]}</Text>
                        </Table.Td>
                        <Table.Td><Text size="sm">{formatMoney(s.allowanceCents)}</Text></Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed">
                            {s.note}
                            {s.recordedBy && (s.note ? ` — ${s.recordedBy.name}` : s.recordedBy.name)}
                          </Text>
                        </Table.Td>
                        {canWriteSalary && (
                          <Table.Td>
                            <Tooltip label="Remove — for a rate entered by mistake" withArrow>
                              <Button
                                variant="subtle"
                                color="red"
                                size="compact-xs"
                                onClick={() => confirmRemoveRate(s.id, s.effectiveFrom)}
                                aria-label={`Remove the rate effective ${s.effectiveFrom}`}
                              >
                                <IconTrash size={14} />
                              </Button>
                            </Tooltip>
                          </Table.Td>
                        )}
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}

            {canWriteSalary && (
              <Grid gap="sm" align="flex-end">
                <Grid.Col span={{ base: 12, sm: 3 }}>
                  <MoneyInput label="Basic" value={basicCents} onChange={setBasicCents} />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 3 }}>
                  <MoneyInput label="Allowance" value={allowanceCents} onChange={setAllowanceCents} />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 2 }}>
                  <Select
                    label="Per"
                    data={SALARY_RATE_TYPES.map(r => ({ value: r, label: SALARY_RATE_LABELS[r] }))}
                    value={rateType}
                    onChange={v => setRateType((v as SalaryRateType) ?? 'DAILY')}
                    allowDeselect={false}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 2 }}>
                  <TextInput
                    label="Effective from"
                    type="date"
                    value={effectiveFrom}
                    onChange={e => setEffectiveFrom(e.currentTarget.value)}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 2 }}>
                  <Button
                    fullWidth
                    leftSection={<IconPlus size={16} />}
                    disabled={basicCents === null || basicCents <= 0 || !effectiveFrom}
                    loading={addingRate}
                    onClick={() => void addRate()}
                  >
                    Add
                  </Button>
                </Grid.Col>
                <Grid.Col span={12}>
                  <TextInput
                    label="Why it changed"
                    placeholder="Regularised, annual increase, promoted…"
                    value={rateNote}
                    onChange={e => setRateNote(e.currentTarget.value)}
                  />
                </Grid.Col>
              </Grid>
            )}
            <Text size="xs" c="dimmed">
              Rates are kept as history. A new rate never rewrites an old one, so past
              payroll keeps the figure it was actually computed on.
            </Text>
          </>
        )}

        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={onClose}>Close</Button>
          {canWriteHr && (
            <Button loading={saving} onClick={() => void save()}>Save record</Button>
          )}
        </Group>
      </Stack>
    </Modal>
  )
}
