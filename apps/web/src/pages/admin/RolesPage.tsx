import { useState } from 'react'
import {
  ActionIcon, Alert, Badge, Button, Group, Modal, Select, Stack, Table, Text,
  TextInput, Textarea, Tooltip,
} from '@mantine/core'
import { useForm } from '@mantine/form'
// zod4Resolver, not zodResolver: the latter reads error.errors (zod 3);
// on zod 4 that is undefined and validation throws instead of showing messages.
import { zod4Resolver as zodResolver } from 'mantine-form-zod-resolver'
import { notifications } from '@mantine/notifications'
import { IconAlertTriangle, IconLock, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react'
import { createRoleSchema, type RoleWithUsage } from '@otomate/shared'
import { adminApi } from '@/lib/admin'
import { useResource } from '@/hooks/useResource'
import { useSession } from '@/lib/session'
import PageHeader from '@/components/PageHeader'
import DataState from '@/components/DataState'
import PermissionPicker from '@/components/PermissionPicker'

export default function RolesPage() {
  const { can } = useSession()
  const roles = useResource(adminApi.listRoles)
  const permissions = useResource(adminApi.permissions)

  const [editing, setEditing] = useState<RoleWithUsage | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<RoleWithUsage | null>(null)
  const [reassignTo, setReassignTo] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const canWrite = can('roles:write')

  const form = useForm({
    initialValues: { name: '', description: '', permissions: [] as string[] },
    validate: zodResolver(createRoleSchema),
  })

  async function run(action: () => Promise<unknown>, message: string, onDone?: () => void) {
    setSaving(true)
    try {
      await action()
      await roles.reload()
      notifications.show({ color: 'green', title: 'Done', message })
      onDone?.()
    } catch (e) {
      notifications.show({ color: 'red', title: 'Failed', message: e instanceof Error ? e.message : 'Something went wrong' })
    } finally {
      setSaving(false)
    }
  }

  function openCreate() {
    form.setValues({ name: '', description: '', permissions: [] })
    form.clearErrors()
    setCreating(true)
  }

  function openEdit(role: RoleWithUsage) {
    form.setValues({
      name: role.name,
      description: role.description ?? '',
      permissions: role.permissions.map(p => p.name),
    })
    form.clearErrors()
    setEditing(role)
  }

  const isEditing = editing !== null
  const otherRoles = (roles.data ?? [])
    .filter(r => r.id !== deleting?.id)
    .map(r => ({ value: r.id, label: r.name }))

  return (
    <>
      <PageHeader
        title="Roles"
        description="A role is a named bundle of permissions. Assign one to each user."
        action={canWrite && <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>Add role</Button>}
      />

      <DataState loading={roles.loading} error={roles.error} empty={roles.data?.length === 0} emptyMessage="No roles yet">
        <Table.ScrollContainer minWidth={720}>
          <Table highlightOnHover verticalSpacing="sm" striped="odd">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Role</Table.Th>
                <Table.Th>Permissions</Table.Th>
                <Table.Th w={90}>Users</Table.Th>
                <Table.Th w={100} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(roles.data ?? []).map(role => (
                <Table.Tr key={role.id}>
                  <Table.Td>
                    <Group gap="xs" wrap="nowrap">
                      <Stack gap={2}>
                        <Group gap={6} wrap="nowrap">
                          <Text fw={500} ff="monospace">{role.name}</Text>
                          {role.isSystem && (
                            <Tooltip label="System role — protected from edits and deletion">
                              <Badge size="xs" color="crust" variant="light" leftSection={<IconLock size={10} />}>
                                system
                              </Badge>
                            </Tooltip>
                          )}
                        </Group>
                        {role.description && <Text size="xs" c="dimmed">{role.description}</Text>}
                      </Stack>
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    {role.permissions.length === 0 ? (
                      <Text size="sm" c="dimmed">None</Text>
                    ) : (
                      <Group gap={4}>
                        {role.permissions.slice(0, 3).map(p => (
                          <Badge key={p.id} size="sm" variant="outline" color="gray">{p.name}</Badge>
                        ))}
                        {role.permissions.length > 3 && (
                          <Tooltip label={role.permissions.slice(3).map(p => p.name).join(', ')}>
                            <Badge size="sm" variant="light" color="gray">+{role.permissions.length - 3}</Badge>
                          </Tooltip>
                        )}
                      </Group>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light" color={role.userCount > 0 ? 'blue' : 'gray'}>{role.userCount}</Badge>
                  </Table.Td>
                  <Table.Td>
                    {canWrite && !role.isSystem && (
                      <Group gap={4} wrap="nowrap">
                        <ActionIcon variant="subtle" color="gray" onClick={() => openEdit(role)} aria-label={`Edit ${role.name}`}>
                          <IconPencil size={16} />
                        </ActionIcon>
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          onClick={() => { setReassignTo(null); setDeleting(role) }}
                          aria-label={`Delete ${role.name}`}
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Group>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </DataState>

      {/* Create and edit share one form — the fields are identical. */}
      <Modal
        opened={creating || isEditing}
        onClose={() => { setCreating(false); setEditing(null) }}
        title={isEditing ? `Edit role: ${editing?.name}` : 'Add role'}
        size="xl"
        centered
      >
        <form
          onSubmit={form.onSubmit(values =>
            run(
              () =>
                isEditing
                  ? adminApi.updateRole(editing!.id, { ...values, description: values.description || null })
                  : adminApi.createRole({ ...values, description: values.description || null }),
              isEditing ? 'Role updated' : `Role '${values.name}' created`,
              () => { setCreating(false); setEditing(null) }
            )
          )}
        >
          <Stack gap="md">
            <Group grow align="flex-start">
              <TextInput
                label="Role name"
                placeholder="frontliner"
                description="Lowercase letters, numbers and underscores"
                withAsterisk
                {...form.getInputProps('name')}
              />
              <Textarea
                label="Description"
                placeholder="Counter and cashier staff"
                description="Optional, shown in the roles list"
                autosize
                minRows={1}
                maxRows={3}
                {...form.getInputProps('description')}
              />
            </Group>

            <Stack gap="xs">
              <Group justify="space-between">
                <Text size="sm" fw={500}>Permissions</Text>
                <Text size="xs" c="dimmed">{form.values.permissions.length} selected</Text>
              </Group>
              <DataState loading={permissions.loading} error={permissions.error}>
                <PermissionPicker
                  permissions={permissions.data ?? []}
                  value={form.values.permissions}
                  onChange={next => form.setFieldValue('permissions', next)}
                />
              </DataState>
            </Stack>

            <Group justify="flex-end" mt="xs">
              <Button variant="default" onClick={() => { setCreating(false); setEditing(null) }}>Cancel</Button>
              <Button type="submit" loading={saving}>{isEditing ? 'Save changes' : 'Create role'}</Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      {/* Deleting a role with users requires an explicit destination. */}
      <Modal opened={deleting !== null} onClose={() => setDeleting(null)} title={`Delete role '${deleting?.name}'?`} centered>
        <Stack gap="md">
          {deleting && deleting.userCount > 0 ? (
            <>
              <Alert color="yellow" icon={<IconAlertTriangle size={18} />}>
                {deleting.userCount} user{deleting.userCount === 1 ? '' : 's'} still {deleting.userCount === 1 ? 'has' : 'have'} this role.
                Choose where to move them.
              </Alert>
              <Select
                label="Reassign those users to"
                placeholder="Select a role"
                data={otherRoles}
                value={reassignTo}
                onChange={setReassignTo}
                withAsterisk
                searchable
              />
            </>
          ) : (
            <Text size="sm">This role has no users assigned. It will be removed permanently.</Text>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button
              color="red"
              loading={saving}
              disabled={Boolean(deleting && deleting.userCount > 0 && !reassignTo)}
              onClick={() =>
                void run(
                  () => adminApi.deleteRole(deleting!.id, reassignTo ?? undefined),
                  'Role deleted',
                  () => setDeleting(null)
                )
              }
            >
              Delete role
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}
