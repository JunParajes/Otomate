import { Alert, Center, Loader, Stack, Text } from '@mantine/core'
import { IconAlertTriangle, IconInbox } from '@tabler/icons-react'

interface Props {
  loading: boolean
  error: string | null
  empty?: boolean
  emptyMessage?: string
  children: React.ReactNode
}

/** One place for the loading / error / empty states every table needs. */
export default function DataState({ loading, error, empty, emptyMessage, children }: Props) {
  if (loading) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    )
  }

  if (error) {
    return (
      <Alert color="red" icon={<IconAlertTriangle size={18} />} title="Could not load">
        {error}
      </Alert>
    )
  }

  if (empty) {
    return (
      <Center py="xl">
        <Stack align="center" gap="xs">
          <IconInbox size={32} opacity={0.4} />
          <Text c="dimmed" size="sm">
            {emptyMessage ?? 'Nothing here yet'}
          </Text>
        </Stack>
      </Center>
    )
  }

  return <>{children}</>
}
