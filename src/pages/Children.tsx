import { useMemo, useState, type CSSProperties } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useStore, childName } from '../lib/store'
import { ActionButton, Avatar, Badge, Card, EmptyState, Field, Modal, PageHead } from '../components/ui'
import { rateForChild, scheduledMinutes } from '../lib/billing'
import { formatMoney } from '../lib/money'
import { ageFrom, formatHours, today, WEEKDAYS_SHORT, WORKING_WEEKDAYS } from '../lib/dates'
import type { ChildStatus } from '../types'

const STATUSES: ChildStatus[] = ['active', 'waitlist', 'archived']

export default function Children() {
  const { db, actions } = useStore()
  const nav = useNavigate()
  const { currency, locale } = db.settings
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<ChildStatus | 'all'>('active')
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ firstName: '', lastName: '', dob: '', rate: '' })

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return db.children
      .filter(c => status === 'all' || c.status === status)
      .filter(c => !q || childName(c).toLowerCase().includes(q))
      .sort((a, b) => childName(a).localeCompare(childName(b)))
  }, [db.children, query, status])

  const submit = () => {
    if (!draft.firstName.trim() && !draft.lastName.trim()) return
    const parsed = draft.rate.trim() === '' ? null : Number(draft.rate)
    const child = actions.addChild({
      firstName: draft.firstName.trim(),
      lastName: draft.lastName.trim(),
      dob: draft.dob,
      startDate: today(),
      hourlyRate: parsed !== null && isFinite(parsed) ? parsed : null,
    })
    setAdding(false)
    setDraft({ firstName: '', lastName: '', dob: '', rate: '' })
    nav(`/children/${child.id}`)
  }

  return (
    <>
      <PageHead
        title="Children"
        subtitle={`${db.children.filter(c => c.status === 'active').length} enrolled`}
        actions={<ActionButton icon="✚" label="Add child" primary onClick={() => setAdding(true)} />}
      />

      <Card>
        <div className="toolbar">
          <input className="input" placeholder="Search by name" value={query}
                 onChange={e => setQuery(e.target.value)} />
          <select className="input" value={status} onChange={e => setStatus(e.target.value as ChildStatus | 'all')}>
            <option value="all">All statuses</option>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {list.length === 0 ? (
          <EmptyState title="No children match"
                      action={<ActionButton icon="✚" label="Add child" primary onClick={() => setAdding(true)} />}>
            Add a child, then give them a weekly schedule so attendance and invoices can follow.
          </EmptyState>
        ) : (
          <div className="child-grid">
            {list.map(child => {
              const blocks = db.schedules.filter(s => s.childId === child.id && s.active)
              const weekMinutes = [0, 1, 2, 3, 4, 5, 6].reduce(
                (s, wd) => s + scheduledMinutes(blocks.filter(b => b.weekday === wd)), 0)
              const days = [...new Set(blocks.map(b => b.weekday))].sort()
              const rate = rateForChild(child, db.settings)
              const openNotes = db.notes.filter(n => n.childId === child.id && n.flagged).length

              return (
                <Link className="child-card" key={child.id} to={`/children/${child.id}`}
                      style={{ ['--child-colour' as string]: child.colour } as CSSProperties}>
                  <div className="child-card-head">
                    <Avatar child={child} size={42} />
                    <div>
                      <strong>{childName(child)}</strong>
                      <span className="muted small">{ageFrom(child.dob)}</span>
                    </div>
                    {child.status !== 'active' && <Badge tone="muted">{child.status}</Badge>}
                  </div>

                  <div className="child-card-days">
                    {WORKING_WEEKDAYS.map(wd => (
                      <span key={wd} className={days.includes(wd) ? 'day on' : 'day'}>
                        {WEEKDAYS_SHORT[wd][0]}
                      </span>
                    ))}
                  </div>

                  <dl className="mini-kv">
                    <div><dt>Booked</dt><dd>{weekMinutes ? `${formatHours(weekMinutes / 60)}/wk` : 'No schedule'}</dd></div>
                    <div><dt>Rate</dt><dd>{formatMoney(rate, currency, locale)}/h{child.hourlyRate === null ? ' (default)' : ''}</dd></div>
                  </dl>

                  {(child.allergies || openNotes > 0) && (
                    <div className="child-card-flags">
                      {child.allergies && <Badge tone="bad">allergy</Badge>}
                      {openNotes > 0 && <Badge tone="warn">{openNotes} flagged</Badge>}
                    </div>
                  )}
                </Link>
              )
            })}
          </div>
        )}
      </Card>

      <Modal
        open={adding}
        title="Add child"
        onClose={() => setAdding(false)}
        footer={
          <>
            <button className="btn" onClick={() => setAdding(false)}>Cancel</button>
            <button className="btn primary" onClick={submit}>Add and open</button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="First name">
            <input className="input" value={draft.firstName}
                   onChange={e => setDraft({ ...draft, firstName: e.target.value })} />
          </Field>
          <Field label="Last name">
            <input className="input" value={draft.lastName}
                   onChange={e => setDraft({ ...draft, lastName: e.target.value })} />
          </Field>
          <Field label="Date of birth">
            <input className="input" type="date" value={draft.dob}
                   onChange={e => setDraft({ ...draft, dob: e.target.value })} />
          </Field>
          <Field label="Hourly rate" hint={`Leave blank to use the default, ${formatMoney(db.settings.defaultHourlyRate, currency, locale)}/h`}>
            <input className="input" type="number" min="0" step="0.5" value={draft.rate}
                   placeholder={String(db.settings.defaultHourlyRate)}
                   onChange={e => setDraft({ ...draft, rate: e.target.value })} />
          </Field>
        </div>
      </Modal>
    </>
  )
}
