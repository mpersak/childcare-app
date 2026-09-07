import type { AttendanceRecord, Child, ScheduleBlock, Settings, ISODate } from '../types'
import { timeToMinutes, weekdayOf, inRange, daysBetween } from './dates'
import { round2 } from './money'

export interface BillingResult {
  /** Actual clock minutes between check-in and check-out, when recorded. */
  rawMinutes: number
  /** Minutes actually charged, after basis, rounding, minimum and cap. */
  billedMinutes: number
  billedHours: number
  rate: number
  /** Multiplier applied for the day's status (holiday, sick, absent). */
  statusRate: number
  /** Hours x rate x statusRate, before the late fee. */
  baseAmount: number
  lateMinutes: number
  lateBlocks: number
  lateFee: number
  amount: number
  /** Human-readable reasons the charge is what it is. */
  adjustments: string[]
}

export const EMPTY_BILLING: BillingResult = {
  rawMinutes: 0, billedMinutes: 0, billedHours: 0, rate: 0, statusRate: 0,
  baseAmount: 0, lateMinutes: 0, lateBlocks: 0, lateFee: 0, amount: 0, adjustments: [],
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

/**
 * The booking that applies to a record: the snapshot taken on the day if there
 * is one, otherwise the live schedule.
 *
 * Preferring the snapshot is what stops a change to a child's weekly booking
 * re-pricing days that were already recorded — the same guarantee `rate` gives.
 */
export function bookedSpanFor(
  record: AttendanceRecord, blocks: ScheduleBlock[],
): { from: number; to: number; minutes: number } | null {
  const snapFrom = timeToMinutes(record.bookedFrom)
  const snapTo = timeToMinutes(record.bookedTo)
  if (snapFrom !== null && snapTo !== null && snapTo > snapFrom) {
    return { from: snapFrom, to: snapTo, minutes: snapTo - snapFrom }
  }
  const minutes = scheduledMinutes(blocks)
  if (minutes === 0 || blocks.length === 0) return null
  const from = Math.min(...blocks.map(b => timeToMinutes(b.start) ?? 0))
  const to = Math.max(...blocks.map(b => timeToMinutes(b.end) ?? 0))
  return { from, to, minutes }
}

export function rateForChild(child: Child | undefined, settings: Settings): number {
  if (child && child.hourlyRate !== null && isFinite(child.hourlyRate)) return child.hourlyRate
  return settings.defaultHourlyRate
}

/**
 * The multiplier for a day that was not attended as normal.
 *
 * A holiday declared with enough notice is discounted; declared late, it is
 * charged in full. Sickness and unexplained absence are charged in full — the
 * place was held either way.
 */
export function statusRateFor(record: AttendanceRecord, s: Settings): { rate: number; why: string } {
  switch (record.status) {
    case 'present':
      return { rate: 1, why: '' }
    case 'sick':
      return { rate: s.sickRate, why: s.sickRate === 1 ? 'Sick day, charged in full' : 'Sick day' }
    case 'absent':
      return { rate: s.absentRate, why: s.absentRate === 1 ? 'Absent, charged in full' : 'Absent' }
    case 'holiday': {
      // Notice runs from the day it was declared to the day off.
      const notice = record.noticeDate ? daysBetween(record.noticeDate, record.date) : 0
      if (notice >= s.holidayNoticeDays) {
        return {
          rate: s.holidayNoticedRate,
          why: `Holiday, ${notice} days' notice — ${Math.round(s.holidayNoticedRate * 100)}%`,
        }
      }
      return {
        rate: s.holidayShortNoticeRate,
        why: record.noticeDate
          ? `Holiday, only ${notice} days' notice — full price`
          : 'Holiday with no notice recorded — full price',
      }
    }
  }
}

/**
 * What a single day is worth.
 *
 * Under the 'schedule' basis the booking is the contract: the booked hours are
 * charged whether or not anyone remembered to use the tablet, and a late
 * collection is charged on top in whole blocks past a grace period.
 */
export function calcBilling(
  record: AttendanceRecord,
  settings: Settings,
  scheduleBlocks: ScheduleBlock[] = [],
): BillingResult {
  const rate = isFinite(record.rate) ? record.rate : settings.defaultHourlyRate
  const adjustments: string[] = []

  const inM = timeToMinutes(record.checkIn)
  const outM = timeToMinutes(record.checkOut)
  const rawMinutes = inM !== null && outM !== null && outM > inM ? outM - inM : 0

  const span = bookedSpanFor(record, scheduleBlocks)
  const booked = span?.minutes ?? 0
  const useSchedule = settings.billBasis === 'schedule' && booked > 0

  let base: number
  if (useSchedule) {
    base = booked
    adjustments.push('Charged on the booking')
  } else {
    // No booking, or billing on the clock: a day with no usable times is worth nothing.
    if (record.status !== 'present') {
      if (!record.billable) return { ...EMPTY_BILLING, rate }
      base = booked
      if (base === 0) return { ...EMPTY_BILLING, rate }
      adjustments.push('Charged at contracted hours')
    } else {
      if (rawMinutes === 0) return { ...EMPTY_BILLING, rate }
      base = rawMinutes
    }
  }

  // An explicitly non-billable day is not charged, whatever the basis.
  if (record.status !== 'present' && !record.billable) return { ...EMPTY_BILLING, rate }

  let billed = applyRounding(base, settings)
  if (billed !== base && !useSchedule) {
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

  const { rate: statusRate, why } = statusRateFor(record, settings)
  if (why) adjustments.push(why)
  if (statusRate <= 0) {
    return { ...EMPTY_BILLING, rate, statusRate, rawMinutes }
  }

  const billedHours = billed / 60
  const baseAmount = round2(billedHours * rate * statusRate)

  // Late collection: only for a day actually attended, and only measured against
  // a booked finish. Whole blocks, after a grace period.
  let lateMinutes = 0, lateBlocks = 0, lateFee = 0
  if (record.status === 'present' && span && settings.lateBlockFee > 0) {
    const bookedEnd = span.to
    if (outM !== null && bookedEnd > 0 && outM > bookedEnd) {
      lateMinutes = outM - bookedEnd
      const chargeable = lateMinutes - Math.max(0, settings.lateGraceMinutes)
      if (chargeable > 0) {
        const block = Math.max(1, settings.lateBlockMinutes)
        lateBlocks = Math.ceil(chargeable / block)
        lateFee = round2(lateBlocks * settings.lateBlockFee)
        adjustments.push(
          `${lateMinutes} min late — ${lateBlocks} × ${settings.lateBlockMinutes} min block`,
        )
      } else {
        adjustments.push(`${lateMinutes} min late, within the ${settings.lateGraceMinutes} min grace`)
      }
    }
  }

  return {
    rawMinutes,
    billedMinutes: billed,
    billedHours: round2(billedHours),
    rate,
    statusRate,
    baseAmount,
    lateMinutes,
    lateBlocks,
    lateFee,
    amount: round2(baseAmount + lateFee),
    adjustments,
  }
}

export function describeStatus(s: AttendanceRecord['status']): string {
  return { present: 'Present', absent: 'Absent', sick: 'Sick', holiday: 'Holiday' }[s]
}
