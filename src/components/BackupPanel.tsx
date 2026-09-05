import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../lib/store'
import { useVault } from '../lib/vault'
import { Card, Field } from './ui'
import { buildBackupZip, backupFilename } from '../lib/backup'
import { uploadBackup } from '../lib/drive'
import { addDays, today } from '../lib/dates'

/**
 * Backup archive: download it, or send it to Google Drive.
 *
 * The archive is plaintext by design — a backup you cannot read without this
 * exact app is not much of a backup. That is the opposite trade from sync, where
 * the point is that GitHub never sees anything readable.
 */
export function BackupPanel() {
  const { db, actions } = useStore()
  const vault = useVault()
  const s = db.settings
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const autoTried = useRef(false)

  const set = (patch: Parameters<typeof actions.updateSettings>[0]) => actions.updateSettings(patch)

  /** Decrypts every signature the records point at so they can go in the archive. */
  const gatherSignatures = useCallback(async (): Promise<Record<string, string>> => {
    const refs = [...new Set(db.attendance.flatMap(a =>
      [a.signIn?.ref, a.signOut?.ref].filter(Boolean) as string[]))]
    const out: Record<string, string> = {}
    for (const ref of refs) {
      const url = await vault.loadSignature(ref)
      if (url) out[ref] = url
    }
    return out
  }, [db.attendance, vault])

  const buildZip = useCallback(async () => {
    return buildBackupZip(db, await gatherSignatures())
  }, [db, gatherSignatures])

  const downloadZip = async () => {
    setBusy('download'); setError(''); setMessage('')
    try {
      const blob = await buildZip()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = backupFilename(db)
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setMessage('Backup downloaded.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build the backup.')
    } finally {
      setBusy('')
    }
  }

  const toDrive = useCallback(async (silent: boolean) => {
    if (!s.driveClientId) return
    setBusy('drive'); setError(''); setMessage('')
    try {
      const blob = await buildZip()
      const link = await uploadBackup(
        s.driveClientId, s.driveFolder, backupFilename(db), blob, silent,
      )
      set({ lastBackupAt: new Date().toISOString() })
      setMessage(`Uploaded to Drive. ${link}`)
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : 'Drive upload failed.')
    } finally {
      setBusy('')
    }
  }, [s.driveClientId, s.driveFolder, db, buildZip])

  // Scheduled backup. A static site holds no refresh token, so this can only run
  // while the app is open, and only silently once consent has been given before.
  useEffect(() => {
    if (autoTried.current) return
    if (!s.driveClientId || s.autoBackupDays <= 0) return
    const due = !s.lastBackupAt ||
      addDays(s.lastBackupAt.slice(0, 10), s.autoBackupDays) <= today()
    if (!due) return
    autoTried.current = true
    void toDrive(true)
  }, [s.driveClientId, s.autoBackupDays, s.lastBackupAt, toDrive])

  return (
    <Card title="Backup archive">
      <p className="muted">
        A ZIP holding the data three ways — <code>data.json</code> to re-import,
        CSVs for a spreadsheet, and a readable HTML page — plus every signature as a
        PNG and a <code>FORMAT.md</code> describing the schema, so the records outlive
        this app. Unlike sync, this file is <strong>not encrypted</strong>.
      </p>

      <div className="row gap wrap">
        <button className="btn primary" disabled={!!busy} onClick={() => void downloadZip()}>
          {busy === 'download' ? 'Building…' : 'Download backup (ZIP)'}
        </button>
        <button className="btn" disabled={!!busy || !s.driveClientId}
                onClick={() => void toDrive(false)}>
          {busy === 'drive' ? 'Uploading…' : 'Send to Google Drive'}
        </button>
      </div>

      {message && <p className="notice">{message}</p>}
      {error && <p className="lock-error">{error}</p>}

      <div className="form-grid" style={{ marginTop: 14 }}>
        <Field label="Google client ID" wide
               hint="OAuth 2.0 Web application client ID from a Google Cloud project. Leave blank to disable Drive.">
          <input className="input" value={s.driveClientId}
                 onChange={e => set({ driveClientId: e.target.value.trim() })} />
        </Field>
        <Field label="Drive folder">
          <input className="input" value={s.driveFolder}
                 onChange={e => set({ driveFolder: e.target.value })} />
        </Field>
        <Field label="Automatic backup" hint="Runs when the app is open. 0 turns it off.">
          <select className="input" value={s.autoBackupDays}
                  onChange={e => set({ autoBackupDays: Number(e.target.value) })}>
            <option value={0}>off</option>
            <option value={1}>daily</option>
            <option value={7}>weekly</option>
            <option value={30}>monthly</option>
          </select>
        </Field>
      </div>

      <p className="muted small">
        Last backup: {s.lastBackupAt ? new Date(s.lastBackupAt).toLocaleString(s.locale) : 'never'}.
        {' '}The app only asks Google for permission to touch files it created itself — it
        cannot see the rest of your Drive. Automatic backups run while the app is open;
        a browser page cannot upload anything while it is closed.
      </p>
    </Card>
  )
}
