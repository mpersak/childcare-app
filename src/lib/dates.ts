import type { ISODate } from '../types'

/** Local-time ISO date (yyyy-mm-dd). Never use toISOString() — it shifts by timezone. */
export function toISODate(d: Date): ISODate {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function today(): ISODate {
  return toISODate(new Date())
}

export function nowTime(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Parses `yyyy-mm-dd` into a local midnight Date. */
export function fromISODate(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

export function addDays(s: ISODate, n: number): ISODate {
  const d = fromISODate(s)
  d.setDate(d.getDate() + n)
  return toISODate(d)
}

export function addMonths(s: ISODate, n: number): ISODate {
  const d = fromISODate(s)
  d.setMonth(d.getMonth() + n)
  return toISODate(d)
}

export function weekdayOf(s: ISODate): number {
  return fromISODate(s).getDay()
}

export function startOfWeek(s: ISODate, weekStartsOn = 1): ISODate {
  const d = fromISODate(s)
  const diff = (d.getDay() - weekStartsOn + 7) % 7
  d.setDate(d.getDate() - diff)
  return toISODate(d)
}

export function startOfMonth(s: ISODate): ISODate {
  const d = fromISODate(s)
  return toISODate(new Date(d.getFullYear(), d.getMonth(), 1))
}

export function endOfMonth(s: ISODate): ISODate {
  const d = fromISODate(s)
  return toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0))
}

export function monthKey(s: ISODate): string {
  return s.slice(0, 7)
}

/** Inclusive on both ends. Empty bounds are treated as open. */
export function inRange(date: ISODate, from: ISODate | '', to: ISODate | ''): boolean {
  if (from && date < from) return false
  if (to && date > to) return false
  return true
}

export function eachDay(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = []
  let cur = from
  let guard = 0
  while (cur <= to && guard++ < 4000) {
    out.push(cur)
    cur = addDays(cur, 1)
  }
  return out
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function formatDate(s: ISODate | '', locale = 'en-NZ'): string {
  if (!s) return '—'
  return fromISODate(s).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatDateShort(s: ISODate | '', locale = 'en-NZ'): string {
  if (!s) return '—'
  return fromISODate(s).toLocaleDateString(locale, { day: '2-digit', month: 'short' })
}

export function formatMonth(key: string, locale = 'en-NZ'): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(locale, { month: 'short', year: '2-digit' })
}

/** `HH:MM` to minutes since midnight. Returns null on anything unparseable. */
export function timeToMinutes(t: string | null | undefined): number | null {
  if (!t) return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim())
  if (!m) return null
  const h = Number(m[1]), mi = Number(m[2])
  if (h > 23 || mi > 59) return null
  return h * 60 + mi
}

export function minutesToTime(mins: number): string {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export function formatHours(h: number): string {
  if (!isFinite(h)) return '0h'
  const whole = Math.floor(h)
  const mins = Math.round((h - whole) * 60)
  if (mins === 0) return `${whole}h`
  return `${whole}h ${mins}m`
}

export function ageFrom(dob: ISODate | ''): string {
  if (!dob) return '—'
  const b = fromISODate(dob)
  const now = new Date()
  let months = (now.getFullYear() - b.getFullYear()) * 12 + (now.getMonth() - b.getMonth())
  if (now.getDate() < b.getDate()) months--
  if (months < 0) return '—'
  if (months < 24) return `${months} mo`
  return `${Math.floor(months / 12)}y ${months % 12}m`
}

/** Whole days from `from` to `to`. Negative when `to` is earlier. */
export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((fromISODate(to).getTime() - fromISODate(from).getTime()) / 86_400_000)
}

/** Times on a fixed grid, e.g. every 10 minutes between two clock times. */
export function everyMinutes(from: string, to: string, step: number): string[] {
  const s = timeToMinutes(from), e = timeToMinutes(to)
  if (s === null || e === null || step <= 0) return []
  const out: string[] = []
  for (let t = s + step; t < e; t += step) out.push(minutesToTime(t))
  return out
}

/**
 * The days the service actually runs, Monday to Friday. Weekends are not shown
 * anywhere and cannot be booked, so nothing can hide on a day nobody looks at.
 */
export const WORKING_WEEKDAYS = [1, 2, 3, 4, 5]
export const WORKING_DAYS_PER_WEEK = WORKING_WEEKDAYS.length

export function isWorkingDay(date: ISODate): boolean {
  return WORKING_WEEKDAYS.includes(weekdayOf(date))
}
