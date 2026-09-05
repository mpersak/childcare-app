import { useState } from 'react'
import { useVault } from '../lib/vault'
import { useStore } from '../lib/store'

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

/** Passphrase prompt for stepping up from parent mode to the full app. */
export function ExitParentMode({ onCancel, onUnlocked }: {
  onCancel(): void
  onUnlocked(): void
}) {
  const vault = useVault()
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (await vault.verify(value)) onUnlocked()
      else setError('That passphrase does not match.')
    } finally {
      setBusy(false)
      setValue('')
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onCancel() }}>
      <form className="modal mode-exit" onSubmit={submit}>
        <header className="modal-head"><h2>Teacher access</h2></header>
        <div className="modal-body">
          <p className="muted">Enter the passphrase to leave parent mode.</p>
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
