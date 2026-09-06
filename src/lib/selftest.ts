/**
 * Plain-node checks for the parts that decide what people get charged.
 * Run with:  npm run selftest
 */
import type { AttendanceRecord, Database, ScheduleBlock } from '../types'
import { emptyDatabase, uid } from './defaults'
import { calcBilling } from './billing'
import { buildInvoice, amountDue, isOverdue, recalcTotals } from './invoicing'
import { summarise } from './finance'
import { addDays, startOfWeek, timeToMinutes, toISODate, today, weekOptions } from './dates'
import { assignLanes, buildDay, dayWindow, occupancy } from './daygrid'
import { normaliseRepo } from './github'
import { round2 } from './money'

let failures = 0
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`)
}

function record(over: Partial<AttendanceRecord> = {}): AttendanceRecord {
  return {
    id: uid('att'), childId: 'c1', date: '2026-03-02',
    checkIn: '08:00', checkOut: '15:00', status: 'present', billable: true,
    rate: 12, note: '', invoiceId: null, createdAt: '2026-03-02T00:00:00.000Z',
    ...over,
  }
}

const block: ScheduleBlock = {
  id: 's1', childId: 'c1', weekday: 1, start: '08:00', end: '15:00',
  effectiveFrom: '', effectiveTo: '', active: true,
}

// --- date helpers ---------------------------------------------------------
check('local ISO date does not shift timezone', toISODate(new Date(2026, 0, 1, 23, 30)), '2026-01-01')
check('time parsing rejects nonsense', timeToMinutes('25:00'), null)
check('time parsing reads HH:MM', timeToMinutes('08:45'), 525)

// --- billing --------------------------------------------------------------
const base = emptyDatabase()
base.settings.defaultHourlyRate = 12
base.settings.roundingMinutes = 15
base.settings.roundingMode = 'nearest'
// These exercise clock-time billing specifically; the app now defaults to the booking.
base.settings.billBasis = 'actual'

check('flat 7 hours at 12/h', calcBilling(record(), base.settings, [block]).amount, 84)

check('07:57–15:07 rounds to the nearest quarter hour',
  calcBilling(record({ checkIn: '07:57', checkOut: '15:07' }), base.settings, [block]).billedHours, 7.25)

const upSettings = { ...base.settings, roundingMode: 'up' as const }
check('rounding up never loses a part-quarter',
  calcBilling(record({ checkIn: '08:00', checkOut: '15:01' }), upSettings, [block]).billedHours, 7.25)

check('still checked in bills nothing yet',
  calcBilling(record({ checkOut: null }), base.settings, [block]).amount, 0)

check('checkout before checkin bills nothing',
  calcBilling(record({ checkIn: '15:00', checkOut: '08:00' }), base.settings, [block]).amount, 0)

const minSettings = { ...base.settings, minimumHours: 3 }
check('minimum charge lifts a short session',
  calcBilling(record({ checkIn: '09:00', checkOut: '10:00' }), minSettings, [block]).amount, 36)

// Late collection off, so this isolates the cap — 18:00 is three hours past the booking.
const capSettings = { ...base.settings, dailyCapHours: 6, lateBlockFee: 0 }
check('daily cap limits a long session',
  calcBilling(record({ checkIn: '07:00', checkOut: '18:00' }), capSettings, [block]).amount, 72)
check('a capped day still attracts the late fee when one applies',
  calcBilling(record({ checkIn: '07:00', checkOut: '18:00' }),
    { ...capSettings, lateBlockFee: 5 }, [block]).lateBlocks, 17)

const lateSettings = { ...base.settings, lateGraceMinutes: 10, lateBlockMinutes: 10, lateBlockFee: 5 }
const late = calcBilling(record({ checkOut: '15:20' }), lateSettings, [block])
check('late fee counts minutes past the booked finish', late.lateMinutes, 20)
check('late fee sits on top of the hourly charge', late.amount, round2(7.25 * 12 + 5))

check('an unbilled absence charges nothing',
  calcBilling(record({ status: 'absent', billable: false, checkIn: null, checkOut: null }), base.settings, [block]).amount, 0)
check('a billed absence charges the contracted hours',
  calcBilling(record({ status: 'absent', billable: true, checkIn: null, checkOut: null }), base.settings, [block]).amount, 84)
check('a billed absence with no schedule charges nothing',
  calcBilling(record({ status: 'absent', billable: true, checkIn: null, checkOut: null }), base.settings, []).amount, 0)

// --- invoicing ------------------------------------------------------------
const db: Database = emptyDatabase()
db.settings.defaultHourlyRate = 12
db.settings.taxEnabled = true
db.settings.taxRate = 0.15
db.settings.paymentTermsDays = 14
db.children.push({
  id: 'c1', firstName: 'Test', lastName: 'Child', dob: '', startDate: '', endDate: '',
  status: 'active', hourlyRate: null, colour: '#2a78d6', guardians: [],
  allergies: '', medical: '', emergencyContact: '', general: '', createdAt: '',
})
db.schedules.push(block)
db.attendance.push(
  record({ id: 'a1', date: '2026-03-02' }),
  record({ id: 'a2', date: '2026-03-03' }),
  record({ id: 'a3', date: '2026-03-04', invoiceId: 'already' }),
)

const draft = buildInvoice(db, 'c1', '2026-03-01', '2026-03-31')
check('an already-invoiced day is left out', draft?.invoice.lines.length, 2)
check('subtotal is the sum of the lines', draft?.invoice.subtotal, 168)
check('tax is charged at the configured rate', draft?.invoice.tax, 25.2)
check('total includes tax', draft?.invoice.total, 193.2)
check('due date follows the payment terms', draft?.invoice.dueDate, addDays(draft!.invoice.issueDate, 14))

const discounted = recalcTotals(draft!.invoice.lines, [{ amount: -18 }], db.settings)
check('a discount reduces the taxable subtotal', discounted.subtotal, 150)
check('tax is charged on the discounted subtotal', discounted.total, 172.5)

const emptyDraft = buildInvoice(db, 'c1', '2026-05-01', '2026-05-31')
check('a period with nothing billable produces no invoice', emptyDraft, null)

// --- receivables ----------------------------------------------------------
const inv = draft!.invoice
inv.status = 'sent'
inv.dueDate = addDays(today(), -45)
db.invoices.push(inv)
for (const id of draft!.attendanceIds) {
  const rec = db.attendance.find(a => a.id === id)
  if (rec) rec.invoiceId = inv.id
}

check('an unpaid invoice past its due date is overdue', isOverdue(inv), true)
check('balance owing equals the total when nothing is paid', amountDue(inv), 193.2)

inv.payments.push({ id: 'p1', date: today(), amount: 100, method: 'Bank', reference: '' })
check('a part payment reduces the balance', amountDue(inv), 93.2)

// A day recorded after the invoice was raised: still work in progress.
db.attendance.push(record({ id: 'a4', date: '2026-03-05' }))

const fin = summarise(db, today())
check('outstanding picks up the unpaid balance', fin.outstanding, 93.2)
check('the 60-day bucket catches a 45-day-old debt', fin.aging.d31to60, 93.2)
check('the uninvoiced day is still counted as work in progress', fin.unbilled, 84)

const voided = { ...inv, status: 'void' as const }
check('a void invoice owes nothing', amountDue(voided), 0)

// --- day timeline ---------------------------------------------------------
const lanes1 = assignLanes([{ start: 0, end: 60 }, { start: 60, end: 120 }])
check('touching bookings share one lane', lanes1.lanes, 1)

const lanes2 = assignLanes([{ start: 0, end: 90 }, { start: 60, end: 120 }])
check('overlapping bookings get their own lanes', lanes2.lanes, 2)

const lanes3 = assignLanes([{ start: 0, end: 90 }, { start: 30, end: 60 }, { start: 95, end: 120 }])
check('a later booking reuses a freed lane', lanes3.lanes, 2)

const win = dayWindow(db, [{ start: 6 * 60, end: 19 * 60 + 30 }])
check('the window widens to cover an early start', win.from, 6 * 60)
check('the window snaps out to a whole hour', win.to, 20 * 60)

const dayRows = buildDay(db, '2026-03-02')
check('the day shows the child booked that Monday', dayRows.length, 1)
check('the bar runs from check-in to check-out', dayRows[0].actual?.start, 8 * 60)
check('a completed day reads as signed out', dayRows[0].status, 'done')

const occ = occupancy(dayRows, 8 * 60, 15 * 60, 60)
check('occupancy counts the child through the middle of the day', occ[3].count, 1)
check('occupancy is empty once everyone has gone', occupancy(dayRows, 16 * 60, 17 * 60, 60)[0].count, 0)

// --- schedule as the contract ---------------------------------------------
const sched = emptyDatabase().settings
sched.defaultHourlyRate = 12
sched.billBasis = 'schedule'
sched.lateGraceMinutes = 10
sched.lateBlockMinutes = 10
sched.lateBlockFee = 5

check('the booking is charged even when nobody was signed in',
  calcBilling(record({ checkIn: null, checkOut: null }), sched, [block]).amount, 84)
check('arriving late does not reduce the charge',
  calcBilling(record({ checkIn: '10:00', checkOut: '15:00' }), sched, [block]).amount, 84)
check('leaving early does not reduce the charge',
  calcBilling(record({ checkOut: '12:00' }), sched, [block]).amount, 84)

check('collection within the grace is free',
  calcBilling(record({ checkOut: '15:10' }), sched, [block]).amount, 84)
check('one minute past the grace costs a whole block',
  calcBilling(record({ checkOut: '15:11' }), sched, [block]).amount, 89)
check('a full block past the grace still costs one block',
  calcBilling(record({ checkOut: '15:20' }), sched, [block]).amount, 89)
check('into the second block costs two',
  calcBilling(record({ checkOut: '15:21' }), sched, [block]).amount, 94)
check('45 min late is 35 chargeable, so four blocks',
  calcBilling(record({ checkOut: '15:45' }), sched, [block]).lateBlocks, 4)

// --- days off --------------------------------------------------------------
check('a sick day is charged in full',
  calcBilling(record({ status: 'sick', checkIn: null, checkOut: null }), sched, [block]).amount, 84)
check('an unexplained absence is charged in full',
  calcBilling(record({ status: 'absent', checkIn: null, checkOut: null }), sched, [block]).amount, 84)

const noticed = record({
  status: 'holiday', checkIn: null, checkOut: null,
  date: '2026-03-02', noticeDate: addDays('2026-03-02', -14),
})
check('a holiday with exactly the required notice is half price',
  calcBilling(noticed, sched, [block]).amount, 42)

const late13 = record({
  status: 'holiday', checkIn: null, checkOut: null,
  date: '2026-03-02', noticeDate: addDays('2026-03-02', -13),
})
check('a day short of the notice period is full price',
  calcBilling(late13, sched, [block]).amount, 84)

check('a holiday with no notice recorded is full price',
  calcBilling(record({ status: 'holiday', checkIn: null, checkOut: null }), sched, [block]).amount, 84)

const generous = { ...sched, holidayNoticedRate: 0, sickRate: 0 }
check('a fully discounted holiday costs nothing',
  calcBilling(noticed, generous, [block]).amount, 0)
check('a free sick-day policy costs nothing',
  calcBilling(record({ status: 'sick', checkIn: null, checkOut: null }), generous, [block]).amount, 0)

// Billing on the clock still works for drop-ins with no booking.
const actualBasis = { ...sched, billBasis: 'actual' as const }
check('with no booking, the clock is used',
  calcBilling(record({ checkIn: '09:00', checkOut: '12:00' }), sched, []).amount, 36)
check('the actual basis charges recorded time, not the booking',
  calcBilling(record({ checkIn: '09:00', checkOut: '12:00' }), actualBasis, [block]).amount, 36)

// --- week picker -----------------------------------------------------------
const thisMonday = startOfWeek(today())
const opts = weekOptions(thisMonday, 4, 1)
check('the picker offers the requested span of weeks', opts.length, 6)
check('every option is a Monday', opts.every(o => startOfWeek(o.monday) === o.monday), true)
check('the newest week is listed first', opts[0].monday, addDays(thisMonday, 7))

// Navigating with the arrows must never empty the picker.
const farBack = addDays(thisMonday, -52 * 7)
check('a week outside the range is still included',
  weekOptions(farBack, 4, 1).some(o => o.monday === farBack), true)
check('including it does not drop the normal range',
  weekOptions(farBack, 4, 1).length, 7)

// --- repository input -----------------------------------------------------
check('a bare repository name is left alone',
  normaliseRepo('mpersak', 'childcare-data'), { owner: 'mpersak', repo: 'childcare-data' })
check('a pasted https URL is split into owner and repo',
  normaliseRepo('mpersak', 'https://github.com/mpersak/childcare-data'),
  { owner: 'mpersak', repo: 'childcare-data' })
check('a URL overrides a mismatched owner field',
  normaliseRepo('someone-else', 'https://github.com/mpersak/childcare-data'),
  { owner: 'mpersak', repo: 'childcare-data' })
check('owner/repo typed into the repository box is split',
  normaliseRepo('', 'mpersak/childcare-data'), { owner: 'mpersak', repo: 'childcare-data' })
check('a .git suffix is dropped',
  normaliseRepo('mpersak', 'https://github.com/mpersak/childcare-data.git'),
  { owner: 'mpersak', repo: 'childcare-data' })
check('an SSH remote is understood',
  normaliseRepo('', 'git@github.com:mpersak/childcare-data.git'),
  { owner: 'mpersak', repo: 'childcare-data' })
check('surrounding whitespace is trimmed',
  normaliseRepo('  mpersak ', ' childcare-data '), { owner: 'mpersak', repo: 'childcare-data' })

if (failures > 0) throw new Error(`${failures} check(s) failed.`)
console.log('\nAll checks passed.')
