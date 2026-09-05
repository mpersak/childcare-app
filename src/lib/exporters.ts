import type { Database } from '../types'
import { calcBilling, scheduleFor } from './billing'
import { amountDue, amountPaid } from './invoicing'
import { childName } from './store'

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
