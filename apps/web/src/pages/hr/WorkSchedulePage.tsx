import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ActionIcon, Alert, Badge, Button, Card, Center, Group, Loader, Modal, Select, SimpleGrid, Stack,
  Table, Text, Textarea, Title, Tooltip,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { modals } from '@mantine/modals'
import { IconAlertTriangle, IconArrowLeft, IconCheck, IconCircleCheck } from '@tabler/icons-react'
import {
  WORK_DAY_HINTS, WORK_DAY_LABELS, WORK_DAY_MARKS, WORK_DAY_STATUSES,
  WORK_SCHEDULE_STATUS_LABELS, cutoffCode, formatCutoff, formatCutoffLabel,
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

/** "Thu 10 Sep" — the dialog says which day it is editing, not just a date. */
function formatDayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`)
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${month[d.getUTCMonth()]}`
}

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
  const [info, setInfo] = useState<{ row: WorkScheduleRow; day: string } | null>(null)
  /**
   * Which branch's grid is open. null shows the branch list instead — eighty
   * staff in one table is a scroll, and a branch manager only ever wants their
   * own. 'ALL' is the whole company, one card per branch.
   *
   * Held in the URL rather than in state so a reload keeps you where you were,
   * and so a branch's week can be linked to. As component state, refreshing
   * mid-edit dropped you back to the branch list.
   */
  const [params, setParams] = useSearchParams()
  const openBranch = params.get('branch')
  const setOpenBranch = (branch: string | null) => {
    const next = new URLSearchParams(params)
    if (branch === null) next.delete('branch')
    else next.set('branch', branch)
    setParams(next, { replace: true })
  }
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
    // Derived from someone else's off day, so it applies whether or not this
    // person has an entry of their own yet.
    const cover = row.covering[day] ?? null
    const nameOf = (id: string | null | undefined) =>
      id ? schedule?.rows?.find(r => r.employeeId === id)?.name ?? null : null

    /**
     * Whether there is an "i" at all, and what colour it takes. Sent elsewhere
     * and covering for someone are the two a planner scans for, so each keeps a
     * colour; anything else is a neutral note.
     */
    const kindOf = (branchName: string | null, partner: string | null, remarks: string | null) =>
      branchName ? 'branch' : cover ? 'cover' : partner || remarks ? 'note' : null

    if (pending) {
      return {
        status: pending.status,
        branchName: pending.assignedBranchId
          ? branches.data?.find(b => b.id === pending.assignedBranchId)?.name ?? null
          : null,
        partner: pending.status === 'OFF' ? nameOf(pending.coveredById) : nameOf(pending.pairedWithId),
        partnerLabel: pending.status === 'OFF' ? 'Cover' : 'With',
        cover,
        remarks: pending.remarks ?? null,
        detailKind: kindOf(
          pending.assignedBranchId
            ? branches.data?.find(b => b.id === pending.assignedBranchId)?.name ?? null
            : null,
          pending.status === 'OFF' ? nameOf(pending.coveredById) : nameOf(pending.pairedWithId),
          pending.remarks ?? null
        ),
        pending: true,
      }
    }
    if (!saved) {
      return {
        status: null, branchName: null, partner: null, partnerLabel: '',
        cover, remarks: null, detailKind: kindOf(null, null, null), pending: false,
      }
    }
    return {
      status: saved.status,
      branchName: saved.assignedBranch?.name ?? null,
      partner: saved.status === 'OFF' ? saved.coveredBy?.name ?? null : saved.pairedWith?.name ?? null,
      partnerLabel: saved.status === 'OFF' ? 'Cover' : 'With',
      cover,
      remarks: saved.remarks,
      detailKind: kindOf(
        saved.assignedBranch?.name ?? null,
        saved.status === 'OFF' ? saved.coveredBy?.name ?? null : saved.pairedWith?.name ?? null,
        saved.remarks
      ),
      pending: false,
    }
  }

  /** First name only — the grid is scanned, and surnames repeat across families. */
  const firstName = (full: string) => full.split(' ')[0] ?? full

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

  async function setBranchPlanned(branchId: string, planned: boolean) {
    if (!schedule) return
    setSaving(true)
    try {
      setSchedule(await workScheduleApi.setBranchPlanned(schedule.id, branchId, planned))
    } catch (e) {
      notifications.show({
        color: 'red',
        title: 'Could not update the branch',
        message: e instanceof Error ? e.message : 'Something went wrong',
      })
    } finally {
      setSaving(false)
    }
  }

  /**
   * Submitting sends every branch, so anything left unplanned goes for approval
   * unnoticed. Name them and make it a decision rather than a surprise — a
   * branch with genuinely nothing to change is legitimate, so this asks rather
   * than blocks.
   */
  function submitForApproval() {
    const pending = (schedule?.branches ?? []).filter(b => !b.planned)
    if (pending.length === 0) {
      void setStatus('SUBMITTED', 'Submitted for approval')
      return
    }
    modals.openConfirmModal({
      title: 'Some branches are not marked as planned',
      children: (
        <Stack gap="xs">
          <Text size="sm">
            {pending.length} branch(es) have not been marked as planned for this cutoff:
          </Text>
          <Text size="sm" fw={500}>{pending.map(b => b.branchName).join(', ')}</Text>
          <Text size="sm" c="dimmed">
            Submitting sends the whole cutoff, these branches included, exactly as they stand.
          </Text>
        </Stack>
      ),
      labels: { confirm: 'Submit anyway', cancel: 'Go back' },
      confirmProps: { color: 'orange' },
      onConfirm: () => void setStatus('SUBMITTED', 'Submitted for approval'),
    })
  }

  async function setStatus(status: WorkSchedule['status'], message: string) {
    if (!schedule) return
    setSaving(true)
    try {
      setSchedule(await workScheduleApi.update(schedule.id, { status }))
      notifications.show({ color: 'green', title: message, message: formatCutoffLabel(schedule.weekStart) })
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
  /**
   * Colleagues to pick from, GROUPED BY BRANCH with their own branch first.
   *
   * Seventy-six names in one flat list is a scroll, and the answer is nearly
   * always someone from the same branch — so that group sits at the top instead
   * of alphabetically among ten others. Filed names, because a list is scanned.
   */
  function colleagueOptions(row: WorkScheduleRow) {
    const byBranch = new Map<string, { value: string; label: string }[]>()
    for (const r of schedule?.rows ?? []) {
      if (r.employeeId === row.employeeId) continue
      const branch = r.branch?.name ?? 'Unassigned'
      byBranch.set(branch, [...(byBranch.get(branch) ?? []), { value: r.employeeId, label: r.nameFiled }])
    }
    const own = row.branch?.name ?? 'Unassigned'
    return [...byBranch.entries()]
      .sort(([a], [b]) => (a === own ? -1 : b === own ? 1 : a.localeCompare(b)))
      .map(([branch, items]) => ({
        group: branch === own ? `${branch} — same branch` : branch,
        items: items.sort((x, y) => x.label.localeCompare(y.label)),
      }))
  }
  const branchOptions = (branches.data ?? []).map(b => ({ value: b.id, label: b.name }))

  return (
    <Stack gap="md" className={canWrite ? pageWithActionBar : undefined}>
      <Group gap="sm" wrap="nowrap">
        <ActionIcon variant="subtle" color="gray" onClick={() => navigate('/hr/work-schedule')} aria-label="Back to schedules">
          <IconArrowLeft size={18} />
        </ActionIcon>
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Group gap="xs" wrap="nowrap">
            <Badge variant="light" color="blue" size="lg">{cutoffCode(schedule.weekStart)}</Badge>
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

      {/*
        The branch list, not the whole company by default.

        Eighty-odd staff in one table is a scroll on any screen, and whoever is
        planning almost always wants one branch. "All branches" is still there,
        as a card per branch — the same shape the 201 file uses for its sections,
        so a long page stays readable instead of being one unbroken grid.
      */}
      {openBranch === null ? (
        <Stack gap="sm">
          <Card withBorder padding="md" radius="md" className={classes.branchCard} onClick={() => setOpenBranch('ALL')}>
            <Group justify="space-between" wrap="nowrap">
              <Stack gap={2}>
                <Text fw={600}>All branches</Text>
                <Text size="xs" c="dimmed">Every branch, one card each</Text>
              </Stack>
              <Badge variant="light">{schedule.rows?.length ?? 0} staff</Badge>
            </Group>
          </Card>
          {(schedule.branches ?? []).map(b => (
            <Card
              key={b.branchName}
              withBorder
              padding="md"
              radius="md"
              className={classes.branchCard}
              onClick={() => setOpenBranch(b.branchName)}
            >
              <Group justify="space-between" wrap="nowrap">
                <Group gap="xs" wrap="nowrap">
                  {b.planned
                    ? <IconCircleCheck size={18} color="var(--mantine-color-green-6)" />
                    : <IconAlertTriangle size={18} color="var(--mantine-color-gray-5)" />}
                  <Text fw={500}>{b.branchName}</Text>
                </Group>
                <Group gap="xs">
                  <Badge
                    size="sm"
                    variant="light"
                    color={b.planned ? 'green' : 'gray'}
                  >
                    {b.planned ? 'Planned' : 'Not planned yet'}
                  </Badge>
                  <Badge variant="light" color="gray">{b.staffCount} staff</Badge>
                </Group>
              </Group>
            </Card>
          ))}
        </Stack>
      ) : (
        <Stack gap="md">
          <Group gap="xs">
            <Button variant="subtle" size="compact-sm" leftSection={<IconArrowLeft size={14} />} onClick={() => setOpenBranch(null)}>
              All branches
            </Button>
            <Text size="sm" c="dimmed">
              {openBranch === 'ALL' ? 'Every branch' : openBranch}
            </Text>
          </Group>

          {(openBranch === 'ALL' ? groups : groups.filter(([name]) => name === openBranch))
            .map(([groupName, groupRows]) => (
              <Card key={groupName} withBorder padding="md" radius="md">
                <Stack gap="sm">
                  <Group justify="space-between" wrap="nowrap">
                    <Title order={5}>{groupName}</Title>
                    {(() => {
                      const state = (schedule.branches ?? []).find(b => b.branchName === groupName)
                      if (!state?.branchId || !canWrite) return null
                      return state.planned ? (
                        <Button
                          size="compact-sm"
                          variant="light"
                          color="green"
                          leftSection={<IconCircleCheck size={15} />}
                          onClick={() => void setBranchPlanned(state.branchId!, false)}
                          loading={saving}
                        >
                          Planned{state.plannedBy ? ` by ${state.plannedBy.name}` : ''}
                        </Button>
                      ) : (
                        <Button
                          size="compact-sm"
                          variant="default"
                          onClick={() => void setBranchPlanned(state.branchId!, true)}
                          loading={saving}
                        >
                          Mark as planned
                        </Button>
                      )
                    })()}
                  </Group>
          <Table.ScrollContainer minWidth={850}>
            {/* No highlightOnHover: lighting up a whole row of eighty is noise, and
                  the cell being pointed at is the thing that matters. */}
                <Table withTableBorder verticalSpacing={6} className={classes.grid}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th className={classes.nameCol}>Employee</Table.Th>
                  {schedule.days.map(d => {
                    const date = new Date(`${d}T00:00:00.000Z`)
                    return (
                      <Table.Th key={d} w={96} ta="center">
                        <Text size="xs" fw={700}>{DAY_NAMES[date.getUTCDay()]}</Text>
                        <Text size="xs" c="dimmed">{d.slice(8)}/{d.slice(5, 7)}</Text>
                      </Table.Th>
                    )
                  })}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {groupRows.map(row => (
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
                              {/*
                                Filed form — "Espinosa, Edgar C." A full name with
                                a middle name wraps to three lines in this column,
                                which makes every row a different height and the
                                grid much taller than the week it shows. The full
                                name is on the details panel.
                              */}
                              <Text size="sm" fw={500} lineClamp={1} style={{ minWidth: 0 }}>
                                {row.nameFiled}
                              </Text>
                              {row.eligibility === 'UNDER_ONE_MONTH' && (
                                <Tooltip label="Under one month — no holiday pay or offsetting yet" withArrow>
                                  <Badge size="xs" variant="light" color="orange">new</Badge>
                                </Tooltip>
                              )}
                              {row.eligibility === 'NO_HIRE_DATE' && (
                                <Tooltip label="No hire date on record — eligibility unknown" withArrow>
                                  <Badge size="xs" variant="light" color="gray">?</Badge>
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
                              {/*
                                The "i" is a SIBLING of the cell button, not inside it — a button
                                within a button is invalid and the browser drops the inner one.
                              */}
                              <div className={classes.cellWrap}>
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
                                </button>
                                {/*
                                  Everything else moved behind this. As three lines of 10px text
                                  inside a 96px cell the detail was present but not readable, which
                                  is the worst of both — it took the space and still had to be
                                  squinted at.
                                */}
                                {cell.detailKind && (
                                  <button
                                    type="button"
                                    className={classes.info}
                                    data-kind={cell.detailKind}
                                    aria-label={`Day details for ${row.name}, ${formatDayLabel(d)}`}
                                    onClick={e => { e.stopPropagation(); setInfo({ row, day: d }) }}
                                  >
                                    i
                                  </button>
                                )}
                              </div>
                            </Table.Td>
                          )
                        })}
                      </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
                </Stack>
              </Card>
            ))}
        </Stack>
      )}

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
                  {/*
                    No hire date is its own answer. It used to fall through to
                    "Over one month", which told the planner something confident
                    and wrong about someone nobody had recorded a start date for.
                  */}
                  {viewing.eligibility === 'NO_HIRE_DATE' ? (
                    <Alert color="orange" icon={<IconAlertTriangle size={16} />} p="xs">
                      <Text size="sm" fw={500}>No date hired on record</Text>
                      <Text size="xs">
                        Add it to their record before planning around holiday pay or offsetting —
                        eligibility cannot be worked out without it.
                      </Text>
                    </Alert>
                  ) : (
                    <>
                      <Group gap="xs">
                        <Text size="sm">{viewing.details.dateHired}</Text>
                        <Badge
                          size="sm"
                          variant="light"
                          color={viewing.eligibility === 'UNDER_ONE_MONTH' ? 'orange' : 'green'}
                        >
                          {viewing.eligibility === 'UNDER_ONE_MONTH' ? 'Under one month' : 'Over one month'}
                        </Badge>
                      </Group>
                      <Text size="xs" c="dimmed">
                        {viewing.eligibility === 'UNDER_ONE_MONTH'
                          ? 'Not eligible for holiday pay or offsetting yet.'
                          : 'Eligible for holiday pay and offsetting.'}
                      </Text>
                    </>
                  )}
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

      {/*
        Wide, and laid out in two columns. As a narrow column this ran to five
        stacked buttons and two more fields below the fold, so setting one day
        meant scrolling inside a dialog — on a tablet, with the grid behind it.
      */}
      <Modal
        opened={editing !== null}
        onClose={() => setEditing(null)}
        size={900}
        title={
          editing ? (
            <Group gap="xs">
              <Text fw={600}>{editing.row.name}</Text>
              <Badge variant="light" color="gray">{editing.row.position}</Badge>
              <Text c="dimmed">·</Text>
              <Text fw={500}>{formatDayLabel(editing.day)}</Text>
            </Group>
          ) : ''
        }
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
            <Stack gap="lg">
              <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xs">
                {WORK_DAY_STATUSES.map(s => (
                  <Button
                    key={s}
                    h="auto"
                    py={8}
                    variant={status === s ? 'filled' : 'default'}
                    justify="space-between"
                    rightSection={<Text size="sm" fw={700} c={status === s ? undefined : 'dimmed'}>{WORK_DAY_MARKS[s]}</Text>}
                    onClick={() => setCell(editing.row, editing.day, { status: s })}
                  >
                    <Stack gap={0} align="flex-start" style={{ whiteSpace: 'normal' }}>
                      <Text size="sm" fw={600}>{WORK_DAY_LABELS[s]}</Text>
                      <Text size="xs" c={status === s ? undefined : 'dimmed'} ta="left">{WORK_DAY_HINTS[s]}</Text>
                    </Stack>
                  </Button>
                ))}
              </SimpleGrid>

              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                <Select
                  label="Working at another branch"
                  description="Leave blank for their own branch"
                  placeholder="Their own branch"
                  // Their own branch is not "another" one — offering it invites a
                  // choice that means nothing and reads as a transfer in the grid.
                  data={branchOptions.filter(b => b.value !== editing.row.branch?.id)}
                  value={assigned}
                  onChange={v => setCell(editing.row, editing.day, { assignedBranchId: v })}
                  clearable
                  searchable
                  maxDropdownHeight={280}
                />

                <Select
                  label={status === 'OFF' ? 'Covered by' : 'Working with'}
                  description={
                    status === 'OFF'
                      ? 'Who takes the shift while they are off'
                      : 'A colleague rostered alongside them'
                  }
                  placeholder="Type a surname"
                  data={colleagueOptions(editing.row)}
                  value={partner}
                  onChange={v =>
                    setCell(editing.row, editing.day,
                      status === 'OFF' ? { coveredById: v } : { pairedWithId: v })
                  }
                  clearable
                  searchable
                  // Names are filed surname-first, so typing a surname narrows
                  // straight away — which is how anyone looks for a person here.
                  nothingFoundMessage="No one by that name"
                  limit={200}
                  maxDropdownHeight={300}
                />
              </SimpleGrid>

              {/*
                A note against the day itself, from whoever drafted it or the
                approver. It is part of the PLAN — "asked for the morning,
                clinic after" is a reason for the roster, not a record of what
                happened.
              */}
              <Textarea
                label="Remarks"
                description="Why this day is planned this way — visible to the approver"
                placeholder="Optional"
                autosize
                minRows={2}
                maxRows={4}
                value={cur?.remarks ?? saved?.remarks ?? ''}
                onChange={e => setCell(editing.row, editing.day, { remarks: e.currentTarget.value })}
              />

              <Group justify="flex-end">
                <Button onClick={() => setEditing(null)}>Done</Button>
              </Group>
            </Stack>
          )
        })()}
      </Modal>

      {/*
        What the "i" opens: the day's detail in a size that can be read, rather
        than three lines of 10px text crammed into a 96px cell.
      */}
      <Modal
        opened={info !== null}
        onClose={() => setInfo(null)}
        size={520}
        title={
          info ? (
            <Group gap="xs">
              <Text fw={600}>{info.row.name}</Text>
              <Text c="dimmed">·</Text>
              <Text fw={500}>{formatDayLabel(info.day)}</Text>
            </Group>
          ) : ''
        }
        centered
      >
        {info && (() => {
          const cell = cellOf(info.row, info.day)
          const rowOf = (label: string, value: React.ReactNode) => (
            <Group gap="sm" wrap="nowrap" align="flex-start">
              <Text size="sm" c="dimmed" w={130} style={{ flexShrink: 0 }}>{label}</Text>
              <Text size="sm" fw={500}>{value}</Text>
            </Group>
          )
          return (
            <Stack gap="sm">
              {rowOf('Planned as', cell.status ? WORK_DAY_LABELS[cell.status] : 'Not set')}
              {cell.branchName && rowOf('Working at', cell.branchName)}
              {cell.partner && rowOf(cell.partnerLabel === 'Cover' ? 'Covered by' : 'Working with', cell.partner)}
              {cell.cover && rowOf(
                'Covering for',
                `${cell.cover.employeeName}${cell.cover.branchName ? ` at ${cell.cover.branchName}` : ''}`
              )}
              {cell.remarks && (
                <Stack gap={2} mt="xs">
                  <Text size="sm" c="dimmed">Remarks</Text>
                  <Text size="sm">{cell.remarks}</Text>
                </Stack>
              )}
              <Group justify="flex-end" mt="sm">
                {canWrite && (
                  <Button
                    variant="default"
                    onClick={() => { const target = info; setInfo(null); setEditing(target) }}
                  >
                    Edit this day
                  </Button>
                )}
                <Button onClick={() => setInfo(null)}>Close</Button>
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
            <Button variant="light" onClick={submitForApproval} loading={saving}>
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
