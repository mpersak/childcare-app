import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useStore, childName } from '../lib/store'
import {
  Badge, Card, ConfirmButton, Field, PageHead,
} from '../components/ui'
import { calcBilling, rateForChild, scheduleFor, scheduledMinutes } from '../lib/billing'
import { amountDue, statusLabel } from '../lib/invoicing'
import { formatMoney } from '../lib/money'
import {
  addMonths, ageFrom, endOfMonth, formatDate, formatHours, startOfMonth, today, WEEKDAYS,
} from '../lib/dates'
import { uid, CHILD_COLOURS } from '../lib/defaults'
import type { ChildStatus, NoteCategory } from '../types'

const TABS = ['Profile', 'Schedule', 'Attendance', 'Notes', 'Invoices'] as const
type Tab = typeof TABS[number]

const CATEGORIES: NoteCategory[] = ['general', 'incident', 'medical', 'milestone', 'behaviour', 'meal', 'nap']

export default function ChildDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const { db, actions } = useStore()
  const [tab, setTab] = useState<Tab>('Profile')
  const child = db.children.find(c => c.id === id)
  const { currency, locale } = db.settings

  if (!child) {
    return (
      <Card>
        <p>That child no longer exists. <Link to="/children">Back to children</Link>.</p>
      </Card>
    )
  }

  const blocks = db.schedules.filter(s => s.childId === child.id)
  const weekMinutes = scheduledMinutes(blocks.filter(b => b.active))
  const rate = rateForChild(child, db.settings)
  const set = (patch: Parameters<typeof actions.updateChild>[1]) => actions.updateChild(child.id, patch)

  return (
    <>
      <PageHead
        title={childName(child)}
        subtitle={`${ageFrom(child.dob)} · ${formatMoney(rate, currency, locale)}/h · ${weekMinutes ? formatHours(weekMinutes / 60) + ' booked per week' : 'no schedule'}`}
        actions={<Link className="btn" to="/children">All children</Link>}
      />

      <div className="tabs">
        {TABS.map(t => (
          <button key={t} className={t === tab ? 'tab active' : 'tab'} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {tab === 'Profile' && (
        <div className="split">
          <Card title="Details">
            <div className="form-grid">
              <Field label="First name">
                <input className="input" value={child.firstName} onChange={e => set({ firstName: e.target.value })} />
              </Field>
              <Field label="Last name">
                <input className="input" value={child.lastName} onChange={e => set({ lastName: e.target.value })} />
              </Field>
              <Field label="Date of birth">
                <input className="input" type="date" value={child.dob} onChange={e => set({ dob: e.target.value })} />
              </Field>
              <Field label="Status">
                <select className="input" value={child.status}
                        onChange={e => set({ status: e.target.value as ChildStatus })}>
                  <option value="active">active</option>
                  <option value="waitlist">waitlist</option>
                  <option value="archived">archived</option>
                </select>
              </Field>
              <Field label="Started">
                <input className="input" type="date" value={child.startDate}
                       onChange={e => set({ startDate: e.target.value })} />
              </Field>
              <Field label="Left" hint="Leave blank while still enrolled">
                <input className="input" type="date" value={child.endDate}
                       onChange={e => set({ endDate: e.target.value })} />
              </Field>
              <Field label="Hourly rate"
                     hint={`Blank uses the default, ${formatMoney(db.settings.defaultHourlyRate, currency, locale)}/h`}>
                <input
                  className="input" type="number" min="0" step="0.5"
                  value={child.hourlyRate ?? ''}
                  placeholder={String(db.settings.defaultHourlyRate)}
                  onChange={e => set({ hourlyRate: e.target.value === '' ? null : Number(e.target.value) })}
                />
              </Field>
              <Field label="Colour">
                <div className="swatches">
                  {CHILD_COLOURS.map(c => (
                    <button key={c} className={`swatch-btn ${c === child.colour ? 'on' : ''}`}
                            style={{ background: c }} aria-label={c} onClick={() => set({ colour: c })} />
                  ))}
                </div>
              </Field>
              <Field label="Allergies" wide>
                <textarea className="input" rows={2} value={child.allergies}
                          onChange={e => set({ allergies: e.target.value })} />
              </Field>
              <Field label="Medical / medication" wide>
                <textarea className="input" rows={2} value={child.medical}
                          onChange={e => set({ medical: e.target.value })} />
              </Field>
              <Field label="Emergency contact" wide>
                <input className="input" value={child.emergencyContact}
                       onChange={e => set({ emergencyContact: e.target.value })} />
              </Field>
              <Field label="General notes" wide>
                <textarea className="input" rows={3} value={child.general}
                          onChange={e => set({ general: e.target.value })} />
              </Field>
            </div>

            <div className="danger-row">
              <ConfirmButton
                confirmLabel="Delete permanently?"
                onConfirm={() => { actions.deleteChild(child.id); nav('/children') }}
              >
                Delete child
              </ConfirmButton>
              <span className="muted small">
                Removes the schedule, uninvoiced attendance and notes. Invoices are kept.
              </span>
            </div>
          </Card>

          <Card
            title="Guardians"
            actions={
              <button className="btn" onClick={() => set({
                guardians: [...child.guardians, {
                  id: uid('g'), name: '', relationship: 'Parent',
                  phone: '', email: '', primary: child.guardians.length === 0,
                }],
              })}>Add guardian</button>
            }
          >
            {child.guardians.length === 0 ? (
              <p className="muted">No guardians recorded.</p>
            ) : child.guardians.map(g => (
              <div className="guardian" key={g.id}>
                <div className="form-grid tight-grid">
                  <Field label="Name">
                    <input className="input" value={g.name} onChange={e => set({
                      guardians: child.guardians.map(x => x.id === g.id ? { ...x, name: e.target.value } : x),
                    })} />
                  </Field>
                  <Field label="Relationship">
                    <input className="input" value={g.relationship} onChange={e => set({
                      guardians: child.guardians.map(x => x.id === g.id ? { ...x, relationship: e.target.value } : x),
                    })} />
                  </Field>
                  <Field label="Phone">
                    <input className="input" value={g.phone} onChange={e => set({
                      guardians: child.guardians.map(x => x.id === g.id ? { ...x, phone: e.target.value } : x),
                    })} />
                  </Field>
                  <Field label="Email">
                    <input className="input" type="email" value={g.email} onChange={e => set({
                      guardians: child.guardians.map(x => x.id === g.id ? { ...x, email: e.target.value } : x),
                    })} />
                  </Field>
                </div>
                <div className="row gap">
                  <label className="check">
                    <input type="checkbox" checked={g.primary} onChange={e => set({
                      // Only one bill payer, so selecting one clears the rest.
                      guardians: child.guardians.map(x => ({ ...x, primary: x.id === g.id ? e.target.checked : false })),
                    })} />
                    Bill payer
                  </label>
                  <button className="btn small danger" onClick={() => set({
                    guardians: child.guardians.filter(x => x.id !== g.id),
                  })}>Remove</button>
                </div>
              </div>
            ))}
          </Card>
        </div>
      )}

      {tab === 'Schedule' && <ScheduleTab childId={child.id} />}
      {tab === 'Attendance' && <AttendanceTab childId={child.id} />}
      {tab === 'Notes' && <NotesTab childId={child.id} />}
      {tab === 'Invoices' && <InvoicesTab childId={child.id} />}
    </>
  )
}

function ScheduleTab({ childId }: { childId: string }) {
  const { db, actions } = useStore()
  const [draft, setDraft] = useState({ weekday: 1, start: '08:00', end: '15:00' })
  const blocks = db.schedules
    .filter(s => s.childId === childId)
    .sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start))

  const add = () => {
    if (draft.end <= draft.start) {
      alert('The finish time has to be after the start time.')
      return
    }
    actions.addSchedule({
      childId, weekday: draft.weekday, start: draft.start, end: draft.end,
      effectiveFrom: today(), effectiveTo: '', active: true,
    })
  }

  return (
    <Card title="Weekly booking">
      <div className="toolbar">
        <select className="input" value={draft.weekday}
                onChange={e => setDraft({ ...draft, weekday: Number(e.target.value) })}>
          {[1, 2, 3, 4, 5, 6, 0].map(wd => <option key={wd} value={wd}>{WEEKDAYS[wd]}</option>)}
        </select>
        <input className="input" type="time" value={draft.start}
               onChange={e => setDraft({ ...draft, start: e.target.value })} />
        <span className="muted">to</span>
        <input className="input" type="time" value={draft.end}
               onChange={e => setDraft({ ...draft, end: e.target.value })} />
        <button className="btn primary" onClick={add}>Add block</button>
      </div>

      {blocks.length === 0 ? (
        <p className="muted">
          No schedule yet. Blocks drive "Fill from schedule", the calendar, and charges on
          absent days that you still bill.
        </p>
      ) : (
        <table className="table">
          <thead>
            <tr><th>Day</th><th>From</th><th>To</th><th className="num">Hours</th>
                <th>Starts</th><th>Ends</th><th>Active</th><th /></tr>
          </thead>
          <tbody>
            {blocks.map(b => (
              <tr key={b.id} className={b.active ? undefined : 'row-muted'}>
                <td>{WEEKDAYS[b.weekday]}</td>
                <td>
                  <input className="input tight" type="time" value={b.start}
                         onChange={e => actions.updateSchedule(b.id, { start: e.target.value })} />
                </td>
                <td>
                  <input className="input tight" type="time" value={b.end}
                         onChange={e => actions.updateSchedule(b.id, { end: e.target.value })} />
                </td>
                <td className="num">{formatHours(scheduledMinutes([b]) / 60)}</td>
                <td>
                  <input className="input tight" type="date" value={b.effectiveFrom}
                         onChange={e => actions.updateSchedule(b.id, { effectiveFrom: e.target.value })} />
                </td>
                <td>
                  <input className="input tight" type="date" value={b.effectiveTo}
                         onChange={e => actions.updateSchedule(b.id, { effectiveTo: e.target.value })} />
                </td>
                <td>
                  <input type="checkbox" checked={b.active}
                         onChange={e => actions.updateSchedule(b.id, { active: e.target.checked })} />
                </td>
                <td className="right">
                  <button className="btn small danger" onClick={() => actions.deleteSchedule(b.id)}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}

function AttendanceTab({ childId }: { childId: string }) {
  const { db } = useStore()
  const { currency, locale } = db.settings
  const [month, setMonth] = useState(startOfMonth(today()).slice(0, 7))

  const rows = useMemo(() => {
    const from = `${month}-01`
    const to = endOfMonth(from)
    return db.attendance
      .filter(a => a.childId === childId && a.date >= from && a.date <= to)
      .sort((a, b) => b.date.localeCompare(a.date))
      .map(r => ({
        r,
        b: calcBilling(r, db.settings, scheduleFor(db.schedules, childId, r.date)),
        inv: db.invoices.find(i => i.id === r.invoiceId),
      }))
  }, [db, childId, month])

  const hours = rows.reduce((s, x) => s + x.b.billedHours, 0)
  const value = rows.reduce((s, x) => s + x.b.amount, 0)

  return (
    <Card
      title="Attendance"
      actions={
        <>
          <button className="btn" onClick={() => setMonth(addMonths(`${month}-01`, -1).slice(0, 7))}>‹</button>
          <input className="input" type="month" value={month} onChange={e => setMonth(e.target.value)} />
          <button className="btn" onClick={() => setMonth(addMonths(`${month}-01`, 1).slice(0, 7))}>›</button>
        </>
      }
    >
      {rows.length === 0 ? (
        <p className="muted">Nothing recorded this month.</p>
      ) : (
        <table className="table">
          <thead>
            <tr><th>Date</th><th>Status</th><th>In</th><th>Out</th>
                <th className="num">Hours</th><th className="num">Charge</th><th>Invoice</th></tr>
          </thead>
          <tbody>
            {rows.map(({ r, b, inv }) => (
              <tr key={r.id}>
                <td><Link to={`/attendance?date=${r.date}`}>{formatDate(r.date, locale)}</Link></td>
                <td><Badge tone={r.status === 'present' ? 'good' : 'muted'}>{r.status}</Badge></td>
                <td>{r.checkIn ?? '—'}</td>
                <td>{r.checkOut ?? '—'}</td>
                <td className="num">{b.billedHours > 0 ? formatHours(b.billedHours) : '—'}</td>
                <td className="num">{b.amount > 0 ? formatMoney(b.amount, currency, locale) : '—'}</td>
                <td>{inv ? <Link to={`/invoices/${inv.id}`}>{inv.number}</Link> : <span className="muted">not billed</span>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="right"><strong>Month</strong></td>
              <td className="num"><strong>{formatHours(hours)}</strong></td>
              <td className="num"><strong>{formatMoney(value, currency, locale)}</strong></td>
              <td />
            </tr>
          </tfoot>
        </table>
      )}
    </Card>
  )
}

function NotesTab({ childId }: { childId: string }) {
  const { db, actions } = useStore()
  const { locale } = db.settings
  const [draft, setDraft] = useState({
    date: today(), category: 'general' as NoteCategory, title: '', body: '', flagged: false,
  })

  const notes = db.notes
    .filter(n => n.childId === childId)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))

  const add = () => {
    if (!draft.title.trim() && !draft.body.trim()) return
    actions.addNote({ childId, author: 'Owner', ...draft })
    setDraft({ date: today(), category: 'general', title: '', body: '', flagged: false })
  }

  return (
    <div className="split">
      <Card title={`Notes (${notes.length})`}>
        {notes.length === 0 ? <p className="muted">No notes for this child yet.</p> : (
          <ul className="note-list">
            {notes.map(n => (
              <li key={n.id} className={n.flagged ? 'flagged' : undefined}>
                <div className="feed-head">
                  <Badge tone={n.flagged ? 'bad' : 'muted'}>{n.category}</Badge>
                  <strong>{n.title || '(untitled)'}</strong>
                  <span className="muted small">{formatDate(n.date, locale)}</span>
                  <button className="link danger" onClick={() => actions.deleteNote(n.id)}>delete</button>
                </div>
                {n.body && <p>{n.body}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Add a note">
        <div className="form-grid">
          <Field label="Date">
            <input className="input" type="date" value={draft.date}
                   onChange={e => setDraft({ ...draft, date: e.target.value })} />
          </Field>
          <Field label="Category">
            <select className="input" value={draft.category}
                    onChange={e => setDraft({ ...draft, category: e.target.value as NoteCategory })}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Title" wide>
            <input className="input" value={draft.title}
                   onChange={e => setDraft({ ...draft, title: e.target.value })} />
          </Field>
          <Field label="Note" wide>
            <textarea className="input" rows={5} value={draft.body}
                      onChange={e => setDraft({ ...draft, body: e.target.value })} />
          </Field>
        </div>
        <div className="row gap">
          <label className="check">
            <input type="checkbox" checked={draft.flagged}
                   onChange={e => setDraft({ ...draft, flagged: e.target.checked })} />
            Flag for follow-up
          </label>
          <button className="btn primary" onClick={add}>Save note</button>
        </div>
      </Card>
    </div>
  )
}

function InvoicesTab({ childId }: { childId: string }) {
  const { db, actions } = useStore()
  const { currency, locale } = db.settings
  const lastMonth = addMonths(today(), -1)
  const [from, setFrom] = useState(startOfMonth(lastMonth))
  const [to, setTo] = useState(endOfMonth(lastMonth))

  const invoices = db.invoices
    .filter(i => i.childId === childId)
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate))

  const pending = db.attendance.filter(
    a => a.childId === childId && !a.invoiceId && a.date >= from && a.date <= to)
  const pendingValue = pending.reduce(
    (s, r) => s + calcBilling(r, db.settings, scheduleFor(db.schedules, childId, r.date)).amount, 0)

  return (
    <div className="split">
      <Card title="Invoices">
        {invoices.length === 0 ? <p className="muted">No invoices yet.</p> : (
          <table className="table">
            <thead>
              <tr><th>Number</th><th>Period</th><th className="num">Total</th>
                  <th className="num">Due</th><th>Status</th></tr>
            </thead>
            <tbody>
              {invoices.map(inv => {
                const s = statusLabel(inv)
                return (
                  <tr key={inv.id}>
                    <td><Link to={`/invoices/${inv.id}`}>{inv.number}</Link></td>
                    <td className="muted">{formatDate(inv.periodStart, locale)} – {formatDate(inv.periodEnd, locale)}</td>
                    <td className="num">{formatMoney(inv.total, currency, locale)}</td>
                    <td className="num">{formatMoney(amountDue(inv), currency, locale)}</td>
                    <td><Badge tone={s.tone as 'good'}>{s.text}</Badge></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Create an invoice">
        <div className="form-grid">
          <Field label="From"><input className="input" type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field>
          <Field label="To"><input className="input" type="date" value={to} onChange={e => setTo(e.target.value)} /></Field>
        </div>
        <p className="muted">
          {pending.length} uninvoiced {pending.length === 1 ? 'day' : 'days'} in this period,
          worth {formatMoney(pendingValue, currency, locale)} before tax.
        </p>
        <button
          className="btn primary"
          disabled={pendingValue <= 0}
          onClick={() => actions.createInvoice(childId, from, to)}
        >
          Generate draft invoice
        </button>
      </Card>
    </div>
  )
}
