import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AttendanceRecord, Child, Closure, Database, Invoice, ISODate,
  KidNote, ScheduleBlock, Settings, Activity, NappyKind,
} from '../types'
import { uid, CHILD_COLOURS } from './defaults'
import { buildInvoice, invoiceNumberFor, recalcTotals } from './invoicing'
import { rateForChild, scheduleFor, scheduledMinutes } from './billing'
import { everyMinutes, minutesToTime, nowTime, timeToMinutes, today } from './dates'

interface Actions {
  updateSettings(patch: Partial<Settings>): void

  addChild(input: Partial<Child>): Child
  updateChild(id: string, patch: Partial<Child>): void
  deleteChild(id: string): void

  addSchedule(input: Omit<ScheduleBlock, 'id'>): void
  updateSchedule(id: string, patch: Partial<ScheduleBlock>): void
  deleteSchedule(id: string): void

  upsertAttendance(input: Partial<AttendanceRecord> & { childId: string; date: ISODate }): void
  deleteAttendance(id: string): void
  checkIn(childId: string, date?: ISODate): void
  checkOut(childId: string, date?: ISODate): void
  /** Check in or out with a captured guardian signature attached. */
  signChild(
    direction: 'in' | 'out',
    childId: string,
    sig: { ref: string; name: string },
    date?: ISODate,
  ): void
  /** Creates records for every child booked on that date. Never touches existing rows. */
  fillFromSchedule(date: ISODate): void

  /** Logs a nappy change at the given time (defaults to now). */
  addNappy(childId: string, nappy: NappyKind, date?: ISODate, time?: string): void
  /** Logs a sleep and generates its safe-sleep checks. */
  addSleep(childId: string, start: string, minutes: number, roomTemp: number, date?: ISODate): void
  updateActivity(id: string, patch: Partial<Activity>): void
  /** Marks one generated sleep check as actually carried out. */
  setSleepCheck(activityId: string, at: string, done: boolean, by: string): void
  deleteActivity(id: string): void

  /** Logs anything else — medicine, a meal, sunscreen — with a typed label. */
  addOther(childId: string, label: string, date?: ISODate, time?: string): void
  /**
   * Re-reads the booked times from the current schedule onto recorded days in a
   * range. Invoiced days are left alone.
   */
  resyncBookings(from: ISODate, to: ISODate): void

  addNote(input: Omit<KidNote, 'id' | 'createdAt'>): void
  updateNote(id: string, patch: Partial<KidNote>): void
  deleteNote(id: string): void

  createInvoice(childId: string, from: ISODate, to: ISODate): void
  createInvoicesForAll(from: ISODate, to: ISODate): void
  updateInvoice(id: string, patch: Partial<Invoice>): void
  deleteInvoice(id: string): void
  setInvoiceStatus(id: string, status: Invoice['status']): void
  addPayment(id: string, amount: number, date: ISODate, method: string, reference: string): void
  removePayment(invoiceId: string, paymentId: string): void

  addClosure(input: Omit<Closure, 'id'>): void
  deleteClosure(id: string): void

  replaceDatabase(next: Database): void
}

const Ctx = createContext<{ db: Database; actions: Actions } | null>(null)

