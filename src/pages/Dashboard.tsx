import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useStore, childName } from '../lib/store'
import { Avatar, Badge, Card, EmptyState, PageHead, Stat } from '../components/ui'
import { calcBilling, scheduleFor } from '../lib/billing'
import { summarise } from '../lib/finance'
import { formatMoney } from '../lib/money'
import { formatDate, formatHours, minutesToTime, timeToMinutes, nowTime, today } from '../lib/dates'
import { buildDemoDatabase } from '../lib/demo'

/** A friendlier page title than "Dashboard" for a screen opened every morning. */
function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export default function Dashboard() {
  const { db, actions } = useStore()
  const date = today()
  const { currency, locale } = db.settings

  const fin = useMemo(() => summarise(db, date), [db, date])

  const rows = useMemo(() => {
    const active = db.children.filter(c => c.status === 'active')
    return active.map(child => {
      const blocks = scheduleFor(db.schedules, child.id, date)
      const record = db.attendance.find(a => a.childId === child.id && a.date === date)
      const billing = record ? calcBilling(record, db.settings, blocks) : null
      // While a child is still on site, show hours accrued so far rather than zero.
      let liveMinutes = 0
      if (record?.status === 'present' && record.checkIn && !record.checkOut) {
        const inM = timeToMinutes(record.checkIn)
        const nowM = timeToMinutes(nowTime())
        if (inM !== null && nowM !== null && nowM > inM) liveMinutes = nowM - inM
      }
      return { child, blocks, record, billing, liveMinutes }
    }).sort((a, b) => {
      const rank = (r: typeof a) => (r.record?.checkIn && !r.record?.checkOut ? 0 : r.blocks.length ? 1 : 2)
      return rank(a) - rank(b) || childName(a.child).localeCompare(childName(b.child))
    })
  }, [db, date])

  const closure = db.closures.find(c => c.date === date)
  const expected = rows.filter(r => r.blocks.length).length
  const onSite = rows.filter(r => r.record?.checkIn && !r.record?.checkOut).length
  const doneToday = rows.filter(r => r.record?.checkOut).length
  const todayValue = rows.reduce((s, r) => s + (r.billing?.amount ?? 0), 0)

  const recentNotes = useMemo(
    () => [...db.notes]
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
      .slice(0, 6),
    [db.notes],
  )

  if (db.children.length === 0) {
    return (
      <>
        <PageHead title="Dashboard" />
        <Card>
          <EmptyState title="Nothing set up yet"
            action={
              <div className="row gap">
                <Link className="btn primary" to="/children">Add your first child</Link>
                <button className="btn" onClick={() => actions.replaceDatabase(buildDemoDatabase())}>
                  Load sample data
                </button>
              </div>
            }>
            Add the children you care for, give each one a weekly schedule, and attendance,
            invoicing and the financial view all follow from there. Sample data is invented
            placeholder text you can clear at any time from Settings.
          </EmptyState>
        </Card>
      </>
    )
  }

  return (
    <>
      <PageHead
        title={greeting()}
        subtitle={
          <span className="greeting">
            <span>{formatDate(date, locale)}</span>
            {onSite > 0 && <span>· {onSite} here right now</span>}
          </span>
        }
      />

      {closure && (
        <div className="banner">
          Closed today — {closure.name}
          {closure.billable ? ' (charged as booked)' : ' (not charged)'}
        </div>
      )}

      <div className="stat-grid">
        <Stat label="On site now" value={onSite} sub={`${expected} booked today`} tone={onSite ? 'info' : 'neutral'} />
        <Stat label="Signed out" value={doneToday} sub={`Today's value ${formatMoney(todayValue, currency, locale)}`} />
        <Stat label="Not yet invoiced" value={formatMoney(fin.unbilled, currency, locale)}
              sub={`${formatHours(fin.unbilledHours)} of care`} tone={fin.unbilled > 0 ? 'warn' : 'neutral'} />
        <Stat label="Owed to you" value={formatMoney(fin.outstanding, currency, locale)}
              sub={fin.overdue > 0 ? `${formatMoney(fin.overdue, currency, locale)} overdue` : 'Nothing overdue'}
              tone={fin.overdue > 0 ? 'bad' : 'good'} />
      </div>

      <div className="split">
        <Card
          title="Today"
          actions={
            <>
              <button className="btn" onClick={() => actions.fillFromSchedule(date)}>
                Fill from schedule
              </button>
              <Link className="btn" to="/attendance">Full sheet</Link>
            </>
          }
        >
          {rows.length === 0 ? (
            <p className="muted">No active children.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Child</th><th>Booked</th><th>In</th><th>Out</th>
                  <th className="num">Hours</th><th className="num">Today</th><th />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ child, blocks, record, billing, liveMinutes }) => {
                  const onNow = !!record?.checkIn && !record?.checkOut && record.status === 'present'
                  return (
                    <tr key={child.id} className={onNow ? 'row-live' : undefined}>
                      <td>
                        <Link className="child-cell" to={`/children/${child.id}`}>
                          <Avatar child={child} size={26} />
                          {childName(child)}
                        </Link>
                      </td>
                      <td className="muted">
                        {blocks.length
                          ? `${blocks[0].start}–${blocks[blocks.length - 1].end}`
                          : '—'}
                      </td>
                      <td>{record?.checkIn ?? '—'}</td>
                      <td>{record?.checkOut ?? '—'}</td>
                      <td className="num">
                        {onNow
                          ? <span className="live">{minutesToTime(liveMinutes)} so far</span>
                          : billing && billing.billedHours > 0 ? formatHours(billing.billedHours) : '—'}
                      </td>
                      <td className="num">{billing && billing.amount > 0 ? formatMoney(billing.amount, currency, locale) : '—'}</td>
                      <td className="right">
                        {record?.status && record.status !== 'present' ? (
                          <Badge tone="muted">{record.status}</Badge>
                        ) : !record?.checkIn ? (
                          <button className="btn small primary" onClick={() => actions.checkIn(child.id)}>
                            Check in
                          </button>
                        ) : !record.checkOut ? (
                          <button className="btn small" onClick={() => actions.checkOut(child.id)}>
                            Check out
                          </button>
                        ) : (
                          <Badge tone="good">Done</Badge>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </Card>

        <div className="stack">
          <Card title="Money" actions={<Link className="btn" to="/finance">Detail</Link>}>
            <dl className="kv">
              <div><dt>This month invoiced</dt><dd>{formatMoney(fin.monthToDate, currency, locale)}</dd></div>
              <div><dt>Last month</dt><dd>{formatMoney(fin.lastMonth, currency, locale)}</dd></div>
              <div><dt>Received this month</dt><dd>{formatMoney(fin.collectedThisMonth, currency, locale)}</dd></div>
              <div><dt>Drafts waiting</dt><dd>{formatMoney(fin.draftValue, currency, locale)}</dd></div>
              <div><dt>Average rate earned</dt><dd>{formatMoney(fin.averageHourlyYield, currency, locale)}/h</dd></div>
            </dl>
          </Card>

          <Card title="Latest notes" actions={<Link className="btn" to="/notes">All notes</Link>}>
            {recentNotes.length === 0 ? (
              <p className="muted">No notes yet.</p>
            ) : (
              <ul className="feed">
                {recentNotes.map(n => {
                  const child = db.children.find(c => c.id === n.childId)
                  return (
                    <li key={n.id}>
                      <Avatar child={child} size={24} />
                      <div>
                        <div className="feed-head">
                          <strong>{childName(child)}</strong>
                          <Badge tone={n.flagged ? 'bad' : 'muted'}>{n.category}</Badge>
                          <span className="muted small">{formatDate(n.date, locale)}</span>
                        </div>
                        <p>{n.title || n.body}</p>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}
