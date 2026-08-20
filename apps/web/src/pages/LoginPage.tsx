import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { saveSession } from '@/lib/auth'
import type { ApiResponse, LoginResponse } from '@otomate/shared'

export default function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const { data } = await api.post<ApiResponse<LoginResponse>>('/api/auth/login', { email, password })
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
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>Otomate</h1>
        <p style={styles.subtitle}>Bakery Management System</p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <label style={styles.label}>Email</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoComplete="email"
            style={styles.input}
            placeholder="admin@otomate.local"
          />

          <label style={styles.label}>Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            style={styles.input}
          />

          {error && <p style={styles.error}>{error}</p>}

          <button type="submit" disabled={loading} style={styles.button}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f5' },
  card: { background: '#fff', padding: '2.5rem', borderRadius: '8px', boxShadow: '0 2px 12px rgba(0,0,0,0.1)', width: '100%', maxWidth: '380px' },
  title: { margin: 0, fontSize: '1.8rem', fontWeight: 700, color: '#1a1a1a' },
  subtitle: { margin: '4px 0 2rem', color: '#666', fontSize: '0.9rem' },
  form: { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  label: { fontSize: '0.875rem', fontWeight: 500, color: '#333' },
  input: { padding: '0.6rem 0.75rem', border: '1px solid #ddd', borderRadius: '6px', fontSize: '1rem', outline: 'none' },
  error: { color: '#dc2626', fontSize: '0.875rem', margin: 0 },
  button: { marginTop: '0.5rem', padding: '0.75rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '1rem', fontWeight: 600, cursor: 'pointer' },
}
