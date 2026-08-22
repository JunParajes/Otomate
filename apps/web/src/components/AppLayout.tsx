import { NavLink as RouterNavLink, useLocation } from 'react-router-dom'
import {
  AppShell,
  Avatar,
  Badge,
  Burger,
  Divider,
  Group,
  Menu,
  NavLink,
  ScrollArea,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import {
  IconBuildingStore,
  IconCategory,
  IconToolsKitchen2,
  IconChevronDown,
  IconKey,
  IconLayoutDashboard,
  IconLogout,
  IconShieldLock,
  IconUsers,
  IconId,
  IconClipboardList,
} from '@tabler/icons-react'
import type { PermissionName } from '@otomate/shared'
import { useSession } from '@/lib/session'

interface NavItem {
  label: string
  to: string
  icon: typeof IconUsers
  permission?: PermissionName
}

const MAIN: NavItem[] = [{ label: 'Dashboard', to: '/dashboard', icon: IconLayoutDashboard }]

const DAILY: NavItem[] = [
  { label: 'Daily Reports', to: '/dsir', icon: IconClipboardList, permission: 'dsir:read' },
]

const CATALOG: NavItem[] = [
  { label: 'Products', to: '/catalog/products', icon: IconToolsKitchen2, permission: 'products:read' },
  { label: 'Categories', to: '/catalog/categories', icon: IconCategory, permission: 'products:read' },
]

const ADMIN: NavItem[] = [
  { label: 'Users', to: '/admin/users', icon: IconUsers, permission: 'users:read' },
  { label: 'Employees', to: '/admin/employees', icon: IconId, permission: 'employees:read' },
  { label: 'Roles', to: '/admin/roles', icon: IconShieldLock, permission: 'roles:read' },
  { label: 'Branches', to: '/admin/branches', icon: IconBuildingStore, permission: 'branches:read' },
]

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [opened, { toggle, close }] = useDisclosure(false)
  const { user, can, signOut } = useSession()
  const location = useLocation()

  // Hidden rather than shown-and-blocked: a link you can't use is just noise.
  const adminItems = ADMIN.filter(item => !item.permission || can(item.permission))
  const catalogItems = CATALOG.filter(item => !item.permission || can(item.permission))
  const dailyItems = DAILY.filter(item => !item.permission || can(item.permission))

  const renderNav = (items: NavItem[]) =>
    items.map(item => (
      <NavLink
        key={item.to}
        component={RouterNavLink}
        to={item.to}
        label={item.label}
        leftSection={<item.icon size={18} stroke={1.6} />}
        active={location.pathname.startsWith(item.to)}
        onClick={close}
        variant="light"
      />
    ))

  return (
    <AppShell
      header={{ height: 56 }}
      // Fixed rail on tablet/laptop; collapses to a drawer only on phones.
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="lg"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Title order={1} size="h4" style={{ whiteSpace: 'nowrap' }}>
              Otomate
            </Title>
          </Group>

          <Menu position="bottom-end" withArrow shadow="md">
            <Menu.Target>
              <UnstyledButton>
                <Group gap="xs" wrap="nowrap">
                  <Avatar color="crust" radius="xl" size={32}>
                    {user?.name?.charAt(0).toUpperCase() ?? '?'}
                  </Avatar>
                  <Stack gap={0} visibleFrom="xs">
                    <Text size="sm" fw={600} lh={1.2}>
                      {user?.name}
                    </Text>
                    <Text size="xs" c="dimmed" lh={1.2}>
                      {user?.role.name}
                    </Text>
                  </Stack>
                  <IconChevronDown size={14} />
                </Group>
              </UnstyledButton>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>{user?.email}</Menu.Label>
              <Menu.Item
                component={RouterNavLink}
                to="/change-password"
                leftSection={<IconKey size={16} />}
              >
                Change password
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item color="red" leftSection={<IconLogout size={16} />} onClick={signOut}>
                Sign out
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        <AppShell.Section grow component={ScrollArea}>
          <Stack gap={2}>
            {renderNav(MAIN)}
            {renderNav(dailyItems)}

            {catalogItems.length > 0 && (
              <>
                <Divider
                  my="sm"
                  label={<Text size="xs" fw={700} c="dimmed" tt="uppercase">Catalogue</Text>}
                  labelPosition="left"
                />
                {renderNav(catalogItems)}
              </>
            )}

            {adminItems.length > 0 && (
              <>
                <Divider
                  my="sm"
                  label={
                    <Text size="xs" fw={700} c="dimmed" tt="uppercase">
                      Administration
                    </Text>
                  }
                  labelPosition="left"
                />
                {renderNav(adminItems)}
              </>
            )}
          </Stack>
        </AppShell.Section>

        {user?.branch && (
          <AppShell.Section>
            <Divider mb="xs" />
            <Group gap="xs" px="xs" pb="xs">
              <Text size="xs" c="dimmed">
                Branch
              </Text>
              <Badge size="sm" variant="light">
                {user.branch.name}
              </Badge>
            </Group>
          </AppShell.Section>
        )}
      </AppShell.Navbar>

      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  )
}
