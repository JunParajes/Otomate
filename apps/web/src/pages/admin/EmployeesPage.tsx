import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ActionIcon, Badge, Button, Card, Checkbox, Grid, Group, Modal, Progress, ScrollArea, SegmentedControl,
  Select, Stack, Switch, Table, Text, TextInput, Title, Tooltip, UnstyledButton,
} from '@mantine/core'
import { useForm } from '@mantine/form'
// zod4Resolver, not zodResolver: the latter reads error.errors (zod 3);
// on zod 4 that is undefined and validation throws instead of showing messages.
import { zod4Resolver as zodResolver } from 'mantine-form-zod-resolver'
import { notifications } from '@mantine/notifications'
import { modals } from '@mantine/modals'
import {
  IconId, IconLayoutGrid, IconLayoutList, IconLink, IconPlus, IconSearch, IconUserCheck,
  IconUserOff, IconX,
} from '@tabler/icons-react'
import {
  createEmployeeSchema, EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABELS, formatEmployeeName,
  GENDERS, GENDER_LABELS, type Employee,
} from '@otomate/shared'
import { employeeApi, positionApi } from '@/lib/employees'
import RowActionsSheet, { rowActionProps, type RowAction } from '@/components/RowActionsSheet'
import { adminApi } from '@/lib/admin'
import { useResource } from '@/hooks/useResource'
import { useStoredPreference } from '@/hooks/useStoredPreference'
import { useSession } from '@/lib/session'
import PageHeader from '@/components/PageHeader'
import DataState from '@/components/DataState'
import classes from './EmployeesPage.module.css'

const VIEWS = ['list', 'branch'] as const
type View = (typeof VIEWS)[number]

const NO_BRANCH = '__none__'

