import { Link } from 'react-router-dom'
import { Button, Center, Stack, Text, Title } from '@mantine/core'

export default function NotFoundPage() {
  return (
    <Center mih="100vh" p="md">
      <Stack align="center" gap="sm">
        <Title order={1} size={64} c="dimmed" lh={1}>
          404
        </Title>
        <Text c="dimmed">Page not found</Text>
        <Button component={Link} to="/dashboard" variant="light" mt="sm">
          Go to Dashboard
        </Button>
      </Stack>
    </Center>
  )
}
