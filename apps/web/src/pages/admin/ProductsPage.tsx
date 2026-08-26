import { useMemo, useState } from 'react'
import {
  Avatar, Badge, Button, Group, Modal, NumberInput, Select, Stack, Switch, Table, Text,
  TextInput, Textarea, Tooltip,
} from '@mantine/core'
import { useForm } from '@mantine/form'
// zod4Resolver, not zodResolver: the latter reads error.errors (zod 3);
// on zod 4 that is undefined and validation throws instead of showing messages.
import { zod4Resolver as zodResolver } from 'mantine-form-zod-resolver'
import { notifications } from '@mantine/notifications'
import { modals } from '@mantine/modals'
import { IconPackageOff, IconPackage, IconPencil, IconPhoto, IconPlus, IconSearch } from '@tabler/icons-react'
import {
  PRODUCT_UNITS, createProductSchema, formatMoney, marginPercent, type Product,
} from '@otomate/shared'
import { catalogApi } from '@/lib/catalog'
import RowActionsSheet, { rowActionProps, type RowAction } from '@/components/RowActionsSheet'
import { useResource } from '@/hooks/useResource'
import { useSession } from '@/lib/session'
import PageHeader from '@/components/PageHeader'
import DataState from '@/components/DataState'
import MoneyInput from '@/components/MoneyInput'
import ImageDropzone from '@/components/ImageDropzone'

const UNIT_LABELS: Record<string, string> = {
  PIECE: 'per piece', PACK: 'per pack', KILO: 'per kilo', TRAY: 'per tray', BOX: 'per box',
}