export default function EmployeesPage() {
  const { can } = useSession()
  const navigate = useNavigate()
  const employees = useResource(employeeApi.list)
  const branches = useResource(adminApi.listBranches)
  const positions = useResource(positionApi.list)
  // Only loadable with users:read — the login link is hidden without it.
  const canLinkLogins = can('users:read')
  const users = useResource(() => (canLinkLogins ? adminApi.listUsers() : Promise.resolve([])), [canLinkLogins])

  const [creating, setCreating] = useState(false)
  const [acting, setActing] = useState<Employee | null>(null)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [branchFilter, setBranchFilter] = useState<string | null>(null)
  const [positionFilter, setPositionFilter] = useState<string | null>(null)
  const [genderFilter, setGenderFilter] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  /*
   * The archive is hidden by default and that is the single biggest thing on
   * this page: 328 records, 247 of them people who left. Opening on all of them
   * buries the 81 who are actually here.
   */
  const [showSeparated, setShowSeparated] = useStoredPreference('otomate.employees.separated', 'no', ['no', 'yes'])
  const [view, setView] = useStoredPreference<View>('otomate.employees.view', 'list', VIEWS)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkPosition, setBulkPosition] = useState<string | null>(null)
  const [bulkBranch, setBulkBranch] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  /**
   * "Other" if it still exists, otherwise whatever sorts first. A new record has
   * to start on something now that a position is required, and picking the first
   * real role would silently mislabel people.
   */
  function defaultPositionId(): string {
    const list = (positions.data ?? []).filter(p => p.isActive)
    return (list.find(p => p.name === 'Other') ?? list[0])?.id ?? ''
  }

  const canWrite = can('employees:write')
  const canReadHr = can('hr:read')
  const all = employees.data ?? []
  const branchOptions = (branches.data ?? []).map(b => ({ value: b.id, label: b.name }))
  /*
   * Positions are rows now, so the picker is loaded rather than compiled in.
   * Inactive ones are dropped from the choices but still render on staff who
   * hold them — retiring a role must not blank out existing records.
   */
  const positionOptions = (positions.data ?? [])
    .filter(p => p.isActive)
    .map(p => ({ value: p.id, label: p.name }))

  /** A login belongs to at most one employee, so hide ones already taken. */
  const userOptions = useMemo(() => {
    const takenByOthers = new Set(all.filter(e => e.linkedUser).map(e => e.linkedUser!.id))
    return (users.data ?? [])
      .filter(u => !takenByOthers.has(u.id))
      .map(u => ({ value: u.id, label: `${u.name} — ${u.email}` }))
  }, [users.data, all])

  const form = useForm({
    initialValues: {
      firstName: '', middleName: '', lastName: '', suffix: '',
      positionId: '',
      branchId: null as string | null, userId: null as string | null, isActive: true,
    },
    validate: zodResolver(createEmployeeSchema),
  })

  /** The name of the position nobody has really been given yet. */
  const placeholderPositionId = (positions.data ?? []).find(p => p.name === 'Unassigned')?.id ?? null

  /*
   * Two figures, stated plainly. The counts that drive work — who still needs a
   * position, who has no branch — are going on the HR dashboard as a to-do
   * list, which is where a task belongs; a roster page should say how big the
   * roster is and get out of the way.
   */
  const activeCount = useMemo(() => all.filter(e => e.isActive).length, [all])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return all.filter(e => {
      if (showSeparated === 'no' && !e.isActive) return false
      if (branchFilter === NO_BRANCH ? e.branch : branchFilter && e.branch?.id !== branchFilter) return false
      if (positionFilter && e.position.id !== positionFilter) return false
      if (genderFilter && e.hr?.gender !== genderFilter) return false
      if (typeFilter && e.hr?.employmentType !== typeFilter) return false
      if (!q) return true
      const haystack = [e.name, e.firstName, e.middleName, e.lastName, e.suffix]
        .filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }, [all, search, branchFilter, positionFilter, genderFilter, typeFilter, showSeparated])

  /** Grouped for the card view — biggest branches first, no-branch last. */
  const byBranch = useMemo(() => {
    const groups = new Map<string, { name: string; people: Employee[] }>()
    for (const e of visible) {
      const key = e.branch?.id ?? NO_BRANCH
      const name = e.branch?.name ?? 'No branch'
      if (!groups.has(key)) groups.set(key, { name, people: [] })
      groups.get(key)!.people.push(e)
    }
    return [...groups.entries()].sort((a, b) => {
      if (a[0] === NO_BRANCH) return 1
      if (b[0] === NO_BRANCH) return -1
      return b[1].people.length - a[1].people.length
    })
  }, [visible])

  const visibleIds = useMemo(() => visible.map(e => e.id), [visible])
  const selectedVisible = visibleIds.filter(id => selected.has(id))
  const allVisibleSelected = visibleIds.length > 0 && selectedVisible.length === visibleIds.length

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function setMany(ids: string[], on: boolean) {
    setSelected(prev => {
      const next = new Set(prev)
      for (const id of ids) (on ? next.add(id) : next.delete(id))
      return next
    })
  }

  async function run(action: () => Promise<unknown>, message: string, done?: () => void) {
    setSaving(true)
    try {
      await action()
      await employees.reload()
      notifications.show({ color: 'green', title: 'Done', message })
      done?.()
    } catch (e) {
      notifications.show({ color: 'red', title: 'Failed', message: e instanceof Error ? e.message : 'Something went wrong' })
    } finally {
      setSaving(false)
    }
  }

  /**
   * Apply one change to everybody ticked.
   *
   * Confirmed first with the count in the sentence. Selection survives
   * scrolling and filtering, so "apply" can reach people who are no longer on
   * screen — which is the feature, and exactly why it should say how many.
   */
  function applyBulk() {
    const ids = [...selected]
    const position = positionOptions.find(p => p.value === bulkPosition)
    const branch = branchOptions.find(b => b.value === bulkBranch)
    const changes = [
      position && `position to ${position.label}`,
      bulkBranch === NO_BRANCH ? 'branch to none' : branch && `branch to ${branch.label}`,
    ].filter(Boolean).join(' and ')

    modals.openConfirmModal({
      title: `Update ${ids.length} employee${ids.length === 1 ? '' : 's'}?`,
      children: <Text size="sm">This sets {changes} for everyone selected. Records are changed one by one, so anything refused is reported and the rest still go through.</Text>,
      labels: { confirm: `Update ${ids.length}`, cancel: 'Cancel' },
      onConfirm: () => void (async () => {
        setSaving(true)
        setProgress({ done: 0, total: ids.length })
        try {
          const payload: { positionId?: string; branchId?: string | null } = {}
          if (bulkPosition) payload.positionId = bulkPosition
          if (bulkBranch) payload.branchId = bulkBranch === NO_BRANCH ? null : bulkBranch
          const { updated, failures } = await employeeApi.updateMany(
            ids, payload, (done, total) => setProgress({ done, total })
          )
          await employees.reload()
          if (failures.length) {
            notifications.show({
              color: 'orange', title: `${updated} updated, ${failures.length} refused`,
              message: failures[0]?.message ?? 'Some records could not be changed', autoClose: 8000,
            })
          } else {
            notifications.show({ color: 'green', title: 'Done', message: `${updated} employees updated` })
          }
          setSelected(new Set())
          setBulkPosition(null)
          setBulkBranch(null)
        } finally {
          setSaving(false)
          setProgress(null)
        }
      })(),
    })
  }

  function openCreate() {
    form.setValues({
      firstName: '', middleName: '', lastName: '', suffix: '',
      positionId: defaultPositionId(), branchId: null, userId: null, isActive: true,
    })
    form.clearErrors(); setCreating(true)
  }

  function confirmToggle(e: Employee) {
    const off = e.isActive
    modals.openConfirmModal({
      title: off ? `Deactivate ${e.name}?` : `Reactivate ${e.name}?`,
      children: (
        <Text size="sm">
          {off
            ? 'They stay on record so past charges remain attributable, but will no longer appear when assigning new ones.'
            : 'They will appear again when assigning charges.'}
        </Text>
      ),
      labels: { confirm: off ? 'Deactivate' : 'Reactivate', cancel: 'Cancel' },
      confirmProps: { color: off ? 'red' : 'green' },
      onConfirm: () => void run(
        () => (off ? employeeApi.deactivate(e.id) : employeeApi.update(e.id, { isActive: true })),
        off ? 'Employee deactivated' : 'Employee reactivated'
      ),
    })
  }


  return (
    <>
      <PageHeader
        title="Employees"
        description="Staff records. Separate from login accounts — most staff have no account at all."
        action={canWrite && <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>Add employee</Button>}
      />

      {/*
        Two rows, arranged by what actually needs the room.

        All five controls fit on one line only by shrinking the pickers until
        "All positions" renders as "All positic" and a selected "Part-time
        (extra)" is clipped in half — which is more cramped than wrapping, not
        less. The search box and the two toggles are narrow and go together;
        the filters then get a full line, so no label is ever cut.
      */}
      <Group mb="xs" gap="sm" wrap="wrap" align="center">
        <TextInput
          placeholder="Search name"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={e => setSearch(e.currentTarget.value)}
          w={{ base: '100%', xs: 340 }}
        />
        <Checkbox
          label="Show separated"
          checked={showSeparated === 'yes'}
          onChange={e => setShowSeparated(e.currentTarget.checked ? 'yes' : 'no')}
        />
        <SegmentedControl
          value={view}
          onChange={v => setView(v as View)}
          aria-label="View"
          data={[
            { value: 'list', label: <Group gap={6} wrap="nowrap"><IconLayoutList size={16} /><Text size="sm">List</Text></Group> },
            { value: 'branch', label: <Group gap={6} wrap="nowrap"><IconLayoutGrid size={16} /><Text size="sm">By branch</Text></Group> },
          ]}
          ml="auto"
        />
      </Group>

      <Group mb="md" gap="sm" wrap="wrap" align="center">
        <Select
          placeholder="All branches"
          data={[{ value: NO_BRANCH, label: 'No branch' }, ...branchOptions]}
          value={branchFilter} onChange={setBranchFilter} clearable searchable
          w={{ base: '100%', xs: 175 }}
        />
        <Select
          placeholder="All positions" data={positionOptions}
          value={positionFilter} onChange={setPositionFilter} clearable searchable
          w={{ base: '100%', xs: 175 }}
        />
        {/* Employment status and gender both live in the 201 file, so they are
            only here for a role that can read one — otherwise they would sit
            there silently matching nothing. */}
        {canReadHr && (
          <>
            <Select
              placeholder="Any status"
              data={EMPLOYMENT_TYPES.map(t => ({ value: t, label: EMPLOYMENT_TYPE_LABELS[t] }))}
              value={typeFilter} onChange={setTypeFilter} clearable
              w={{ base: '100%', xs: 195 }}
              aria-label="Employment status"
            />
            <Select
              placeholder="Any gender"
              data={GENDERS.map(g => ({ value: g, label: GENDER_LABELS[g] }))}
              value={genderFilter} onChange={setGenderFilter} clearable
              w={{ base: '100%', xs: 145 }}
              aria-label="Gender"
            />
          </>
        )}
      </Group>

      {/*
        The size of the roster, and how much of it is on screen — but only when
        those differ. Hiding the archive already narrows the list to the active
        count, so saying "showing 81 · 81 active" is the same fact twice.
      */}
      <Text size="sm" c="dimmed" mb="xs">
        {all.length} employees{' · '}{activeCount} active
        {visible.length !== (showSeparated === 'yes' ? all.length : activeCount)
          && ` · showing ${visible.length}`}
        {canWrite && visible.length > 0 && (
          <>
            {' · '}
            <UnstyledButton
              onClick={() => setMany(visibleIds, !allVisibleSelected)}
              style={{ font: 'inherit', color: 'var(--mantine-color-anchor)' }}
            >
              {allVisibleSelected ? 'Clear selection' : `Select all ${visible.length}`}
            </UnstyledButton>
          </>
        )}
      </Text>

      <DataState
        loading={employees.loading}
        error={employees.error}
        empty={visible.length === 0}
        emptyMessage={all.length === 0 ? 'No employees yet' : 'No employees match'}
      >
        {view === 'branch' ? (
          <div className={classes.branchGrid}>
            {byBranch.map(([id, group]) => {
              const ids = group.people.map(p => p.id)
              const allOn = ids.every(i => selected.has(i))
              return (
                <Card key={id} withBorder padding="sm" radius="md">
                  <Group justify="space-between" wrap="nowrap" mb="xs">
                    <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                      {canWrite && (
                        <Checkbox
                          size="xs"
                          checked={allOn}
                          indeterminate={!allOn && ids.some(i => selected.has(i))}
                          onChange={() => setMany(ids, !allOn)}
                          aria-label={`Select everyone at ${group.name}`}
                        />
                      )}
                      <Title order={6} lineClamp={1}>{group.name}</Title>
                    </Group>
                    <Badge variant="light" color="gray">{group.people.length}</Badge>
                  </Group>
                  <ScrollArea.Autosize className={classes.branchList} type="auto">
                    <Stack gap={2}>
                      {/*
                        The checkbox's own LABEL is the tap target, not a button
                        wrapping the row — a button containing the open-record
                        button is invalid HTML, and React says so. This way the
                        whole name area selects, the icon opens the record, and
                        both are reachable from the keyboard on their own.
                      */}
                      {group.people.map(p => (
                        <Group
                          key={p.id}
                          className={`${classes.personRow} ${p.isActive ? '' : classes.separated}`}
                          data-selected={selected.has(p.id)}
                          wrap="nowrap"
                          gap="xs"
                        >
                          {canWrite ? (
                            <Checkbox
                              size="xs"
                              checked={selected.has(p.id)}
                              onChange={() => toggle(p.id)}
                              aria-label={`Select ${p.name}`}
                              label={<Text size="sm" lineClamp={1}>{p.name}</Text>}
                              style={{ flex: 1, minWidth: 0 }}
                              styles={{ labelWrapper: { minWidth: 0 }, label: { cursor: 'pointer' } }}
                            />
                          ) : (
                            <Text size="sm" lineClamp={1} style={{ flex: 1 }}>{p.name}</Text>
                          )}
                          <Tooltip label="Open record">
                            <ActionIcon
                              size="sm" variant="subtle" color="gray"
                              aria-label={`Open ${p.name}`}
                              onClick={() => navigate(`/admin/employees/${p.id}`)}
                            >
                              <IconId size={15} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      ))}
                    </Stack>
                  </ScrollArea.Autosize>
                </Card>
              )
            })}
          </div>
        ) : (
          <Table.ScrollContainer minWidth={720}>
            <Table highlightOnHover verticalSpacing="sm" striped="odd">
              <Table.Thead>
                <Table.Tr>
                  {canWrite && (
                    <Table.Th w={40}>
                      <Checkbox
                        size="xs"
                        checked={allVisibleSelected}
                        indeterminate={!allVisibleSelected && selectedVisible.length > 0}
                        onChange={() => setMany(visibleIds, !allVisibleSelected)}
                        aria-label="Select all shown"
                      />
                    </Table.Th>
                  )}
                  <Table.Th>Name</Table.Th>
                  <Table.Th w={130}>Position</Table.Th>
                  <Table.Th w={150}>Branch</Table.Th>
                  <Table.Th w={170}>Login</Table.Th>
                  <Table.Th w={110}>Status</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {visible.map(e => (
                  <Table.Tr
                    key={e.id}
                    opacity={e.isActive ? 1 : 0.55}
                    bg={selected.has(e.id) ? 'var(--mantine-color-crust-light)' : undefined}
                    {...rowActionProps(canWrite, () => setActing(e))}
                  >
                    {canWrite && (
                      <Table.Td onClick={ev => ev.stopPropagation()}>
                        <Checkbox
                          size="xs"
                          checked={selected.has(e.id)}
                          onChange={() => toggle(e.id)}
                          aria-label={`Select ${e.name}`}
                        />
                      </Table.Td>
                    )}
                    <Table.Td><Text fw={500}>{e.name}</Text></Table.Td>
                    <Table.Td>
                      <Badge
                        variant="light"
                        color={e.position.id === placeholderPositionId ? 'orange' : 'gray'}
                      >
                        {e.position.name}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      {e.branch
                        ? <Text size="sm">{e.branch.name}</Text>
                        : <Text size="sm" c="orange">No branch</Text>}
                    </Table.Td>
                    <Table.Td>
                      {e.linkedUser ? (
                        <Tooltip label={e.linkedUser.email}>
                          <Badge variant="light" color="crust" leftSection={<IconLink size={10} />}>linked</Badge>
                        </Tooltip>
                      ) : (
                        <Text size="sm" c="dimmed">—</Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Badge variant="light" color={e.isActive ? 'green' : 'gray'}>{e.isActive ? 'Active' : 'Separated'}</Badge>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </DataState>

      {/*
        Only once something is ticked. An empty toolbar sitting there permanently
        is a row of dead controls to read past on every visit.
      */}
      {canWrite && selected.size > 0 && (
        <div className={classes.bulkBar}>
          <Group gap="sm" wrap="wrap" align="flex-end">
            <Group gap={6} wrap="nowrap">
              <Tooltip label="Clear selection">
                <ActionIcon variant="subtle" color="gray" onClick={() => setSelected(new Set())} aria-label="Clear selection">
                  <IconX size={16} />
                </ActionIcon>
              </Tooltip>
              <Text fw={600} size="sm">{selected.size} selected</Text>
            </Group>
            <Select
              placeholder="Set position…" data={positionOptions} value={bulkPosition}
              onChange={setBulkPosition} clearable searchable w={190} size="sm"
              aria-label="Position for selected"
            />
            <Select
              placeholder="Set branch…"
              data={[{ value: NO_BRANCH, label: 'No branch' }, ...branchOptions]}
              value={bulkBranch} onChange={setBulkBranch} clearable searchable w={190} size="sm"
              aria-label="Branch for selected"
            />
            <Button
              onClick={applyBulk}
              disabled={!bulkPosition && !bulkBranch}
              loading={saving}
              size="sm"
            >
              Apply to {selected.size}
            </Button>
            {progress && (
              <Progress
                value={(progress.done / progress.total) * 100}
                w={140}
                aria-label={`${progress.done} of ${progress.total} updated`}
              />
            )}
          </Group>
        </div>
      )}

      <RowActionsSheet
        opened={acting !== null}
        onClose={() => setActing(null)}
        title={acting?.name ?? ''}
        subtitle={acting ? [acting.position.name, acting.branch?.name ?? 'No branch'].join(' · ') : undefined}
        actions={
          acting
            ? ([
                /*
                 * One action, not two. "Edit" opened a modal with the name and
                 * posting; "HR record" opened the page with everything else. So
                 * correcting a spelling you were looking at on the record page
                 * meant going back to the list and reopening a dialog — and
                 * there were two different Saves. The record page holds both now.
                 */
                {
                  label: 'Open record',
                  icon: <IconId size={18} />,
                  onClick: () => navigate(`/admin/employees/${acting.id}`),
                },
                {
                  label: acting.isActive ? 'Deactivate' : 'Reactivate',
                  icon: acting.isActive ? <IconUserOff size={18} /> : <IconUserCheck size={18} />,
                  destructive: acting.isActive,
                  onClick: () => confirmToggle(acting),
                },
              ] satisfies RowAction[])
            : []
        }
      />

      <Modal
        opened={creating}
        onClose={() => setCreating(false)}
        title="Add employee"
        size="xl"
        centered
      >
        <form onSubmit={form.onSubmit(values =>
          run(
            () => employeeApi.create({ ...values, positionId: values.positionId }),
            `${formatEmployeeName(values)} added`,
            () => setCreating(false)
          )
        )}>
          <Stack gap="md">
            {/* Name parts on one row, mirroring how they sit on a paper form —
                the encoder reads left to right and tabs straight through.
                Widths are uneven on purpose: surnames run long ("Dela Cruz"),
                suffixes never do. They stack on a phone. */}
            <Grid gap="sm" align="flex-start">
              <Grid.Col span={{ base: 12, sm: 4 }}>
                <TextInput label="First name" placeholder="Maria" withAsterisk {...form.getInputProps('firstName')} />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 3 }}>
                <TextInput label="Middle name" placeholder="Reyes" {...form.getInputProps('middleName')} />
              </Grid.Col>
              <Grid.Col span={{ base: 8, sm: 3 }}>
                <TextInput label="Surname" placeholder="Santos" withAsterisk {...form.getInputProps('lastName')} />
              </Grid.Col>
              <Grid.Col span={{ base: 4, sm: 2 }}>
                <TextInput label="Suffix" placeholder="Jr." {...form.getInputProps('suffix')} />
              </Grid.Col>
            </Grid>

            <Select label="Position" data={positionOptions} withAsterisk {...form.getInputProps('positionId')} />

            <Select
              label="Branch"
              data={branchOptions}
              clearable
              placeholder="No branch"
              description="Current assignment — change it when they transfer"
              {...form.getInputProps('branchId')}
            />

            {canLinkLogins && (
              <Select
                label="Linked login"
                data={userOptions}
                clearable
                searchable
                placeholder="No account"
                description="Only for staff who also sign in to Otomate. Accounts already linked to someone else are hidden."
                {...form.getInputProps('userId')}
              />
            )}

            <Switch label="Active" {...form.getInputProps('isActive', { type: 'checkbox' })} />

            <Group justify="flex-end" mt="xs">
              <Button variant="default" onClick={() => setCreating(false)}>Cancel</Button>
              <Button type="submit" loading={saving}>Add employee</Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </>
  )
}
