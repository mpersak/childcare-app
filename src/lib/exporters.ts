import type { Database } from '../types'
import { calcBilling, scheduleFor } from './billing'
import { amountDue, amountPaid } from './invoicing'
import { childName } from './store'
import { formatMoney } from './money'
import { WEEKDAYS } from './dates'

/** RFC 4180 quoting. A leading =, +, - or @ is prefixed so Excel treats it as text. */
function cell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function toCSV(rows: unknown[][]): string {
  return rows.map(r => r.map(cell).join(',')).join('\r\n')
}

export function download(filename: string, content: string, mime = 'text/plain'): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Give the browser a beat to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function attendanceCSV(db: Database, from?: string, to?: string): string {
  const rows: unknown[][] = [[
    'Date', 'Child', 'Status', 'Check in', 'Check out',
    'Billed hours', 'Rate', 'Amount', 'Invoiced', 'Note',
  ]]
  const records = db.attendance
    .filter(r => (!from || r.date >= from) && (!to || r.date <= to))
    .sort((a, b) => a.date.localeCompare(b.date))

  for (const r of records) {
    const child = db.children.find(c => c.id === r.childId)
    const b = calcBilling(r, db.settings, scheduleFor(db.schedules, r.childId, r.date))
    const inv = db.invoices.find(i => i.id === r.invoiceId)
    rows.push([
      r.date, childName(child), r.status, r.checkIn ?? '', r.checkOut ?? '',
      b.billedHours.toFixed(2), b.rate.toFixed(2), b.amount.toFixed(2),
      inv?.number ?? '', r.note,
    ])
  }
  return toCSV(rows)
}

export function invoicesCSV(db: Database): string {
  const rows: unknown[][] = [[
    'Number', 'Child', 'Issued', 'Due', 'Period start', 'Period end',
    'Subtotal', 'Tax', 'Total', 'Paid', 'Due amount', 'Status',
  ]]
  for (const inv of [...db.invoices].sort((a, b) => a.issueDate.localeCompare(b.issueDate))) {
    const child = db.children.find(c => c.id === inv.childId)
    rows.push([
      inv.number, childName(child), inv.issueDate, inv.dueDate,
      inv.periodStart, inv.periodEnd,
      inv.subtotal.toFixed(2), inv.tax.toFixed(2), inv.total.toFixed(2),
      amountPaid(inv).toFixed(2), amountDue(inv).toFixed(2), inv.status,
    ])
  }
  return toCSV(rows)
}

export function notesCSV(db: Database): string {
  const rows: unknown[][] = [['Date', 'Child', 'Category', 'Title', 'Note', 'Author', 'Flagged']]
  for (const n of [...db.notes].sort((a, b) => b.date.localeCompare(a.date))) {
    const child = db.children.find(c => c.id === n.childId)
    rows.push([n.date, childName(child), n.category, n.title, n.body, n.author, n.flagged ? 'yes' : ''])
  }
  return toCSV(rows)
}

/**
 * Everything in one readable, printable HTML file — for filing, or for keeping a
 * copy somewhere like Google Drive. This is plaintext by design, so it contains
 * children's personal details: store it accordingly.
 */
export function readableHTML(db: Database): string {
  const { locale, currency } = db.settings
  const money = (n: number) => formatMoney(n, currency, locale)
  const esc = (s: unknown) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const child = (id: string) => childName(db.children.find(c => c.id === id))

  const kids = db.children.map(c => {
    const sched = db.schedules
      .filter(s => s.childId === c.id && s.active)
      .sort((a, b) => a.weekday - b.weekday)
      .map(s => `${WEEKDAYS[s.weekday]} ${s.start}–${s.end}`)
      .join('<br>') || '—'
    const guardians = c.guardians
      .map(g => `${esc(g.name)} (${esc(g.relationship)}) ${esc(g.phone)} ${esc(g.email)}`)
      .join('<br>') || '—'
    return `<tr>
      <td>${esc(childName(c))}</td><td>${esc(c.dob)}</td><td>${esc(c.status)}</td>
      <td>${sched}</td><td>${guardians}</td>
      <td>${esc(c.allergies) || '—'}</td><td>${esc(c.medical) || '—'}</td></tr>`
  }).join('')

  const attendance = [...db.attendance]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(r => {
      const b = calcBilling(r, db.settings, scheduleFor(db.schedules, r.childId, r.date))
      return `<tr><td>${esc(r.date)}</td><td>${esc(child(r.childId))}</td>
        <td>${esc(r.status)}</td><td>${esc(r.checkIn ?? '')}</td><td>${esc(r.checkOut ?? '')}</td>
        <td class="n">${b.billedHours.toFixed(2)}</td><td class="n">${money(b.amount)}</td>
        <td>${r.signIn ? 'signed in' : ''} ${r.signOut ? 'signed out' : ''}</td>
        <td>${esc(r.note)}</td></tr>`
    }).join('')

  const invoices = [...db.invoices]
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate))
    .map(i => `<tr><td>${esc(i.number)}</td><td>${esc(child(i.childId))}</td>
      <td>${esc(i.periodStart)} – ${esc(i.periodEnd)}</td><td>${esc(i.issueDate)}</td>
      <td class="n">${money(i.total)}</td><td class="n">${money(amountPaid(i))}</td>
      <td class="n">${money(amountDue(i))}</td><td>${esc(i.status)}</td></tr>`).join('')

  const notes = [...db.notes]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(n => `<tr><td>${esc(n.date)}</td><td>${esc(child(n.childId))}</td>
      <td>${esc(n.category)}</td><td>${esc(n.title)}</td><td>${esc(n.body)}</td>
      <td>${n.flagged ? 'flagged' : ''}</td></tr>`).join('')

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(db.settings.businessName)} — full record</title>
<style>
  body { font: 13px/1.5 system-ui, sans-serif; margin: 32px; color: #111; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 28px 0 8px; border-bottom: 2px solid #333; padding-bottom: 4px; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 12px; }
  th, td { border: 1px solid #bbb; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #eee; font-size: 11px; text-transform: uppercase; }
  .n { text-align: right; }
  .meta { color: #555; margin-bottom: 4px; }
</style></head><body>
<h1>${esc(db.settings.businessName)}</h1>
<p class="meta">Full record exported ${new Date().toLocaleString(locale)}. Contains personal information.</p>

<h2>Children (${db.children.length})</h2>
<table><thead><tr><th>Name</th><th>Date of birth</th><th>Status</th><th>Weekly booking</th>
<th>Guardians</th><th>Allergies</th><th>Medical</th></tr></thead><tbody>${kids}</tbody></table>

<h2>Attendance (${db.attendance.length})</h2>
<table><thead><tr><th>Date</th><th>Child</th><th>Status</th><th>In</th><th>Out</th>
<th>Hours</th><th>Charge</th><th>Signatures</th><th>Note</th></tr></thead><tbody>${attendance}</tbody></table>

<h2>Invoices (${db.invoices.length})</h2>
<table><thead><tr><th>Number</th><th>Child</th><th>Period</th><th>Issued</th>
<th>Total</th><th>Paid</th><th>Owing</th><th>Status</th></tr></thead><tbody>${invoices}</tbody></table>

<h2>Notes (${db.notes.length})</h2>
<table><thead><tr><th>Date</th><th>Child</th><th>Category</th><th>Title</th><th>Note</th>
<th></th></tr></thead><tbody>${notes}</tbody></table>
</body></html>`
}