export default function ProductsPage() {
  const { can } = useSession()
  const products = useResource(catalogApi.listProducts)
  const categories = useResource(catalogApi.listCategories)

  const [editing, setEditing] = useState<Product | null>(null)
  const [creating, setCreating] = useState(false)
  const [acting, setActing] = useState<Product | null>(null)
  const [saving, setSaving] = useState(false)
  const [pendingImage, setPendingImage] = useState<File | null>(null)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)

  const canWrite = can('products:write')
  const canSeeCost = can('products:cost')
  const categoryOptions = (categories.data ?? []).map(c => ({ value: c.id, label: c.name }))

  const form = useForm({
    initialValues: {
      name: '', sku: '', description: '', categoryId: '',
      priceCents: null as number | null, costCents: null as number | null,
      unit: 'PIECE', isActive: true, sortOrder: 0,
    },
    validate: zodResolver(createProductSchema.partial({ priceCents: true })),
  })

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (products.data ?? []).filter(p => {
      if (categoryFilter && p.category.id !== categoryFilter) return false
      if (!q) return true
      return p.name.toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q)
    })
  }, [products.data, search, categoryFilter])

  function openCreate() {
    form.setValues({ name: '', sku: '', description: '', categoryId: categoryOptions[0]?.value ?? '', priceCents: null, costCents: null, unit: 'PIECE', isActive: true, sortOrder: 0 })
    form.clearErrors(); setPendingImage(null); setCreating(true)
  }

  function openEdit(p: Product) {
    form.setValues({
      name: p.name, sku: p.sku ?? '', description: p.description ?? '', categoryId: p.category.id,
      priceCents: p.priceCents, costCents: p.costCents ?? null, unit: p.unit,
      isActive: p.isActive, sortOrder: p.sortOrder,
    })
    form.clearErrors(); setPendingImage(null); setEditing(p)
  }

  async function run(action: () => Promise<unknown>, message: string, done?: () => void) {
    setSaving(true)
    try {
      await action()
      await products.reload()
      notifications.show({ color: 'green', title: 'Done', message })
      done?.()
    } catch (e) {
      notifications.show({ color: 'red', title: 'Failed', message: e instanceof Error ? e.message : 'Something went wrong' })
    } finally {
      setSaving(false)
    }
  }

  /** The image endpoint needs an id, so it is uploaded after the product exists. */
  async function submit(values: typeof form.values) {
    const payload = {
      name: values.name,
      sku: values.sku.trim() || null,
      description: values.description.trim() || null,
      categoryId: values.categoryId,
      priceCents: values.priceCents ?? 0,
      unit: values.unit as (typeof PRODUCT_UNITS)[number],
      isActive: values.isActive,
      sortOrder: values.sortOrder,
      ...(canSeeCost && { costCents: values.costCents }),
    }
    await run(
      async () => {
        const saved = editing
          ? await catalogApi.updateProduct(editing.id, payload)
          : await catalogApi.createProduct(payload)
        if (pendingImage) await catalogApi.uploadImage(saved.id, pendingImage)
      },
      editing ? 'Product updated' : `${values.name} added`,
      () => { setCreating(false); setEditing(null); setPendingImage(null) }
    )
  }

  function confirmToggle(p: Product) {
    const off = p.isActive
    modals.openConfirmModal({
      title: off ? `Deactivate ${p.name}?` : `Reactivate ${p.name}?`,
      children: <Text size="sm">{off ? 'It stays on record and in past reports, but is hidden from active listings.' : 'It will appear in active listings again.'}</Text>,
      labels: { confirm: off ? 'Deactivate' : 'Reactivate', cancel: 'Cancel' },
      confirmProps: { color: off ? 'red' : 'green' },
      onConfirm: () => void run(
        () => (off ? catalogApi.deactivateProduct(p.id) : catalogApi.updateProduct(p.id, { isActive: true })),
        off ? 'Product deactivated' : 'Product reactivated'
      ),
    })
  }

  const isEditing = editing !== null
  const noCategories = (categories.data ?? []).length === 0

  return (
    <>
      <PageHeader
        title="Products"
        description="Your catalogue — what you sell, and for how much."
        action={
          canWrite && (
            <Tooltip label="Add a category first" disabled={!noCategories}>
              <Button leftSection={<IconPlus size={16} />} onClick={openCreate} disabled={noCategories}>
                Add product
              </Button>
            </Tooltip>
          )
        }
      />

      <Group mb="md" gap="sm" wrap="wrap">
        <TextInput
          placeholder="Search name or code"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={e => setSearch(e.currentTarget.value)}
          w={{ base: '100%', xs: 280 }}
        />
        <Select
          placeholder="All categories"
          data={categoryOptions}
          value={categoryFilter}
          onChange={setCategoryFilter}
          clearable
          w={{ base: '100%', xs: 200 }}
        />
        {visible.length !== (products.data ?? []).length && (
          <Text size="sm" c="dimmed">{visible.length} of {products.data?.length} shown</Text>
        )}
      </Group>

      <DataState
        loading={products.loading}
        error={products.error}
        empty={visible.length === 0}
        emptyMessage={noCategories ? 'Add a category first, then add products' : 'No products match'}
      >
        <Table.ScrollContainer minWidth={canSeeCost ? 900 : 760}>
          <Table highlightOnHover verticalSpacing="sm" striped="odd">
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={64} />
                <Table.Th>Product</Table.Th>
                <Table.Th>Category</Table.Th>
                <Table.Th w={140}>Price</Table.Th>
                {canSeeCost && <Table.Th w={150}>Cost / margin</Table.Th>}
                <Table.Th w={110}>Status</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {visible.map(p => {
                const margin = canSeeCost ? marginPercent(p.priceCents, p.costCents ?? null) : null
                return (
                  <Table.Tr
                    key={p.id}
                    opacity={p.isActive ? 1 : 0.55}
                    {...rowActionProps(canWrite, () => setActing(p))}
                  >
                    <Table.Td>
                      <Avatar src={p.imageUrl} radius="sm" size={44}>
                        <IconPhoto size={18} opacity={0.5} />
                      </Avatar>
                    </Table.Td>
                    <Table.Td>
                      <Stack gap={2}>
                        <Text fw={500}>{p.name}</Text>
                        {p.sku && <Text size="xs" c="dimmed" ff="monospace">{p.sku}</Text>}
                      </Stack>
                    </Table.Td>
                    <Table.Td><Badge variant="light" color="gray">{p.category.name}</Badge></Table.Td>
                    <Table.Td>
                      <Stack gap={0}>
                        <Text fw={600}>{formatMoney(p.priceCents)}</Text>
                        <Text size="xs" c="dimmed">{UNIT_LABELS[p.unit] ?? p.unit}</Text>
                      </Stack>
                    </Table.Td>
                    {canSeeCost && (
                      <Table.Td>
                        {p.costCents == null ? (
                          <Text size="sm" c="dimmed">—</Text>
                        ) : (
                          <Stack gap={0}>
                            <Text size="sm">{formatMoney(p.costCents)}</Text>
                            {margin !== null && (
                              <Text size="xs" c={margin < 0 ? 'red' : margin < 20 ? 'orange' : 'green'}>
                                {margin}% margin
                              </Text>
                            )}
                          </Stack>
                        )}
                      </Table.Td>
                    )}
                    <Table.Td>
                      <Badge variant="light" color={p.isActive ? 'green' : 'gray'}>{p.isActive ? 'Active' : 'Inactive'}</Badge>
                    </Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </DataState>

      <RowActionsSheet
        opened={acting !== null}
        onClose={() => setActing(null)}
        title={acting?.name ?? ''}
        subtitle={acting ? `${acting.category.name} · ${formatMoney(acting.priceCents)} per ${acting.unit.toLowerCase()}` : undefined}
        actions={
          acting
            ? ([
                { label: 'Edit', icon: <IconPencil size={18} />, onClick: () => openEdit(acting) },
                {
                  label: acting.isActive ? 'Deactivate' : 'Reactivate',
                  icon: acting.isActive ? <IconPackageOff size={18} /> : <IconPackage size={18} />,
                  destructive: acting.isActive,
                  onClick: () => confirmToggle(acting),
                },
              ] satisfies RowAction[])
            : []
        }
      />

      <Modal
        opened={creating || isEditing}
        onClose={() => { setCreating(false); setEditing(null); setPendingImage(null) }}
        title={isEditing ? `Edit ${editing?.name}` : 'Add product'}
        size="xl"
        centered
      >
        <form onSubmit={form.onSubmit(submit)}>
          <Stack gap="md">
            <Group grow align="flex-start">
              <TextInput label="Product name" placeholder="Pandesal" withAsterisk {...form.getInputProps('name')} />
              <TextInput label="Product code" placeholder="BRD-001" description="Optional, must be unique" {...form.getInputProps('sku')} />
            </Group>

            <Group grow align="flex-start">
              <Select label="Category" data={categoryOptions} withAsterisk searchable {...form.getInputProps('categoryId')} />
              <Select
                label="Sold by"
                data={PRODUCT_UNITS.map(u => ({ value: u, label: UNIT_LABELS[u].replace('per ', '') }))}
                {...form.getInputProps('unit')}
              />
            </Group>

            <Group grow align="flex-start">
              <MoneyInput
                label="Selling price"
                withAsterisk
                value={form.values.priceCents}
                onChange={v => form.setFieldValue('priceCents', v)}
                error={form.errors.priceCents}
              />
              {canSeeCost && (
                <MoneyInput
                  label="Cost price"
                  description="What it costs you. Only visible with permission."
                  value={form.values.costCents}
                  onChange={v => form.setFieldValue('costCents', v)}
                  error={form.errors.costCents}
                />
              )}
            </Group>

            {canSeeCost && form.values.priceCents !== null && form.values.costCents !== null && (
              <Text size="sm" c="dimmed">
                Margin:{' '}
                <Text span fw={600} c={(marginPercent(form.values.priceCents, form.values.costCents) ?? 0) < 0 ? 'red' : 'green'}>
                  {marginPercent(form.values.priceCents, form.values.costCents)}%
                </Text>{' '}
                ({formatMoney(form.values.priceCents - form.values.costCents)} per {UNIT_LABELS[form.values.unit]?.replace('per ', '') ?? 'unit'})
              </Text>
            )}

            <Textarea label="Description" placeholder="Optional notes, ingredients, size" autosize minRows={2} maxRows={4} {...form.getInputProps('description')} />

            <Stack gap="xs">
              <Text size="sm" fw={500}>Photo</Text>
              <ImageDropzone
                imageUrl={editing?.imageUrl ?? null}
                pending={pendingImage}
                onSelect={setPendingImage}
                onRemoveExisting={
                  editing
                    ? () => void run(() => catalogApi.removeImage(editing.id), 'Image removed', () => setEditing({ ...editing, imageUrl: null }))
                    : undefined
                }
                disabled={saving}
              />
            </Stack>

            <Group grow align="flex-start">
              <NumberInput label="Sort order" description="Lower shows first" min={0} max={9999} {...form.getInputProps('sortOrder')} />
              <Switch label="Active" mt="xl" {...form.getInputProps('isActive', { type: 'checkbox' })} />
            </Group>

            <Group justify="flex-end" mt="xs">
              <Button variant="default" onClick={() => { setCreating(false); setEditing(null); setPendingImage(null) }}>Cancel</Button>
              <Button type="submit" loading={saving}>{isEditing ? 'Save changes' : 'Add product'}</Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </>
  )
}
