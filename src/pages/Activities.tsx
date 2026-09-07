import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useStore, childName } from '../lib/store'
import { Avatar, Badge, Card, PageHead } from '../components/ui'
import { formatDate, minutesToTime, nowTime, timeToMinutes, today, stepWorkingDay } from '../lib/dates'
import { SUNBLOCK_LABEL, isSunblock } from '../lib/chartdata'
import type { Activity, NappyKind } from '../types'

const NAPPIES: { kind: NappyKind; label: string; icon: string }[] = [
  { kind: 'dry', label: 'Dry', icon: '☀️' },
  { kind: 'wet', label: 'Wet', icon: '💧' },
  { kind: 'stools', label: 'Stools', icon: '💩' },
  { kind: 'wet+stools', label: 'Both', icon: '💧💩' },
]

/** The day's nappies and sleeps, logged in as few taps as possible. */
export default function Activities() {
  const { db } = useStore()
  const [params, setParams] = useSearchParams()
  const date = params.get('date') || today()

  const setDate = (d: string) => setParams(prev => {
    const next = new URLSearchParams(prev)
    next.set('date', d)
    return next
  }, { replace: true })

  const children = db.children.filter(c => c.status === 'active')

  return (
    <>
      <PageHead
        title="Activities"
        subtitle={formatDate(date, db.settings.locale)}
        actions={
          <>
            <button className="btn" onClick={() => setDate(stepWorkingDay(date, -1))} aria-label="Previous day">‹</button>
            <input className="input" type="date" value={date}
                   onChange={e => setDate(e.target.value || today())} />
            <button className="btn" onClick={() => setDate(stepWorkingDay(date, 1))} aria-label="Next day">›</button>
            <button className="btn" onClick={() => setDate(today())}>Today</button>
            <Link className="btn" to="/charts">Charts</Link>
          </>
        }
      />

      {children.length === 0 ? (
        <Card><p className="muted">No active children.</p></Card>
      ) : children.map(child => (
        <ChildActivities key={child.id} childId={child.id} date={date} />
      ))}
    </>
  )
}

function ChildActivities({ childId, date }: { childId: string; date: string }) {
  const { db, actions } = useStore()
  const child = db.children.find(c => c.id === childId)
  const [sleepStart, setSleepStart] = useState(nowTime())
  const [sleepMinutes, setSleepMinutes] = useState(db.settings.sleepBlockMinutes)
  const [roomTemp, setRoomTemp] = useState(db.settings.defaultRoomTemp)
  const [other, setOther] = useState('')
  const [otherTime, setOtherTime] = useState(nowTime())

  const addOther = () => {
    if (!other.trim()) return
    actions.addOther(childId, other, date, otherTime)
    setOther('')
    setOtherTime(nowTime())
  }

  const entries = useMemo(
    () => db.activities
      .filter(a => a.childId === childId && a.date === date)
      .sort((a, b) => a.time.localeCompare(b.time)),
    [db.activities, childId, date],
  )

  const nappies = entries.filter(a => a.kind === 'nappy')
  const others = entries.filter(a => a.kind === 'other')
  const sleeps = entries.filter(a => a.kind === 'sleep')
  const totalSleep = sleeps.reduce((s, a) => {
    const from = timeToMinutes(a.time), to = timeToMinutes(a.endTime ?? '')
    return s + (from !== null && to !== null && to > from ? to - from : 0)
  }, 0)

  return (
    <Card
      title={
        <span className="child-cell">
          <Avatar child={child} size={26} />
          <Link to={`/children/${childId}`}>{childName(child)}</Link>
        </span>
      }
      actions={
        <span className="muted small">
          {nappies.length} nappies · {totalSleep > 0 ? `${Math.floor(totalSleep / 60)}h ${totalSleep % 60}m` : 'no'} sleep
          {others.length > 0 && ` · ${others.length} other`}
        </span>
      }
    >
      <div className="act-quick">
        {NAPPIES.map(n => (
          <button key={n.kind} className="act-btn"
                  onClick={() => actions.addNappy(childId, n.kind, date)}>
            <span className="act-icon">{n.icon}</span>
            {n.label}
          </button>
        ))}
        <button className="act-btn" onClick={() => actions.addOther(childId, SUNBLOCK_LABEL, date)}>
          <span className="act-icon">🧴</span>
          Sun block
        </button>
      </div>

      {/* Medicine, sunscreen, a meal — anything worth a timestamped line. */}
      <div className="other-add">
        <label className="field other-what">
          <span className="field-label">Something else</span>
          <input
            className="input"
            placeholder="Medicine, sunscreen, meal…"
            value={other}
            onChange={e => setOther(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addOther() }}
          />
        </label>
        <label className="field">
          <span className="field-label">At</span>
          <input className="input tight" type="time" value={otherTime}
                 onChange={e => setOtherTime(e.target.value)} />
        </label>
        <button className="btn" disabled={!other.trim()} onClick={addOther}>Log it</button>
      </div>

      <div className="sleep-add">
        <label className="field">
          <span className="field-label">Sleep from</span>
          <input className="input tight" type="time" value={sleepStart}
                 onChange={e => setSleepStart(e.target.value)} />
        </label>
        <label className="field sleep-slider">
          <span className="field-label">
            For {Math.floor(sleepMinutes / 60) > 0 && `${Math.floor(sleepMinutes / 60)}h `}
            {sleepMinutes % 60}m
            {' → ends '}
            {minutesToTime((timeToMinutes(sleepStart) ?? 0) + sleepMinutes)}
          </span>
          <input
            type="range" min={10} max={240} step={5}
            value={sleepMinutes}
            onChange={e => setSleepMinutes(Number(e.target.value))}
          />
        </label>
        <label className="field temp-slider">
          <span className="field-label">Room {roomTemp}°C</span>
          <input
            type="range" min={12} max={30} step={0.5}
            value={roomTemp}
            onChange={e => setRoomTemp(Number(e.target.value))}
          />
        </label>
        <button className="btn primary"
                onClick={() => actions.addSleep(childId, sleepStart, sleepMinutes, roomTemp, date)}>
          Add sleep
        </button>
      </div>

      {entries.length === 0 ? (
        <p className="muted">Nothing logged yet.</p>
      ) : (
        <ul className="act-list">
          {entries.map(a => (
            <ActivityRow key={a.id} activity={a} />
          ))}
        </ul>
      )}
    </Card>
  )
}

