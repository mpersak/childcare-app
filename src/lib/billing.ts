import type { AttendanceRecord, Child, ScheduleBlock, Settings, ISODate } from '../types'
import { timeToMinutes, weekdayOf, inRange } from './dates'
import { round2 } from './money'

export interface BillingResult {
  /** Actual clock minutes between check-in and check-out. */
  rawMinutes: number
  /** Minutes after rounding / minimum / daily cap have been applied. */
  billedMinutes: number
  billedHours: number
  rate: number
  /** Hours x rate, before the late fee. */
  baseAmount: number
  lateMinutes: number
  lateFee: number
  amount: number
  /** Human-readable reasons the billed time differs from the raw time. */
  adjustments: string[]
}

export const EMPTY_BILLING: BillingResult = {
  rawMinutes: 0, billedMinutes: 0, billedHours: 0, rate: 0,
  baseAmount: 0, lateMinutes: 0, lateFee: 0, amount: 0, adjustments: [],
}

function applyRounding(minutes: number, s: Settings): number {
  const step = Math.max(1, Math.round(s.roundingMinutes || 1))
  if (step <= 1) return Math.round(minutes)
  if (s.roundingMode === 'up') return Math.ceil(minutes / step) * step
  if (s.roundingMode === 'down') return Math.floor(minutes / step) * step
  return Math.round(minutes / step) * step
}

/** The schedule blocks that apply to a child on a given date. */
export function scheduleFor(
  schedules: ScheduleBlock[], childId: string, date: ISODate,
): ScheduleBlock[] {
  const wd = weekdayOf(date)
  return schedules
    .filter(b =>
      b.childId === childId &&
      b.active &&
      b.weekday === wd &&
      inRange(date, b.effectiveFrom, b.effectiveTo))
    .sort((a, b) => a.start.localeCompare(b.start))
}

export function scheduledMinutes(blocks: ScheduleBlock[]): number {
  return blocks.reduce((sum, b) => {
    const s = timeToMinutes(b.start), e = timeToMinutes(b.end)
    if (s === null || e === null || e <= s) return sum
    return sum + (e - s)
  }, 0)
}

export function rateForChild(child: Child | undefined, settings: Settings): number {
  if (child && child.hourlyRate !== null && isFinite(child.hourlyRate)) return child.hourlyRate
  return settings.defaultHourlyRate
}

/**
 * Works out what a single attendance record is worth.
 *
 * `present` bills the clock time. A non-present day bills nothing unless it is
 * explicitly marked billable, in which case the contracted (scheduled) hours are
 * charged instead — the usual arrangement for retainer or public-holiday days.
 */
export function calcBilling(
  record: AttendanceRecord,
  settings: Settings,
  scheduleBlocks: ScheduleBlock[] = [],
): BillingResult {
  const rate = isFinite(record.rate) ? record.rate : settings.defaultHourlyRate
  const adjustments: string[] = []

  let rawMinutes = 0
  if (record.status === 'present') {
    const inM = timeToMinutes(record.checkIn)
    const outM = timeToMinutes(record.checkOut)
    // Still checked in, or a bad pair of times — nothing to bill yet.
    if (inM === null || outM === null || outM <= inM) {
      return { ...EMPTY_BILLING, rate }
    }
    rawMinutes = outM - inM
  } else {
    if (!record.billable) return { ...EMPTY_BILLING, rate }
    rawMinutes = scheduledMinutes(scheduleBlocks)
    if (rawMinutes === 0) return { ...EMPTY_BILLING, rate }
    adjustments.push('Charged at contracted hours')
  }

  let billed = applyRounding(rawMinutes, settings)
  if (billed !== rawMinutes && record.status === 'present') {
    adjustments.push(`Rounded to ${settings.roundingMinutes} min`)
  }

  const minMinutes = Math.round((settings.minimumHours || 0) * 60)
  if (minMinutes > 0 && billed < minMinutes) {
    billed = minMinutes
    adjustments.push(`Minimum ${settings.minimumHours}h applied`)
  }

  const capMinutes = Math.round((settings.dailyCapHours || 0) * 60)
  if (capMinutes > 0 && billed > capMinutes) {
    billed = capMinutes
    adjustments.push(`Capped at ${settings.dailyCapHours}h`)
  }

  // Late collection is charged on top of the hourly time, measured against the
  // latest booked finish for that day. No schedule means no late fee.
  let lateMinutes = 0
  let lateFee = 0
  if (record.status === 'present' && settings.lateFeePerMinute > 0 && scheduleBlocks.length) {
    const outM = timeToMinutes(record.checkOut)
    const bookedEnd = Math.max(...scheduleBlocks.map(b => timeToMinutes(b.end) ?? 0))
    if (outM !== null && bookedEnd > 0 && outM > bookedEnd) {
      lateMinutes = outM - bookedEnd
      lateFee = round2(lateMinutes * settings.lateFeePerMinute)
      adjustments.push(`${lateMinutes} min late collection`)
    }
  }

  const billedHours = billed / 60
  const baseAmount = round2(billedHours * rate)
  return {
    rawMinutes,
    billedMinutes: billed,
    billedHours: round2(billedHours),
    rate,
    baseAmount,
    lateMinutes,
    lateFee,
    amount: round2(baseAmount + lateFee),
    adjustments,
  }
}

export function describeStatus(s: AttendanceRecord['status']): string {
  return { present: 'Present', absent: 'Absent', sick: 'Sick', holiday: 'Holiday' }[s]
}
