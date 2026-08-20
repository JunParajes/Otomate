import { useNavigate } from 'react-router-dom'
import { getUser, clearSession } from '@/lib/auth'

export default function DashboardPage() {
  const navigate = useNavigate()
  const user = getUser()

  function handleLogout() {
    clearSession()
    navigate('/login')
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.logo}>Otomate</h1>
        <button onClick={handleLogout} style={styles.logout}>Sign out</button>
      </header>

      <main style={styles.main}>
        <div style={styles.card}>
          <h2 style={styles.welcome}>Welcome, {user?.name} 👋</h2>
          <p style={styles.role}>Role: <strong>{user?.role.name}</strong></p>
          <p style={styles.email}>{user?.email}</p>
        </div>

        <div style={styles.card}>
          <h3 style={styles.sectionTitle}>System Status</h3>
          <p style={{ color: '#16a34a' }}>✓ API connected</p>
          <p style={{ color: '#16a34a' }}>✓ Authentication active</p>
        </div>
      </main>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: { minHeight: '100vh', background: '#f5f5f5' },
  header: { background: '#fff', padding: '1rem 2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' },
  logo: { margin: 0, fontSize: '1.4rem', fontWeight: 700, color: '#1a1a1a' },
  logout: { background: 'none', border: '1px solid #ddd', padding: '0.4rem 1rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.875rem' },
  main: { padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '700px', margin: '0 auto' },
  card: { background: '#fff', padding: '1.5rem 2rem', borderRadius: '8px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' },
  welcome: { margin: '0 0 0.5rem', fontSize: '1.4rem' },
  role: { margin: '0 0 0.25rem', color: '#555' },
  email: { margin: 0, color: '#888', fontSize: '0.9rem' },
  sectionTitle: { margin: '0 0 1rem', fontSize: '1.1rem' },
}
