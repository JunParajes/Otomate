import { useState } from 'react'
import { Badge, Button, Group, Modal, NumberInput, Stack, Switch, Table, Text, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
// zod4Resolver, not zodResolver: the latter reads error.errors (zod 3);
// on zod 4 that is undefined and validation throws instead of showing messages.
import { zod4Resolver as zodResolver } from 'mantine-form-zod-resolver'
import { notifications } from '@mantine/notifications'
import { modals } from '@mantine/modals'
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react'
import { createPositionSchema, type EmployeePositionRecord } from '@otomate/shared'
import { positionApi } from '@/lib/employees'
import { useResource } from '@/hooks/useResource'
import RowActionsSheet, { rowActionProps, type RowAction } from '@/components/RowActionsSheet'
import { useSession } from '@/lib/session'
import PageHeader from '@/components/PageHeader'
import DataState from '@/components/DataState'

/**
 * The job roles a branch can assign.
 *
 * These were a fixed list in the code until 2026-09-02, which meant a new role —
 * a pastry chef, a delivery helper — needed a deploy. They are rows now.
 *
 * Deliberately its own page rather than a section on Categories: that page is
 * gated on `products:read`, so putting positions there would show employee job
 * roles to anyone who can see the product catalogue.
 */
export default function PositionsPage() {
  const { can } = useSession()
  const positions = useResource(positionApi.list)
  const [editing, setEditing] = useState<EmployeePositionRecord | null>(null)
  const [acting, setActing] = useState<EmployeePositionRecord | null>(null)
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)

  const canWrite = can('positions:write')
  const form = useForm({
    initialValues: { name: '', isActive: true, sortOrder: 0 },
    validate: zodResolver(createPositionSchema),
  })

  async function run(action: () => Promise<unknown>, message: string, done?: () => void) {
    setSaving(true)
    try {
      await action()
      await positions.reload()
      notifications.show({ color: 'green', title: 'Done', message })
      done?.()
    } catch (e) {
      notifications.show({ color: 'red', title: 'Failed', message: e instanceof Error ? e.message : 'Something went wrong' })
    } finally {
      setSaving(false)
    }
  }

  const isEditing = editing !== null

  /**
   * A position somebody holds cannot be deleted — the foreign key is RESTRICT,
   * and the answer is almost never "delete it anyway" but "stop offering it to
   * new records", which is what deactivating does.
   */
  function confirmDelete(p: EmployeePositionRecord) {
    modals.openConfirmModal({
      title: `Delete ${p.name}?`,
      children: (
        <Text size="sm">
          {p.employeeCount > 0
            ? `${p.employeeCount} employee(s) still hold this position. Move them to another position first, or deactivate this one instead.`
            : 'No one holds this position and it will be removed permanently.'}
        </Text>
      ),
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red', disabled: p.employeeCount > 0 },
      onConfirm: () => void run(() => positionApi.remove(p.id), 'Position deleted'),
    })
  }

  return (
    <>
      <PageHeader
        title="Positions"
        description="The job roles staff can be assigned — baker, frontliner, driver, and any others you take on."
        action={
          canWrite && (
            <Button
              leftSection={<IconPlus size={16} />}
              onClick={() => { form.setValues({ name: '', isActive: true, sortOrder: 0 }); form.clearErrors(); setCreating(true) }}
            >
              Add position
            </Button>
          )
        }
      />

      <DataState
        loading={positions.loading}
        error={positions.error}
        empty={positions.data?.length === 0}
        emptyMessage="No positions yet — add Baker to get started"
      >
        <Table.ScrollContainer minWidth={520}>
          <Table highlightOnHover verticalSpacing="sm" striped="odd">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Position</Table.Th>
                <Table.Th w={110}>Staff</Table.Th>
                <Table.Th w={110}>Status</Table.Th>
                <Table.Th w={90}>Order</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(positions.data ?? []).map(p => (
                <Table.Tr
                  key={p.id}
                  opacity={p.isActive ? 1 : 0.55}
                  {...rowActionProps(canWrite, () => setActing(p))}
                >
                  <Table.Td><Text fw={500}>{p.name}</Text></Table.Td>
                  <Table.Td><Badge variant="light" color={p.employeeCount > 0 ? 'blue' : 'gray'}>{p.employeeCount}</Badge></Table.Td>
                  <Table.Td><Badge variant="light" color={p.isActive ? 'green' : 'gray'}>{p.isActive ? 'Active' : 'Inactive'}</Badge></Table.Td>
                  <Table.Td><Text size="sm" c="dimmed">{p.sortOrder}</Text></Table.Td>
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
        subtitle={acting ? `${acting.employeeCount} employee(s) · ${acting.isActive ? 'Active' : 'Inactive'}` : undefined}
        actions={
          acting
            ? ([
                {
                  label: 'Edit',
                  icon: <IconPencil size={18} />,
                  onClick: () => {
                    form.setValues({ name: acting.name, isActive: acting.isActive, sortOrder: acting.sortOrder })
                    form.clearErrors()
                    setEditing(acting)
                  },
                },
                {
                  label: 'Delete',
                  icon: <IconTrash size={18} />,
                  destructive: true,
                  disabled: acting.employeeCount > 0,
                  disabledReason: 'Staff hold this position — move them first',
                  onClick: () => confirmDelete(acting),
                },
              ] satisfies RowAction[])
            : []
        }
      />

      <Modal
        opened={creating || isEditing}
        onClose={() => { setCreating(false); setEditing(null) }}
        title={isEditing ? `Edit ${editing?.name}` : 'Add position'}
        centered
      >
        <form onSubmit={form.onSubmit(values =>
          run(
            () => (isEditing ? positionApi.update(editing!.id, values) : positionApi.create(values)),
            isEditing ? 'Position updated' : `${values.name} added`,
            () => { setCreating(false); setEditing(null) }
          )
        )}>
          <Stack gap="md">
            <TextInput label="Name" placeholder="Pastry Chef" withAsterisk {...form.getInputProps('name')} />
            <Group grow align="flex-start">
              <NumberInput label="Sort order" description="Lower shows first" min={0} max={9999} {...form.getInputProps('sortOrder')} />
              {/*
                Renaming is safe — employees point at the id, not the name — so
                deactivating is only about keeping a retired role out of the
                picker without disturbing anyone who still holds it.
              */}
              <Switch label="Active" mt="xl" {...form.getInputProps('isActive', { type: 'checkbox' })} />
            </Group>
            <Group justify="flex-end" mt="xs">
              <Button variant="default" onClick={() => { setCreating(false); setEditing(null) }}>Cancel</Button>
              <Button type="submit" loading={saving}>{isEditing ? 'Save changes' : 'Add position'}</Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </>
  )
}
