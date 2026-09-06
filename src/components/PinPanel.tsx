import { useState } from 'react'
import { useStore } from '../lib/store'
import { Card, ConfirmButton, Field } from './ui'
import { hashPin, randomBytes, toBase64 } from '../lib/crypto'
import { useVault } from '../lib/vault'
import { MAX_PIN_ATTEMPTS, pinLooksValid } from '../lib/pinunlock'

/**
 * Sets the short PIN that unlocks teacher mode on the door tablet.
 *
 * Worth being clear about what this is: the vault is already open when the PIN
 * is checked, so it is a barrier against a parent wandering into the records,
 * not a cryptographic one. The passphrase is what protects the data itself.
 */
export function PinPanel() {
  const { db, actions } = useStore()
  const s = db.settings
  const vault = useVault()
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [unlockPass, setUnlockPass] = useState('')
  const [unlockPin, setUnlockPin] = useState('')
  const [busy, setBusy] = useState(false)

  const enableUnlock = async () => {
    setError(''); setMessage(''); setBusy(true)
    try {
      await vault.enablePinUnlock(unlockPass, unlockPin)
      // One PIN is the point of the exercise: if teacher mode has none yet, use
      // the same digits, so nothing still falls back to the full passphrase.
      let alsoTeacher = false
      if (!s.teacherPinHash) {
        const salt = randomBytes(16)
        actions.updateSettings({
          teacherPinHash: await hashPin(unlockPin, salt),
          teacherPinSalt: toBase64(salt),
        })
        alsoTeacher = true
      }
      setUnlockPass(''); setUnlockPin('')
      setMessage(alsoTeacher
        ? 'PIN unlock is on for this device, and the same PIN now opens teacher mode.'
        : 'PIN unlock is on for this device.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set up PIN unlock.')
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    setError(''); setMessage('')
    if (!/^\d{4,8}$/.test(pin)) { setError('Use 4 to 8 digits.'); return }
    if (pin !== confirm) { setError('The two PINs do not match.'); return }
    const salt = randomBytes(16)
    actions.updateSettings({
      teacherPinHash: await hashPin(pin, salt),
      teacherPinSalt: toBase64(salt),
    })
    setPin(''); setConfirm('')
    setMessage('PIN set. Leaving parent mode will ask for this instead of the passphrase.')
  }

  return (
    <Card title="Teacher PIN">
      <p className="muted">
        A short PIN for getting from the parent screen back into the app, so nobody has to
        type the full passphrase at the door. It unlocks the <em>view</em> — the passphrase
        is still what encrypts the data, and is asked for whenever the app is fully locked.
      </p>

      <div className="form-grid">
        <Field label="New PIN" hint="4 to 8 digits">
          <input className="input" type="password" inputMode="numeric" autoComplete="off"
                 value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field label="Confirm PIN">
          <input className="input" type="password" inputMode="numeric" autoComplete="off"
                 value={confirm} onChange={e => setConfirm(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field label="Return to parent mode after" wide
               hint="Idle time on the door tablet before it drops back automatically.">
          <select className="input" value={s.parentIdleMinutes}
                  onChange={e => actions.updateSettings({ parentIdleMinutes: Number(e.target.value) })}>
            <option value={0}>never</option>
            <option value={2}>2 minutes</option>
            <option value={5}>5 minutes</option>
            <option value={10}>10 minutes</option>
            <option value={30}>30 minutes</option>
          </select>
        </Field>
      </div>

      {error && <p className="lock-error">{error}</p>}
      {message && <p className="notice">{message}</p>}

      <div className="unlock-block">
        <strong>Open the app with this PIN too</strong>
        <p className="muted small">
          Wraps your passphrase behind the PIN <em>and</em> a key the browser keeps on this
          device and will not reveal, so the stored data cannot be attacked by guessing four
          digits against a copied file. It is still weaker than the passphrase — after{' '}
          {MAX_PIN_ATTEMPTS} wrong tries it switches itself off. Set it up per device.
        </p>

        {vault.pinUnlockReady ? (
          <ConfirmButton
            className="btn"
            confirmLabel="Turn PIN unlock off?"
            onConfirm={() => {
              void vault.disablePinUnlock()
              setMessage('PIN unlock switched off. This device now needs the passphrase.')
            }}
          >
            PIN unlock is on — turn it off
          </ConfirmButton>
        ) : (
          <div className="row gap wrap">
            <input
              className="input tight" type="password" placeholder="Passphrase"
              autoComplete="current-password"
              value={unlockPass} onChange={e => setUnlockPass(e.target.value)}
            />
            <input
              className="input tight" type="password" placeholder="PIN" inputMode="numeric"
              value={unlockPin} onChange={e => setUnlockPin(e.target.value.replace(/\D/g, ''))}
            />
            <button
              className="btn"
              disabled={busy || !unlockPass || !pinLooksValid(unlockPin)}
              onClick={() => void enableUnlock()}
            >
              {busy ? 'Setting up…' : 'Enable PIN unlock'}
            </button>
          </div>
        )}
      </div>

      <div className="row gap wrap">
        <button className="btn primary" disabled={!pin || !confirm} onClick={() => void save()}>
          {s.teacherPinHash ? 'Change PIN' : 'Set PIN'}
        </button>
        {s.teacherPinHash && (
          <ConfirmButton
            className="btn"
            confirmLabel="Remove the PIN?"
            onConfirm={() => {
              actions.updateSettings({ teacherPinHash: '', teacherPinSalt: '' })
              setMessage('PIN removed. Leaving parent mode now asks for the passphrase.')
            }}
          >
            Remove PIN
          </ConfirmButton>
        )}
      </div>
    </Card>
  )
}
