import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Card, Center, PasswordInput, Stack, Text, Title } from '@mantine/core'
import { useForm } from '@mantine/form'
// zod4Resolver, not zodResolver: the latter reads error.errors (zod 3);
// on zod 4 that is undefined and validation throws instead of showing messages.
import { zod4Resolver as zodResolver } from 'mantine-form-zod-resolver'
import { notifications } from '@mantine/notifications'
import { IconInfoCircle } from '@tabler/icons-react'
import { changeOwnPasswordSchema } from '@otomate/shared'
import { adminApi } from '@/lib/admin'
import { useSession } from '@/lib/session'

export default function ChangePasswordPage() {
  const navigate = useNavigate()
  const { user, refresh, signOut } = useSession()
  const [saving, setSaving] = useState(false)
  const forced = Boolean(user?.mustChangePassword)

  const form = useForm({
    initialValues: { currentPassword: '', newPassword: '' },
    validate: zodResolver(changeOwnPasswordSchema),
  })

  return (
    <Center mih="100vh" p="md" bg="var(--mantine-color-body)">
      <Card withBorder shadow="sm" padding="xl" radius="md" w="100%" maw={440}>
        <Stack gap="xs" mb="lg">
          <Title order={1} size="h3">
            {forced ? 'Set a new password' : 'Change password'}
          </Title>
          <Text size="sm" c="dimmed">{user?.email}</Text>
        </Stack>

        {forced && (
          <Alert color="yellow" variant="light" icon={<IconInfoCircle size={18} />} mb="md">
            Your password was set by an administrator. Choose your own before continuing.
          </Alert>
        )}

        <form
          onSubmit={form.onSubmit(async values => {
            setSaving(true)
            try {
              await adminApi.changeOwnPassword(values.currentPassword, values.newPassword)
              await refresh()
              notifications.show({ color: 'green', title: 'Password changed', message: 'Your new password is active.' })
              navigate('/dashboard')
            } catch (e) {
              form.setFieldError('currentPassword', e instanceof Error ? e.message : 'Could not change password')
            } finally {
              setSaving(false)
            }
          })}
        >
          <Stack gap="md">
            <PasswordInput label="Current password" autoComplete="current-password" withAsterisk {...form.getInputProps('currentPassword')} />
            <PasswordInput
              label="New password"
              description="At least 8 characters."
              autoComplete="new-password"
              withAsterisk
              {...form.getInputProps('newPassword')}
            />
            <Button type="submit" loading={saving} fullWidth mt="xs">Update password</Button>
            <Button variant="subtle" color="gray" size="compact-sm" onClick={forced ? signOut : () => navigate('/dashboard')}>
              {forced ? 'Sign out instead' : 'Back to dashboard'}
            </Button>
          </Stack>
        </form>
      </Card>
    </Center>
  )
}
