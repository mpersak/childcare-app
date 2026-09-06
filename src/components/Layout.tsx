import { NavLink, Outlet } from 'react-router-dom'
import { useStore } from '../lib/store'
import { formatDate, today } from '../lib/dates'
import { amountDue, isOverdue } from '../lib/invoicing'

const NAV = [
  { to: '/', label: 'Dashboard', icon: '🏠', end: true },
  { to: '/signin', label: 'Sign in / out', icon: '👋' },
  { to: '/attendance', label: 'Attendance', icon: '📋' },
  { to: '/activities', label: 'Activities', icon: '🍼' },
  { to: '/calendar', label: 'Calendar', icon: '📅' },
  { to: '/sheet', label: 'Sign in sheet', icon: '📄' },
  { to: '/children', label: 'Children', icon: '🧒' },
  { to: '/notes', label: 'Notes', icon: '📝' },
  { to: '/invoices', label: 'Invoices', icon: '💌' },
  { to: '/finance', label: 'Finance', icon: '🌱' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
]

export default function Layout() {
  const { db } = useStore()

  const overdueCount = db.invoices.filter(i => isOverdue(i)).length
  const openDrafts = db.invoices.filter(i => i.status === 'draft').length
  const stillIn = db.attendance.filter(
    a => a.date === today() && a.status === 'present' && a.checkIn && !a.checkOut,
  ).length

  const badgeFor = (label: string): number => {
    if (label === 'Invoices') return overdueCount + openDrafts
    if (label === 'Attendance') return stillIn
    return 0
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">{db.settings.logoText || 'CC'}</span>
          <span className="brand-text">
            <strong>{db.settings.businessName || 'Childcare Manager'}</strong>
            <small>{formatDate(today(), db.settings.locale)}</small>
          </span>
        </div>

        <nav>
          {NAV.map(item => {
            const count = badgeFor(item.label)
            return (
              <NavLink key={item.to} to={item.to} end={item.end}
                       className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
                <span><i className="nav-icon" aria-hidden="true">{item.icon}</i>{item.label}</span>
                {count > 0 && <span className="nav-count">{count}</span>}
              </NavLink>
            )
          })}
        </nav>

        <div className="sidebar-foot">
          <span className="muted">
            {db.children.filter(c => c.status === 'active').length} enrolled
          </span>
          <span className="muted">
            Owing {new Intl.NumberFormat(db.settings.locale, {
              style: 'currency', currency: db.settings.currency, maximumFractionDigits: 0,
            }).format(db.invoices.reduce((s, i) => s + (i.status === 'draft' ? 0 : amountDue(i)), 0))}
          </span>
        </div>
      </aside>

      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}
