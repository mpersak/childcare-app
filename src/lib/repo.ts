import type { Database } from '../types'
import { emptyDatabase, DB_VERSION } from './defaults'

/**
 * Shape-normalisation and import/export for the database document.
 *
 * Persistence itself lives in `vault.tsx` — everything on disk or on GitHub is
 * encrypted, so there is no plaintext read or write anywhere in the app.
 */

export function migrate(db: Database): Database {
  // Older payloads may be missing collections added later; fill the gaps so the
  // UI never has to guard against undefined arrays.
  const base = emptyDatabase()
  return {
    ...base,
    ...db,
    settings: { ...base.settings, ...(db.settings || {}) },
    children: db.children ?? [],
    schedules: db.schedules ?? [],
    attendance: db.attendance ?? [],
    notes: db.notes ?? [],
    invoices: db.invoices ?? [],
    closures: db.closures ?? [],
    version: DB_VERSION,
  }
}

export function exportJSON(db: Database): string {
  return JSON.stringify(db, null, 2)
}

/** Throws with a readable message if the file is not a database export. */
export function parseImport(text: string): Database {
  const parsed = JSON.parse(text)
  if (!parsed || typeof parsed !== 'object' || !('children' in parsed)) {
    throw new Error('That file does not look like a Childcare Manager backup.')
  }
  return migrate(parsed as Database)
}
