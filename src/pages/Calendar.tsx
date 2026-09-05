import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore, childName } from '../lib/store'
import { Badge, Card, PageHead } from '../components/ui'
import { calcBilling, scheduleFor } from '../lib/billing'
import { formatMoney } from '../lib/money'
import {
  addDays, addMonths, endOfMonth, fromISODate, startOfMonth, today, WEEKDAYS_SHORT,
} from '../lib/dates'

export default function Calendar() {
  const { db } = useStore()
  const nav = useNavigate()
  const { currency, locale } = db.settings
  const [anchor, setAnchor] = useState(startOfMonth(today()))
  const [showMoney, setShowMoney] = useState(true)

  const monthLabel = fromISODate(anchor)
    .toLocaleDateString(locale, { month: 'long', year: 'numeric' })

  const weeks = useMemo(() => {
    const first = startOfMonth(anchor)
    const last = endOfMonth(anchor)
    // Pad out to whole Monday-start weeks so the grid is always rectangular.
    const lead = (fromISODate(first).getDay() + 6) % 7
    const start = addDays(first, -lead)
    const trail = 6 - ((fromISODate(last).getDay() + 6) % 7)
    const end = addDays(last, trail)

    const out: string[][] = []
    let cur = start
    while (cur <= end) {
      const week: string[] = []
      for (let i = 0; i < 7; i++) { week.push(cur); cur = addDays(cur, 1) }
      out.push(week)
    }
    return out
  }, [anchor])

  const monthStats = useMemo(() => {
    const from = startOfMonth(anchor), to = endOfMonth(anchor)
    const records = db.attendance.filter(a => a.date >= from && a.date <= to)
    const value = records.reduce(
      (s, r) => s + calcBilling(r, db.settings, scheduleFor(db.schedules, r.childId, r.date)).amount, 0)
    const hours = records.reduce(
      (s, r) => s + calcBilling(r, db.settings, scheduleFor(db.schedules, r.childId, r.date)).billedHours, 0)
    return { value, hours, sessions: records.filter(r => r.status === 'present').length }
  }, [db, anchor])

  return (
    <>
      <PageHead
        title="Calendar"
        subtitle={`${monthStats.sessions} sessions · ${monthStats.hours.toFixed(1)} h · ${formatMoney(monthStats.value, currency, locale)}`}
        actions={
          <>
            <button className="btn" onClick={() => setAnchor(addMonths(anchor, -1))} aria-label="Previous month">‹</button>
            <strong className="month-label">{monthLabel}</strong>
            <button className="btn" onClick={() => setAnchor(addMonths(anchor, 1))} aria-label="Next month">›</button>
            <button className="btn" onClick={() => setAnchor(startOfMonth(today()))}>This month</button>
          </>
        }
      />

      <Card
        actions={
          <label className="check">
            <input type="checkbox" checked={showMoney} onChange={e => setShowMoney(e.target.checked)} />
            Show daily value
          </label>
        }
      >
        <div className="calendar">
          <div className="cal-head">
            {[1, 2, 3, 4, 5, 6, 0].map(i => <div key={i}>{WEEKDAYS_SHORT[i]}</div>)}
          </div>

          {weeks.map((week, wi) => (
            <div className="cal-week" key={wi}>
              {week.map(d => {
                const inMonth = d.slice(0, 7) === anchor.slice(0, 7)
                const closure = db.closures.find(c => c.date === d)
                const records = db.attendance.filter(a => a.date === d)
                const booked = db.children.filter(
                  c => c.status === 'active' && scheduleFor(db.schedules, c.id, d).length > 0)
                const value = records.reduce(
                  (s, r) => s + calcBilling(r, db.settings, scheduleFor(db.schedules, r.childId, d)).amount, 0)

                return (
                  <button
                    key={d}
                    className={[
                      'cal-day',
                      inMonth ? '' : 'outside',
                      d === today() ? 'is-today' : '',
                      closure ? 'is-closed' : '',
                    ].join(' ')}
                    onClick={() => nav(`/attendance?date=${d}`)}
                    title={booked.map(c => childName(c)).join(', ')}
                  >
                    <span className="cal-date">{Number(d.slice(8))}</span>

                    {closure && <Badge tone="warn">{closure.name}</Badge>}

                    <span className="chips">
                      {booked.slice(0, 6).map(c => {
                        const rec = records.find(r => r.childId === c.id)
                        const state = !rec ? 'none'
                          : rec.status !== 'present' ? 'away'
                          : rec.checkOut ? 'done' : rec.checkIn ? 'in' : 'none'
                        return (
                          <i
                            key={c.id}
                            className={`chip chip-${state}`}
                            style={{ background: state === 'away' ? undefined : c.colour }}
                            title={`${childName(c)} — ${state === 'none' ? 'not recorded' : state}`}
                          />
                        )
                      })}
                      {booked.length > 6 && <em className="chip-more">+{booked.length - 6}</em>}
                    </span>

                    {showMoney && value > 0 && (
                      <span className="cal-value">{formatMoney(value, currency, locale)}</span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        <div className="cal-legend">
          <span><i className="chip chip-done" /> signed out</span>
          <span><i className="chip chip-in" /> on site</span>
          <span><i className="chip chip-none" /> booked, not recorded</span>
          <span><i className="chip chip-away" /> absent or sick</span>
        </div>
      </Card>
    </>
  )
}
