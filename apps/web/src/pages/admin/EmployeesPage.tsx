import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge, Button, Grid, Group, Modal, Select, Stack, Switch, Table, Text, TextInput, Tooltip } from '@mantine/core'
import { useForm } from '@mantine/form'
// zod4Resolver, not zodResolver: the latter reads error.errors (zod 3);
// on zod 4 that is undefined and validation throws instead of showing messages.
import { zod4Resolver as zodResolver } from 'mantine-form-zod-resolver'
import { notifications } from '@mantine/notifications'
import { modals } from '@mantine/modals'
import { IconId, IconLink, IconPlus, IconSearch, IconUserCheck, IconUserOff } from '@tabler/icons-react'
import {
  createEmployeeSchema, formatEmployeeName, type Employee,
} from '@otomate/shared'
import { employeeApi, positionApi } from '@/lib/employees'
import RowActionsSheet, { rowActionProps, type RowAction } from '@/components/RowActionsSheet'
import { adminApi } from '@/lib/admin'
import { useResource } from '@/hooks/useResource'
import { useSession } from '@/lib/session'
import PageHeader from '@/components/PageHeader'
import DataState from '@/components/DataState'

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
    const takenByOthers = new Set(
      (employees.data ?? [])
        .filter(e => e.linkedUser)
        .map(e => e.linkedUser!.id)
    )
    return (users.data ?? [])
      .filter(u => !takenByOthers.has(u.id))
      .map(u => ({ value: u.id, label: `${u.name} — ${u.email}` }))
  }, [users.data, employees.data])

  const form = useForm({
    initialValues: {
      firstName: '', middleName: '', lastName: '', suffix: '',
      positionId: '',
      branchId: null as string | null, userId: null as string | null, isActive: true,
    },
    validate: zodResolver(createEmployeeSchema),
  })

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (employees.data ?? []).filter(e => {
      if (branchFilter && e.branch?.id !== branchFilter) return false
      if (positionFilter && e.position.id !== positionFilter) return false
      if (!q) return true
      const haystack = [e.name, e.firstName, e.middleName, e.lastName, e.suffix]
        .filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }, [employees.data, search, branchFilter, positionFilter])

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

      <Group mb="md" gap="sm" wrap="wrap">
        <TextInput
          placeholder="Search name or code"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={e => setSearch(e.currentTarget.value)}
          w={{ base: '100%', xs: 260 }}
        />
        <Select placeholder="All branches" data={branchOptions} value={branchFilter} onChange={setBranchFilter} clearable w={{ base: '100%', xs: 180 }} />
        <Select placeholder="All positions" data={positionOptions} value={positionFilter} onChange={setPositionFilter} clearable w={{ base: '100%', xs: 170 }} />
        {visible.length !== (employees.data ?? []).length && (
          <Text size="sm" c="dimmed">{visible.length} of {employees.data?.length} shown</Text>
        )}
      </Group>

      <DataState
        loading={employees.loading}
        error={employees.error}
        empty={visible.length === 0}
        emptyMessage={(employees.data ?? []).length === 0 ? 'No employees yet' : 'No employees match'}
      >
        <Table.ScrollContainer minWidth={720}>
          <Table highlightOnHover verticalSpacing="sm" striped="odd">
            <Table.Thead>
              <Table.Tr>
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
                  {...rowActionProps(canWrite, () => setActing(e))}
                >
                  <Table.Td>
                    <Stack gap={2}>
                      <Text fw={500}>{e.name}</Text>
                    </Stack>
                  </Table.Td>
                  <Table.Td><Badge variant="light" color="gray">{e.position.name}</Badge></Table.Td>
                  <Table.Td>
                    {e.branch ? <Text size="sm">{e.branch.name}</Text> : <Text size="sm" c="dimmed">Unassigned</Text>}
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
                    <Badge variant="light" color={e.isActive ? 'green' : 'gray'}>{e.isActive ? 'Active' : 'Inactive'}</Badge>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </DataState>

      <RowActionsSheet
        opened={acting !== null}
        onClose={() => setActing(null)}
        title={acting?.name ?? ''}
        subtitle={acting ? [acting.position.name, acting.branch?.name ?? 'Unassigned'].join(' · ') : undefined}
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
            () => {
              const payload = {
                ...values,
                positionId: values.positionId,
              }
              return employeeApi.create(payload)
            },
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
              placeholder="Unassigned"
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
