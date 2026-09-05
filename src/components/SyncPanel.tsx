import { useState } from 'react'
import { useVault } from '../lib/vault'
import { Card, ConfirmButton, Field } from './ui'
import type { GithubConfig } from '../lib/github'

/** GitHub sync setup and status. Only ciphertext ever leaves the device. */
export function SyncPanel() {
  const vault = useVault()
  const [form, setForm] = useState<GithubConfig>(() => vault.github ?? {
    owner: '', repo: '', branch: 'main', path: 'data', token: '',
  })
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  const [error, setError] = useState('')

  const connect = async () => {
    setBusy(true); setError(''); setResult('')
    try {
      setResult(await vault.connectGithub({ ...form, owner: form.owner.trim(), repo: form.repo.trim() }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect.')
    } finally {
      setBusy(false)
    }
  }

  const tone =
    vault.syncState === 'error' ? 'bad'
    : vault.syncState === 'conflict' ? 'warn'
    : vault.syncState === 'syncing' ? 'info'
    : vault.github ? 'good' : 'muted'

  return (
    <Card
      title="Sync to GitHub"
      actions={<span className={`badge badge-${tone}`}>{vault.github ? vault.syncState : 'not connected'}</span>}
    >
      <p className="muted">
        The document is encrypted on this device before it is uploaded, so the repository
        only ever holds ciphertext. Use a <strong>private</strong> repository anyway.
      </p>

      {vault.syncState === 'conflict' && (
        <div className="banner">
          <strong>Both copies changed.</strong> Another device saved since this one last synced.
          <div className="row gap" style={{ marginTop: 8 }}>
            <button className="btn" onClick={() => void vault.resolveConflict('theirs')}>
              Keep the GitHub copy
            </button>
            <button className="btn primary" onClick={() => void vault.resolveConflict('mine')}>
              Keep this device's copy
            </button>
          </div>
        </div>
      )}

      {vault.github ? (
        <>
          <dl className="kv">
            <div><dt>Repository</dt><dd>{vault.github.owner}/{vault.github.repo}</dd></div>
            <div><dt>Branch</dt><dd>{vault.github.branch}</dd></div>
            <div><dt>Last synced</dt><dd>
              {vault.lastSyncAt ? new Date(vault.lastSyncAt).toLocaleString() : 'never'}
            </dd></div>
            {vault.pendingCount > 0 && (
              <div><dt>Waiting to upload</dt><dd>{vault.pendingCount} signature(s)</dd></div>
            )}
          </dl>

          {vault.syncMessage && <p className="notice">{vault.syncMessage}</p>}

          <div className="row gap wrap">
            <button className="btn primary" disabled={vault.syncState === 'syncing'}
                    onClick={() => void vault.syncNow()}>
              Sync now
            </button>
            <button className="btn" disabled={vault.syncState === 'syncing'}
                    onClick={() => void vault.pullRemote()}>
              Pull from GitHub
            </button>
            <ConfirmButton className="btn" confirmLabel="Stop syncing?" onConfirm={vault.disconnectGithub}>
              Disconnect
            </ConfirmButton>
          </div>
        </>
      ) : (
        <>
          <div className="form-grid">
            <Field label="Owner" hint="Your GitHub username">
              <input className="input" value={form.owner}
                     onChange={e => setForm({ ...form, owner: e.target.value })} />
            </Field>
            <Field label="Repository" hint="Private, and separate from the app's own repo">
              <input className="input" value={form.repo}
                     onChange={e => setForm({ ...form, repo: e.target.value })} />
            </Field>
            <Field label="Branch">
              <input className="input" value={form.branch}
                     onChange={e => setForm({ ...form, branch: e.target.value })} />
            </Field>
            <Field label="Folder" hint="Inside the repository">
              <input className="input" value={form.path}
                     onChange={e => setForm({ ...form, path: e.target.value })} />
            </Field>
            <Field label="Access token" wide
                   hint="Fine-grained token, this repository only, Contents: read and write. Stored encrypted under your passphrase.">
              <input className="input" type="password" value={form.token}
                     onChange={e => setForm({ ...form, token: e.target.value })} />
            </Field>
          </div>

          {error && <p className="lock-error">{error}</p>}
          {result && <p className="notice">{result}</p>}

          <button className="btn primary" disabled={busy || !form.owner || !form.repo || !form.token}
                  onClick={() => void connect()}>
            {busy ? 'Checking…' : 'Connect'}
          </button>
        </>
      )}
    </Card>
  )
}

/** Passphrase change and locking. */
export function SecurityPanel() {
  const vault = useVault()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const change = async () => {
    setError(''); setMsg('')
    if (next.length < 12) { setError('Use at least 12 characters.'); return }
    if (next !== confirm) { setError('The new passphrases do not match.'); return }
    setBusy(true)
    try {
      await vault.changePassphrase(current, next)
      setMsg('Passphrase changed. Everything has been re-encrypted; sync again to update GitHub.')
      setCurrent(''); setNext(''); setConfirm('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the passphrase.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Passphrase" actions={<button className="btn" onClick={vault.lock}>Lock now</button>}>
      <p className="muted">
        This passphrase is the encryption key. There is no reset — if it is lost, the data
        cannot be recovered by anyone.
      </p>

      <div className="form-grid">
        <Field label="Current passphrase" wide>
          <input className="input" type="password" autoComplete="current-password"
                 value={current} onChange={e => setCurrent(e.target.value)} />
        </Field>
        <Field label="New passphrase">
          <input className="input" type="password" autoComplete="new-password"
                 value={next} onChange={e => setNext(e.target.value)} />
        </Field>
        <Field label="Confirm new passphrase">
          <input className="input" type="password" autoComplete="new-password"
                 value={confirm} onChange={e => setConfirm(e.target.value)} />
        </Field>
      </div>

      {error && <p className="lock-error">{error}</p>}
      {msg && <p className="notice">{msg}</p>}

      <button className="btn" disabled={busy || !current || !next} onClick={() => void change()}>
        {busy ? 'Re-encrypting…' : 'Change passphrase'}
      </button>
    </Card>
  )
}
