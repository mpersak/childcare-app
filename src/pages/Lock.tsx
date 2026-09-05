import { useState } from 'react'
import { useVault } from '../lib/vault'

/**
 * The way in. There is no server and no reset link, so the copy here is blunt
 * about what forgetting the passphrase costs.
 */
export default function Lock() {
  const vault = useVault()
  const creating = vault.status === 'new'

  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const weak = passphrase.length > 0 && passphrase.length < 12

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (creating) {
        if (passphrase !== confirm) throw new Error('The two passphrases do not match.')
        if (passphrase.length < 12) throw new Error('Use at least 12 characters.')
        await vault.create(passphrase)
      } else {
        await vault.unlock(passphrase)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not unlock.')
    } finally {
      setBusy(false)
      setPassphrase('')
      setConfirm('')
    }
  }

  return (
    <div className="lock-screen">
      <form className="lock-card" onSubmit={submit}>
        <div className="lock-mark">CC</div>
        <h1>{creating ? 'Set a passphrase' : 'Unlock'}</h1>
        <p className="muted">
          {creating
            ? 'This passphrase encrypts everything — on this device and on GitHub.'
            : 'Enter the passphrase for this vault.'}
        </p>

        <label className="field">
          <span className="field-label">Passphrase</span>
          <input
            className="input" type="password" autoFocus
            autoComplete={creating ? 'new-password' : 'current-password'}
            value={passphrase} onChange={e => setPassphrase(e.target.value)}
          />
          {creating && weak && <span className="field-hint warn">Use at least 12 characters.</span>}
        </label>

        {creating && (
          <>
            <label className="field">
              <span className="field-label">Confirm passphrase</span>
              <input
                className="input" type="password" autoComplete="new-password"
                value={confirm} onChange={e => setConfirm(e.target.value)}
              />
            </label>

            <label className="check lock-ack">
              <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />
              <span>
                I understand there is no way to reset this. If the passphrase is lost, the
                data cannot be recovered by anyone, including me.
              </span>
            </label>
          </>
        )}

        {error && <p className="lock-error">{error}</p>}

        <button
          className="btn primary big" type="submit"
          disabled={busy || !passphrase || (creating && (!ack || passphrase !== confirm))}
        >
          {busy ? 'Working…' : creating ? 'Create vault' : 'Unlock'}
        </button>

        {creating && (
          <p className="muted small">
            Write it down and keep it somewhere physical. A password manager entry is better
            than memory.
          </p>
        )}
      </form>
    </div>
  )
}
