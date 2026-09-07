/** Domain model. All dates are ISO `yyyy-mm-dd`, all times are 24h `HH:MM` local. */

export type ISODate = string
export type ISOTimestamp = string

export interface Guardian {
  id: string
  name: string
  relationship: string
  phone: string
  email: string
  primary: boolean
}

export type ChildStatus = 'active' | 'waitlist' | 'archived'

export interface Child {
  id: string
  firstName: string
  lastName: string
  dob: ISODate | ''
  startDate: ISODate | ''
  endDate: ISODate | ''
  status: ChildStatus
  /** Per-child override. null means "use the default rate from settings". */
  hourlyRate: number | null
  colour: string
  guardians: Guardian[]
  allergies: string
  medical: string
  emergencyContact: string
  general: string
  createdAt: ISOTimestamp
}

/** A recurring weekly booking. A child may have several per weekday. */
export interface ScheduleBlock {
  id: string
  childId: string
  weekday: number // 0 = Sunday .. 6 = Saturday
  start: string
  end: string
  effectiveFrom: ISODate | ''
  effectiveTo: ISODate | ''
  active: boolean
}

export type AttendanceStatus = 'present' | 'absent' | 'sick' | 'holiday'

/**
 * A parent or guardian signing a child in or out.
 *
 * The image itself lives in its own encrypted file, referenced by `ref`, so the
 * synced document stays small. `at` is when it was captured, which is the
 * defensible timestamp — the editable check-in time on the record is not.
 */
export interface SignatureRecord {
  /** Key of the separate encrypted file holding the image. */
  ref: string
  name: string
  at: ISOTimestamp
  /** The time that was recorded on the attendance row when this was signed. */
  time: string
}

export interface AttendanceRecord {
  id: string
  childId: string
  date: ISODate
  checkIn: string | null
  checkOut: string | null
  status: AttendanceStatus
  /** Absences can still be charged (retainer days) — this decides. */
  billable: boolean
  /** Rate snapshot taken when the record is created, so past invoices never drift. */
  rate: number
  /**
   * The booked times as they stood on the day, snapshotted for the same reason
   * as `rate`. Editing a child's weekly booking must not rewrite what the
   * sign-in sheet says happened last month.
   */
  bookedFrom?: string
  bookedTo?: string
  /**
   * True while checkIn/checkOut still hold the booked times auto check-in put
   * there, rather than a real arrival. Cleared the moment anyone signs or edits
   * a time, which is what lets the sign-in sheet leave the cell blank until
   * there is something genuine to report.
   */
  timesFromBooking?: boolean
  note: string
  /** Set once the record has been pulled onto an invoice; blocks double billing. */
  invoiceId: string | null
  createdAt: ISOTimestamp
  /** When a holiday was declared, for working out whether notice was given. */
  noticeDate?: ISODate
  /** Optional: records created before signatures existed simply have none. */
  signIn?: SignatureRecord | null
  signOut?: SignatureRecord | null
}

/** A nappy change or a sleep, logged through the day. */
export type NappyKind = 'dry' | 'wet' | 'stools' | 'wet+stools'

/** A safe-sleep check. `done` stays false until someone confirms it happened. */
export interface SleepCheck {
  at: string
  done: boolean
  by: string
}

export interface Activity {
  id: string
  childId: string
  date: ISODate
  kind: 'nappy' | 'sleep' | 'other'
  /** Start time, 24h HH:MM. */
  time: string
  /** Sleep only. */
  endTime?: string
  nappy?: NappyKind
  /** For an 'other' entry: what it was, e.g. "Medicine — 5ml paracetamol". */
  label?: string
  checks?: SleepCheck[]
  note: string
  createdAt: ISOTimestamp
}

export type NoteCategory =
  | 'general' | 'incident' | 'medical' | 'milestone' | 'behaviour' | 'meal' | 'nap'

export interface KidNote {
  id: string
  childId: string
  date: ISODate
  category: NoteCategory
  title: string
  body: string
  author: string
  flagged: boolean
  createdAt: ISOTimestamp
}

export interface InvoiceLine {
  id: string
  date: ISODate | ''
  description: string
  hours: number
  rate: number
  amount: number
  attendanceId: string | null
}

