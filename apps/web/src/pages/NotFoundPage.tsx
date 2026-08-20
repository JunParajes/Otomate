import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem' }}>
      <h1 style={{ fontSize: '3rem', margin: 0 }}>404</h1>
      <p style={{ color: '#666' }}>Page not found</p>
      <Link to="/dashboard" style={{ color: '#2563eb' }}>Go to Dashboard</Link>
    </div>
  )
}
