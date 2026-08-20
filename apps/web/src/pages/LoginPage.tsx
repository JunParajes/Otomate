import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert,
  Button,
  Card,
  Center,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { zodResolver } from 'mantine-form-zod-resolver'
import { api } from '@/lib/api'
import { saveSession } from '@/lib/auth'
import { loginSchema, type ApiResponse, type LoginInput, type LoginResponse } from '@otomate/shared'

export default function LoginPage() {
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Validated against the exact schema the API uses — see packages/shared/src/schemas/auth.ts
  const form = useForm<LoginInput>({
    initialValues: { email: '', password: '' },
    validate: zodResolver(loginSchema),
    validateInputOnBlur: true,
  })

  async function handleSubmit(values: LoginInput) {
    setError('')
    setLoading(true)

    try {
      const { data } = await api.post<ApiResponse<LoginResponse>>('/api/auth/login', values)
      if (data.error) {
        setError(data.error.message)
        return
      }
      saveSession(data.data)
      navigate('/dashboard')
    } catch {
      setError('Invalid email or password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Center mih="100vh" p="md" bg="var(--mantine-color-body)">
      <Card withBorder shadow="sm" padding="xl" radius="md" w="100%" maw={400}>
        <Stack gap="xs" mb="lg">
          <Title order={1} size="h2">
            Otomate
          </Title>
          <Text c="dimmed" size="sm">
            Bakery Management System
          </Text>
        </Stack>

        <form onSubmit={form.onSubmit(handleSubmit)}>
          <Stack gap="md">
            <TextInput
              label="Email"
              placeholder="admin@otomate.local"
              autoComplete="email"
              withAsterisk
              {...form.getInputProps('email')}
            />

            <PasswordInput
              label="Password"
              autoComplete="current-password"
              withAsterisk
              {...form.getInputProps('password')}
            />

            {error && (
              <Alert color="red" variant="light" role="alert">
                {error}
              </Alert>
            )}

            <Button type="submit" loading={loading} fullWidth mt="xs">
              Sign in
            </Button>
          </Stack>
        </form>
      </Card>
    </Center>
  )
}
