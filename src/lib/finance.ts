import type { Database, ISODate } from '../types'
import { amountDue, amountPaid, isOverdue } from './invoicing'
import { calcBilling, scheduleFor } from './billing'
import { round2 } from './money'
import { addMonths, monthKey, startOfMonth, today } from './dates'

export interface MonthPoint {
  key: string
  /** Invoiced excluding tax — the actual earnings figure. */
  revenue: number
  /** Cash actually received in that month, by payment date. */
  collected: number
  hours: number
}

export interface AgingBuckets {
  current: number
  d1to30: number
  d31to60: number
  d60plus: number
}

export interface FinancialSummary {
  monthToDate: number
  lastMonth: number
  yearToDate: number
  outstanding: number
  overdue: number
  draftValue: number
  /** Billable attendance not yet on any invoice — work in progress. */
  unbilled: number
  unbilledHours: number
  collectedThisMonth: number
  aging: AgingBuckets
  months: MonthPoint[]
  perChild: { childId: string; revenue: number; hours: number; outstanding: number }[]
  averageHourlyYield: number
}

function daysBetween(a: ISODate, b: ISODate): number {
  const ms = new Date(b).getTime() - new Date(a).getTime()
  return Math.floor(ms / 86_400_000)
}

/** One pass over the database producing everything the Finance page needs. */
export function summarise(db: Database, asOf: ISODate = today(), monthsBack = 12): FinancialSummary {
  const live = db.invoices.filter(i => i.status !== 'void')
  const thisMonth = monthKey(asOf)
  const prevMonth = monthKey(addMonths(startOfMonth(asOf), -1))
  const year = asOf.slice(0, 4)

  // Seed the series so months with no activity still render as gaps, not holes.
  const series = new Map<string, MonthPoint>()
  for (let i = monthsBack - 1; i >= 0; i--) {
    const key = monthKey(addMonths(startOfMonth(asOf), -i))
    series.set(key, { key, revenue: 0, collected: 0, hours: 0 })
  }

  let monthToDate = 0, lastMonth = 0, yearToDate = 0
  let outstanding = 0, overdue = 0, draftValue = 0, collectedThisMonth = 0
  const aging: AgingBuckets = { current: 0, d1to30: 0, d31to60: 0, d60plus: 0 }
  const perChild = new Map<string, { childId: string; revenue: number; hours: number; outstanding: number }>()

  const bump = (childId: string) => {
    if (!perChild.has(childId)) perChild.set(childId, { childId, revenue: 0, hours: 0, outstanding: 0 })
    return perChild.get(childId)!
  }

  for (const inv of live) {
    const net = inv.subtotal // excludes tax — tax is collected on behalf, not income
    const hours = inv.lines.reduce((s, l) => s + (isFinite(l.hours) ? l.hours : 0), 0)
    const key = monthKey(inv.issueDate)
    const point = series.get(key)
    if (point) {
      point.revenue = round2(point.revenue + net)
      point.hours = round2(point.hours + hours)
    }

    const child = bump(inv.childId)
    child.revenue = round2(child.revenue + net)
    child.hours = round2(child.hours + hours)

    if (key === thisMonth) monthToDate = round2(monthToDate + net)
    if (key === prevMonth) lastMonth = round2(lastMonth + net)
    if (inv.issueDate.slice(0, 4) === year) yearToDate = round2(yearToDate + net)

    if (inv.status === 'draft') {
      draftValue = round2(draftValue + inv.total)
    } else {
      const due = amountDue(inv)
      if (due > 0.005) {
        outstanding = round2(outstanding + due)
        child.outstanding = round2(child.outstanding + due)
        if (isOverdue(inv, asOf)) overdue = round2(overdue + due)

        const age = daysBetween(inv.dueDate, asOf)
        if (age <= 0) aging.current = round2(aging.current + due)
        else if (age <= 30) aging.d1to30 = round2(aging.d1to30 + due)
        else if (age <= 60) aging.d31to60 = round2(aging.d31to60 + due)
        else aging.d60plus = round2(aging.d60plus + due)
      }
    }

    for (const p of inv.payments) {
      const pk = monthKey(p.date)
      const pp = series.get(pk)
      if (pp) pp.collected = round2(pp.collected + p.amount)
      if (pk === thisMonth) collectedThisMonth = round2(collectedThisMonth + p.amount)
    }
  }

  // Work in progress: attended and billable, but not yet on an invoice.
  let unbilled = 0, unbilledHours = 0
  for (const r of db.attendance) {
    if (r.invoiceId) continue
    const b = calcBilling(r, db.settings, scheduleFor(db.schedules, r.childId, r.date))
    if (b.amount <= 0) continue
    unbilled = round2(unbilled + b.amount)
    unbilledHours = round2(unbilledHours + b.billedHours)
  }

  const totalRevenue = [...series.values()].reduce((s, m) => s + m.revenue, 0)
  const totalHours = [...series.values()].reduce((s, m) => s + m.hours, 0)

  return {
    monthToDate, lastMonth, yearToDate,
    outstanding, overdue, draftValue,
    unbilled, unbilledHours, collectedThisMonth,
    aging,
    months: [...series.values()],
    perChild: [...perChild.values()].sort((a, b) => b.revenue - a.revenue),
    averageHourlyYield: totalHours > 0 ? round2(totalRevenue / totalHours) : 0,
  }
}

export function paidRatio(db: Database): number {
  const live = db.invoices.filter(i => i.status !== 'void' && i.status !== 'draft')
  const billed = live.reduce((s, i) => s + i.total, 0)
  if (billed <= 0) return 0
  const paid = live.reduce((s, i) => s + amountPaid(i), 0)
  return Math.min(1, paid / billed)
}
