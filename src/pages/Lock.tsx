import { useState } from 'react'
import { useVault } from '../lib/vault'
import { normaliseRepo, type GithubConfig } from '../lib/github'
import { Field } from '../components/ui'
import { PinPad } from '../components/PinPad'

/**
 * The way in. There is no server and no reset link, so the copy here is blunt
 * about what forgetting the passphrase costs.
 */
export default function Lock() {
  const vault = useVault()
  const creating = vault.status === 'new'
  const [mode, setMode] = useState<'default' | 'restore' | 'passphrase'>('default')

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

  if (mode === 'restore') return <Restore onBack={() => setMode('default')} />

  // A vault that has PIN unlock set up opens with the keypad by default.
  if (!creating && vault.pinUnlockReady && mode === 'default') {
    return <PinUnlock onUsePassphrase={() => setMode('passphrase')} />
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
          <>
            <p className="muted small">
              Write it down and keep it somewhere physical. A password manager entry is better
              than memory.
            </p>
            <button type="button" className="link" onClick={() => setMode('restore')}>
              Already set this up on another device?
            </button>
          </>
        )}
      </form>
    </div>
  )
}

/**
 * Adding a second device: pull the existing vault down rather than starting a
 * new one. The passphrase must be the same — it is the key, not an account.
 */
function Restore({ onBack }: { onBack(): void }) {
  const vault = useVault()
  const [cfg, setCfg] = useState<GithubConfig>({
    owner: '', repo: '', branch: 'main', path: 'data', token: '',
  })
  const [passphrase, setPassphrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    const { owner, repo } = normaliseRepo(cfg.owner, cfg.repo)
    try {
      await vault.restoreFromGithub(
        { ...cfg, owner, repo, branch: cfg.branch.trim() || 'main', token: cfg.token.trim() },
        passphrase,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not restore.')
    } finally {
      setBusy(false)
      setPassphrase('')
    }
  }

  return (
    <div className="lock-screen">
      <form className="lock-card wide" onSubmit={submit}>
        <div className="lock-mark">CC</div>
        <h1>Add this device</h1>
        <p className="muted">
          Point this device at the repository the other one syncs to, and unlock it with the
          same passphrase.
        </p>

        <div className="form-grid">
          <Field label="Owner">
            <input className="input" value={cfg.owner}
                   onChange={e => setCfg({ ...cfg, owner: e.target.value })} />
          </Field>
          <Field label="Repository" hint="Name, owner/repo or a pasted URL">
            <input className="input" value={cfg.repo}
                   onChange={e => setCfg({ ...cfg, repo: e.target.value })} />
          </Field>
          <Field label="Branch">
            <input className="input" value={cfg.branch}
                   onChange={e => setCfg({ ...cfg, branch: e.target.value })} />
          </Field>
          <Field label="Folder">
            <input className="input" value={cfg.path}
                   onChange={e => setCfg({ ...cfg, path: e.target.value })} />
          </Field>
          <Field label="Access token" wide hint="A fine-grained token for that repository">
            <input className="input" type="password" value={cfg.token}
                   onChange={e => setCfg({ ...cfg, token: e.target.value })} />
          </Field>
          <Field label="Passphrase" wide hint="The same one used on the first device">
            <input className="input" type="password" autoComplete="current-password"
                   value={passphrase} onChange={e => setPassphrase(e.target.value)} />
          </Field>
        </div>

        {error && <p className="lock-error">{error}</p>}

        <button className="btn primary big" type="submit"
                disabled={busy || !cfg.owner || !cfg.repo || !cfg.token || !passphrase}>
          {busy ? 'Fetching…' : 'Restore onto this device'}
        </button>
        <button type="button" className="link" onClick={onBack}>Back</button>
      </form>
    </div>
  )
}

/** Keypad entry for a device where PIN unlock has been set up. */
function PinUnlock({ onUsePassphrase }: { onUsePassphrase(): void }) {
  const vault = useVault()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (pin: string) => {
    setBusy(true)
    setError('')
    try {
      await vault.unlockWithPin(pin)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not unlock.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="lock-screen">
      <div className="lock-card">
        <div className="lock-mark">CC</div>
        <h1>Enter PIN</h1>
        <p className="muted">
          {vault.pinAttemptsLeft <= 2
            ? `${vault.pinAttemptsLeft} attempts left before PIN unlock switches off.`
            : 'Or use the full passphrase.'}
        </p>

        <PinPad onSubmit={pin => { void submit(pin) }} busy={busy} error={error} />

        <button type="button" className="link" onClick={onUsePassphrase}>
          Use the passphrase instead
        </button>
      </div>
    </div>
  )
}
