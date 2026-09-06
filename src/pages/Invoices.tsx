import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore, childName } from '../lib/store'
import { ActionButton, Avatar, Badge, Card, EmptyState, Field, Modal, PageHead, Stat } from '../components/ui'
import { amountDue, amountPaid, isOverdue, statusLabel } from '../lib/invoicing'
import { calcBilling, scheduleFor } from '../lib/billing'
import { formatMoney } from '../lib/money'
import { addMonths, endOfMonth, formatDate, startOfMonth, today } from '../lib/dates'
import { download, invoicesCSV } from '../lib/exporters'
import type { InvoiceStatus } from '../types'

const FILTERS: (InvoiceStatus | 'all' | 'overdue')[] = ['all', 'draft', 'sent', 'overdue', 'paid', 'void']

export default function Invoices() {
  const { db, actions } = useStore()
  const { currency, locale } = db.settings
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all')
  const [generating, setGenerating] = useState(false)

  const lastMonth = addMonths(today(), -1)
  const [range, setRange] = useState({
    from: startOfMonth(lastMonth),
    to: endOfMonth(lastMonth),
    childId: 'all',
  })

  const list = useMemo(() => {
    return db.invoices
      .filter(i => {
        if (filter === 'all') return true
        if (filter === 'overdue') return isOverdue(i)
        return i.status === filter
      })
      .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number))
  }, [db.invoices, filter])

  const totals = useMemo(() => {
    const live = db.invoices.filter(i => i.status !== 'void' && i.status !== 'draft')
    return {
      outstanding: live.reduce((s, i) => s + amountDue(i), 0),
      overdue: live.filter(i => isOverdue(i)).reduce((s, i) => s + amountDue(i), 0),
      drafts: db.invoices.filter(i => i.status === 'draft').reduce((s, i) => s + i.total, 0),
    }
  }, [db.invoices])

  // What the chosen period would actually produce, so the button is never a guess.
  const preview = useMemo(() => {
    const targets = range.childId === 'all'
      ? db.children.filter(c => c.status !== 'archived')
      : db.children.filter(c => c.id === range.childId)
    let value = 0, days = 0, kids = 0
    for (const c of targets) {
      const recs = db.attendance.filter(
        a => a.childId === c.id && !a.invoiceId && a.date >= range.from && a.date <= range.to)
      const v = recs.reduce(
        (s, r) => s + calcBilling(r, db.settings, scheduleFor(db.schedules, c.id, r.date)).amount, 0)
      if (v > 0) { kids++; value += v; days += recs.length }
    }
    return { value, days, kids }
  }, [db, range])

  const generate = () => {
    if (range.childId === 'all') actions.createInvoicesForAll(range.from, range.to)
    else actions.createInvoice(range.childId, range.from, range.to)
    setGenerating(false)
  }

  return (
    <>
      <PageHead
        title="Invoices"
        subtitle={`${db.invoices.length} total`}
        actions={
          <>
            <ActionButton icon="⬇" label="Export CSV" disabled={db.invoices.length === 0}
                          onClick={() => download('invoices.csv', invoicesCSV(db), 'text/csv')} />
            <ActionButton icon="✚" label="Generate invoices" primary disabled={db.children.length === 0}
                          onClick={() => setGenerating(true)} />
          </>
        }
      />

      <div className="stat-grid">
        <Stat label="Outstanding" value={formatMoney(totals.outstanding, currency, locale)}
              tone={totals.outstanding > 0 ? 'warn' : 'good'} />
        <Stat label="Overdue" value={formatMoney(totals.overdue, currency, locale)}
              tone={totals.overdue > 0 ? 'bad' : 'good'} />
        <Stat label="In draft" value={formatMoney(totals.drafts, currency, locale)}
              sub="Not sent yet" />
      </div>

      <Card>
        <div className="toolbar">
          {FILTERS.map(f => (
            <button key={f} className={filter === f ? 'pill active' : 'pill'} onClick={() => setFilter(f)}>
              {f}
            </button>
          ))}
        </div>

        {list.length === 0 ? (
          <EmptyState title="No invoices here"
                      action={<button className="btn primary" onClick={() => setGenerating(true)}>Generate invoices</button>}>
            Invoices are built from recorded attendance. Anything already invoiced is locked so it
            cannot be billed twice.
          </EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Number</th><th>Child</th><th>Period</th><th>Issued</th><th>Due</th>
                  <th className="num">Total</th><th className="num">Paid</th><th className="num">Owing</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {list.map(inv => {
                  const child = db.children.find(c => c.id === inv.childId)
                  const s = statusLabel(inv)
                  return (
                    <tr key={inv.id}>
                      <td><Link to={`/invoices/${inv.id}`}><strong>{inv.number}</strong></Link></td>
                      <td>
                        <span className="child-cell">
                          <Avatar child={child} size={24} />{childName(child)}
                        </span>
                      </td>
                      <td className="muted">{formatDate(inv.periodStart, locale)} – {formatDate(inv.periodEnd, locale)}</td>
                      <td className="muted">{formatDate(inv.issueDate, locale)}</td>
                      <td className="muted">{formatDate(inv.dueDate, locale)}</td>
                      <td className="num">{formatMoney(inv.total, currency, locale)}</td>
                      <td className="num">{formatMoney(amountPaid(inv), currency, locale)}</td>
                      <td className="num">{formatMoney(amountDue(inv), currency, locale)}</td>
                      <td><Badge tone={s.tone as 'good'}>{s.text}</Badge></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={generating}
        title="Generate invoices"
        onClose={() => setGenerating(false)}
        footer={
          <>
            <button className="btn" onClick={() => setGenerating(false)}>Cancel</button>
            <button className="btn primary" disabled={preview.value <= 0} onClick={generate}>
              {preview.kids > 1 ? `Create ${preview.kids} drafts` : 'Create draft'}
            </button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="From"><input className="input" type="date" value={range.from}
                                     onChange={e => setRange({ ...range, from: e.target.value })} /></Field>
          <Field label="To"><input className="input" type="date" value={range.to}
                                   onChange={e => setRange({ ...range, to: e.target.value })} /></Field>
          <Field label="Child" wide>
            <select className="input" value={range.childId}
                    onChange={e => setRange({ ...range, childId: e.target.value })}>
              <option value="all">Everyone with billable time</option>
              {db.children.filter(c => c.status !== 'archived')
                .map(c => <option key={c.id} value={c.id}>{childName(c)}</option>)}
            </select>
          </Field>
        </div>

        <div className="row gap">
          <button className="btn small" onClick={() => {
            const m = addMonths(today(), -1)
            setRange({ ...range, from: startOfMonth(m), to: endOfMonth(m) })
          }}>Last month</button>
          <button className="btn small" onClick={() =>
            setRange({ ...range, from: startOfMonth(today()), to: endOfMonth(today()) })
          }>This month</button>
        </div>

        <p className={preview.value > 0 ? 'notice' : 'notice muted'}>
          {preview.value > 0
            ? `${preview.kids} ${preview.kids === 1 ? 'child' : 'children'}, ${preview.days} uninvoiced days, ` +
              `${formatMoney(preview.value, currency, locale)} before ${db.settings.taxEnabled ? db.settings.taxName : 'tax'}.`
            : 'No uninvoiced attendance in this period.'}
        </p>
      </Modal>
    </>
  )
}
