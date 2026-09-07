import { useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useStore, childName, initials } from '../lib/store'
import { Avatar, Badge, Card, PageHead } from '../components/ui'
import { calcBilling, scheduleFor } from '../lib/billing'
import {
  assignLanes, buildDay, dayWindow, hourTicks, occupancy, type TimelineItem,
} from '../lib/daygrid'
import { formatMoney } from '../lib/money'
import {
  addDays, addMonths, endOfMonth, formatDate, formatHours, fromISODate,
  isWorkingDay, minutesToTime, startOfMonth, startOfWeek, timeToMinutes, today,
  WEEKDAYS, WEEKDAYS_SHORT, WORKING_DAYS_PER_WEEK, WORKING_WEEKDAYS,
} from '../lib/dates'

type View = 'day' | 'week' | 'month'

export default function Calendar() {
  const { db } = useStore()
  const [params, setParams] = useSearchParams()
  const view = (params.get('view') as View) || 'week'
  const date = params.get('date') || today()
  // Days off are shown by default; the toggle is for when they clutter planning.
  const showAway = params.get('away') !== '0'

  const update = (patch: { view?: View; date?: string; away?: boolean }) => setParams(prev => {
    const next = new URLSearchParams(prev)
    if (patch.view) next.set('view', patch.view)
    if (patch.date) next.set('date', patch.date)
    if (patch.away !== undefined) next.set('away', patch.away ? '1' : '0')
    return next
  }, { replace: true })

  const step = (dir: number) => {
    if (view === 'day') update({ date: addDays(date, dir) })
    else if (view === 'week') update({ date: addDays(date, dir * 7) })
    else update({ date: addMonths(date, dir) })
  }

  const label = view === 'month'
    ? fromISODate(date).toLocaleDateString(db.settings.locale, { month: 'long', year: 'numeric' })
    : view === 'week'
      ? `Week of ${formatDate(startOfWeek(date), db.settings.locale)}`
      : `${WEEKDAYS[fromISODate(date).getDay()]} ${formatDate(date, db.settings.locale)}`

  return (
    <>
      <PageHead
        title="Calendar"
        subtitle={label}
        actions={
          <>
            <div className="segmented">
              {(['day', 'week', 'month'] as View[]).map(v => (
                <button key={v} className={view === v ? 'seg active' : 'seg'}
                        onClick={() => update({ view: v })}>{v}</button>
              ))}
            </div>
            <button className="btn" onClick={() => step(-1)} aria-label="Previous">‹</button>
            <button className="btn" onClick={() => update({ date: today() })}>Today</button>
            <button className="btn" onClick={() => step(1)} aria-label="Next">›</button>
            {view !== 'day' && (
              <label className="check">
                <input type="checkbox" checked={showAway}
                       onChange={e => update({ away: e.target.checked })} />
                Days off
              </label>
            )}
          </>
        }
      />

      {view === 'day' && <DayView date={date} />}
      {view === 'week' && <WeekView date={date} showAway={showAway} onPick={d => update({ view: 'day', date: d })} />}
      {view === 'month' && <MonthView date={date} showAway={showAway} onPick={d => update({ view: 'day', date: d })} />}
    </>
  )
}

/* -------------------------------------------------------------------------- */

