import type { Activity, Database, ISODate } from '../types'
import { childName } from './store'
import { timeToMinutes } from './dates'

/**
 * Turns logged activities into the rows the service's printed charts expect.
 *
 * The paper forms are designed to be filled in by hand, so anything the app does
 * not capture — bottle feeds, comments — is deliberately left empty for a pen
 * rather than invented.
 */

/** The minute offsets printed across the sleep chart. */
export const CHECK_OFFSETS = [
  [10, 20, 30, 40, 50, 60],
  [70, 80, 90, 100, 110, 120],
  [130, 140, 150, 160, 170, 180],
]

export interface SleepBlock {
  key: string
  child: string
  date: ISODate
  inBed: string
  asleep: string
  awake: string
  /** Offset in minutes -> the clock time that check was actually recorded. */
  checked: Record<number, string>
  /** Whether the sleep started before or after midday. */
  meridiem: 'am' | 'pm' | ''
  /** Room temperature in °C, blank on records made before it was captured. */
  roomTemp: string
}

export function sleepBlocks(db: Database, from: ISODate, to: ISODate, childId = 'all'): SleepBlock[] {
  return db.activities
    .filter(a => a.kind === 'sleep' && a.date >= from && a.date <= to)
    .filter(a => childId === 'all' || a.childId === childId)
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
    .map(a => {
      const start = timeToMinutes(a.time)
      const checked: Record<number, string> = {}
      for (const c of a.checks ?? []) {
        if (!c.done) continue
        const at = timeToMinutes(c.at)
        if (at === null || start === null) continue
        // Snap to the nearest printed column so a check at +11 min lands under 10.
        const offset = Math.round((at - start) / 10) * 10
        if (offset >= 10 && offset <= 180) checked[offset] = c.at
      }
      return {
        key: a.id,
        child: childName(db.children.find(c => c.id === a.childId)),
        date: a.date,
        inBed: a.time,
        // The app records one sleep span; "asleep" is a separate observation
        // on the paper form, so it stays blank rather than being guessed at.
        asleep: '',
        awake: a.endTime ?? '',
        checked,
        meridiem: start === null ? '' : start < 12 * 60 ? 'am' : 'pm',
        roomTemp: a.roomTemp === undefined ? '' : `${a.roomTemp}°C`,
      }
    })
}

export interface CareRow {
  time: string
  wet: boolean
  soiled: boolean
  dry: boolean
  medication: string
  sunblock: string
}

export interface CareBlock {
  key: string
  child: string
  date: ISODate
  rows: CareRow[]
}

/** Anything logged as sun block, however it was typed. */
export const SUNBLOCK_LABEL = 'Sun block'

export function isSunblock(label?: string): boolean {
  return /sun\s*block|sunscreen|sunblock/i.test(label ?? '')
}

/** Rows per child block on the printed care routines chart. */
export const CARE_ROWS = 4

export function careBlocks(db: Database, from: ISODate, to: ISODate, childId = 'all'): CareBlock[] {
  const byChildDay = new Map<string, Activity[]>()
  for (const a of db.activities) {
    if (a.date < from || a.date > to) continue
    if (childId !== 'all' && a.childId !== childId) continue
    if (a.kind === 'sleep') continue
    const key = `${a.childId}|${a.date}`
    byChildDay.set(key, [...(byChildDay.get(key) ?? []), a])
  }

  return [...byChildDay.entries()]
    .sort((a, b) => a[0].split('|')[1].localeCompare(b[0].split('|')[1]))
    .map(([key, list]) => {
      const [cid, date] = key.split('|')
      const sorted = [...list].sort((a, b) => a.time.localeCompare(b.time))
      const rows: CareRow[] = sorted.map(a => ({
        time: a.time,
        wet: a.nappy === 'wet' || a.nappy === 'wet+stools',
        soiled: a.nappy === 'stools' || a.nappy === 'wet+stools',
        dry: a.nappy === 'dry',
        // Sun block has its own column on the form, so route it there.
        medication: a.kind === 'other' && !isSunblock(a.label) ? (a.label ?? '') : '',
        sunblock: a.kind === 'other' && isSunblock(a.label) ? a.time : '',
      }))
      // Pad to the fixed number of printed rows so the form keeps its shape.
      while (rows.length < CARE_ROWS) {
        rows.push({ time: '', wet: false, soiled: false, dry: false, medication: '', sunblock: '' })
      }

      return {
        key,
        child: childName(db.children.find(c => c.id === cid)),
        date,
        rows,
      }
    })
}
