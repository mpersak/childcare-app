import type { AttendanceRecord, Child, Database, ISODate } from '../types'
import { scheduleFor } from './billing'
import { timeToMinutes, nowTime, today } from './dates'

/** One bar on a timeline: a booking, or the time a child was actually here. */
export interface TimelineItem {
  childId: string
  name: string
  colour: string
  start: number
  end: number
  kind: 'booked' | 'actual'
  /** True while the child is still on site and the bar has no real end yet. */
  open: boolean
}

export interface DayRow {
  child: Child
  record: AttendanceRecord | undefined
  booked: TimelineItem[]
  actual: TimelineItem | null
  status: 'none' | 'in' | 'done' | 'away'
}

/** The visible time window, widened when someone falls outside opening hours. */
export function dayWindow(db: Database, items: { start: number; end: number }[]) {
  let from = timeToMinutes(db.settings.openTime) ?? 7 * 60
  let to = timeToMinutes(db.settings.closeTime) ?? 18 * 60
  for (const i of items) {
    if (i.start < from) from = i.start
    if (i.end > to) to = i.end
  }
  // Snap outwards to whole hours so the ruler reads cleanly.
  from = Math.floor(from / 60) * 60
  to = Math.ceil(to / 60) * 60
  if (to - from < 120) to = from + 120
  return { from, to, span: to - from }
}

export function buildDay(db: Database, date: ISODate): DayRow[] {
  const nowM = timeToMinutes(nowTime()) ?? 0
  const isToday = date === today()

  return db.children
    .filter(c => c.status === 'active')
    .map<DayRow>(child => {
      const blocks = scheduleFor(db.schedules, child.id, date)
      const record = db.attendance.find(a => a.childId === child.id && a.date === date)

      const booked: TimelineItem[] = blocks.flatMap(b => {
        const start = timeToMinutes(b.start)
        const end = timeToMinutes(b.end)
        if (start === null || end === null || end <= start) return []
        return [{
          childId: child.id, name: `${child.firstName} ${child.lastName}`.trim(),
          colour: child.colour, start, end, kind: 'booked' as const, open: false,
        }]
      })

      let actual: TimelineItem | null = null
      let status: DayRow['status'] = 'none'
      if (record && record.status !== 'present') {
        status = 'away'
      } else if (record?.checkIn) {
        const start = timeToMinutes(record.checkIn)
        const rawEnd = record.checkOut ? timeToMinutes(record.checkOut) : null
        // Still on site: run the bar to the current time so the day reads live.
        const end = rawEnd ?? (isToday ? Math.max(nowM, (start ?? 0) + 5) : null)
        if (start !== null && end !== null && end > start) {
          actual = {
            childId: child.id, name: `${child.firstName} ${child.lastName}`.trim(),
            colour: child.colour, start, end, kind: 'actual', open: !record.checkOut,
          }
        }
        status = record.checkOut ? 'done' : 'in'
      }

      return { child, record, booked, actual, status }
    })
    .filter(r => r.booked.length > 0 || r.record)
    .sort((a, b) => {
      const first = (r: DayRow) => r.actual?.start ?? r.booked[0]?.start ?? 9999
      return first(a) - first(b) || a.child.firstName.localeCompare(b.child.firstName)
    })
}

/**
 * How many children are expected on site through the day, in fixed slots.
 * Uses the recorded times where they exist and the booking otherwise, so the
 * curve is useful for planning before anyone has arrived.
 */
export function occupancy(rows: DayRow[], from: number, to: number, slot = 30) {
  const out: { at: number; count: number }[] = []
  for (let t = from; t < to; t += slot) {
    let count = 0
    for (const r of rows) {
      if (r.status === 'away') continue
      const spans = r.actual ? [r.actual] : r.booked
      if (spans.some(s => s.start <= t && s.end > t)) count++
    }
    out.push({ at: t, count })
  }
  return out
}

/** Side-by-side lanes so overlapping bookings in one column stay readable. */
export function assignLanes<T extends { start: number; end: number }>(items: T[]) {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end)
  const laneEnds: number[] = []
  const placed = sorted.map(item => {
    let lane = laneEnds.findIndex(end => end <= item.start)
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(item.end) }
    else laneEnds[lane] = item.end
    return { item, lane }
  })
  return { placed, lanes: Math.max(1, laneEnds.length) }
}

export function hourTicks(from: number, to: number): number[] {
  const out: number[] = []
  for (let t = Math.ceil(from / 60) * 60; t <= to; t += 60) out.push(t)
  return out
}