function DayView({ date }: { date: string }) {
  const { db } = useStore()
  const { currency, locale } = db.settings
  const rows = useMemo(() => buildDay(db, date), [db, date])
  const closure = db.closures.find(c => c.date === date)

  const all = rows.flatMap(r => [...r.booked, ...(r.actual ? [r.actual] : [])])
  const win = dayWindow(db, all)
  const slots = useMemo(() => occupancy(rows, win.from, win.to), [rows, win.from, win.to])
  const peak = Math.max(1, ...slots.map(s => s.count))

  const pct = (m: number) => ((Math.min(win.to, Math.max(win.from, m)) - win.from) / win.span) * 100
  const nowM = timeToMinutes(new Date().toTimeString().slice(0, 5))
  const showNow = date === today() && nowM !== null && nowM >= win.from && nowM <= win.to

  const dayValue = rows.reduce((s, r) => s + (r.record
    ? calcBilling(r.record, db.settings, scheduleFor(db.schedules, r.child.id, date)).amount : 0), 0)
  const dayHours = rows.reduce((s, r) => s + (r.record
    ? calcBilling(r.record, db.settings, scheduleFor(db.schedules, r.child.id, date)).billedHours : 0), 0)

  if (rows.length === 0) {
    return (
      <Card>
        <p className="muted">
          Nobody is booked or recorded for this day.{' '}
          <Link to={`/attendance?date=${date}`}>Open the attendance sheet</Link> to add a drop-in.
        </p>
      </Card>
    )
  }

  return (
    <>
      {closure && (
        <div className="banner">
          Closed — {closure.name}. {closure.billable ? 'Booked hours are still charged.' : 'Nothing is charged.'}
        </div>
      )}

      <Card
        title={`${rows.length} booked · peak ${peak} at once`}
        actions={
          <>
            <span className="muted small">
              {formatHours(dayHours)} · {formatMoney(dayValue, currency, locale)}
            </span>
            <Link className="btn" to={`/attendance?date=${date}`}>Edit sheet</Link>
          </>
        }
      >
        <div className="timeline">
          <div className="tl-ruler">
            <span className="tl-gutter" />
            <div className="tl-track">
              {hourTicks(win.from, win.to).map(t => (
                <span key={t} className="tl-tick" style={{ left: `${pct(t)}%` }}>
                  {minutesToTime(t)}
                </span>
              ))}
            </div>
          </div>

          {rows.map(r => (
            <div className="tl-row" key={r.child.id}>
              <Link className="tl-gutter" to={`/children/${r.child.id}`}>
                <Avatar child={r.child} size={24} />
                <span className="tl-name">{childName(r.child)}</span>
              </Link>

              <div className="tl-track">
                {hourTicks(win.from, win.to).map(t => (
                  <span key={t} className="tl-gridline" style={{ left: `${pct(t)}%` }} />
                ))}

                {r.booked.map((b, i) => (
                  <span
                    key={`b${i}`}
                    className="tl-bar booked"
                    style={{ left: `${pct(b.start)}%`, width: `${pct(b.end) - pct(b.start)}%` }}
                    title={`Booked ${minutesToTime(b.start)}–${minutesToTime(b.end)}`}
                  />
                ))}

                {r.actual && (
                  <span
                    className={`tl-bar actual ${r.actual.open ? 'open' : ''}`}
                    style={{
                      left: `${pct(r.actual.start)}%`,
                      width: `${pct(r.actual.end) - pct(r.actual.start)}%`,
                      background: r.child.colour,
                    }}
                    title={`${minutesToTime(r.actual.start)}–${r.actual.open ? 'now' : minutesToTime(r.actual.end)}`}
                  >
                    <em>{minutesToTime(r.actual.start)}–{r.actual.open ? 'now' : minutesToTime(r.actual.end)}</em>
                  </span>
                )}

                {r.status === 'away' && (
                  <span className="tl-away">{r.record?.status}</span>
                )}
                {r.status === 'none' && r.booked.length > 0 && (
                  <span className="tl-pending" style={{ left: `${pct(r.booked[0].start)}%` }}>
                    not recorded
                  </span>
                )}
              </div>
            </div>
          ))}

          <div className="tl-row tl-occupancy">
            <span className="tl-gutter muted small">On site</span>
            <div className="tl-track">
              {slots.map(s => (
                <span
                  key={s.at}
                  className="occ-bar"
                  style={{
                    left: `${pct(s.at)}%`,
                    width: `${(30 / win.span) * 100}%`,
                    height: `${(s.count / peak) * 100}%`,
                  }}
                  title={`${minutesToTime(s.at)} — ${s.count} ${s.count === 1 ? 'child' : 'children'}`}
                />
              ))}
            </div>
          </div>

          {showNow && (
            <span className="tl-now" style={{ left: `calc(var(--tl-gutter) + ${pct(nowM!)}% * (100% - var(--tl-gutter)) / 100)` }}>
              <em>{minutesToTime(nowM!)}</em>
            </span>
          )}
        </div>

        <div className="tl-legend">
          <span><i className="key booked" /> booked</span>
          <span><i className="key actual" /> actually here</span>
          <span><i className="key occ" /> children on site</span>
        </div>
      </Card>
    </>
  )
}

