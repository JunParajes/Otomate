import { useState } from 'react'
import {
  ActionIcon, Badge, Button, Group, Menu, Modal, PasswordInput, Select, Stack,
  Switch, Table, Text, TextInput, Tooltip,
} from '@mantine/core'
import { useForm } from '@mantine/form'
// zod4Resolver, not zodResolver: the latter reads error.errors (zod 3);
// on zod 4 that is undefined and validation throws instead of showing messages.
import { zod4Resolver as zodResolver } from 'mantine-form-zod-resolver'
import { notifications } from '@mantine/notifications'
import { modals } from '@mantine/modals'
import { IconDotsVertical, IconKey, IconPencil, IconPlus, IconUserOff, IconUserCheck } from '@tabler/icons-react'
import { createUserSchema, updateUserSchema, type User } from '@otomate/shared'
import { adminApi } from '@/lib/admin'
import { useResource } from '@/hooks/useResource'
import { useSession } from '@/lib/session'
import PageHeader from '@/components/PageHeader'
import DataState from '@/components/DataState'

function fail(e: unknown) {
  notifications.show({ color: 'red', title: 'Failed', message: e instanceof Error ? e.message : 'Something went wrong' })
}
function ok(message: string) {
  notifications.show({ color: 'green', title: 'Done', message })
}