export interface Adjustment {
  id: string
  description: string
  /** Negative for a discount, positive for a surcharge. Taxed with the rest. */
  amount: number
}

export interface Payment {
  id: string
  date: ISODate
  amount: number
  method: string
  reference: string
}

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'void'

export interface Invoice {
  id: string
  number: string
  childId: string
  periodStart: ISODate
  periodEnd: ISODate
  issueDate: ISODate
  dueDate: ISODate
  lines: InvoiceLine[]
  adjustments: Adjustment[]
  subtotal: number
  tax: number
  total: number
  status: InvoiceStatus
  payments: Payment[]
  notes: string
  createdAt: ISOTimestamp
}

/** A day the service is closed (public holiday, staff training, shutdown). */
export interface Closure {
  id: string
  date: ISODate
  name: string
  /** Charged anyway (common for public holidays on a contracted day). */
  billable: boolean
}

export type RoundingMode = 'nearest' | 'up' | 'down'

export interface Settings {
  businessName: string
  businessEmail: string
  businessPhone: string
  businessAddress: string
  logoText: string

  currency: string
  locale: string
  defaultHourlyRate: number
  /** Billed time is rounded to this many minutes. 1 = no rounding. */
  roundingMinutes: number
  roundingMode: RoundingMode
  /** Every attended session bills at least this many hours. 0 disables. */
  minimumHours: number
  /** Cap on billable hours in a single day. 0 disables. */
  dailyCapHours: number

  /**
   * What the day is billed on.
   * 'schedule' — the booking is the contract, so the booked hours are charged
   *   whether or not anyone touched the tablet. Late collection is charged on top.
   * 'actual'   — charge the clock time that was recorded.
   */
  billBasis: 'schedule' | 'actual'
  /** Minutes past the booked finish that are not charged. */
  lateGraceMinutes: number
  /** Each started block beyond the grace costs `lateBlockFee`. */
  lateBlockMinutes: number
  lateBlockFee: number

  /** Days of notice needed for a holiday to attract the discount. */
  holidayNoticeDays: number
  /** Multiplier for a holiday with enough notice. 0.5 = half price. */
  holidayNoticedRate: number
  /** Multiplier for a holiday declared too late. */
  holidayShortNoticeRate: number
  /** Multiplier for a sick day. */
  sickRate: number
  /** Multiplier for an absence that is neither sick nor a declared holiday. */
  absentRate: number

  /** Create today's attendance from the schedule automatically. */
  autoCheckIn: boolean
  /** Minutes between safe-sleep checks generated with a sleep. 0 disables. */
  sleepCheckMinutes: number
  /** Default length of a sleep block, in minutes. */
  sleepBlockMinutes: number
  /** Where the activity report is emailed. */
  activityEmail: string

  taxEnabled: boolean
  taxName: string
  taxRate: number

  invoicePrefix: string
  nextInvoiceNumber: number
  paymentTermsDays: number
  bankAccount: string
  invoiceFooter: string

  openTime: string
  closeTime: string

  /** Named on the sign-in sheet as the educator. */
  educatorName: string
  /** The service the sheet is returned to, printed in its header. */
  orgName: string
  orgRegion: string
  /** Where the weekly sign-in sheet is emailed. */
  coordinatorEmail: string
  /** Which client the Email buttons hand off to. */
  emailClient: 'gmail' | 'default'

  /** Google Cloud OAuth client ID for Drive backups. Empty disables Drive. */
  driveClientId: string
  driveFolder: string
  /** Days between automatic Drive backups. 0 turns automation off. */
  autoBackupDays: number
  lastBackupAt: string

  /** Short PIN for leaving parent mode. Empty means fall back to the passphrase. */
  teacherPinHash: string
  teacherPinSalt: string
  /** Minutes of no interaction before the door tablet drops back to parent mode. 0 = never. */
  parentIdleMinutes: number
}

export interface Database {
  version: number
  settings: Settings
  children: Child[]
  schedules: ScheduleBlock[]
  attendance: AttendanceRecord[]
  notes: KidNote[]
  activities: Activity[]
  invoices: Invoice[]
  closures: Closure[]
  updatedAt: ISOTimestamp
}
