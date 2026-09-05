import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AttendanceRecord, Child, Closure, Database, Invoice, ISODate,
  KidNote, ScheduleBlock, Settings,
} from '../types'
import * as repo from './repo'
import { uid, CHILD_COLOURS } from './defaults'
import { buildInvoice, invoiceNumberFor, recalcTotals } from './invoicing'
import { rateForChild, scheduleFor, scheduledMinutes } from './billing'
import { nowTime, today } from './dates'

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
    sig: { dataUrl: string; name: string },
    date?: ISODate,
  ): void
  /** Creates records for every child booked on that date. Never touches existing rows. */
  fillFromSchedule(date: ISODate): void

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
  resetDatabase(): void
}

const Ctx = createContext<{ db: Database; actions: Actions } | null>(null)

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<Database>(() => repo.load())
  const first = useRef(true)

  useEffect(() => {
    if (first.current) {
      first.current = false
      repo.snapshot(db)
      return
    }
    repo.save(db)
  }, [db])

  const actions = useMemo<Actions>(() => {
    const mutate = (fn: (d: Database) => Database) => setDb(prev => fn(structuredClone(prev)))

    const upsertAttendance: Actions['upsertAttendance'] = (input) => {
      mutate(d => {
        const i = d.attendance.findIndex(a => a.childId === input.childId && a.date === input.date)
        if (i >= 0) {
          // An invoiced record is locked; editing it would silently desync the invoice.
          if (d.attendance[i].invoiceId) return d
          d.attendance[i] = { ...d.attendance[i], ...input }
        } else {
          const child = d.children.find(c => c.id === input.childId)
          d.attendance.push({
            id: uid('att'),
            checkIn: null,
            checkOut: null,
            status: 'present',
            billable: true,
            rate: rateForChild(child, d.settings),
            note: '',
            invoiceId: null,
            createdAt: new Date().toISOString(),
            ...input,
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
              note: closed ? closed.name : '',
              invoiceId: null,
              createdAt: new Date().toISOString(),
            })
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
      resetDatabase() {
        repo.clearAll()
        setDb(repo.load())
      },
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
