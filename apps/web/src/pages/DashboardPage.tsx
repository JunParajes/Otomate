import { useNavigate } from 'react-router-dom'
import {
  AppShell,
  Badge,
  Button,
  Card,
  Container,
  Group,
  List,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core'
import { getUser, clearSession } from '@/lib/auth'

export default function DashboardPage() {
  const navigate = useNavigate()
  const user = getUser()

  function handleLogout() {
    clearSession()
    navigate('/login')
  }

  return (
    <AppShell header={{ height: 60 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Title order={1} size="h4">
            Otomate
          </Title>
          <Button variant="default" size="sm" onClick={handleLogout}>
            Sign out
          </Button>
        </Group>
      </AppShell.Header>

      <AppShell.Main>
        <Container size="sm" py="md">
          <Stack gap="lg">
            <Card withBorder padding="lg" radius="md">
              <Group justify="space-between" align="flex-start">
                <Stack gap={4}>
                  <Title order={2} size="h3">
                    Welcome, {user?.name ?? 'there'}
                  </Title>
                  <Text c="dimmed" size="sm">
                    {user?.email}
                  </Text>
                </Stack>
                {user?.role?.name && (
                  <Badge variant="light" size="lg">
                    {user.role.name}
                  </Badge>
                )}
              </Group>
            </Card>

            <Card withBorder padding="lg" radius="md">
              <Title order={3} size="h5" mb="md">
                System Status
              </Title>
              <List
                spacing="xs"
                size="sm"
                icon={
                  <ThemeIcon color="green" size={18} radius="xl">
                    <Text size="xs" fw={700} c="white" lh={1}>
                      ✓
                    </Text>
                  </ThemeIcon>
                }
              >
                <List.Item>API connected</List.Item>
                <List.Item>Authentication active</List.Item>
              </List>
            </Card>
          </Stack>
        </Container>
      </AppShell.Main>
    </AppShell>
  )
}
