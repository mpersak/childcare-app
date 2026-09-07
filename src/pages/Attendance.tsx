import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useStore, childName } from '../lib/store'
import { useVault } from '../lib/vault'
import { ActionButton, Avatar, Badge, Card, PageHead } from '../components/ui'
import { calcBilling, scheduleFor } from '../lib/billing'
import { formatMoney } from '../lib/money'
import { addDays, formatDate, formatHours, today, WEEKDAYS, WORKING_DAYS_PER_WEEK } from '../lib/dates'
import type { AttendanceStatus, SignatureRecord } from '../types'

const STATUSES: AttendanceStatus[] = ['present', 'absent', 'sick', 'holiday']

export default function Attendance() {
  const { db, actions } = useStore()
  const [params, setParams] = useSearchParams()
  const date = params.get('date') || today()
  // Arriving from the calendar: highlight and scroll to the child that was tapped.
  const focusChild = params.get('child') ?? ''
  const { currency, locale } = db.settings
  const [showAll, setShowAll] = useState(false)
  const focusRef = useRef<HTMLTableRowElement>(null)

  useEffect(() => {
    if (focusChild) focusRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [focusChild, date])

  const setDate = (d: string) => setParams(prev => {
    const next = new URLSearchParams(prev)
    next.set('date', d)
    return next
  })

  const closure = db.closures.find(c => c.date === date)

  const rows = useMemo(() => {
    return db.children
      .filter(c => c.status === 'active')
      .map(child => {
        const blocks = scheduleFor(db.schedules, child.id, date)
        const record = db.attendance.find(a => a.childId === child.id && a.date === date)
        const billing = record ? calcBilling(record, db.settings, blocks) : null
        const invoice = record?.invoiceId
          ? db.invoices.find(i => i.id === record.invoiceId)
          : undefined
        return { child, blocks, record, billing, invoice }
      })
      // By default show who is actually booked; drop-ins are one toggle away.
      .filter(r => showAll || r.blocks.length > 0 || r.record || r.child.id === focusChild)
      .sort((a, b) => childName(a.child).localeCompare(childName(b.child)))
  }, [db, date, showAll, focusChild])

  const dayHours = rows.reduce((s, r) => s + (r.billing?.billedHours ?? 0), 0)
  const dayValue = rows.reduce((s, r) => s + (r.billing?.amount ?? 0), 0)

  return (
    <>
      <PageHead
        title="Attendance"
        subtitle={`${WEEKDAYS[new Date(date + 'T00:00:00').getDay()]} · ${formatDate(date, locale)}`}
        actions={
          <>
            <button className="btn" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">‹</button>
            <input className="input" type="date" value={date} onChange={e => setDate(e.target.value || today())} />
            <button className="btn" onClick={() => setDate(addDays(date, 1))} aria-label="Next day">›</button>
            <button className="btn" onClick={() => setDate(today())}>Today</button>
          </>
        }
      />

      {closure && (
        <div className="banner">
          Closed — {closure.name}. {closure.billable
            ? 'Booked hours are still charged.'
            : 'Nothing is charged for this day.'}
        </div>
      )}

      <Card
        title={`${rows.length} ${rows.length === 1 ? 'child' : 'children'}`}
        actions={
          <>
            <label className="check">
              <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
              Show everyone
            </label>
            <ActionButton icon="↻" label="Fill from schedule" primary onClick={() => actions.fillFromSchedule(date)} />
          </>
        }
      >
        {rows.length === 0 ? (
          <p className="muted">
            Nobody is booked for this day. <button className="link" onClick={() => setShowAll(true)}>Show everyone</button> to
            record a drop-in.
          </p>
        ) : (
          <div className="table-scroll">
            <table className="table attendance-table">
              <thead>
                <tr>
                  <th>Child</th><th>Booked</th><th>Status</th><th>In</th><th>Out</th>
                  <th className="num">Hours</th><th className="num">Charge</th><th>Note</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ child, blocks, record, billing, invoice }) => {
                  const locked = !!invoice
                  const status = record?.status ?? 'present'
                  const set = (patch: Record<string, unknown>) =>
                    actions.upsertAttendance({ childId: child.id, date, ...patch })

                  return (
                    <tr key={child.id} ref={child.id === focusChild ? focusRef : undefined}
                        className={[locked ? 'row-locked' : '', child.id === focusChild ? 'row-focus' : ''].filter(Boolean).join(' ') || undefined}>
                      <td>
                        <Link className="child-cell" to={`/children/${child.id}`}>
                          <Avatar child={child} size={26} />
                          <span>
                            {childName(child)}
                            {locked && (
                              <em className="locked-hint">
                                on <Link to={`/invoices/${invoice!.id}`}>{invoice!.number}</Link>
                              </em>
                            )}
                          </span>
                        </Link>
                      </td>
                      <td className="muted">
                        {blocks.length ? `${blocks[0].start}–${blocks[blocks.length - 1].end}` : 'drop-in'}
                      </td>
                      <td>
                        <select
                          className="input tight" value={record ? status : ''} disabled={locked}
                          onChange={e => {
                            const v = e.target.value as AttendanceStatus | ''
                            if (!v) return
                            set({
                              status: v,
                              // Leaving "present" clears the clock; the contracted hours bill instead.
                              ...(v === 'present' ? {} : { checkIn: null, checkOut: null }),
                              ...(record ? {} : { billable: v === 'present' }),
                            })
                          }}
                        >
                          {!record && <option value="">—</option>}
                          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td>
                        <span className="time-cell">
                          <input
                            className="input tight" type="time" disabled={locked || status !== 'present'}
                            value={record?.checkIn ?? ''}
                            onChange={e => set({ status: 'present', checkIn: e.target.value || null })}
                          />
                          <SignatureMark sig={record?.signIn} />
                        </span>
                      </td>
                      <td>
                        <span className="time-cell">
                          <input
                            className="input tight" type="time" disabled={locked || status !== 'present'}
                            value={record?.checkOut ?? ''}
                            onChange={e => set({ status: 'present', checkOut: e.target.value || null })}
                          />
                          <SignatureMark sig={record?.signOut} />
                        </span>
                      </td>
                      <td className="num">
                        {billing && billing.billedHours > 0 ? formatHours(billing.billedHours) : '—'}
                        {/* Billed hours come from the booking, so they do not move when
                            the times are edited. Show the time actually on site as well,
                            or the column looks stuck. */}
                        {billing && billing.rawMinutes > 0
                          && Math.abs(billing.rawMinutes - billing.billedMinutes) >= 1 && (
                          <em className="cell-sub">{formatHours(billing.rawMinutes / 60)} on site</em>
                        )}
                      </td>
                      <td className="num">
                        {billing && billing.amount > 0
                          ? <span title={billing.adjustments.join(' · ')}>
                              {formatMoney(billing.amount, currency, locale)}
                              {/* Name the late fee, so a charge that moved while the
                                  hours did not is accounted for on the row. */}
                              {billing.lateFee > 0 && (
                                <em className="cell-sub">
                                  incl. {formatMoney(billing.lateFee, currency, locale)} late
                                  {' '}({billing.lateMinutes} min)
                                </em>
                              )}
                            </span>
                          : record && status !== 'present'
                            ? <label className="check tiny">
                                <input type="checkbox" checked={record.billable} disabled={locked}
                                       onChange={e => set({ billable: e.target.checked })} />
                                charge
                              </label>
                            : '—'}
                      </td>
                      <td>
                        <input
                          className="input" placeholder="—" disabled={locked}
                          value={record?.note ?? ''}
                          onChange={e => set({ note: e.target.value })}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5} className="right"><strong>Day total</strong></td>
                  <td className="num"><strong>{formatHours(dayHours)}</strong></td>
                  <td className="num"><strong>{formatMoney(dayValue, currency, locale)}</strong></td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <Card title="This week">
        <WeekStrip date={date} onPick={setDate} />
      </Card>
    </>
  )
}

/**
 * A guardian signature captured at the door, shown beside the time it set.
 * The image sits in its own encrypted file, so it is fetched only on demand.
 */
function SignatureMark({ sig }: { sig: SignatureRecord | null | undefined }) {
  const vault = useVault()
  const [src, setSrc] = useState<string | null>(null)
  const [asked, setAsked] = useState(false)

  const reveal = () => {
    if (asked || !sig) return
    setAsked(true)
    void vault.loadSignature(sig.ref).then(setSrc)
  }

  if (!sig) return null
  return (
    <span className="sig-mark" tabIndex={0} onMouseEnter={reveal} onFocus={reveal}
          title={`Signed by ${sig.name} at ${new Date(sig.at).toLocaleString()}`}>
      ✓
      {src && <img className="sig-pop" src={src} alt={`Signature of ${sig.name}`} />}
    </span>
  )
}

function WeekStrip({ date, onPick }: { date: string; onPick(d: string): void }) {
  const { db } = useStore()
  const { currency, locale } = db.settings
  const monday = (() => {
    const d = new Date(date + 'T00:00:00')
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    return d.toISOString().slice(0, 10)
  })()

  const days = Array.from({ length: WORKING_DAYS_PER_WEEK }, (_, i) => addDays(monday, i))

  return (
    <div className="week-strip">
      {days.map(d => {
        const records = db.attendance.filter(a => a.date === d)
        const value = records.reduce(
          (s, r) => s + calcBilling(r, db.settings, scheduleFor(db.schedules, r.childId, d)).amount, 0)
        const present = records.filter(r => r.status === 'present').length
        const closed = db.closures.some(c => c.date === d)
        return (
          <button key={d} className={`week-day ${d === date ? 'active' : ''}`} onClick={() => onPick(d)}>
            <span className="week-day-name">{WEEKDAYS[new Date(d + 'T00:00:00').getDay()].slice(0, 3)}</span>
            <strong>{d.slice(8)}</strong>
            {closed
              ? <Badge tone="warn">closed</Badge>
              : <span className="muted small">{present} in · {formatMoney(value, currency, locale)}</span>}
          </button>
        )
      })}
    </div>
  )
}