function ActivityRow({ activity }: { activity: Activity }) {
  const { db, actions } = useStore()
  const [open, setOpen] = useState(false)

  if (activity.kind === 'other') {
    return (
      <li className="act-row">
        <span className="act-time">{activity.time}</span>
        <span className="act-icon">{isSunblock(activity.label) ? '🧴' : '💊'}</span>
        <span>{activity.label}</span>
        <button className="link danger" onClick={() => actions.deleteActivity(activity.id)}>remove</button>
      </li>
    )
  }

  if (activity.kind === 'nappy') {
    const meta = NAPPIES.find(n => n.kind === activity.nappy)
    return (
      <li className="act-row">
        <span className="act-time">{activity.time}</span>
        <span className="act-icon">{meta?.icon ?? '·'}</span>
        <span>Nappy — {meta?.label ?? activity.nappy}</span>
        <button className="link danger" onClick={() => actions.deleteActivity(activity.id)}>remove</button>
      </li>
    )
  }

  const checks = activity.checks ?? []
  const done = checks.filter(c => c.done).length
  const allDone = checks.length > 0 && done === checks.length

  return (
    <li className="act-row sleep">
      <span className="act-time">{activity.time}–{activity.endTime}</span>
      <span className="act-icon">😴</span>
      <span>Sleep</span>
      {activity.roomTemp !== undefined && (
        <span className={activity.roomTemp < 18 ? 'temp-tag cold' : 'temp-tag'}
              title={activity.roomTemp < 18 ? 'Below the 18°C the form asks for' : 'Room temperature'}>
          {activity.roomTemp}°C
        </span>
      )}
      {checks.length > 0 && (
        <Badge tone={allDone ? 'good' : done > 0 ? 'warn' : 'bad'}>
          {done}/{checks.length} checks
        </Badge>
      )}
      <button className="link" onClick={() => setOpen(!open)}>
        {open ? 'hide' : 'checks'}
      </button>
      <button className="link danger" onClick={() => actions.deleteActivity(activity.id)}>remove</button>

      {open && (
        <div className="check-grid">
          {checks.length === 0 && <span className="muted small">No checks were generated.</span>}
          {checks.map(c => (
            <label key={c.at} className={c.done ? 'check-chip on' : 'check-chip'}>
              <input
                type="checkbox" checked={c.done}
                onChange={e => actions.setSleepCheck(
                  activity.id, c.at, e.target.checked, db.settings.educatorName || 'Owner',
                )}
              />
              {c.at}
            </label>
          ))}
          {checks.length > 0 && (
            <button className="btn small" onClick={() => {
              for (const c of checks) {
                actions.setSleepCheck(activity.id, c.at, true, db.settings.educatorName || 'Owner')
              }
            }}>
              Tick all
            </button>
          )}
        </div>
      )}
    </li>
  )
}
