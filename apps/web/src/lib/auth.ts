import type { LoginResponse } from '@otomate/shared'

export function saveSession(data: LoginResponse) {
  localStorage.setItem('token', data.token)
  localStorage.setItem('user', JSON.stringify(data.user))
}

export function clearSession() {
  localStorage.removeItem('token')
  localStorage.removeItem('user')
}

export function getToken(): string | null {
  return localStorage.getItem('token')
}

export function getUser(): LoginResponse['user'] | null {
  const raw = localStorage.getItem('user')
  return raw ? JSON.parse(raw) : null
}

export function isAuthenticated(): boolean {
  return Boolean(getToken())
}
