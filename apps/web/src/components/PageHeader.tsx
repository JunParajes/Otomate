import { Group, Stack, Text, Title } from '@mantine/core'

interface Props {
  title: string
  description?: string
  action?: React.ReactNode
}

/** Consistent page masthead — title left, primary action right. */
export default function PageHeader({ title, description, action }: Props) {
  return (
    <Group justify="space-between" align="flex-start" wrap="wrap" mb="lg" gap="sm">
      <Stack gap={2}>
        <Title order={2} size="h3">
          {title}
        </Title>
        {description && (
          <Text size="sm" c="dimmed">
            {description}
          </Text>
        )}
      </Stack>
      {action}
    </Group>
  )
}