export function StoreProvider({ initial, persist, children }: {
  /** Already-decrypted document handed down by the vault. */
  initial: Database
  /** Called with every new document; the vault encrypts and stores it. */
  persist(db: Database): void
  children: React.ReactNode
}) {
  const [db, setDb] = useState<Database>(initial)
  const first = useRef(true)

  // The vault owns storage. Skip the first pass so opening the app is not a write.
  useEffect(() => {
    if (first.current) { first.current = false; return }
    persist(db)
  }, [db, persist])

  const actions = useMemo<Actions>(() => {
    const mutate = (fn: (d: Database) => Database) => setDb(prev => fn(structuredClone(prev)))

    const upsertAttendance: Actions['upsertAttendance'] = (input) => {
      mutate(d => {
        const i = d.attendance.findIndex(a => a.childId === input.childId && a.date === input.date)
        if (i >= 0) {
          // An invoiced record is locked; editing it would silently desync the invoice.
          if (d.attendance[i].invoiceId) return d
          const merged = { ...d.attendance[i], ...input }
          // A signature or a hand edit means the times are real now.
          if ('checkIn' in input || 'checkOut' in input) merged.timesFromBooking = false
          // Declaring a holiday stamps the day it was declared, which is what
          // decides whether enough notice was given to earn the discount.
          if (merged.status === 'holiday' && !merged.noticeDate) merged.noticeDate = today()
          if (merged.status !== 'holiday') delete merged.noticeDate
          d.attendance[i] = merged
        } else {
          const child = d.children.find(c => c.id === input.childId)
          const booked = scheduleFor(d.schedules, input.childId, input.date)
          d.attendance.push({
            id: uid('att'),
            checkIn: null,
            checkOut: null,
            status: 'present',
            billable: true,
            rate: rateForChild(child, d.settings),
            // Snapshot the booking alongside the rate, for the same reason.
            ...(booked.length
              ? { bookedFrom: booked[0].start, bookedTo: booked[booked.length - 1].end }
              : {}),
            note: '',
            invoiceId: null,
            createdAt: new Date().toISOString(),
            ...input,
            ...(input.status === 'holiday' ? { noticeDate: input.noticeDate ?? today() } : {}),
          })
        }
        return d
      })
    }

    return {
      updateSettings(patch) {
        mutate(d => { d.settings = { ...d.settings, ...patch }; return d })
      },

      addChild(input) {
        const child: Child = {
          id: uid('child'),
          firstName: '', lastName: '', dob: '', startDate: today(), endDate: '',
          status: 'active', hourlyRate: null,
          colour: CHILD_COLOURS[Math.floor(Math.random() * CHILD_COLOURS.length)],
          guardians: [], allergies: '', medical: '', emergencyContact: '', general: '',
          createdAt: new Date().toISOString(),
          ...input,
        }
        mutate(d => { d.children.push(child); return d })
        return child
      },
      updateChild(id, patch) {
        mutate(d => {
          const i = d.children.findIndex(c => c.id === id)
          if (i >= 0) d.children[i] = { ...d.children[i], ...patch }
          return d
        })
      },
      deleteChild(id) {
        // Invoices are financial records, so they survive and history stays auditable.
        // Attendance already tied to an invoice survives with them.
        mutate(d => {
          d.children = d.children.filter(c => c.id !== id)
          d.schedules = d.schedules.filter(s => s.childId !== id)
          d.attendance = d.attendance.filter(a => a.childId !== id || a.invoiceId)
          d.notes = d.notes.filter(n => n.childId !== id)
          d.activities = d.activities.filter(a => a.childId !== id)
          return d
        })
      },

      addSchedule(input) {
        mutate(d => { d.schedules.push({ ...input, id: uid('sch') }); return d })
      },
      updateSchedule(id, patch) {
        mutate(d => {
          const i = d.schedules.findIndex(s => s.id === id)
          if (i >= 0) d.schedules[i] = { ...d.schedules[i], ...patch }
          return d
        })
      },
      deleteSchedule(id) {
        mutate(d => { d.schedules = d.schedules.filter(s => s.id !== id); return d })
      },

      upsertAttendance,
      deleteAttendance(id) {
        mutate(d => { d.attendance = d.attendance.filter(a => a.id !== id || a.invoiceId); return d })
      },
      checkIn(childId, date = today()) {
        upsertAttendance({ childId, date, status: 'present', checkIn: nowTime() })
      },
      checkOut(childId, date = today()) {
        upsertAttendance({ childId, date, status: 'present', checkOut: nowTime() })
      },
      signChild(direction, childId, sig, date = today()) {
        const time = nowTime()
        const signature = { ...sig, at: new Date().toISOString(), time }
        upsertAttendance(direction === 'in'
          ? { childId, date, status: 'present', checkIn: time, signIn: signature }
          : { childId, date, status: 'present', checkOut: time, signOut: signature })
      },
      fillFromSchedule(date) {
        mutate(d => {
          const closed = d.closures.find(c => c.date === date)
          for (const child of d.children) {
            if (child.status !== 'active') continue
            const blocks = scheduleFor(d.schedules, child.id, date)
            if (!blocks.length) continue
            if (d.attendance.some(a => a.childId === child.id && a.date === date)) continue
            if (scheduledMinutes(blocks) <= 0) continue
            d.attendance.push({
              id: uid('att'),
              childId: child.id,
              date,
              checkIn: closed ? null : blocks[0].start,
              checkOut: closed ? null : blocks[blocks.length - 1].end,
              status: closed ? 'holiday' : 'present',
              billable: closed ? closed.billable : true,
              rate: rateForChild(child, d.settings),
              bookedFrom: blocks[0].start,
              bookedTo: blocks[blocks.length - 1].end,
              timesFromBooking: !closed,
              note: closed ? closed.name : '',
              invoiceId: null,
              createdAt: new Date().toISOString(),
            })
          }
          return d
        })
      },

      addNappy(childId, nappy, date = today(), time = nowTime()) {
        mutate(d => {
          d.activities.push({
            id: uid('act'), childId, date, kind: 'nappy', time, nappy,
            note: '', createdAt: new Date().toISOString(),
          })
          return d
        })
      },
      addSleep(childId, start, minutes, roomTemp, date = today()) {
        mutate(d => {
          const startM = timeToMinutes(start)
          if (startM === null || minutes <= 0) return d
          const end = minutesToTime(startM + minutes)
          const step = d.settings.sleepCheckMinutes
          // Checks are generated unticked: the record should show what was
          // actually done, not assert that every check happened.
          const checks = step > 0
            ? everyMinutes(start, end, step).map(at => ({ at, done: false, by: '' }))
            : []
          d.activities.push({
            id: uid('act'), childId, date, kind: 'sleep', time: start, endTime: end,
            roomTemp, checks, note: '', createdAt: new Date().toISOString(),
          })
          return d
        })
      },
      updateActivity(id, patch) {
        mutate(d => {
          const i = d.activities.findIndex(a => a.id === id)
          if (i >= 0) d.activities[i] = { ...d.activities[i], ...patch }
          return d
        })
      },
      setSleepCheck(activityId, at, done, by) {
        mutate(d => {
          const act = d.activities.find(a => a.id === activityId)
          if (!act?.checks) return d
          act.checks = act.checks.map(c => c.at === at ? { ...c, done, by: done ? by : '' } : c)
          return d
        })
      },
      deleteActivity(id) {
        mutate(d => { d.activities = d.activities.filter(a => a.id !== id); return d })
      },

      addOther(childId, label, date = today(), time = nowTime()) {
        if (!label.trim()) return
        mutate(d => {
          d.activities.push({
            id: uid('act'), childId, date, kind: 'other', time,
            label: label.trim(), note: '', createdAt: new Date().toISOString(),
          })
          return d
        })
      },
      resyncBookings(from, to) {
        mutate(d => {
          for (const rec of d.attendance) {
            if (rec.date < from || rec.date > to) continue
            if (rec.invoiceId) continue
            const blocks = scheduleFor(d.schedules, rec.childId, rec.date)
            if (!blocks.length) continue
            rec.bookedFrom = blocks[0].start
            rec.bookedTo = blocks[blocks.length - 1].end
          }
          return d
        })
      },

      addNote(input) {
        mutate(d => {
          d.notes.push({ ...input, id: uid('note'), createdAt: new Date().toISOString() })
          return d
        })
      },
      updateNote(id, patch) {
        mutate(d => {
          const i = d.notes.findIndex(n => n.id === id)
          if (i >= 0) d.notes[i] = { ...d.notes[i], ...patch }
          return d
        })
      },
      deleteNote(id) {
        mutate(d => { d.notes = d.notes.filter(n => n.id !== id); return d })
      },

      createInvoice(childId, from, to) {
        mutate(d => {
          const draft = buildInvoice(d, childId, from, to)
          if (!draft) return d
          d.invoices.push(draft.invoice)
          for (const id of draft.attendanceIds) {
            const rec = d.attendance.find(a => a.id === id)
            if (rec) rec.invoiceId = draft.invoice.id
          }
          d.settings.nextInvoiceNumber += 1
          return d
        })
      },
      createInvoicesForAll(from, to) {
        mutate(d => {
          for (const child of d.children) {
            if (child.status === 'archived') continue
            const draft = buildInvoice(d, child.id, from, to, invoiceNumberFor(d.settings))
            if (!draft) continue
            d.invoices.push(draft.invoice)
            for (const id of draft.attendanceIds) {
              const rec = d.attendance.find(a => a.id === id)
              if (rec) rec.invoiceId = draft.invoice.id
            }
            d.settings.nextInvoiceNumber += 1
          }
          return d
        })
      },
      updateInvoice(id, patch) {
        mutate(d => {
          const i = d.invoices.findIndex(v => v.id === id)
          if (i < 0) return d
          const next = { ...d.invoices[i], ...patch }
          Object.assign(next, recalcTotals(next.lines, next.adjustments, d.settings))
          d.invoices[i] = next
          return d
        })
      },
      deleteInvoice(id) {
        // Releases its attendance so the period can be re-invoiced cleanly.
        mutate(d => {
          d.invoices = d.invoices.filter(v => v.id !== id)
          for (const a of d.attendance) if (a.invoiceId === id) a.invoiceId = null
          return d
        })
      },
      setInvoiceStatus(id, status) {
        mutate(d => {
          const inv = d.invoices.find(v => v.id === id)
          if (!inv) return d
          inv.status = status
          if (status === 'paid') {
            const paid = inv.payments.reduce((s, p) => s + p.amount, 0)
            const gap = Math.round((inv.total - paid) * 100) / 100
            if (gap > 0.005) {
              inv.payments.push({
                id: uid('pay'), date: today(), amount: gap,
                method: 'Marked paid', reference: '',
              })
            }
          }
          return d
        })
      },
      addPayment(id, amount, date, method, reference) {
        mutate(d => {
          const inv = d.invoices.find(v => v.id === id)
          if (!inv) return d
          inv.payments.push({ id: uid('pay'), amount, date, method, reference })
          const paid = inv.payments.reduce((s, p) => s + p.amount, 0)
          if (paid >= inv.total - 0.005) inv.status = 'paid'
          else if (inv.status === 'draft') inv.status = 'sent'
          return d
        })
      },
      removePayment(invoiceId, paymentId) {
        mutate(d => {
          const inv = d.invoices.find(v => v.id === invoiceId)
          if (!inv) return d
          inv.payments = inv.payments.filter(p => p.id !== paymentId)
          if (inv.status === 'paid') inv.status = 'sent'
          return d
        })
      },

      addClosure(input) {
        mutate(d => { d.closures.push({ ...input, id: uid('clo') }); return d })
      },
      deleteClosure(id) {
        mutate(d => { d.closures = d.closures.filter(c => c.id !== id); return d })
      },

      replaceDatabase(next) { setDb(next) },
    }
  }, [])

  return <Ctx.Provider value={{ db, actions }}>{children}</Ctx.Provider>
}

export function useStore() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>')
  return ctx
}

export function childName(c: Child | undefined): string {
  if (!c) return 'Unknown'
  return `${c.firstName} ${c.lastName}`.trim() || 'Unnamed'
}

export function initials(c: Child | undefined): string {
  if (!c) return '?'
  return `${c.firstName[0] ?? ''}${c.lastName[0] ?? ''}`.toUpperCase() || '?'
}
