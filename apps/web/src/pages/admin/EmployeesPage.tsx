import { useMemo, useState } from 'react'
import {
  ActionIcon, Badge, Button, Grid, Group, Menu, Modal, Select, Stack, Switch, Table,
  Text, TextInput, Tooltip,
} from '@mantine/core'
import { useForm } from '@mantine/form'
// zod4Resolver, not zodResolver: the latter reads error.errors (zod 3);
// on zod 4 that is undefined and validation throws instead of showing messages.
import { zod4Resolver as zodResolver } from 'mantine-form-zod-resolver'
import { notifications } from '@mantine/notifications'
import { modals } from '@mantine/modals'
import {
  IconDotsVertical, IconLink, IconPencil, IconPlus, IconSearch, IconUserCheck, IconUserOff,
} from '@tabler/icons-react'
import {
  EMPLOYEE_POSITIONS, POSITION_LABELS, createEmployeeSchema, formatEmployeeName, type Employee,
} from '@otomate/shared'
import { employeeApi } from '@/lib/employees'
import { adminApi } from '@/lib/admin'
import { useResource } from '@/hooks/useResource'
import { useSession } from '@/lib/session'
import PageHeader from '@/components/PageHeader'
import DataState from '@/components/DataState'

export default function EmployeesPage() {
  const { can } = useSession()
  const employees = useResource(employeeApi.list)
  const branches = useResource(adminApi.listBranches)
  // Only loadable with users:read — the login link is hidden without it.
  const canLinkLogins = can('users:read')
  const users = useResource(() => (canLinkLogins ? adminApi.listUsers() : Promise.resolve([])), [canLinkLogins])

  const [editing, setEditing] = useState<Employee | null>(null)
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [branchFilter, setBranchFilter] = useState<string | null>(null)
  const [positionFilter, setPositionFilter] = useState<string | null>(null)

  const canWrite = can('employees:write')
  const branchOptions = (branches.data ?? []).map(b => ({ value: b.id, label: b.name }))
  const positionOptions = EMPLOYEE_POSITIONS.map(p => ({ value: p, label: POSITION_LABELS[p] }))

  /** A login belongs to at most one employee, so hide ones already taken. */
  const userOptions = useMemo(() => {
    const takenByOthers = new Set(
      (employees.data ?? [])
        .filter(e => e.linkedUser && e.id !== editing?.id)
        .map(e => e.linkedUser!.id)
    )
    return (users.data ?? [])
      .filter(u => !takenByOthers.has(u.id))
      .map(u => ({ value: u.id, label: `${u.name} — ${u.email}` }))
  }, [users.data, employees.data, editing])

  const form = useForm({
    initialValues: {
      firstName: '', middleName: '', lastName: '', suffix: '',
      employeeCode: '', position: 'OTHER',
      branchId: null as string | null, userId: null as string | null, isActive: true,
    },
    validate: zodResolver(createEmployeeSchema),
  })

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (employees.data ?? []).filter(e => {
      if (branchFilter && e.branch?.id !== branchFilter) return false
      if (positionFilter && e.position !== positionFilter) return false
      if (!q) return true
      const haystack = [e.name, e.firstName, e.middleName, e.lastName, e.suffix, e.employeeCode]
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
      employeeCode: '', position: 'OTHER', branchId: null, userId: null, isActive: true,
    })
    form.clearErrors(); setCreating(true)
  }

  function openEdit(e: Employee) {
    form.setValues({
      firstName: e.firstName,
      middleName: e.middleName ?? '',
      lastName: e.lastName,
      suffix: e.suffix ?? '',
      employeeCode: e.employeeCode ?? '', position: e.position,
      branchId: e.branch?.id ?? null, userId: e.linkedUser?.id ?? null, isActive: e.isActive,
    })
    form.clearErrors(); setEditing(e)
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

  const isEditing = editing !== null

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
                <Table.Th w={60} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {visible.map(e => (
                <Table.Tr key={e.id} opacity={e.isActive ? 1 : 0.55}>
                  <Table.Td>
                    <Stack gap={2}>
                      <Text fw={500}>{e.name}</Text>
                      {e.employeeCode && <Text size="xs" c="dimmed" ff="monospace">{e.employeeCode}</Text>}
                    </Stack>
                  </Table.Td>
                  <Table.Td><Badge variant="light" color="gray">{POSITION_LABELS[e.position]}</Badge></Table.Td>
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
                  <Table.Td>
                    {canWrite && (
                      <Menu position="bottom-end" withArrow>
                        <Menu.Target>
                          <ActionIcon variant="subtle" color="gray" aria-label={`Actions for ${e.name}`}>
                            <IconDotsVertical size={16} />
                          </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Item leftSection={<IconPencil size={14} />} onClick={() => openEdit(e)}>Edit</Menu.Item>
                          <Menu.Divider />
                          <Menu.Item
                            color={e.isActive ? 'red' : 'green'}
                            leftSection={e.isActive ? <IconUserOff size={14} /> : <IconUserCheck size={14} />}
                            onClick={() => confirmToggle(e)}
                          >
                            {e.isActive ? 'Deactivate' : 'Reactivate'}
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </DataState>

      <Modal
        opened={creating || isEditing}
        onClose={() => { setCreating(false); setEditing(null) }}
        title={isEditing ? `Edit ${editing?.name}` : 'Add employee'}
        size="xl"
        centered
      >
        <form onSubmit={form.onSubmit(values =>
          run(
            () => {
              const payload = {
                ...values,
                employeeCode: values.employeeCode.trim() || null,
                position: values.position as (typeof EMPLOYEE_POSITIONS)[number],
              }
              return isEditing ? employeeApi.update(editing!.id, payload) : employeeApi.create(payload)
            },
            isEditing ? 'Changes saved' : `${formatEmployeeName(values)} added`,
            () => { setCreating(false); setEditing(null) }
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

            {/* flex-end, not flex-start: the description under Employee code
                makes its label block taller, and aligning tops would leave the
                two inputs on different lines. */}
            <Group grow align="flex-end">
              <TextInput label="Employee code" placeholder="EMP-001" description="Optional, must be unique" {...form.getInputProps('employeeCode')} />
              <Select label="Position" data={positionOptions} {...form.getInputProps('position')} />
            </Group>

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
              <Button variant="default" onClick={() => { setCreating(false); setEditing(null) }}>Cancel</Button>
              <Button type="submit" loading={saving}>{isEditing ? 'Save changes' : 'Add employee'}</Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </>
  )
}