/* -------------------------------------------------------------------------- */

function WeekView({ date, showAway, onPick }: {
  date: string; showAway: boolean; onPick(d: string): void
}) {
  const { db } = useStore()
  const nav = useNavigate()
  const monday = startOfWeek(date)
  const days = Array.from({ length: WORKING_DAYS_PER_WEEK }, (_, i) => addDays(monday, i))

  const perDay = useMemo(() => days.map(d => {
    const rows = buildDay(db, d)
    // Carry the day's status onto each block. Flattening to bare timeline items
    // loses it, which is what made a sick day look like an ordinary booking.
    const items = rows.flatMap(r => {
      const spans = r.booked.length ? r.booked : (r.actual ? [r.actual] : [])
      if (!showAway && r.status === 'away') return []
      return spans.map(s => ({
        ...s,
        away: r.status === 'away',
        reason: r.status === 'away' ? (r.record?.status ?? 'away') : '',
      }))
    })
    return { date: d, rows, items }
  }), [db, monday, showAway])

  const win = dayWindow(db, perDay.flatMap(p => p.items))
  const top = (m: number) => ((Math.min(win.to, Math.max(win.from, m)) - win.from) / win.span) * 100

  const weekHours = perDay.reduce((s, p) =>
    s + p.items.reduce((t, i) => t + (i.end - i.start) / 60, 0), 0)

  return (
    <Card
      title={`${formatHours(weekHours)} booked across the week`}
      actions={<span className="muted small">Click a day for the hour-by-hour view</span>}
    >
      <div className="weekgrid">
        <div className="wk-times">
          <span className="wk-daylabel" />
          {hourTicks(win.from, win.to).map(t => (
            <span key={t} className="wk-time" style={{ top: `${top(t)}%` }}>{minutesToTime(t)}</span>
          ))}
        </div>

        {perDay.map(({ date: d, items }) => {
          const { placed, lanes } = assignLanes(items)
          const closed = db.closures.find(c => c.date === d)
          return (
            <div className={`wk-col ${d === today() ? 'is-today' : ''}`} key={d}>
              <button className="wk-daylabel" onClick={() => onPick(d)}>
                <span className="muted small">{WEEKDAYS_SHORT[fromISODate(d).getDay()]}</span>
                <strong>{Number(d.slice(8))}</strong>
                {/* In the header, where bookings cannot paint over it. */}
                {closed && <span className="wk-closed-tag" title={closed.name}>Closed</span>}
              </button>

              <div className={`wk-body ${closed ? 'is-closed' : ''}`}>
                {hourTicks(win.from, win.to).map(t => (
                  <span key={t} className="wk-line" style={{ top: `${top(t)}%` }} />
                ))}
                {/* The centred label only helps on an otherwise empty column. */}
                {closed && items.length === 0 && <span className="wk-closed">{closed.name}</span>}

                {placed.map(({ item, lane }, i) => {
                  const block = item as TimelineItem & { away: boolean; reason: string }
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`wk-block ${block.kind}${block.away ? ' away' : ''}`}
                      onClick={e => {
                        e.stopPropagation()
                        nav(`/attendance?date=${d}&child=${block.childId}`)
                      }}
                      style={{
                        top: `${top(item.start)}%`,
                        height: `${top(item.end) - top(item.start)}%`,
                        left: `${(lane / lanes) * 100}%`,
                        width: `${(1 / lanes) * 100}%`,
                        background: block.colour,
                      }}
                      title={`${block.name} ${minutesToTime(item.start)}–${minutesToTime(item.end)}` +
                        (block.away ? ` — ${block.reason}` : '') + ' — tap to edit'}
                    >
                      <em>{block.name.split(' ')[0]}</em>
                      <small>{block.away ? block.reason : minutesToTime(item.start)}</small>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

/* -------------------------------------------------------------------------- */

function MonthView({ date, showAway, onPick }: {
  date: string; showAway: boolean; onPick(d: string): void
}) {
  const { db } = useStore()
  const nav = useNavigate()
  const { currency, locale } = db.settings
  const anchor = startOfMonth(date)

  const weeks = useMemo(() => {
    const first = startOfMonth(anchor)
    const last = endOfMonth(anchor)
    const start = addDays(first, -((fromISODate(first).getDay() + 6) % 7))
    const end = addDays(last, 6 - ((fromISODate(last).getDay() + 6) % 7))
    const out: string[][] = []
    let cur = start
    while (cur <= end) {
      const week: string[] = []
      // Step over all seven days but keep only the working ones.
      for (let i = 0; i < 7; i++) {
        if (isWorkingDay(cur)) week.push(cur)
        cur = addDays(cur, 1)
      }
      out.push(week)
    }
    return out
  }, [anchor])

  const stats = useMemo(() => {
    const from = startOfMonth(anchor), to = endOfMonth(anchor)
    const records = db.attendance.filter(a => a.date >= from && a.date <= to)
    const billed = records.map(r =>
      calcBilling(r, db.settings, scheduleFor(db.schedules, r.childId, r.date)))
    return {
      value: billed.reduce((s, b) => s + b.amount, 0),
      hours: billed.reduce((s, b) => s + b.billedHours, 0),
      sessions: records.filter(r => r.status === 'present').length,
    }
  }, [db, anchor])

  return (
    <Card
      title={`${stats.sessions} sessions · ${formatHours(stats.hours)} · ${formatMoney(stats.value, currency, locale)}`}
      actions={<span className="muted small">Click a day to open it</span>}
    >
      <div className="calendar">
        <div className="cal-head">
          {WORKING_WEEKDAYS.map(i => <div key={i}>{WEEKDAYS_SHORT[i]}</div>)}
        </div>

        {weeks.map((week, wi) => (
          <div className="cal-week" key={wi}>
            {week.map(d => {
              const inMonth = d.slice(0, 7) === anchor.slice(0, 7)
              const closure = db.closures.find(c => c.date === d)
              const rows = buildDay(db, d).filter(r => showAway || r.status !== 'away')
              const bookedHours = rows.reduce(
                (s, r) => s + r.booked.reduce((t, b) => t + (b.end - b.start) / 60, 0), 0)

              return (
                <div
                  key={d}
                  className={[
                    'cal-day',
                    inMonth ? '' : 'outside',
                    d === today() ? 'is-today' : '',
                    closure ? 'is-closed' : '',
                  ].join(' ')}
                  onClick={() => onPick(d)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter') onPick(d) }}
                >
                  <span className="cal-top">
                    <span className="cal-date">{Number(d.slice(8))}</span>
                    {bookedHours > 0 && <span className="cal-hours">{formatHours(bookedHours)}</span>}
                  </span>

                  {closure && <Badge tone="warn">{closure.name}</Badge>}

                  <span className="cal-people">
                    {rows.slice(0, 4).map(r => (
                      <span
                        key={r.child.id}
                        className={`person state-${r.status}`}
                        style={{ borderColor: r.child.colour }}
                        onClick={e => { e.stopPropagation(); nav(`/attendance?date=${d}&child=${r.child.id}`) }}
                        title={`Edit ${childName(r.child)} — ${r.booked.length
                          ? `${minutesToTime(r.booked[0].start)}–${minutesToTime(r.booked[r.booked.length - 1].end)}`
                          : 'drop-in'}`}
                      >
                        <i style={{ background: r.child.colour }}>{initials(r.child)}</i>
                        <em>{r.child.firstName}</em>
                      </span>
                    ))}
                    {rows.length > 4 && <span className="person more">+{rows.length - 4}</span>}
                  </span>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <div className="cal-legend">
        <span><i className="dot state-done" /> signed out</span>
        <span><i className="dot state-in" /> on site</span>
        <span><i className="dot state-none" /> booked, not recorded</span>
        <span><i className="dot state-away" /> absent or sick</span>
      </div>
    </Card>
  )
}
