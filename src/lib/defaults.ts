import type { Database, Settings } from '../types'
import { today } from './dates'

export const DB_VERSION = 1

export const DEFAULT_SETTINGS: Settings = {
  businessName: 'My Childcare',
  businessEmail: '',
  businessPhone: '',
  businessAddress: '',
  logoText: 'MC',

  currency: 'NZD',
  locale: 'en-NZ',
  defaultHourlyRate: 12,
  roundingMinutes: 15,
  roundingMode: 'nearest',
  minimumHours: 0,
  dailyCapHours: 0,
  lateFeePerMinute: 0,

  taxEnabled: true,
  taxName: 'GST',
  taxRate: 0.15,

  invoicePrefix: 'INV-',
  nextInvoiceNumber: 1001,
  paymentTermsDays: 14,
  bankAccount: '',
  invoiceFooter: 'Thank you. Please quote the invoice number with your payment.',

  openTime: '07:00',
  closeTime: '18:00',
}

export const CHILD_COLOURS = [
  '#2563eb', '#db2777', '#059669', '#d97706',
  '#7c3aed', '#0891b2', '#dc2626', '#65a30d',
]

export function emptyDatabase(): Database {
  return {
    version: DB_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    children: [],
    schedules: [],
    attendance: [],
    notes: [],
    invoices: [],
    closures: [],
    updatedAt: new Date().toISOString(),
  }
}

export function uid(prefix = 'id'): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10)
  return `${prefix}_${Date.now().toString(36)}${rand}`
}

export const TODAY = today
