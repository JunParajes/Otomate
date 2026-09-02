import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ActionIcon, Alert, Badge, Button, Center, Group, Loader, Modal, Select, Stack, Table, Text,
  Title, Tooltip,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconAlertTriangle, IconArrowLeft, IconCheck } from '@tabler/icons-react'
import {
  WORK_DAY_HINTS, WORK_DAY_LABELS, WORK_DAY_MARKS, WORK_DAY_STATUSES,
  WORK_SCHEDULE_STATUS_LABELS, formatCutoff,
  type WorkDayStatus, type WorkSchedule, type WorkScheduleEntryInput, type WorkScheduleRow,
} from '@otomate/shared'
import { workScheduleApi } from '@/lib/work-schedule'
import { adminApi } from '@/lib/admin'
import { useResource } from '@/hooks/useResource'
import { useSession } from '@/lib/session'
import StickyActionBar, { pageWithActionBar } from '@/components/StickyActionBar'
import classes from './WorkSchedulePage.module.css'

const STATUS_COLOUR = { DRAFT: 'gray', SUBMITTED: 'orange', APPROVED: 'green' } as const
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** A pending change to one cell, keyed by `${employeeId}|${day}`. */
type Draft = Map<string, WorkScheduleEntryInput>
const keyOf = (employeeId: string, day: string) => `${employeeId}|${day}`

/**
 * The grid: one row per employee, one column per day of the cutoff.
 *
 * This is the plan, and only the plan. Absences, half-days and suspensions are
 * what HAPPENED, and putting them in these cells is exactly what made the
 * spreadsheet unusable — by Wednesday the original plan had been edited away and
 * nobody could see what had been intended.
 *
 * Cells are plain buttons and only one editor exists at a time. A full cutoff is
 * eighty-odd staff across seven days, so a popover per cell would be six hundred
 * mounted components for the sake of the one being tapped.
 */
