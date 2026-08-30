import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge, Button, Group, Modal, Stack, Switch, Table, Text, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
// zod4Resolver, not zodResolver: the latter reads error.errors (zod 3);
// on zod 4 that is undefined and validation throws instead of showing messages.
import { zod4Resolver as zodResolver } from 'mantine-form-zod-resolver'
import { notifications } from '@mantine/notifications'
import { modals } from '@mantine/modals'
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react'
import { createBranchSchema } from '@otomate/shared'
import { adminApi, type BranchWithUsage } from '@/lib/admin'
import { useResource } from '@/hooks/useResource'
import RowActionsSheet, { rowActionProps, type RowAction } from '@/components/RowActionsSheet'
import { branchPermitStatus } from '@otomate/shared'
import { IconFileText } from '@tabler/icons-react'
import { useSession } from '@/lib/session'
import PageHeader from '@/components/PageHeader'
import DataState from '@/components/DataState'

export default function BranchesPage() {
  const { can, refresh } = useSession()
  const navigate = useNavigate()
  const canSeeRecords = can('branches:permits:read') || can('branches:lease:read')
  const branches = useResource(adminApi.listBranches)
  const [editing, setEditing] = useState<BranchWithUsage | null>(null)
  const [acting, setActing] = useState<BranchWithUsage | null>(null)
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)

  const canWrite = can('branches:write')
  const form = useForm({
    initialValues: { name: '', isActive: true },
    validate: zodResolver(createBranchSchema),
  })

  async function run(action: () => Promise<unknown>, message: string, onDone?: () => void) {
    setSaving(true)
    try {
      await action()
      await branches.reload()
      // The header, the branch badge and the visible nav all read from the
      // session, so a write here can leave them stale — most visibly when you
      // edit your own account. Refreshed unconditionally rather than only when
      // the row is "me": changing a role you hold, or renaming your branch,
      // changes what you see without touching your own user row.
      await refresh()
      notifications.show({ color: 'green', title: 'Done', message })
      onDone?.()
    } catch (e) {
      notifications.show({ color: 'red', title: 'Failed', message: e instanceof Error ? e.message : 'Something went wrong' })
    } finally {
      setSaving(false)
    }
  }

  const isEditing = editing !== null

  function confirmDelete(branch: BranchWithUsage) {
    modals.openConfirmModal({
      title: `Delete ${branch.name}?`,
      children: (
        <Text size="sm">
          {branch.userCount > 0
            ? `${branch.userCount} user(s) are assigned here. Reassign them first, or deactivate the branch instead of deleting it.`
            : 'This branch has no users assigned and will be removed permanently.'}
        </Text>
      ),
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red', disabled: branch.userCount > 0 },
      onConfirm: () => void run(() => adminApi.deleteBranch(branch.id), 'Branch deleted'),
    })
  }

  return (
    <>
      <PageHeader
        title="Branches"
        description="Your bakery locations. Users can be assigned to one."
        action={
          canWrite && (
            <Button
              leftSection={<IconPlus size={16} />}
              onClick={() => { form.setValues({ name: '', isActive: true }); form.clearErrors(); setCreating(true) }}
            >
              Add branch
            </Button>
          )
        }
      />

      <DataState loading={branches.loading} error={branches.error} empty={branches.data?.length === 0} emptyMessage="No branches yet">
        <Table.ScrollContainer minWidth={520}>
          <Table highlightOnHover verticalSpacing="sm" striped="odd">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Branch</Table.Th>
                <Table.Th w={110}>Users</Table.Th>
                <Table.Th w={150}>Permits</Table.Th>
                <Table.Th w={120}>Status</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(branches.data ?? []).map(branch => (
                <Table.Tr
                  key={branch.id}
                  opacity={branch.isActive ? 1 : 0.55}
                  {...rowActionProps(canWrite, () => setActing(branch))}
                >
                  <Table.Td><Text fw={500}>{branch.name}</Text></Table.Td>
                  <Table.Td>
                    <Badge variant="light" color={branch.userCount > 0 ? 'blue' : 'gray'}>{branch.userCount}</Badge>
                  </Table.Td>
                  <Table.Td>
                    {(() => {
                      if (!branch.permits) return <Text size="sm" c="dimmed">—</Text>
                      const { state, count } = branchPermitStatus(branch.permits)
                      if (state === 'overdue') return <Badge color="red" variant="light">{count} expired</Badge>
                      if (state === 'due') return <Badge color="orange" variant="light">{count} due soon</Badge>
                      if (branch.permits.length === 0) return <Text size="sm" c="dimmed">none recorded</Text>
                      return <Badge color="green" variant="light">{branch.permits.length} current</Badge>
                    })()}
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light" color={branch.isActive ? 'green' : 'gray'}>
                      {branch.isActive ? 'Active' : 'Inactive'}
                    </Badge>
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
        subtitle={acting ? `${acting.userCount} user(s) · ${acting.isActive ? 'Active' : 'Inactive'}` : undefined}
        actions={
          acting
            ? ([
                ...(canSeeRecords
                  ? [{
                      label: 'Permits & lease',
                      icon: <IconFileText size={18} />,
                      onClick: () => navigate(`/admin/branches/${acting.id}`),
                    }]
                  : []),
                {
                  label: 'Edit',
                  icon: <IconPencil size={18} />,
                  onClick: () => {
                    form.setValues({ name: acting.name, isActive: acting.isActive })
                    form.clearErrors()
                    setEditing(acting)
                  },
                },
                {
                  label: 'Delete',
                  icon: <IconTrash size={18} />,
                  destructive: true,
                  disabled: acting.userCount > 0,
                  disabledReason: 'Users are assigned here — reassign them first',
                  onClick: () => confirmDelete(acting),
                },
              ] satisfies RowAction[])
            : []
        }
      />

      <Modal
        opened={creating || isEditing}
        onClose={() => { setCreating(false); setEditing(null) }}
        title={isEditing ? `Edit ${editing?.name}` : 'Add branch'}
        centered
      >
        <form
          onSubmit={form.onSubmit(values =>
            run(
              () => (isEditing ? adminApi.updateBranch(editing!.id, values) : adminApi.createBranch(values)),
              isEditing ? 'Branch updated' : `${values.name} added`,
              () => { setCreating(false); setEditing(null) }
            )
          )}
        >
          <Stack gap="md">
            <TextInput label="Branch name" placeholder="Malolos" withAsterisk {...form.getInputProps('name')} />
            <Switch
              label="Active"
              description="Inactive branches stay on record but are marked closed."
              {...form.getInputProps('isActive', { type: 'checkbox' })}
            />
            <Group justify="flex-end" mt="xs">
              <Button variant="default" onClick={() => { setCreating(false); setEditing(null) }}>Cancel</Button>
              <Button type="submit" loading={saving}>{isEditing ? 'Save changes' : 'Add branch'}</Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </>
  )
}
