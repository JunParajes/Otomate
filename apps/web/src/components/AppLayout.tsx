import { useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink as RouterNavLink, useLocation } from 'react-router-dom'
import {
  ActionIcon,
  AppShell,
  Avatar,
  Badge,
  Box,
  Burger,
  Center,
  Divider,
  Group,
  Menu,
  NavLink,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  Title,
  Tooltip,
  UnstyledButton,
  useComputedColorScheme,
  useMantineColorScheme,
  type MantineColorScheme,
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
  IconBriefcase,
  IconId,
  IconClipboardList,
  IconArchive,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconSun,
  IconMoon,
  IconDeviceDesktop,
} from '@tabler/icons-react'
import type { PermissionName } from '@otomate/shared'
import { useSession } from '@/lib/session'
import { syncThemeColor } from '@/lib/theme-color'

interface NavItem {
  label: string
  to: string
  icon: typeof IconUsers
  permission?: PermissionName
}

const APPEARANCE_OPTIONS = [
  { value: 'light', label: 'Light', icon: IconSun },
  { value: 'dark', label: 'Dark', icon: IconMoon },
  { value: 'auto', label: 'System', icon: IconDeviceDesktop },
] as const

/**
 * Light / Dark / System. "System" is kept as an option rather than reduced to a
 * two-way toggle because it is the existing default — dropping it would take
 * away the behaviour everyone has now. Mantine persists the choice to
 * localStorage itself, so there is nothing to save here.
 */
function AppearancePicker() {
  const { colorScheme, setColorScheme } = useMantineColorScheme()

  return (
    <SegmentedControl
      fullWidth
      size="xs"
      value={colorScheme}
      onChange={value => setColorScheme(value as MantineColorScheme)}
      data={APPEARANCE_OPTIONS.map(({ value, label, icon: Icon }) => ({
        value,
        label: (
          <Center style={{ gap: 6 }}>
            <Icon size={14} />
            <span>{label}</span>
          </Center>
        ),
      }))}
    />
  )
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
  { label: 'Finalised Reports', to: '/dsir/archive', icon: IconArchive, permission: 'dsir:read' },
]

const CATALOG: NavItem[] = [
  { label: 'Products', to: '/catalog/products', icon: IconToolsKitchen2, permission: 'products:read' },
  { label: 'Categories', to: '/catalog/categories', icon: IconCategory, permission: 'products:read' },
]

const ADMIN: NavItem[] = [
  { label: 'Users', to: '/admin/users', icon: IconUsers, permission: 'users:read' },
  { label: 'Employees', to: '/admin/employees', icon: IconId, permission: 'employees:read' },
  { label: 'Positions', to: '/admin/positions', icon: IconBriefcase, permission: 'employees:read' },
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

  /**
   * Only the most specific matching link is highlighted.
   *
   * A plain startsWith lights up every ancestor: on /dsir/archive both "Daily
   * Reports" (/dsir) and "Finalised Reports" (/dsir/archive) would look active.
   * Taking the longest match keeps that correct for any future nesting too —
   * and a report at /dsir/<id> still highlights Daily Reports, which is right.
   */
  const activePath = useMemo(() => {
    const { pathname } = location
    return [...MAIN, ...DAILY, ...CATALOG, ...ADMIN]
      .map(i => i.to)
      .filter(to => pathname === to || pathname.startsWith(`${to}/`))
      .sort((a, b) => b.length - a.length)[0]
  }, [location])

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
          // React Router's NavLink adds its own "active" class on a PREFIX
          // match, which highlighted Daily Reports (/dsir) while sitting on
          // /dsir/archive — a second, competing source of highlighting next to
          // Mantine's data-active. `end` restricts it to an exact match and
          // leaves activePath below as the single source of truth.
          end
          label={collapsed ? undefined : item.label}
          leftSection={<item.icon size={collapsed ? 20 : 18} stroke={1.6} />}
          active={item.to === activePath}
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

          {/* Wide enough for the appearance control to breathe; the dropdown
              would otherwise shrink to the width of the email address. */}
          <Menu position="bottom-end" withArrow shadow="md" width={260}>
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
              <Menu.Label>Appearance</Menu.Label>
              {/* Not a Menu.Item: those close the menu on click, and the point
                  of this control is to see the change while choosing. */}
              <Box px="xs" pb={6}>
                <AppearancePicker />
              </Box>

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
