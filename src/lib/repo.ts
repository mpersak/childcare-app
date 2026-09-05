import type { Database } from '../types'
import { emptyDatabase, DB_VERSION } from './defaults'

/**
 * The single persistence boundary for the whole app.
 *
 * Everything above this file works on a plain `Database` object, so replacing
 * localStorage with a real API (once password login lands) means rewriting
 * `load` / `save` here and nothing else.
 */

const KEY = 'childcare.db.v1'
const BACKUP_PREFIX = 'childcare.backup.'
const MAX_BACKUPS = 5

function migrate(db: Database): Database {
  // Older payloads may be missing collections added later; fill the gaps so the
  // UI never has to guard against undefined arrays.
  const base = emptyDatabase()
  const merged: Database = {
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
  return merged
}

export function load(): Database {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return emptyDatabase()
    return migrate(JSON.parse(raw) as Database)
  } catch (err) {
    console.error('Could not read saved data, starting empty.', err)
    return emptyDatabase()
  }
}

export function save(db: Database): void {
  try {
    const payload: Database = { ...db, updatedAt: new Date().toISOString() }
    localStorage.setItem(KEY, JSON.stringify(payload))
  } catch (err) {
    // Quota is the realistic failure here. Surface it rather than silently losing edits.
    console.error('Save failed', err)
    alert('Could not save changes — browser storage may be full. Export a backup from Settings.')
  }
}

/** Keeps a short ring of daily snapshots so a bad edit is recoverable. */
export function snapshot(db: Database): void {
  try {
    const key = `${BACKUP_PREFIX}${new Date().toISOString().slice(0, 10)}`
    if (localStorage.getItem(key)) return
    localStorage.setItem(key, JSON.stringify(db))
    const keys = Object.keys(localStorage)
      .filter(k => k.startsWith(BACKUP_PREFIX))
      .sort()
    while (keys.length > MAX_BACKUPS) {
      const oldest = keys.shift()
      if (oldest) localStorage.removeItem(oldest)
    }
  } catch {
    /* backups are best-effort */
  }
}

export function listBackups(): string[] {
  return Object.keys(localStorage)
    .filter(k => k.startsWith(BACKUP_PREFIX))
    .map(k => k.slice(BACKUP_PREFIX.length))
    .sort()
    .reverse()
}

export function restoreBackup(date: string): Database | null {
  const raw = localStorage.getItem(`${BACKUP_PREFIX}${date}`)
  if (!raw) return null
  try {
    return migrate(JSON.parse(raw) as Database)
  } catch {
    return null
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

export function clearAll(): void {
  localStorage.removeItem(KEY)
}
