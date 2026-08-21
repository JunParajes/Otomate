import { useState } from 'react'
import { ActionIcon, Badge, Button, Group, Modal, Stack, Switch, Table, Text, TextInput } from '@mantine/core'
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
import { useSession } from '@/lib/session'
import PageHeader from '@/components/PageHeader'
import DataState from '@/components/DataState'

export default function BranchesPage() {
  const { can } = useSession()
  const branches = useResource(adminApi.listBranches)
  const [editing, setEditing] = useState<BranchWithUsage | null>(null)
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
                <Table.Th w={120}>Status</Table.Th>
                <Table.Th w={100} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(branches.data ?? []).map(branch => (
                <Table.Tr key={branch.id} opacity={branch.isActive ? 1 : 0.55}>
                  <Table.Td><Text fw={500}>{branch.name}</Text></Table.Td>
                  <Table.Td>
                    <Badge variant="light" color={branch.userCount > 0 ? 'blue' : 'gray'}>{branch.userCount}</Badge>
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light" color={branch.isActive ? 'green' : 'gray'}>
                      {branch.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    {canWrite && (
                      <Group gap={4} wrap="nowrap">
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          aria-label={`Edit ${branch.name}`}
                          onClick={() => {
                            form.setValues({ name: branch.name, isActive: branch.isActive })
                            form.clearErrors()
                            setEditing(branch)
                          }}
                        >
                          <IconPencil size={16} />
                        </ActionIcon>
                        <ActionIcon variant="subtle" color="red" aria-label={`Delete ${branch.name}`} onClick={() => confirmDelete(branch)}>
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
