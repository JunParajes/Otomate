import { useState } from 'react'
import { Badge, Button, Group, Modal, NumberInput, Stack, Switch, Table, Text, TextInput, Textarea } from '@mantine/core'
import { useForm } from '@mantine/form'
// zod4Resolver, not zodResolver: the latter reads error.errors (zod 3);
// on zod 4 that is undefined and validation throws instead of showing messages.
import { zod4Resolver as zodResolver } from 'mantine-form-zod-resolver'
import { notifications } from '@mantine/notifications'
import { modals } from '@mantine/modals'
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react'
import { createCategorySchema, type CategoryWithUsage } from '@otomate/shared'
import { catalogApi } from '@/lib/catalog'
import { useResource } from '@/hooks/useResource'
import RowActionsSheet, { rowActionProps, type RowAction } from '@/components/RowActionsSheet'
import { useSession } from '@/lib/session'
import PageHeader from '@/components/PageHeader'
import DataState from '@/components/DataState'

export default function CategoriesPage() {
  const { can } = useSession()
  const categories = useResource(catalogApi.listCategories)
  const [editing, setEditing] = useState<CategoryWithUsage | null>(null)
  const [acting, setActing] = useState<CategoryWithUsage | null>(null)
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)

  const canWrite = can('categories:write')
  const form = useForm({
    initialValues: { name: '', description: '', isActive: true, sortOrder: 0 },
    validate: zodResolver(createCategorySchema),
  })

  async function run(action: () => Promise<unknown>, message: string, done?: () => void) {
    setSaving(true)
    try {
      await action()
      await categories.reload()
      notifications.show({ color: 'green', title: 'Done', message })
      done?.()
    } catch (e) {
      notifications.show({ color: 'red', title: 'Failed', message: e instanceof Error ? e.message : 'Something went wrong' })
    } finally {
      setSaving(false)
    }
  }

  const isEditing = editing !== null

  function confirmDelete(c: CategoryWithUsage) {
    modals.openConfirmModal({
      title: `Delete ${c.name}?`,
      children: (
        <Text size="sm">
          {c.productCount > 0
            ? `${c.productCount} product(s) are still in this category. Move them to another category first, or deactivate this one instead.`
            : 'This category has no products and will be removed permanently.'}
        </Text>
      ),
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red', disabled: c.productCount > 0 },
      onConfirm: () => void run(() => catalogApi.deleteCategory(c.id), 'Category deleted'),
    })
  }

  return (
    <>
      <PageHeader
        title="Categories"
        description="Group products — bread, softdrinks, cakes, and so on."
        action={
          canWrite && (
            <Button
              leftSection={<IconPlus size={16} />}
              onClick={() => { form.setValues({ name: '', description: '', isActive: true, sortOrder: 0 }); form.clearErrors(); setCreating(true) }}
            >
              Add category
            </Button>
          )
        }
      />

      <DataState loading={categories.loading} error={categories.error} empty={categories.data?.length === 0} emptyMessage="No categories yet — add Bread to get started">
        <Table.ScrollContainer minWidth={560}>
          <Table highlightOnHover verticalSpacing="sm" striped="odd">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Category</Table.Th>
                <Table.Th w={110}>Products</Table.Th>
                <Table.Th w={110}>Status</Table.Th>
                <Table.Th w={90}>Order</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(categories.data ?? []).map(c => (
                <Table.Tr
                  key={c.id}
                  opacity={c.isActive ? 1 : 0.55}
                  {...rowActionProps(canWrite, () => setActing(c))}
                >
                  <Table.Td>
                    <Stack gap={2}>
                      <Text fw={500}>{c.name}</Text>
                      {c.description && <Text size="xs" c="dimmed">{c.description}</Text>}
                    </Stack>
                  </Table.Td>
                  <Table.Td><Badge variant="light" color={c.productCount > 0 ? 'blue' : 'gray'}>{c.productCount}</Badge></Table.Td>
                  <Table.Td><Badge variant="light" color={c.isActive ? 'green' : 'gray'}>{c.isActive ? 'Active' : 'Inactive'}</Badge></Table.Td>
                  <Table.Td><Text size="sm" c="dimmed">{c.sortOrder}</Text></Table.Td>
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
        subtitle={acting ? `${acting.productCount} product(s) · ${acting.isActive ? 'Active' : 'Inactive'}` : undefined}
        actions={
          acting
            ? ([
                {
                  label: 'Edit',
                  icon: <IconPencil size={18} />,
                  onClick: () => {
                    form.setValues({ name: acting.name, description: acting.description ?? '', isActive: acting.isActive, sortOrder: acting.sortOrder })
                    form.clearErrors()
                    setEditing(acting)
                  },
                },
                {
                  label: 'Delete',
                  icon: <IconTrash size={18} />,
                  destructive: true,
                  disabled: acting.productCount > 0,
                  disabledReason: 'Products use this category — move them first',
                  onClick: () => confirmDelete(acting),
                },
              ] satisfies RowAction[])
            : []
        }
      />

      <Modal opened={creating || isEditing} onClose={() => { setCreating(false); setEditing(null) }} title={isEditing ? `Edit ${editing?.name}` : 'Add category'} centered>
        <form onSubmit={form.onSubmit(values =>
          run(
            () => (isEditing
              ? catalogApi.updateCategory(editing!.id, { ...values, description: values.description || null })
              : catalogApi.createCategory({ ...values, description: values.description || null })),
            isEditing ? 'Category updated' : `${values.name} added`,
            () => { setCreating(false); setEditing(null) }
          )
        )}>
          <Stack gap="md">
            <TextInput label="Name" placeholder="Bread" withAsterisk {...form.getInputProps('name')} />
            <Textarea label="Description" placeholder="Optional" autosize minRows={1} maxRows={3} {...form.getInputProps('description')} />
            <Group grow align="flex-start">
              <NumberInput label="Sort order" description="Lower shows first" min={0} max={9999} {...form.getInputProps('sortOrder')} />
              <Switch label="Active" mt="xl" {...form.getInputProps('isActive', { type: 'checkbox' })} />
            </Group>
            <Group justify="flex-end" mt="xs">
              <Button variant="default" onClick={() => { setCreating(false); setEditing(null) }}>Cancel</Button>
              <Button type="submit" loading={saving}>{isEditing ? 'Save changes' : 'Add category'}</Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </>
  )
}
