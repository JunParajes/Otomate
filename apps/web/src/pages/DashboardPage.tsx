import { Link } from 'react-router-dom'
import { Badge, Card, Grid, Group, SimpleGrid, Stack, Text, Title, UnstyledButton } from '@mantine/core'
import { IconBuildingStore, IconCategory, IconShieldLock, IconToolsKitchen2, IconUsers } from '@tabler/icons-react'
import type { PermissionName } from '@otomate/shared'
import { useSession } from '@/lib/session'
import PageHeader from '@/components/PageHeader'

const SHORTCUTS = [
  { label: 'Products', to: '/catalog/products', icon: IconToolsKitchen2, permission: 'products:read' as PermissionName, hint: 'Your catalogue and prices' },
  { label: 'Categories', to: '/catalog/categories', icon: IconCategory, permission: 'products:read' as PermissionName, hint: 'Group products by type' },
  { label: 'Users', to: '/admin/users', icon: IconUsers, permission: 'users:read' as PermissionName, hint: 'Add staff, set roles and branches' },
  { label: 'Roles', to: '/admin/roles', icon: IconShieldLock, permission: 'roles:read' as PermissionName, hint: 'Bundle permissions into roles' },
  { label: 'Branches', to: '/admin/branches', icon: IconBuildingStore, permission: 'branches:read' as PermissionName, hint: 'Manage bakery locations' },
]

export default function DashboardPage() {
  const { user, can } = useSession()
  const available = SHORTCUTS.filter(s => can(s.permission))

  return (
    <>
      <PageHeader title={`Welcome, ${user?.name ?? ''}`} description="Otomate Bakery Management" />

      <Grid gap="lg">
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Card withBorder padding="lg" radius="md" h="100%">
            <Title order={3} size="h5" mb="md">Your account</Title>
            <Stack gap="sm">
              <Group justify="space-between">
                <Text size="sm" c="dimmed">Role</Text>
                <Badge variant="light">{user?.role.name}</Badge>
              </Group>
              <Group justify="space-between">
                <Text size="sm" c="dimmed">Branch</Text>
                <Text size="sm">{user?.branch?.name ?? 'Unassigned'}</Text>
              </Group>
              <Group justify="space-between">
                <Text size="sm" c="dimmed">Permissions</Text>
                <Text size="sm">{user?.isSuperAdmin ? 'All (Super Admin)' : `${user?.permissions.length ?? 0} granted`}</Text>
              </Group>
            </Stack>
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 7 }}>
          <Card withBorder padding="lg" radius="md" h="100%">
            <Title order={3} size="h5" mb="md">Quick actions</Title>
            {available.length === 0 ? (
              <Text size="sm" c="dimmed">You don't have access to any admin areas yet.</Text>
            ) : (
              <SimpleGrid cols={{ base: 1, sm: available.length > 2 ? 3 : 2 }} spacing="sm">
                {available.map(s => (
                  <UnstyledButton key={s.to} component={Link} to={s.to}>
                    <Card withBorder padding="md" radius="md" h="100%">
                      <Stack gap={6}>
                        <s.icon size={22} stroke={1.6} />
                        <Text fw={600} size="sm">{s.label}</Text>
                        <Text size="xs" c="dimmed" lh={1.3}>{s.hint}</Text>
                      </Stack>
                    </Card>
                  </UnstyledButton>
                ))}
              </SimpleGrid>
            )}
          </Card>
        </Grid.Col>
      </Grid>
    </>
  )
}
