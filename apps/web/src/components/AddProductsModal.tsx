import { useMemo, useState } from 'react'
import {
  ActionIcon, Badge, Box, Button, Group, Modal, ScrollArea, SimpleGrid, Stack, Text, TextInput,
} from '@mantine/core'
import { IconCheck, IconSearch, IconX } from '@tabler/icons-react'
import { formatMoney, type Product } from '@otomate/shared'
import classes from './AddProductsModal.module.css'

interface Props {
  opened: boolean
  onClose: () => void
  products: Product[]
  /** Products already on the report — shown as taken, never selectable. */
  alreadyAdded: Set<string>
  onAdd: (productIds: string[]) => void
}

/**
 * Picking products to add, built for a tablet.
 *
 * The old control was a searchable Select, which summons the on-screen keyboard
 * the moment it opens and then covers half the screen — exactly when you are
 * trying to look through a long catalogue. So: a near-fullscreen sheet, products
 * as cards grouped under their category, and the search box deliberately NOT
 * focused on open. Tap search only if typing is genuinely faster than looking.
 *
 * Several can be ticked and added in one go, because adding products one at a
 * time through a modal would be worse than what it replaces.
 */
export default function AddProductsModal({ opened, onClose, products, alreadyAdded, onAdd }: Props) {
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase()
    const matches = products.filter(p => {
      if (!p.isActive) return false
      if (!q) return true
      return p.name.toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q)
    })

    const byCategory = new Map<string, { name: string; items: Product[] }>()
    for (const p of matches) {
      const entry = byCategory.get(p.category.id) ?? { name: p.category.name, items: [] }
      entry.items.push(p)
      byCategory.set(p.category.id, entry)
    }
    for (const entry of byCategory.values()) {
      entry.items.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    }
    return [...byCategory.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [products, search])

  const toggle = (id: string) =>
    setPicked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const close = () => {
    setPicked(new Set())
    setSearch('')
    onClose()
  }

  const confirm = () => {
    onAdd([...picked])
    close()
  }

  const availableCount = grouped.reduce(
    (n, g) => n + g.items.filter(p => !alreadyAdded.has(p.id)).length,
    0
  )

  return (
    <Modal
      opened={opened}
      onClose={close}
      title="Add products"
      size="90%"
      centered
      // Nothing is focused on open, which is the point: autofocus here would
      // raise the keyboard and hide the catalogue being browsed.
      trapFocus={false}
      scrollAreaComponent={ScrollArea.Autosize}
      classNames={{ body: classes.body }}
    >
      <Stack gap="sm" h="100%">
        <TextInput
          placeholder="Search by name or code"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={e => setSearch(e.currentTarget.value)}
          rightSection={
            search ? (
              <ActionIcon variant="subtle" color="gray" onClick={() => setSearch('')} aria-label="Clear search">
                <IconX size={14} />
              </ActionIcon>
            ) : null
          }
        />

        <ScrollArea.Autosize mah="60vh" type="auto" offsetScrollbars>
          <Stack gap="lg">
            {grouped.map(group => (
              <Box key={group.name}>
                <Text size="xs" fw={700} c="dimmed" tt="uppercase" mb={6}>
                  {group.name}
                </Text>
                <SimpleGrid cols={{ base: 2, sm: 3, lg: 4 }} spacing="xs">
                  {group.items.map(p => {
                    const taken = alreadyAdded.has(p.id)
                    const chosen = picked.has(p.id)
                    return (
                      <button
                        key={p.id}
                        type="button"
                        disabled={taken}
                        onClick={() => toggle(p.id)}
                        className={[classes.card, chosen ? classes.chosen : '', taken ? classes.taken : '']
                          .filter(Boolean)
                          .join(' ')}
                      >
                        <Group justify="space-between" wrap="nowrap" gap={4}>
                          <Text size="sm" fw={600} lineClamp={2} ta="left">{p.name}</Text>
                          {chosen && <IconCheck size={16} />}
                        </Group>
                        <Group justify="space-between" wrap="nowrap" mt={4}>
                          <Text size="xs" c="dimmed">{formatMoney(p.priceCents)}</Text>
                          {taken && <Badge size="xs" variant="light" color="gray">on the form</Badge>}
                        </Group>
                      </button>
                    )
                  })}
                </SimpleGrid>
              </Box>
            ))}

            {availableCount === 0 && (
              <Text c="dimmed" ta="center" py="xl">
                {search
                  ? 'Nothing matches that search'
                  : 'Every product is already on this form'}
              </Text>
            )}
          </Stack>
        </ScrollArea.Autosize>

        <Group justify="space-between" wrap="nowrap">
          <Text size="sm" c="dimmed">
            {picked.size === 0 ? 'Tap products to add them' : `${picked.size} selected`}
          </Text>
          <Group gap="xs">
            <Button variant="default" onClick={close}>Cancel</Button>
            <Button onClick={confirm} disabled={picked.size === 0}>
              Add {picked.size > 0 ? picked.size : ''}
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  )
}
