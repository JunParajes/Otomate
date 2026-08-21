import { Checkbox, Grid, Paper, Stack, Text } from '@mantine/core'
import type { Permission } from '@otomate/shared'

interface Props {
  permissions: Permission[]
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
}

/**
 * Permissions grouped by category across columns — on a laptop or tablet the
 * whole catalog is visible at once, so composing a role is a single glance
 * rather than a scroll.
 */
export default function PermissionPicker({ permissions, value, onChange, disabled }: Props) {
  const groups = permissions.reduce<Record<string, Permission[]>>((acc, p) => {
    const key = p.category ?? 'Other'
    ;(acc[key] ??= []).push(p)
    return acc
  }, {})

  const toggle = (name: string, checked: boolean) => {
    onChange(checked ? [...value, name] : value.filter(v => v !== name))
  }

  return (
    <Grid gap="sm">
      {Object.entries(groups).map(([category, items]) => (
        <Grid.Col key={category} span={{ base: 12, sm: 6 }}>
          <Paper withBorder p="sm" radius="md" h="100%">
            <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb="xs">
              {category}
            </Text>
            <Stack gap="xs">
              {items.map(p => (
                <Checkbox
                  key={p.id}
                  size="sm"
                  disabled={disabled}
                  checked={value.includes(p.name)}
                  onChange={e => toggle(p.name, e.currentTarget.checked)}
                  label={
                    <Stack gap={0}>
                      <Text size="sm" lh={1.3}>
                        {p.description ?? p.name}
                      </Text>
                      <Text size="xs" c="dimmed" ff="monospace" lh={1.3}>
                        {p.name}
                      </Text>
                    </Stack>
                  }
                />
              ))}
            </Stack>
          </Paper>
        </Grid.Col>
      ))}
    </Grid>
  )
}
