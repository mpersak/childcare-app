import type { Database, ISODate, NoteCategory } from '../types'
import { emptyDatabase, uid, CHILD_COLOURS } from './defaults'
import { addDays, addMonths, endOfMonth, startOfMonth, today, weekdayOf } from './dates'
import { buildInvoice, invoiceNumberFor } from './invoicing'
import { scheduleFor } from './billing'

/**
 * Sample data for trying the app out. Every name here is invented placeholder
 * text, not a real person. Settings > Data > "Start fresh" clears it.
 */

const KIDS = [
  { firstName: 'Ava', lastName: 'Sample', ageMonths: 32, rate: null, days: [1, 2, 3, 4, 5], start: '08:00', end: '15:30' },
  { firstName: 'Noah', lastName: 'Sample', ageMonths: 18, rate: 14, days: [1, 3, 5], start: '08:30', end: '13:00' },
  { firstName: 'Mia', lastName: 'Example', ageMonths: 46, rate: null, days: [2, 4], start: '07:30', end: '17:00' },
  { firstName: 'Leo', lastName: 'Example', ageMonths: 27, rate: null, days: [1, 2, 3, 4], start: '09:00', end: '14:00' },
  { firstName: 'Ruby', lastName: 'Placeholder', ageMonths: 11, rate: 15, days: [3, 4, 5], start: '08:00', end: '12:30' },
]

const NOTE_SEEDS: { category: NoteCategory; title: string; body: string }[] = [
  { category: 'milestone', title: 'First full sentence', body: 'Strung together a full sentence unprompted during morning play.' },
  { category: 'meal', title: 'Lunch', body: 'Ate most of lunch, left the vegetables. Second helping of fruit.' },
  { category: 'nap', title: 'Nap', body: 'Settled quickly, slept 12:40 to 14:05.' },
  { category: 'incident', title: 'Minor bump', body: 'Bumped knee on the deck step. Cleaned and checked, no mark. Parent told at pickup.' },
  { category: 'behaviour', title: 'Sharing', body: 'Took turns with the blocks without prompting today.' },
  { category: 'medical', title: 'Sunscreen', body: 'Sunscreen applied before outdoor play, as per consent form.' },
  { category: 'general', title: 'Settling in', body: 'Much happier at drop-off this week, no tears.' },
]

function dobFromAge(months: number): ISODate {
  const d = new Date()
  d.setMonth(d.getMonth() - months)
  return d.toISOString().slice(0, 10)
}

/** Deterministic pseudo-random so the demo looks the same each time it is loaded. */
function seeded(seed: number) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

