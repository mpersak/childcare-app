import { useRef, useState } from 'react'
import { useStore } from '../lib/store'
import { Card, ConfirmButton, Field, PageHead } from '../components/ui'
import { SyncPanel, SecurityPanel } from '../components/SyncPanel'
import { BackupPanel } from '../components/BackupPanel'
import { PinPanel } from '../components/PinPanel'
import { ChargingPanel } from '../components/ChargingPanel'
import { SheetSettings } from './SignSheet'
import { useVault } from '../lib/vault'
import { attendanceCSV, download, invoicesCSV, readableHTML } from '../lib/exporters'
import { exportJSON, parseImport } from '../lib/repo'
import { buildDemoDatabase } from '../lib/demo'
import { formatDate, today } from '../lib/dates'
import type { RoundingMode } from '../types'

export default function SettingsPage() {
  const { db, actions } = useStore()
  const vault = useVault()
  const s = db.settings
  const fileRef = useRef<HTMLInputElement>(null)
  const [closure, setClosure] = useState({ date: today(), name: '', billable: false })
  const [message, setMessage] = useState('')

  const set = (patch: Parameters<typeof actions.updateSettings>[0]) => actions.updateSettings(patch)

  const onImport = async (file: File) => {
    try {
      const next = parseImport(await file.text())
      actions.replaceDatabase(next)
      setMessage(`Imported ${next.children.length} children and ${next.invoices.length} invoices.`)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'That file could not be read.')
    }
  }

  return (
    <>
      <PageHead title="Settings" subtitle={`Last saved ${new Date(db.updatedAt).toLocaleString(s.locale)}`} />

      {message && <div className="banner">{message}</div>}

      <div className="split">
        <Card title="Your business">
          <div className="form-grid">
            <Field label="Name" wide>
              <input className="input" value={s.businessName} onChange={e => set({ businessName: e.target.value })} />
            </Field>
            <Field label="Initials on invoices" hint="Two or three characters">
              <input className="input" maxLength={3} value={s.logoText}
                     onChange={e => set({ logoText: e.target.value })} />
            </Field>
            <Field label="Phone">
              <input className="input" value={s.businessPhone} onChange={e => set({ businessPhone: e.target.value })} />
            </Field>
            <Field label="Email" wide>
              <input className="input" type="email" value={s.businessEmail}
                     onChange={e => set({ businessEmail: e.target.value })} />
            </Field>
            <Field label="Address" wide>
              <textarea className="input" rows={3} value={s.businessAddress}
                        onChange={e => set({ businessAddress: e.target.value })} />
            </Field>
            <Field label="Opens">
              <input className="input" type="time" value={s.openTime} onChange={e => set({ openTime: e.target.value })} />
            </Field>
            <Field label="Closes">
              <input className="input" type="time" value={s.closeTime} onChange={e => set({ closeTime: e.target.value })} />
            </Field>
          </div>
        </Card>

        <Card title="Charging">
          <div className="form-grid">
            <Field label="Default hourly rate" hint="Children can override this individually">
              <input className="input" type="number" min="0" step="0.5" value={s.defaultHourlyRate}
                     onChange={e => set({ defaultHourlyRate: Number(e.target.value) })} />
            </Field>
            <Field label="Currency">
              <input className="input" value={s.currency} onChange={e => set({ currency: e.target.value.toUpperCase() })} />
            </Field>
            <Field label="Round time to" hint="1 means charge to the exact minute">
              <select className="input" value={s.roundingMinutes}
                      onChange={e => set({ roundingMinutes: Number(e.target.value) })}>
                {[1, 5, 6, 10, 15, 30, 60].map(m => <option key={m} value={m}>{m} minutes</option>)}
              </select>
            </Field>
            <Field label="Rounding direction">
              <select className="input" value={s.roundingMode}
                      onChange={e => set({ roundingMode: e.target.value as RoundingMode })}>
                <option value="nearest">to the nearest</option>
                <option value="up">always up</option>
                <option value="down">always down</option>
              </select>
            </Field>
            <Field label="Minimum charge" hint="Hours. 0 turns it off">
              <input className="input" type="number" min="0" step="0.25" value={s.minimumHours}
                     onChange={e => set({ minimumHours: Number(e.target.value) })} />
            </Field>
            <Field label="Daily cap" hint="Hours. 0 turns it off">
              <input className="input" type="number" min="0" step="0.5" value={s.dailyCapHours}
                     onChange={e => set({ dailyCapHours: Number(e.target.value) })} />
            </Field>
          </div>
          <p className="muted small">
            Changing a rate does not touch attendance already recorded — every record keeps the
            rate that applied on the day.
          </p>
        </Card>
      </div>

      <div className="split">
        <Card title="Tax and invoicing">
          <div className="form-grid">
            <Field label="Charge tax">
              <label className="check">
                <input type="checkbox" checked={s.taxEnabled} onChange={e => set({ taxEnabled: e.target.checked })} />
                Registered
              </label>
            </Field>
            <Field label="Tax name">
              <input className="input" value={s.taxName} onChange={e => set({ taxName: e.target.value })} />
            </Field>
            <Field label="Tax rate" hint="As a percentage">
              <input className="input" type="number" min="0" max="100" step="0.5"
                     value={(s.taxRate * 100).toFixed(1)}
                     onChange={e => set({ taxRate: Number(e.target.value) / 100 })} />
            </Field>
            <Field label="Invoice prefix">
              <input className="input" value={s.invoicePrefix} onChange={e => set({ invoicePrefix: e.target.value })} />
            </Field>
            <Field label="Next number">
              <input className="input" type="number" min="1" step="1" value={s.nextInvoiceNumber}
                     onChange={e => set({ nextInvoiceNumber: Number(e.target.value) })} />
            </Field>
            <Field label="Payment terms" hint="Days from issue">
              <input className="input" type="number" min="0" step="1" value={s.paymentTermsDays}
                     onChange={e => set({ paymentTermsDays: Number(e.target.value) })} />
            </Field>
            <Field label="Bank account shown on invoices" wide>
              <input className="input" value={s.bankAccount} onChange={e => set({ bankAccount: e.target.value })} />
            </Field>
            <Field label="Invoice footer" wide>
              <textarea className="input" rows={2} value={s.invoiceFooter}
                        onChange={e => set({ invoiceFooter: e.target.value })} />
            </Field>
          </div>
        </Card>

        <Card title="Closures">
          <div className="toolbar">
            <input className="input" type="date" value={closure.date}
                   onChange={e => setClosure({ ...closure, date: e.target.value })} />
            <input className="input" placeholder="Reason" value={closure.name}
                   onChange={e => setClosure({ ...closure, name: e.target.value })} />
            <label className="check">
              <input type="checkbox" checked={closure.billable}
                     onChange={e => setClosure({ ...closure, billable: e.target.checked })} />
              Still charge
            </label>
            <button className="btn primary" disabled={!closure.name.trim()} onClick={() => {
              actions.addClosure(closure)
              setClosure({ date: today(), name: '', billable: false })
            }}>Add</button>
          </div>

          {db.closures.length === 0 ? (
            <p className="muted">
              Public holidays and shutdown days. "Fill from schedule" marks these as holiday
              instead of present.
            </p>
          ) : (
            <div className="table-scroll">
  <table className="table">
                <tbody>
                  {[...db.closures].sort((a, b) => a.date.localeCompare(b.date)).map(c => (
                    <tr key={c.id}>
                      <td>{formatDate(c.date, s.locale)}</td>
                      <td>{c.name}</td>
                      <td className="muted">{c.billable ? 'charged' : 'not charged'}</td>
                      <td className="right">
                        <button className="link danger" onClick={() => actions.deleteClosure(c.id)}>remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <ChargingPanel />

      <SheetSettings />

      <SyncPanel />
      <PinPanel />

      <SecurityPanel />

      <BackupPanel />

      <Card title="Other exports">
        <p className="muted">
          Sync keeps a copy on GitHub, encrypted. An exported JSON file is plaintext, so
          treat it as a file containing children's personal details.
        </p>

        <div className="row gap wrap">
          <button className="btn primary" onClick={() =>
            download(`childcare-backup-${today()}.json`, exportJSON(db), 'application/json')}>
            Export backup (JSON)
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>Import backup</button>
          <input
            ref={fileRef} type="file" accept="application/json,.json" hidden
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) void onImport(f)
              e.target.value = ''
            }}
          />
          <button className="btn" onClick={() => download('attendance.csv', attendanceCSV(db), 'text/csv')}>
            Attendance CSV
          </button>
          <button className="btn" onClick={() => download('invoices.csv', invoicesCSV(db), 'text/csv')}>
            Invoices CSV
          </button>
          <button className="btn" onClick={() =>
            download(`childcare-record-${today()}.html`, readableHTML(db), 'text/html')}>
            Readable export (HTML)
          </button>
        </div>

        <div className="danger-row">
          <ConfirmButton
            className="btn"
            confirmLabel="Replace everything with sample data?"
            onConfirm={() => {
              actions.replaceDatabase(buildDemoDatabase())
              setMessage('Sample data loaded. All names in it are invented placeholders.')
            }}
          >
            Load sample data
          </ConfirmButton>

          <ConfirmButton
            confirmLabel="Erase this vault and all local data?"
            onConfirm={() => vault.destroy()}
          >
            Destroy vault
          </ConfirmButton>
          <span className="muted small">
            Destroying clears this device only. Anything already pushed to GitHub stays there
            until you delete the repository.
          </span>
        </div>
      </Card>
    </>
  )
}
