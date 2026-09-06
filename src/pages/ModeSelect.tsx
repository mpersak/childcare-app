import { useState } from 'react'
import { useVault } from '../lib/vault'
import { useStore } from '../lib/store'
import { hashPin, sameHash, fromBase64 } from '../lib/crypto'
import { PinPad } from '../components/PinPad'

/**
 * Shown once the vault is open. The tablet by the door lives in parent mode all
 * day, so leaving it asks for the passphrase again — otherwise anyone dropping
 * off could read every child's notes and the finances.
 */
export function ModeSelect({ onPick }: { onPick(mode: 'parent' | 'teacher'): void }) {
  const { db } = useStore()

  return (
    <div className="mode-screen">
      <div className="mode-head">
        <span className="brand-mark big">{db.settings.logoText || 'CC'}</span>
        <h1>{db.settings.businessName || 'Childcare Manager'}</h1>
      </div>

      <div className="mode-grid">
        <button className="mode-card parent" onClick={() => onPick('parent')}>
          <span className="mode-icon" aria-hidden="true">👋</span>
          <strong>Parents</strong>
          <span>Sign your child in or out</span>
        </button>

        <button className="mode-card teacher" onClick={() => onPick('teacher')}>
          <span className="mode-icon" aria-hidden="true">📋</span>
          <strong>Teacher</strong>
          <span>Attendance, notes, invoices</span>
        </button>
      </div>
    </div>
  )
}

/**
 * Stepping up from parent mode. A short PIN when one is set, otherwise the
 * passphrase — typing 20 characters on a tablet a dozen times a day is not a
 * workable ask.
 */
export function ExitParentMode({ onCancel, onUnlocked }: {
  onCancel(): void
  onUnlocked(): void
}) {
  const vault = useVault()
  const { db } = useStore()
  const usePin = !!db.settings.teacherPinHash
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const check = async (candidate: string) => {
    setBusy(true)
    setError('')
    try {
      const ok = usePin
        ? await verifyPin(candidate, db.settings.teacherPinHash, db.settings.teacherPinSalt)
        : await vault.verify(candidate)
      if (ok) onUnlocked()
      else setError(usePin ? 'Wrong PIN.' : 'That passphrase does not match.')
    } finally {
      setBusy(false)
    }
  }

  if (usePin) {
    return (
      <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onCancel() }}>
        <div className="modal mode-exit" role="dialog" aria-modal="true" aria-label="Teacher access">
          <header className="modal-head"><h2>Teacher access</h2></header>
          <div className="modal-body">
            <PinPad onSubmit={pin => { void check(pin) }} busy={busy} error={error} />
          </div>
          <footer className="modal-foot">
            <button className="btn" onClick={onCancel}>Cancel</button>
          </footer>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onCancel() }}>
      <form className="modal mode-exit"
            onSubmit={e => { e.preventDefault(); void check(value) }}>
        <header className="modal-head"><h2>Teacher access</h2></header>
        <div className="modal-body">
          <p className="muted">
            Enter the passphrase to leave parent mode. Set a short PIN in Settings to make
            this quicker.
          </p>
          <input className="input" type="password" autoFocus autoComplete="current-password"
                 value={value} onChange={e => setValue(e.target.value)} />
          {error && <p className="lock-error">{error}</p>}
        </div>
        <footer className="modal-foot">
          <button className="btn" type="button" onClick={onCancel}>Cancel</button>
          <button className="btn primary" type="submit" disabled={busy || !value}>Unlock</button>
        </footer>
      </form>
    </div>
  )
}

async function verifyPin(pin: string, storedHash: string, storedSalt: string): Promise<boolean> {
  try {
    return sameHash(await hashPin(pin, fromBase64(storedSalt)), storedHash)
  } catch {
    return false
  }
}