export function buildDemoDatabase(): Database {
  const db = emptyDatabase()
  const rand = seeded(42)
  const now = today()

  db.settings = {
    ...db.settings,
    businessName: 'Sunnyside Home Childcare',
    businessEmail: 'hello@example.com',
    businessPhone: '09 000 0000',
    businessAddress: '12 Example Road\nAuckland 1010',
    logoText: 'SC',
    defaultHourlyRate: 12.5,
    minimumHours: 2,
    lateFeePerMinute: 1,
    bankAccount: '00-0000-0000000-00',
  }

  KIDS.forEach((k, i) => {
    const childId = uid('child')
    db.children.push({
      id: childId,
      firstName: k.firstName,
      lastName: k.lastName,
      dob: dobFromAge(k.ageMonths),
      startDate: addMonths(now, -6),
      endDate: '',
      status: 'active',
      hourlyRate: k.rate,
      colour: CHILD_COLOURS[i % CHILD_COLOURS.length],
      guardians: [{
        id: uid('g'),
        name: `${k.lastName} household`,
        relationship: 'Parent',
        phone: '021 000 0000',
        email: `${k.firstName.toLowerCase()}.parent@example.com`,
        primary: true,
      }],
      allergies: i === 1 ? 'Peanuts — EpiPen in bag' : '',
      medical: i === 4 ? 'Mild eczema, cream twice daily' : '',
      emergencyContact: 'Listed guardian',
      general: '',
      createdAt: new Date().toISOString(),
    })

    for (const wd of k.days) {
      db.schedules.push({
        id: uid('sch'),
        childId,
        weekday: wd,
        start: k.start,
        end: k.end,
        effectiveFrom: addMonths(now, -6),
        effectiveTo: '',
        active: true,
      })
    }
  })

  // Attendance for the previous ~10 weeks, following each schedule with some drift.
  const from = addDays(now, -70)
  for (let d = from; d <= now; d = addDays(d, 1)) {
    const wd = weekdayOf(d)
    if (wd === 0 || wd === 6) continue
    for (const child of db.children) {
      const blocks = scheduleFor(db.schedules, child.id, d)
      if (!blocks.length) continue

      const roll = rand()
      if (roll < 0.05) {
        db.attendance.push({
          id: uid('att'), childId: child.id, date: d,
          checkIn: null, checkOut: null,
          status: roll < 0.03 ? 'sick' : 'absent',
          billable: false,
          rate: child.hourlyRate ?? db.settings.defaultHourlyRate,
          note: roll < 0.03 ? 'Unwell, parent called' : 'Family day out',
          invoiceId: null,
          createdAt: new Date().toISOString(),
        })
        continue
      }

      // Nudge the real times a little either side of the booking.
      const jitter = (base: string, spread: number) => {
        const [h, m] = base.split(':').map(Number)
        const total = h * 60 + m + Math.round((rand() - 0.5) * spread)
        const cl = Math.max(0, Math.min(1439, total))
        return `${String(Math.floor(cl / 60)).padStart(2, '0')}:${String(cl % 60).padStart(2, '0')}`
      }

      db.attendance.push({
        id: uid('att'), childId: child.id, date: d,
        checkIn: jitter(blocks[0].start, 24),
        checkOut: jitter(blocks[blocks.length - 1].end, 30),
        status: 'present',
        billable: true,
        rate: child.hourlyRate ?? db.settings.defaultHourlyRate,
        note: '',
        invoiceId: null,
        createdAt: new Date().toISOString(),
      })
    }
  }

  // A scatter of notes across the same period.
  for (let i = 0; i < 26; i++) {
    const child = db.children[Math.floor(rand() * db.children.length)]
    const seed = NOTE_SEEDS[Math.floor(rand() * NOTE_SEEDS.length)]
    db.notes.push({
      id: uid('note'),
      childId: child.id,
      date: addDays(now, -Math.floor(rand() * 60)),
      category: seed.category,
      title: seed.title,
      body: seed.body,
      author: 'Owner',
      flagged: seed.category === 'incident',
      createdAt: new Date().toISOString(),
    })
  }

  db.closures.push({
    id: uid('clo'),
    date: addDays(now, 21),
    name: 'Staff training day',
    billable: false,
  })

  // Invoice the two complete months before this one, so the finance page has history.
  for (const back of [2, 1]) {
    const anchor = addMonths(now, -back)
    const ps = startOfMonth(anchor)
    const pe = endOfMonth(anchor)
    for (const child of db.children) {
      const draft = buildInvoice(db, child.id, ps, pe, invoiceNumberFor(db.settings))
      if (!draft) continue
      // Older month settled, most recent month still out with one payment landed.
      if (back === 2) {
        draft.invoice.status = 'paid'
        draft.invoice.payments.push({
          id: uid('pay'), date: addDays(draft.invoice.dueDate, -3),
          amount: draft.invoice.total, method: 'Bank transfer', reference: draft.invoice.number,
        })
      } else {
        draft.invoice.status = 'sent'
        if (rand() < 0.4) {
          draft.invoice.payments.push({
            id: uid('pay'), date: addDays(draft.invoice.issueDate, 5),
            amount: Math.round(draft.invoice.total * 0.5 * 100) / 100,
            method: 'Bank transfer', reference: draft.invoice.number,
          })
        }
      }
      db.invoices.push(draft.invoice)
      for (const id of draft.attendanceIds) {
        const rec = db.attendance.find(a => a.id === id)
        if (rec) rec.invoiceId = draft.invoice.id
      }
      db.settings.nextInvoiceNumber += 1
    }
  }

  return db
}