export default function UsersPage() {
  const { user: me, can, refresh } = useSession()
  const users = useResource(adminApi.listUsers)
  const roles = useResource(adminApi.listRoles)
  const branches = useResource(adminApi.listBranches)

  const [editing, setEditing] = useState<User | null>(null)
  const [creating, setCreating] = useState(false)
  const [resetting, setResetting] = useState<User | null>(null)
  const [saving, setSaving] = useState(false)

  const canWrite = can('users:write')
  const roleOptions = (roles.data ?? []).map(r => ({ value: r.id, label: r.name }))
  const branchOptions = (branches.data ?? []).map(b => ({ value: b.id, label: b.name }))

  const createForm = useForm({
    initialValues: { email: '', name: '', password: '', roleId: '', branchId: null as string | null, mustChangePassword: true },
    validate: zodResolver(createUserSchema),
  })
  const editForm = useForm({
    initialValues: { email: '', name: '', roleId: '', branchId: null as string | null },
    validate: zodResolver(updateUserSchema),
  })
  const resetForm = useForm({ initialValues: { password: '', mustChangePassword: true } })

  function openCreate() {
    createForm.setValues({ email: '', name: '', password: '', roleId: '', branchId: null, mustChangePassword: true })
    createForm.clearErrors()
    setCreating(true)
  }

  function openEdit(u: User) {
    editForm.setValues({ email: u.email, name: u.name, roleId: u.role.id, branchId: u.branch?.id ?? null })
    editForm.clearErrors()
    setEditing(u)
  }

  async function run(action: () => Promise<unknown>, message: string, onDone?: () => void) {
    setSaving(true)
    try {
      await action()
      await users.reload()
      // The header, the branch badge and the visible nav all read from the
      // session, so a write here can leave them stale — most visibly when you
      // edit your own account. Refreshed unconditionally rather than only when
      // the row is "me": changing a role you hold, or renaming your branch,
      // changes what you see without touching your own user row.
      await refresh()
      ok(message)
      onDone?.()
    } catch (e) {
      fail(e)
    } finally {
      setSaving(false)
    }
  }

  function confirmToggleActive(u: User) {
    const deactivating = u.isActive
    modals.openConfirmModal({
      title: deactivating ? `Deactivate ${u.name}?` : `Reactivate ${u.name}?`,
      children: (
        <Text size="sm">
          {deactivating
            ? 'They will be signed out immediately and cannot log in again until reactivated. Their record and history are kept.'
            : 'They will be able to sign in again straight away.'}
        </Text>
      ),
      labels: { confirm: deactivating ? 'Deactivate' : 'Reactivate', cancel: 'Cancel' },
      confirmProps: { color: deactivating ? 'red' : 'green' },
      onConfirm: () =>
        void run(
          () => (deactivating ? adminApi.deactivateUser(u.id) : adminApi.updateUser(u.id, { isActive: true })),
          deactivating ? 'User deactivated' : 'User reactivated'
        ),
    })
  }

  return (
    <>
      <PageHeader
        title="Users"
        description="Staff accounts, their role, and which branch they belong to."
        action={canWrite && <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>Add user</Button>}
      />

      <DataState loading={users.loading} error={users.error} empty={users.data?.length === 0} emptyMessage="No users yet">
        <Table.ScrollContainer minWidth={760}>
          <Table highlightOnHover verticalSpacing="sm" striped="odd">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Email</Table.Th>
                <Table.Th>Role</Table.Th>
                <Table.Th>Branch</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th w={60} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(users.data ?? []).map(u => (
                <Table.Tr key={u.id} opacity={u.isActive ? 1 : 0.55}>
                  <Table.Td>
                    <Group gap="xs" wrap="nowrap">
                      <Text fw={500}>{u.name}</Text>
                      {u.id === me?.id && <Badge size="xs" variant="light">You</Badge>}
                    </Group>
                  </Table.Td>
                  <Table.Td><Text size="sm" c="dimmed">{u.email}</Text></Table.Td>
                  <Table.Td>
                    <Badge variant="light" color={u.role.isSystem ? 'crust' : 'gray'}>{u.role.name}</Badge>
                  </Table.Td>
                  <Table.Td>
                    {u.branch ? <Text size="sm">{u.branch.name}</Text> : <Text size="sm" c="dimmed">—</Text>}
                  </Table.Td>
                  <Table.Td>
                    <Group gap={6} wrap="nowrap">
                      <Badge color={u.isActive ? 'green' : 'gray'} variant="light">{u.isActive ? 'Active' : 'Inactive'}</Badge>
                      {u.mustChangePassword && (
                        <Tooltip label="Must set a new password at next sign-in">
                          <Badge color="yellow" variant="light">New password</Badge>
                        </Tooltip>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    {canWrite && (
                      <Menu position="bottom-end" withArrow>
                        <Menu.Target>
                          <ActionIcon variant="subtle" color="gray" aria-label={`Actions for ${u.name}`}>
                            <IconDotsVertical size={16} />
                          </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Item leftSection={<IconPencil size={14} />} onClick={() => openEdit(u)}>Edit</Menu.Item>
                          <Menu.Item
                            leftSection={<IconKey size={14} />}
                            onClick={() => { resetForm.setValues({ password: '', mustChangePassword: true }); setResetting(u) }}
                          >
                            Reset password
                          </Menu.Item>
                          <Menu.Divider />
                          {/* The API blocks self-deactivation; don't offer it either. */}
                          <Menu.Item
                            color={u.isActive ? 'red' : 'green'}
                            disabled={u.id === me?.id}
                            leftSection={u.isActive ? <IconUserOff size={14} /> : <IconUserCheck size={14} />}
                            onClick={() => confirmToggleActive(u)}
                          >
                            {u.isActive ? 'Deactivate' : 'Reactivate'}
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

      <Modal opened={creating} onClose={() => setCreating(false)} title="Add user" size="lg" centered>
        <form onSubmit={createForm.onSubmit(values => run(() => adminApi.createUser(values), `${values.name} added`, () => setCreating(false)))}>
          <Stack gap="md">
            <Group grow align="flex-start">
              <TextInput label="Full name" placeholder="Maria Santos" withAsterisk {...createForm.getInputProps('name')} />
              <TextInput label="Email" placeholder="maria@otomate.local" withAsterisk {...createForm.getInputProps('email')} />
            </Group>
            <Group grow align="flex-start">
              <Select label="Role" data={roleOptions} withAsterisk searchable {...createForm.getInputProps('roleId')} />
              <Select label="Branch" data={branchOptions} clearable placeholder="Unassigned" {...createForm.getInputProps('branchId')} />
            </Group>
            <PasswordInput
              label="Initial password"
              description="Share this with them directly; they will be asked to change it."
              withAsterisk
              {...createForm.getInputProps('password')}
            />
            <Switch label="Require a password change at first sign-in" {...createForm.getInputProps('mustChangePassword', { type: 'checkbox' })} />
            <Group justify="flex-end" mt="xs">
              <Button variant="default" onClick={() => setCreating(false)}>Cancel</Button>
              <Button type="submit" loading={saving}>Add user</Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Modal opened={editing !== null} onClose={() => setEditing(null)} title={`Edit ${editing?.name ?? ''}`} size="lg" centered>
        <form onSubmit={editForm.onSubmit(values => run(() => adminApi.updateUser(editing!.id, values), 'Changes saved', () => setEditing(null)))}>
          <Stack gap="md">
            <Group grow align="flex-start">
              <TextInput label="Full name" withAsterisk {...editForm.getInputProps('name')} />
              <TextInput label="Email" withAsterisk {...editForm.getInputProps('email')} />
            </Group>
            <Group grow align="flex-start">
              <Select
                label="Role"
                data={roleOptions}
                searchable
                disabled={editing?.id === me?.id}
                description={editing?.id === me?.id ? 'You cannot change your own role' : undefined}
                {...editForm.getInputProps('roleId')}
              />
              <Select label="Branch" data={branchOptions} clearable placeholder="Unassigned" {...editForm.getInputProps('branchId')} />
            </Group>
            <Group justify="flex-end" mt="xs">
              <Button variant="default" onClick={() => setEditing(null)}>Cancel</Button>
              <Button type="submit" loading={saving}>Save changes</Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Modal opened={resetting !== null} onClose={() => setResetting(null)} title={`Reset password for ${resetting?.name ?? ''}`} centered>
        <form onSubmit={resetForm.onSubmit(values => run(() => adminApi.resetPassword(resetting!.id, values.password, values.mustChangePassword), 'Password reset', () => setResetting(null)))}>
          <Stack gap="md">
            <PasswordInput label="New password" description="At least 8 characters." withAsterisk {...resetForm.getInputProps('password')} />
            <Switch label="Require a change at next sign-in" {...resetForm.getInputProps('mustChangePassword', { type: 'checkbox' })} />
            <Group justify="flex-end" mt="xs">
              <Button variant="default" onClick={() => setResetting(null)}>Cancel</Button>
              <Button type="submit" loading={saving}>Reset password</Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </>
  )
}