export default function WorkSchedulePage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { can } = useSession()
  const [schedule, setSchedule] = useState<WorkSchedule | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(new Map())
  const [editing, setEditing] = useState<{ row: WorkScheduleRow; day: string } | null>(null)
  const [viewing, setViewing] = useState<WorkScheduleRow | null>(null)
  const [saving, setSaving] = useState(false)
  const branches = useResource(adminApi.listBranches)
  const dirtyRef = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setSchedule(await workScheduleApi.get(id))
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load this schedule')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { void load() }, [load])

  // Same guard as the 201 file: a cutoff is a lot of decisions to lose to a
  // stray reload.
  useEffect(() => {
    if (!dirtyRef.current) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  })

  const approved = schedule?.status === 'APPROVED'
  const canWrite = can('schedule:write') && (!approved || can('schedule:approve'))
  const canApprove = can('schedule:approve')

  /** Rows grouped by branch, the way the spreadsheet reads. */
  const groups = useMemo(() => {
    const out = new Map<string, WorkScheduleRow[]>()
    for (const row of schedule?.rows ?? []) {
      const name = row.branch?.name ?? 'Unassigned'
      out.set(name, [...(out.get(name) ?? []), row])
    }
    return [...out.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [schedule])

  /** What a cell shows: the pending edit if there is one, else what was saved. */
  function cellOf(row: WorkScheduleRow, day: string) {
    const pending = draft.get(keyOf(row.employeeId, day))
    const saved = row.days[day]
    if (pending) {
      return {
        status: pending.status,
        branchName: pending.assignedBranchId
          ? branches.data?.find(b => b.id === pending.assignedBranchId)?.name ?? null
          : null,
        partner: null as string | null,
        pending: true,
      }
    }
    if (!saved) return { status: null, branchName: null, partner: null, pending: false }
    return {
      status: saved.status,
      branchName: saved.assignedBranch?.name ?? null,
      partner: saved.coveredBy?.name ?? saved.pairedWith?.name ?? null,
      pending: false,
    }
  }

  function setCell(row: WorkScheduleRow, day: string, patch: Partial<WorkScheduleEntryInput>) {
    setDraft(prev => {
      const next = new Map(prev)
      const key = keyOf(row.employeeId, day)
      const base: WorkScheduleEntryInput = next.get(key) ?? {
        employeeId: row.employeeId,
        day,
        status: row.days[day]?.status ?? 'SCHEDULED',
        assignedBranchId: row.days[day]?.assignedBranch?.id ?? null,
        coveredById: row.days[day]?.coveredBy?.id ?? null,
        pairedWithId: row.days[day]?.pairedWith?.id ?? null,
      }
      next.set(key, { ...base, ...patch })
      return next
    })
  }

  async function save() {
    if (!schedule || draft.size === 0) return
    setSaving(true)
    try {
      const updated = await workScheduleApi.saveEntries(schedule.id, { entries: [...draft.values()] })
      setSchedule(updated)
      setDraft(new Map())
      notifications.show({ color: 'green', title: 'Saved', message: `${draft.size} change(s)` })
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

  async function setStatus(status: WorkSchedule['status'], message: string) {
    if (!schedule) return
    setSaving(true)
    try {
      setSchedule(await workScheduleApi.update(schedule.id, { status }))
      notifications.show({ color: 'green', title: message, message: formatCutoff(schedule.weekStart) })
    } catch (e) {
      notifications.show({
        color: 'red',
        title: 'Could not change the status',
        message: e instanceof Error ? e.message : 'Something went wrong',
      })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Center py="xl"><Loader /></Center>
  if (loadError || !schedule) {
    return (
      <Stack gap="md">
        <Group gap="sm">
          <ActionIcon variant="subtle" color="gray" onClick={() => navigate('/hr/work-schedule')} aria-label="Back">
            <IconArrowLeft size={18} />
          </ActionIcon>
          <Title order={2} size="h4">Work schedule</Title>
        </Group>
        <Alert color="red" title="Could not load">{loadError ?? 'That schedule does not exist.'}</Alert>
      </Stack>
    )
  }

  const dirty = draft.size > 0
  dirtyRef.current = dirty
  const staffOptions = (schedule.rows ?? []).map(r => ({ value: r.employeeId, label: r.name }))
  const branchOptions = (branches.data ?? []).map(b => ({ value: b.id, label: b.name }))

  return (
    <Stack gap="md" className={canWrite ? pageWithActionBar : undefined}>
      <Group gap="sm" wrap="nowrap">
        <ActionIcon variant="subtle" color="gray" onClick={() => navigate('/hr/work-schedule')} aria-label="Back to schedules">
          <IconArrowLeft size={18} />
        </ActionIcon>
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Group gap="xs" wrap="nowrap">
            <Title order={2} size="h4">{formatCutoff(schedule.weekStart)}</Title>
            <Badge variant="light" color={STATUS_COLOUR[schedule.status]}>
              {WORK_SCHEDULE_STATUS_LABELS[schedule.status]}
            </Badge>
          </Group>
          <Text size="sm" c="dimmed">
            {schedule.approvedBy
              ? `Approved by ${schedule.approvedBy.name}`
              : schedule.createdBy ? `Drafted by ${schedule.createdBy.name}` : 'The plan for this cutoff'}
          </Text>
        </Stack>
      </Group>

      {approved && (
        <Alert color="green" icon={<IconCheck size={18} />}>
          This plan is approved and is now a record of what was intended. Changes to what actually
          happens during the cutoff belong in the actuals, not here.
        </Alert>
      )}

      <Table.ScrollContainer minWidth={900}>
        <Table withTableBorder highlightOnHover verticalSpacing={6} className={classes.grid}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th className={classes.nameCol}>Employee</Table.Th>
              {schedule.days.map(d => {
                const date = new Date(`${d}T00:00:00.000Z`)
                return (
                  <Table.Th key={d} w={78} ta="center">
                    <Text size="xs" fw={700}>{DAY_NAMES[date.getUTCDay()]}</Text>
                    <Text size="xs" c="dimmed">{d.slice(8)}/{d.slice(5, 7)}</Text>
                  </Table.Th>
                )
              })}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {groups.map(([branchName, rows]) => (
              <>
                <Table.Tr key={`h-${branchName}`}>
                  <Table.Td colSpan={1 + schedule.days.length} className={classes.groupRow}>
                    <Text size="xs" fw={700} tt="uppercase">{branchName}</Text>
                  </Table.Td>
                </Table.Tr>
                {rows.map(row => (
                  <Table.Tr key={row.employeeId}>
                    <Table.Td className={classes.nameCol}>
                      {/*
                        The name opens the person's details rather than the grid
                        carrying columns for them. Address and contact numbers
                        are needed occasionally — when deciding who can cover an
                        early shift — and permanently on screen they are eighty
                        rows of noise in the way of the week.
                      */}
                      <button
                        type="button"
                        className={classes.nameButton}
                        onClick={() => setViewing(row)}
                        aria-label={`Details for ${row.name}`}
                      >
                        <Group gap={6} wrap="nowrap">
                          <Text size="sm" fw={500}>{row.name}</Text>
                          {row.underOneMonth && (
                            <Tooltip label="Under one month — no holiday pay or offsetting yet" withArrow>
                              <Badge size="xs" variant="light" color="orange">new</Badge>
                            </Tooltip>
                          )}
                        </Group>
                        <Text size="xs" c="dimmed">{row.position}</Text>
                      </button>
                    </Table.Td>
                    {schedule.days.map(d => {
                      const cell = cellOf(row, d)
                      return (
                        <Table.Td key={d} p={2}>
                          <button
                            type="button"
                            className={`${classes.cell} ${cell.pending ? classes.pending : ''}`}
                            data-status={cell.status ?? 'NONE'}
                            disabled={!canWrite}
                            aria-label={`${row.name}, ${d}: ${cell.status ? WORK_DAY_LABELS[cell.status] : 'not set'}`}
                            onClick={() => setEditing({ row, day: d })}
                          >
                            <span className={classes.mark}>
                              {cell.status ? WORK_DAY_MARKS[cell.status] : '·'}
                            </span>
                            {cell.branchName && <span className={classes.sub}>{cell.branchName}</span>}
                            {cell.partner && <span className={classes.sub}>{cell.partner.split(' ')[0]}</span>}
                          </button>
                        </Table.Td>
                      )
                    })}
                  </Table.Tr>
                ))}
              </>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      {/*
        Their record, from the 201 file — not a second copy kept here.
        The section is omitted server-side without hr:read, so a caller who can
        plan the week but is not entitled to staff records simply has no button
        to press.
      */}
      <Modal
        opened={viewing !== null}
        onClose={() => setViewing(null)}
        title={viewing?.name ?? ''}
        centered
      >
        {viewing && (
          <Stack gap="md">
            <Group gap="xs">
              <Badge variant="light" color="gray">{viewing.position}</Badge>
              <Badge variant="light">{viewing.branch?.name ?? 'Unassigned'}</Badge>
            </Group>

            {viewing.details ? (
              <>
                <Stack gap={2}>
                  <Text size="xs" c="dimmed">Date hired</Text>
                  <Group gap="xs">
                    <Text size="sm">{viewing.details.dateHired ?? 'Not recorded'}</Text>
                    <Badge
                      size="sm"
                      variant="light"
                      color={viewing.underOneMonth ? 'orange' : 'green'}
                    >
                      {viewing.underOneMonth ? 'Under one month' : 'Over one month'}
                    </Badge>
                  </Group>
                  <Text size="xs" c="dimmed">
                    {viewing.underOneMonth
                      ? 'Not eligible for holiday pay or offsetting yet.'
                      : 'Eligible for holiday pay and offsetting.'}
                  </Text>
                </Stack>

                <Stack gap={2}>
                  <Text size="xs" c="dimmed">Address</Text>
                  <Text size="sm">{viewing.details.address || 'Not recorded'}</Text>
                </Stack>

                <Stack gap={2}>
                  <Text size="xs" c="dimmed">Contact numbers</Text>
                  {viewing.details.contacts.length === 0 && (
                    <Text size="sm" c="dimmed">None recorded</Text>
                  )}
                  {viewing.details.contacts.map((c, i) => (
                    <Group key={i} gap="xs">
                      <Text size="sm" ff="monospace">{c.number}</Text>
                      {c.label && <Badge size="xs" variant="light" color="gray">{c.label}</Badge>}
                    </Group>
                  ))}
                </Stack>
              </>
            ) : (
              <Text size="sm" c="dimmed">
                Their address and contact numbers are part of the HR record, which needs the
                HR permission to view.
              </Text>
            )}

            <Group justify="flex-end">
              {can('hr:read') && (
                <Button
                  variant="default"
                  onClick={() => navigate(`/admin/employees/${viewing.employeeId}`)}
                >
                  Open full record
                </Button>
              )}
              <Button onClick={() => setViewing(null)}>Close</Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal
        opened={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? `${editing.row.name} — ${editing.day}` : ''}
        centered
      >
        {editing && (() => {
          const cur = draft.get(keyOf(editing.row.employeeId, editing.day))
          const saved = editing.row.days[editing.day]
          const status = cur?.status ?? saved?.status ?? 'SCHEDULED'
          const assigned = cur?.assignedBranchId ?? saved?.assignedBranch?.id ?? null
          const partner = status === 'OFF'
            ? cur?.coveredById ?? saved?.coveredBy?.id ?? null
            : cur?.pairedWithId ?? saved?.pairedWith?.id ?? null
          return (
            <Stack gap="md">
              <Stack gap={6}>
                {WORK_DAY_STATUSES.map(s => (
                  <Button
                    key={s}
                    variant={status === s ? 'filled' : 'default'}
                    justify="space-between"
                    rightSection={<Text size="xs" c={status === s ? undefined : 'dimmed'}>{WORK_DAY_MARKS[s]}</Text>}
                    onClick={() => setCell(editing.row, editing.day, { status: s })}
                  >
                    <Stack gap={0} align="flex-start">
                      <Text size="sm">{WORK_DAY_LABELS[s]}</Text>
                      <Text size="xs" c={status === s ? undefined : 'dimmed'} ta="left">{WORK_DAY_HINTS[s]}</Text>
                    </Stack>
                  </Button>
                ))}
              </Stack>

              <Select
                label="Working at another branch"
                description="Leave blank for their own branch"
                data={branchOptions}
                value={assigned}
                onChange={v => setCell(editing.row, editing.day, { assignedBranchId: v })}
                clearable
                searchable
              />

              <Select
                label={status === 'OFF' ? 'Covered by' : 'Working with'}
                description={
                  status === 'OFF'
                    ? 'Who takes the shift while they are off'
                    : 'A colleague rostered alongside them'
                }
                data={staffOptions.filter(o => o.value !== editing.row.employeeId)}
                value={partner}
                onChange={v =>
                  setCell(editing.row, editing.day,
                    status === 'OFF' ? { coveredById: v } : { pairedWithId: v })
                }
                clearable
                searchable
              />

              <Group justify="flex-end">
                <Button onClick={() => setEditing(null)}>Done</Button>
              </Group>
            </Stack>
          )
        })()}
      </Modal>

      {canWrite && (
        <StickyActionBar
          status={
            dirty
              ? <Text size="sm" c="orange" fw={500}>{draft.size} unsaved change(s)</Text>
              : <Text size="sm" c="dimmed">No changes</Text>
          }
        >
          <Button variant="default" onClick={() => navigate('/hr/work-schedule')}>Back</Button>
          {schedule.status === 'DRAFT' && !dirty && (
            <Button variant="light" onClick={() => void setStatus('SUBMITTED', 'Submitted for approval')} loading={saving}>
              Submit
            </Button>
          )}
          {schedule.status === 'SUBMITTED' && canApprove && (
            <Button
              variant="light"
              color="green"
              leftSection={<IconCheck size={16} />}
              onClick={() => void setStatus('APPROVED', 'Approved')}
              loading={saving}
            >
              Approve
            </Button>
          )}
          {approved && canApprove && (
            <Button
              variant="light"
              color="orange"
              leftSection={<IconAlertTriangle size={16} />}
              onClick={() => void setStatus('DRAFT', 'Reopened as a draft')}
              loading={saving}
            >
              Reopen
            </Button>
          )}
          <Button onClick={() => void save()} loading={saving} disabled={!dirty}>Save</Button>
        </StickyActionBar>
      )}
    </Stack>
  )
}
