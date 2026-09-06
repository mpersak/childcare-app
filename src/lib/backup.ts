import type { Database } from '../types'
import { makeZip, textEntry, dataUrlEntry, type ZipEntry } from './zip'
import {
  attendanceCSV, invoicesCSV, notesCSV, childrenCSV, schedulesCSV, activitiesCSV,
  readableHTML, toCSV,
} from './exporters'
import { exportJSON } from './repo'
import { today } from './dates'

/**
 * One archive holding the same data three ways:
 *
 *   data.json   exact, and what `Import backup` reads back
 *   *.csv       opens in any spreadsheet
 *   record.html readable in any browser, forever
 *
 * FORMAT.md documents the schema so the data outlives this app — if it is ever
 * rewritten, or abandoned, the archive is still enough to rebuild from.
 */

const FORMAT_DOC = `# Childcare Manager backup

Written by Childcare Manager. Everything here is plaintext and includes
children's personal details — store it accordingly.

## What is in this archive

| File | What it is |
|---|---|
| \`data.json\` | The complete database. This is the file to re-import. |
| \`children.csv\` | One row per child, with guardians flattened. |
| \`schedules.csv\` | Recurring weekly bookings. |
| \`attendance.csv\` | One row per child per day, with calculated hours and charge. |
| \`invoices.csv\` | Invoice totals and balances. |
| \`notes.csv\` | The per-child note log. |
| \`record.html\` | Everything in one readable, printable page. |
| \`signatures/\` | PNG of each captured signature, named by its reference. |

## Restoring

In the app: **Settings → Backups and data → Import backup**, and choose
\`data.json\`. That replaces everything currently held.

Signatures are referenced from attendance records by \`signIn.ref\` /
\`signOut.ref\`, matching the filenames under \`signatures/\`. Importing
\`data.json\` alone restores the records and the signer names and timestamps;
the images are in this archive rather than in the JSON.

## The schema

\`data.json\` is a single object:

\`\`\`
{
  version: number
  updatedAt: ISO timestamp
  settings: { businessName, defaultHourlyRate, roundingMinutes, roundingMode,
              minimumHours, dailyCapHours, taxEnabled, taxName, taxRate,
              invoicePrefix, nextInvoiceNumber, paymentTermsDays,
              currency, locale,
              billBasis: 'schedule'|'actual',
              lateGraceMinutes, lateBlockMinutes, lateBlockFee,
              holidayNoticeDays, holidayNoticedRate, holidayShortNoticeRate,
              sickRate, absentRate, ... }
  children:   [{ id, firstName, lastName, dob, startDate, endDate, status,
                 hourlyRate (null = use default), colour, guardians[],
                 allergies, medical, emergencyContact, general, createdAt }]
  schedules:  [{ id, childId, weekday (0=Sunday), start "HH:MM", end "HH:MM",
                 effectiveFrom, effectiveTo, active }]
  attendance: [{ id, childId, date "YYYY-MM-DD", checkIn, checkOut,
                 status: present|absent|sick|holiday, billable,
                 rate (snapshot of the rate on that day), note,
                 invoiceId (set once billed), createdAt,
                 noticeDate (holidays: the day the holiday was declared),
                 signIn?: { ref, name, at, time }, signOut?: { ... } }]
  activities: [{ id, childId, date, kind: 'nappy'|'sleep', time "HH:MM",
                 endTime (sleep), nappy: 'dry'|'wet'|'stools'|'wet+stools',
                 checks: [{ at "HH:MM", done, by }]  // safe-sleep checks
                 note, createdAt }]
  notes:      [{ id, childId, date, category, title, body, author, flagged, createdAt }]
  invoices:   [{ id, number, childId, periodStart, periodEnd, issueDate, dueDate,
                 lines[], adjustments[], subtotal, tax, total,
                 status: draft|sent|paid|void, payments[], notes, createdAt }]
  closures:   [{ id, date, name, billable }]
}
\`\`\`

Dates are \`YYYY-MM-DD\` in local time. Times are 24-hour \`HH:MM\`.
Money is a plain number in the currency named in settings.

Every attendance row stores the \`rate\` that applied that day, so historical
invoices stay correct even after rates change. \`invoiceId\` being set means the
day has been billed.
`

export function buildBackupEntries(db: Database, signatures: Record<string, string>): ZipEntry[] {
  const entries: ZipEntry[] = [
    textEntry('data.json', exportJSON(db)),
    textEntry('FORMAT.md', FORMAT_DOC),
    textEntry('record.html', readableHTML(db)),
    textEntry('children.csv', childrenCSV(db)),
    textEntry('schedules.csv', schedulesCSV(db)),
    textEntry('attendance.csv', attendanceCSV(db)),
    textEntry('invoices.csv', invoicesCSV(db)),
    textEntry('notes.csv', notesCSV(db)),
    textEntry('activities.csv', activitiesCSV(db)),
    textEntry('closures.csv', toCSV([
      ['Date', 'Name', 'Charged'],
      ...db.closures.map(c => [c.date, c.name, c.billable ? 'yes' : 'no']),
    ])),
  ]

  for (const [ref, dataUrl] of Object.entries(signatures)) {
    const entry = dataUrlEntry(`signatures/${ref}.png`, dataUrl)
    if (entry) entries.push(entry)
  }
  return entries
}

export function backupFilename(db: Database): string {
  const name = (db.settings.businessName || 'childcare')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `${name || 'childcare'}-backup-${today()}.zip`
}

export function buildBackupZip(db: Database, signatures: Record<string, string>): Blob {
  return makeZip(buildBackupEntries(db, signatures))
}
