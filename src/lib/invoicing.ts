import type {
  Database, Invoice, InvoiceLine, ISODate, Settings, AttendanceRecord,
} from '../types'
import { uid } from './defaults'
import { calcBilling, scheduleFor } from './billing'
import { round2 } from './money'
import { addDays, formatDateShort, formatHours, today } from './dates'

export function invoiceNumberFor(settings: Settings): string {
  return `${settings.invoicePrefix}${settings.nextInvoiceNumber}`
}

/** Sum of lines + adjustments, then tax. Adjustments are taxed like everything else. */
export function recalcTotals(
  lines: InvoiceLine[],
  adjustments: { amount: number }[],
  settings: Settings,
): Pick<Invoice, 'subtotal' | 'tax' | 'total'> {
  const linesTotal = lines.reduce((s, l) => s + (isFinite(l.amount) ? l.amount : 0), 0)
  const adjTotal = adjustments.reduce((s, a) => s + (isFinite(a.amount) ? a.amount : 0), 0)
  const subtotal = round2(linesTotal + adjTotal)
  const tax = settings.taxEnabled ? round2(subtotal * settings.taxRate) : 0
  return { subtotal, tax, total: round2(subtotal + tax) }
}

export function amountPaid(inv: Invoice): number {
  return round2(inv.payments.reduce((s, p) => s + (isFinite(p.amount) ? p.amount : 0), 0))
}

export function amountDue(inv: Invoice): number {
  if (inv.status === 'void') return 0
  return round2(inv.total - amountPaid(inv))
}

export function isOverdue(inv: Invoice, asOf: ISODate = today()): boolean {
  return inv.status === 'sent' && amountDue(inv) > 0.005 && inv.dueDate < asOf
}

/** Attendance in the window that is worth money and has not been billed yet. */
export function billableRecords(
  db: Database, childId: string, from: ISODate, to: ISODate,
): AttendanceRecord[] {
  return db.attendance
    .filter(r =>
      r.childId === childId &&
      r.date >= from && r.date <= to &&
      !r.invoiceId)
    .filter(r => {
      const blocks = scheduleFor(db.schedules, childId, r.date)
      return calcBilling(r, db.settings, blocks).amount > 0
    })
    .sort((a, b) => a.date.localeCompare(b.date))
}

export interface DraftInvoice {
  invoice: Invoice
  attendanceIds: string[]
}

/**
 * Builds a draft invoice for one child over a date range.
 * Returns null when there is nothing billable — the caller decides how to report that.
 */
export function buildInvoice(
  db: Database, childId: string, from: ISODate, to: ISODate, numberOverride?: string,
): DraftInvoice | null {
  const records = billableRecords(db, childId, from, to)
  if (records.length === 0) return null

  const lines: InvoiceLine[] = []
  for (const r of records) {
    const blocks = scheduleFor(db.schedules, childId, r.date)
    const b = calcBilling(r, db.settings, blocks)
    if (b.baseAmount > 0) {
      const times = r.status === 'present' && r.checkIn && r.checkOut
        ? ` ${r.checkIn}–${r.checkOut}`
        : ` (${r.status})`
      lines.push({
        id: uid('line'),
        date: r.date,
        description: `${formatDateShort(r.date, db.settings.locale)}${times} · ${formatHours(b.billedHours)}`,
        hours: b.billedHours,
        rate: b.rate,
        amount: b.baseAmount,
        attendanceId: r.id,
      })
    }
    if (b.lateFee > 0) {
      lines.push({
        id: uid('line'),
        date: r.date,
        description: `${formatDateShort(r.date, db.settings.locale)} · late collection (${b.lateMinutes} min)`,
        hours: 0,
        rate: 0,
        amount: b.lateFee,
        attendanceId: r.id,
      })
    }
  }
  if (lines.length === 0) return null

  const issue = today()
  const totals = recalcTotals(lines, [], db.settings)
  const invoice: Invoice = {
    id: uid('inv'),
    number: numberOverride ?? invoiceNumberFor(db.settings),
    childId,
    periodStart: from,
    periodEnd: to,
    issueDate: issue,
    dueDate: addDays(issue, db.settings.paymentTermsDays),
    lines,
    adjustments: [],
    ...totals,
    status: 'draft',
    payments: [],
    notes: '',
    createdAt: new Date().toISOString(),
  }
  return { invoice, attendanceIds: records.map(r => r.id) }
}

export function statusLabel(inv: Invoice): { text: string; tone: string } {
  if (inv.status === 'void') return { text: 'Void', tone: 'muted' }
  if (inv.status === 'paid') return { text: 'Paid', tone: 'good' }
  if (isOverdue(inv)) return { text: 'Overdue', tone: 'bad' }
  if (inv.status === 'sent') {
    return amountPaid(inv) > 0 ? { text: 'Part paid', tone: 'warn' } : { text: 'Sent', tone: 'info' }
  }
  return { text: 'Draft', tone: 'muted' }
}
