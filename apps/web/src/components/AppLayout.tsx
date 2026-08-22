import { useCallback, useEffect, useState } from 'react'
import { NavLink as RouterNavLink, useLocation } from 'react-router-dom'
import {
  ActionIcon,
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
  Tooltip,
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
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
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

const NAV_WIDTH = 240
/** Wide enough for a 20px icon plus comfortable padding. */
const RAIL_WIDTH = 64
const COLLAPSE_KEY = 'otomate.nav.collapsed'

/** Remembered per browser so the choice survives a reload. Storage can throw in
 *  private windows, so every access is guarded. */
function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

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
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const { user, can, signOut } = useSession()
  const location = useLocation()

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
    } catch {
      /* private mode — the preference just won't persist */
    }
  }, [collapsed])

  const toggleCollapsed = useCallback(() => setCollapsed(c => !c), [])

  // Hidden rather than shown-and-blocked: a link you can't use is just noise.
  const adminItems = ADMIN.filter(item => !item.permission || can(item.permission))
  const catalogItems = CATALOG.filter(item => !item.permission || can(item.permission))
  const dailyItems = DAILY.filter(item => !item.permission || can(item.permission))

  const renderNav = (items: NavItem[]) =>
    items.map(item => {
      const link = (
        <NavLink
          key={item.to}
          component={RouterNavLink}
          to={item.to}
          label={collapsed ? undefined : item.label}
          leftSection={<item.icon size={collapsed ? 20 : 18} stroke={1.6} />}
          active={location.pathname.startsWith(item.to)}
          onClick={close}
          variant="light"
          aria-label={item.label}
          // Collapsed: drop the label box and centre the icon in the rail.
          styles={collapsed ? { body: { display: 'none' }, section: { marginInlineEnd: 0 } } : undefined}
          style={collapsed ? { justifyContent: 'center', paddingInline: 0 } : undefined}
        />
      )
      // The tooltip is the only way to read a label in the rail, so it is added
      // ONLY when collapsed — otherwise it is noise over a visible label.
      return collapsed ? (
        <Tooltip key={item.to} label={item.label} position="right" withArrow offset={8}>
          {link}
        </Tooltip>
      ) : (
        link
      )
    })

  /** A labelled rule when open; a plain rule in the rail, where a label cannot fit. */
  const sectionDivider = (label: string) =>
    collapsed ? (
      <Divider my="sm" />
    ) : (
      <Divider
        my="sm"
        label={<Text size="xs" fw={700} c="dimmed" tt="uppercase">{label}</Text>}
        labelPosition="left"
      />
    )

  return (
    <AppShell
      header={{ height: 56 }}
      // Fixed rail on tablet/laptop; collapses to a drawer only on phones.
      // AppShell reflows the main area whenever this width changes, so collapsing
      // the rail widens the content — which the DSIR table needs on a tablet.
      navbar={{
        width: collapsed ? RAIL_WIDTH : NAV_WIDTH,
        breakpoint: 'sm',
        collapsed: { mobile: !opened },
      }}
      padding="lg"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            {/* Desktop only: on phones the navbar is a drawer, so collapsing is meaningless. */}
            <Tooltip label={collapsed ? 'Expand menu' : 'Collapse menu'} position="right" withArrow>
              <ActionIcon
                variant="subtle"
                color="gray"
                onClick={toggleCollapsed}
                visibleFrom="sm"
                aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
              >
                {collapsed ? <IconLayoutSidebarLeftExpand size={20} /> : <IconLayoutSidebarLeftCollapse size={20} />}
              </ActionIcon>
            </Tooltip>
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
                {sectionDivider('Catalogue')}
                {renderNav(catalogItems)}
              </>
            )}

            {adminItems.length > 0 && (
              <>
                {sectionDivider('Administration')}
                {renderNav(adminItems)}
              </>
            )}
          </Stack>
        </AppShell.Section>

        {user?.branch && (
          <AppShell.Section>
            <Divider mb="xs" />
            {collapsed ? (
              // "Branch: HQ" cannot fit a 64px rail — keep the initial, and put
              // the full name in the tooltip.
              <Tooltip label={`Branch: ${user.branch.name}`} position="right" withArrow>
                <Group justify="center" pb="xs">
                  <Badge size="sm" variant="light" circle aria-label={`Branch ${user.branch.name}`}>
                    {user.branch.name.charAt(0).toUpperCase()}
                  </Badge>
                </Group>
              </Tooltip>
            ) : (
              <Group gap="xs" px="xs" pb="xs">
                <Text size="xs" c="dimmed">
                  Branch
                </Text>
                <Badge size="sm" variant="light">
                  {user.branch.name}
                </Badge>
              </Group>
            )}
          </AppShell.Section>
        )}
      </AppShell.Navbar>

      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  )
}
