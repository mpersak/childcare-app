import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useStore, childName } from '../lib/store'
import { Badge, Card, ConfirmButton, Field, PageHead } from '../components/ui'
import { amountDue, amountPaid, statusLabel } from '../lib/invoicing'
import { formatMoney, parseMoney } from '../lib/money'
import { formatDate, formatHours, today } from '../lib/dates'
import { uid } from '../lib/defaults'
import type { InvoiceStatus } from '../types'

const STATUSES: InvoiceStatus[] = ['draft', 'sent', 'paid', 'void']

export default function InvoiceDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const { db, actions } = useStore()
  const { currency, locale, taxName, taxEnabled } = db.settings
  const inv = db.invoices.find(i => i.id === id)
  const [payment, setPayment] = useState({ amount: '', date: today(), method: 'Bank transfer', reference: '' })

  if (!inv) {
    return <Card><p>That invoice no longer exists. <Link to="/invoices">Back to invoices</Link>.</p></Card>
  }

  const child = db.children.find(c => c.id === inv.childId)
  const payer = child?.guardians.find(g => g.primary) ?? child?.guardians[0]
  const due = amountDue(inv)
  const paid = amountPaid(inv)
  const s = statusLabel(inv)

  const addPayment = () => {
    const amount = parseMoney(payment.amount)
    if (amount <= 0) return
    actions.addPayment(inv.id, amount, payment.date, payment.method, payment.reference)
    setPayment({ amount: '', date: today(), method: payment.method, reference: '' })
  }

  return (
    <>
      <PageHead
        title={inv.number}
        subtitle={<>{childName(child)} · <Badge tone={s.tone as 'good'}>{s.text}</Badge></>}
        actions={
          <>
            <Link className="btn" to="/invoices">All invoices</Link>
            <button className="btn" onClick={() => window.print()}>Print / PDF</button>
          </>
        }
      />

      <div className="invoice-layout">
        {/* The printable document. Everything else is hidden by the print stylesheet. */}
        <article className="invoice-doc">
          <header className="inv-head">
            <div>
              <div className="inv-logo">{db.settings.logoText || 'CC'}</div>
              <h2>{db.settings.businessName}</h2>
              <p className="pre">{db.settings.businessAddress}</p>
              <p className="muted small">
                {db.settings.businessEmail}{db.settings.businessEmail && db.settings.businessPhone ? ' · ' : ''}
                {db.settings.businessPhone}
              </p>
            </div>
            <div className="inv-meta">
              <h1>Invoice</h1>
              <dl>
                <div><dt>Number</dt><dd>{inv.number}</dd></div>
                <div><dt>Issued</dt><dd>{formatDate(inv.issueDate, locale)}</dd></div>
                <div><dt>Due</dt><dd>{formatDate(inv.dueDate, locale)}</dd></div>
                <div><dt>Period</dt><dd>{formatDate(inv.periodStart, locale)} – {formatDate(inv.periodEnd, locale)}</dd></div>
              </dl>
            </div>
          </header>

          <section className="inv-to">
            <span className="muted small">Bill to</span>
            <strong>{payer?.name || childName(child)}</strong>
            {payer?.email && <div className="muted small">{payer.email}</div>}
            <div className="muted small">Care for {childName(child)}</div>
          </section>

          <table className="table inv-lines">
            <thead>
              <tr>
                <th>Description</th>
                <th className="num">Hours</th>
                <th className="num">Rate</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {inv.lines.map(l => (
                <tr key={l.id}>
                  <td>{l.description}</td>
                  <td className="num">{l.hours > 0 ? formatHours(l.hours) : '—'}</td>
                  <td className="num">{l.rate > 0 ? formatMoney(l.rate, currency, locale) : '—'}</td>
                  <td className="num">{formatMoney(l.amount, currency, locale)}</td>
                </tr>
              ))}
              {inv.adjustments.map(a => (
                <tr key={a.id}>
                  <td>{a.description || 'Adjustment'}</td>
                  <td className="num">—</td><td className="num">—</td>
                  <td className="num">{formatMoney(a.amount, currency, locale)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="right">Subtotal</td>
                <td className="num">{formatMoney(inv.subtotal, currency, locale)}</td>
              </tr>
              {taxEnabled && (
                <tr>
                  <td colSpan={3} className="right">
                    {taxName} at {(db.settings.taxRate * 100).toFixed(0)}%
                  </td>
                  <td className="num">{formatMoney(inv.tax, currency, locale)}</td>
                </tr>
              )}
              <tr className="total-row">
                <td colSpan={3} className="right">Total</td>
                <td className="num">{formatMoney(inv.total, currency, locale)}</td>
              </tr>
              {paid > 0 && (
                <>
                  <tr>
                    <td colSpan={3} className="right">Paid</td>
                    <td className="num">−{formatMoney(paid, currency, locale)}</td>
                  </tr>
                  <tr className="total-row">
                    <td colSpan={3} className="right">Balance due</td>
                    <td className="num">{formatMoney(due, currency, locale)}</td>
                  </tr>
                </>
              )}
            </tfoot>
          </table>

          <footer className="inv-foot">
            {db.settings.bankAccount && (
              <p><strong>Payment to</strong> {db.settings.bankAccount}, reference {inv.number}</p>
            )}
            {inv.notes && <p className="pre">{inv.notes}</p>}
            {db.settings.invoiceFooter && <p className="muted small">{db.settings.invoiceFooter}</p>}
          </footer>
        </article>

        <div className="stack no-print">
          <Card title="Status">
            <div className="toolbar">
              {STATUSES.map(st => (
                <button key={st} className={inv.status === st ? 'pill active' : 'pill'}
                        onClick={() => actions.setInvoiceStatus(inv.id, st)}>
                  {st}
                </button>
              ))}
            </div>
            <dl className="kv">
              <div><dt>Total</dt><dd>{formatMoney(inv.total, currency, locale)}</dd></div>
              <div><dt>Paid</dt><dd>{formatMoney(paid, currency, locale)}</dd></div>
              <div><dt>Balance</dt><dd><strong>{formatMoney(due, currency, locale)}</strong></dd></div>
            </dl>
            <div className="form-grid">
              <Field label="Issued">
                <input className="input" type="date" value={inv.issueDate}
                       onChange={e => actions.updateInvoice(inv.id, { issueDate: e.target.value })} />
              </Field>
              <Field label="Due">
                <input className="input" type="date" value={inv.dueDate}
                       onChange={e => actions.updateInvoice(inv.id, { dueDate: e.target.value })} />
              </Field>
              <Field label="Note on invoice" wide>
                <textarea className="input" rows={2} value={inv.notes}
                          onChange={e => actions.updateInvoice(inv.id, { notes: e.target.value })} />
              </Field>
            </div>
          </Card>

          <Card
            title="Adjustments"
            actions={
              <button className="btn small" onClick={() => actions.updateInvoice(inv.id, {
                adjustments: [...inv.adjustments, { id: uid('adj'), description: '', amount: 0 }],
              })}>Add line</button>
            }
          >
            {inv.adjustments.length === 0 ? (
              <p className="muted">Use a negative amount for a discount, positive for a surcharge.</p>
            ) : inv.adjustments.map(a => (
              <div className="row gap" key={a.id}>
                <input className="input" placeholder="Description" value={a.description}
                       onChange={e => actions.updateInvoice(inv.id, {
                         adjustments: inv.adjustments.map(x => x.id === a.id ? { ...x, description: e.target.value } : x),
                       })} />
                <input className="input tight" type="number" step="0.01" value={a.amount}
                       onChange={e => actions.updateInvoice(inv.id, {
                         adjustments: inv.adjustments.map(x => x.id === a.id ? { ...x, amount: Number(e.target.value) } : x),
                       })} />
                <button className="btn small danger" onClick={() => actions.updateInvoice(inv.id, {
                  adjustments: inv.adjustments.filter(x => x.id !== a.id),
                })}>×</button>
              </div>
            ))}
          </Card>

          <Card title="Payments">
            {inv.payments.length > 0 && (
              <table className="table">
                <tbody>
                  {inv.payments.map(p => (
                    <tr key={p.id}>
                      <td>{formatDate(p.date, locale)}</td>
                      <td className="muted">{p.method}{p.reference ? ` · ${p.reference}` : ''}</td>
                      <td className="num">{formatMoney(p.amount, currency, locale)}</td>
                      <td className="right">
                        <button className="link danger" onClick={() => actions.removePayment(inv.id, p.id)}>
                          remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="form-grid">
              <Field label="Amount">
                <input className="input" type="number" step="0.01" placeholder={String(due.toFixed(2))}
                       value={payment.amount} onChange={e => setPayment({ ...payment, amount: e.target.value })} />
              </Field>
              <Field label="Date">
                <input className="input" type="date" value={payment.date}
                       onChange={e => setPayment({ ...payment, date: e.target.value })} />
              </Field>
              <Field label="Method">
                <input className="input" value={payment.method}
                       onChange={e => setPayment({ ...payment, method: e.target.value })} />
              </Field>
              <Field label="Reference">
                <input className="input" value={payment.reference}
                       onChange={e => setPayment({ ...payment, reference: e.target.value })} />
              </Field>
            </div>
            <div className="row gap">
              <button className="btn" onClick={() => setPayment({ ...payment, amount: due.toFixed(2) })}>
                Full balance
              </button>
              <button className="btn primary" onClick={addPayment}>Record payment</button>
            </div>
          </Card>

          <Card title="Danger zone">
            <ConfirmButton
              confirmLabel="Delete and unlock its days?"
              onConfirm={() => { actions.deleteInvoice(inv.id); nav('/invoices') }}
            >
              Delete invoice
            </ConfirmButton>
            <p className="muted small">
              Deleting releases the attendance behind it so the period can be re-invoiced.
              Prefer marking an issued invoice <em>void</em> to keep the audit trail.
            </p>
          </Card>
        </div>
      </div>
    </>
  )
}
