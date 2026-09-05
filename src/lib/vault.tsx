import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react'
import type { Database } from '../types'
import { emptyDatabase } from './defaults'
import { migrate } from './repo'
import {
  decryptString, deriveKey, encryptString, generateRecoveryKey, isEnvelope,
  randomBytes, saltOf, toBase64, fromBase64, type Envelope,
} from './crypto'
import {
  ConflictError, checkAccess, getFile, putFile, type GithubConfig,
} from './github'

/**
 * The vault owns the encryption key and every read and write of persisted data.
 *
 * Nothing is stored in the clear, on this device or on GitHub. The passphrase is
 * the only way in — losing it loses the data, which is the trade for not having
 * a server that could reset it.
 */

const VAULT_KEY = 'childcare.vault.v1'
const SIG_PREFIX = 'childcare.sig.'
const DOC_FILE = 'data.json.enc'

interface VaultRecord {
  salt: string
  doc: Envelope | null
  /** GitHub settings including the token, encrypted under the same passphrase. */
  sync: Envelope | null
  remoteSha: string | null
  lastSyncAt: string | null
  /** Signature refs captured but not yet uploaded. */
  pending: string[]
}

export type VaultStatus = 'new' | 'locked' | 'unlocked'
export type SyncState = 'off' | 'idle' | 'syncing' | 'error' | 'conflict'

interface VaultApi {
  status: VaultStatus
  db: Database | null
  syncState: SyncState
  syncMessage: string
  lastSyncAt: string | null
  pendingCount: number
  github: GithubConfig | null

  create(passphrase: string): Promise<void>
  unlock(passphrase: string): Promise<void>
  lock(): void
  changePassphrase(current: string, next: string): Promise<void>
  /** Confirms a passphrase without changing state — used to leave parent mode. */
  verify(passphrase: string): Promise<boolean>

  persist(db: Database): void
  replace(db: Database): void

  connectGithub(cfg: GithubConfig): Promise<string>
  disconnectGithub(): void
  syncNow(): Promise<void>
  pullRemote(): Promise<void>
  resolveConflict(keep: 'mine' | 'theirs'): Promise<void>

  saveSignature(dataUrl: string): Promise<string>
  loadSignature(ref: string): Promise<string | null>

  newRecoveryKey(): string
  destroy(): void
}

const Ctx = createContext<VaultApi | null>(null)

function readVault(): VaultRecord | null {
  try {
    const raw = localStorage.getItem(VAULT_KEY)
    return raw ? JSON.parse(raw) as VaultRecord : null
  } catch {
    return null
  }
}

function writeVault(v: VaultRecord): void {
  try {
    localStorage.setItem(VAULT_KEY, JSON.stringify(v))
  } catch (err) {
    console.error('Could not write the local vault', err)
    alert('Could not save locally — browser storage may be full. Sync to GitHub or export a backup.')
  }
}

export function VaultProvider({ children }: { children: React.ReactNode }) {
  const [record, setRecord] = useState<VaultRecord | null>(() => readVault())
  const [status, setStatus] = useState<VaultStatus>(() => (readVault()?.doc ? 'locked' : 'new'))
  const [db, setDb] = useState<Database | null>(null)
  const [github, setGithub] = useState<GithubConfig | null>(null)
  const [syncState, setSyncState] = useState<SyncState>('off')
  const [syncMessage, setSyncMessage] = useState('')

  const keyRef = useRef<CryptoKey | null>(null)
  const saltRef = useRef<Uint8Array | null>(null)
  const recordRef = useRef<VaultRecord | null>(record)
  const sigCache = useRef(new Map<string, string>())
  const pushTimer = useRef<number | null>(null)
  const remoteConflict = useRef<Database | null>(null)

  const commit = useCallback((next: VaultRecord) => {
    recordRef.current = next
    setRecord(next)
    writeVault(next)
  }, [])

  /* ------------------------------ unlocking ------------------------------ */

  const create = useCallback(async (passphrase: string) => {
    const salt = randomBytes(16)
    const key = await deriveKey(passphrase, salt)
    const fresh = emptyDatabase()
    const doc = await encryptString(key, salt, JSON.stringify(fresh))
    keyRef.current = key
    saltRef.current = salt
    commit({ salt: toBase64(salt), doc, sync: null, remoteSha: null, lastSyncAt: null, pending: [] })
    setDb(fresh)
    setStatus('unlocked')
  }, [commit])

  const unlock = useCallback(async (passphrase: string) => {
    const v = readVault()
    if (!v?.doc) throw new Error('There is no vault on this device yet.')
    const salt = saltOf(v.doc)
    const key = await deriveKey(passphrase, salt, v.doc.iter)
    // A wrong passphrase fails the AES-GCM tag check rather than yielding junk.
    let plain: string
    try {
      plain = await decryptString(key, v.doc)
    } catch {
      throw new Error('That passphrase does not match this vault.')
    }
    keyRef.current = key
    saltRef.current = salt
    recordRef.current = v
    setRecord(v)
    setDb(migrate(JSON.parse(plain) as Database))

    if (v.sync) {
      try {
        const cfg = JSON.parse(await decryptString(key, v.sync)) as GithubConfig
        setGithub(cfg)
        setSyncState('idle')
      } catch {
        setSyncState('error')
        setSyncMessage('Stored GitHub settings could not be read.')
      }
    }
    setStatus('unlocked')
  }, [])

  const lock = useCallback(() => {
    keyRef.current = null
    saltRef.current = null
    sigCache.current.clear()
    setDb(null)
    setGithub(null)
    setSyncState('off')
    setStatus(readVault()?.doc ? 'locked' : 'new')
  }, [])

  /* ------------------------------ persistence ---------------------------- */

  const writeDoc = useCallback(async (next: Database) => {
    const key = keyRef.current, salt = saltRef.current, cur = recordRef.current
    if (!key || !salt || !cur) return
    const doc = await encryptString(key, salt, JSON.stringify(next))
    commit({ ...cur, doc })
  }, [commit])

  const pushDoc = useCallback(async (): Promise<void> => {
    const key = keyRef.current, cur = recordRef.current
    if (!key || !cur?.doc || !github) return

    setSyncState('syncing')
    setSyncMessage('')
    try {
      // Signature files are write-once, so they go up first and never conflict.
      const stillPending: string[] = []
      for (const ref of cur.pending) {
        const raw = localStorage.getItem(SIG_PREFIX + ref)
        if (!raw) continue
        try {
          await putFile(github, `sig/${ref}.enc`, raw, null, `signature ${ref}`)
        } catch (err) {
          if (!(err instanceof ConflictError)) throw err
          // Already there — nothing to do.
        }
        void stillPending
      }

      const sha = await putFile(
        github, DOC_FILE, JSON.stringify(cur.doc), cur.remoteSha,
        `update ${new Date().toISOString()}`,
      )
      commit({ ...recordRef.current!, remoteSha: sha, lastSyncAt: new Date().toISOString(), pending: [] })
      setSyncState('idle')
    } catch (err) {
      if (err instanceof ConflictError) {
        setSyncState('conflict')
        setSyncMessage('Another device saved changes. Choose which copy to keep.')
        try {
          const remote = await getFile(github, DOC_FILE)
          if (remote) {
            const envelope = JSON.parse(remote.content) as Envelope
            remoteConflict.current = migrate(JSON.parse(await decryptString(key, envelope)) as Database)
            commit({ ...recordRef.current!, remoteSha: remote.sha })
          }
        } catch { /* the resolve step will report it */ }
        return
      }
      setSyncState('error')
      setSyncMessage(err instanceof Error ? err.message : 'Sync failed.')
    }
  }, [github, commit])

  /** Saves locally straight away, then pushes once edits settle. */
  const persist = useCallback((next: Database) => {
    setDb(next)
    void writeDoc(next)
    if (!github) return
    if (pushTimer.current) window.clearTimeout(pushTimer.current)
    pushTimer.current = window.setTimeout(() => { void pushDoc() }, 4000)
  }, [writeDoc, github, pushDoc])

  const replace = useCallback((next: Database) => {
    setDb(next)
    void writeDoc(next)
  }, [writeDoc])

  /* -------------------------------- sync --------------------------------- */

  const connectGithub = useCallback(async (cfg: GithubConfig) => {
    const key = keyRef.current, salt = saltRef.current, cur = recordRef.current
    if (!key || !salt || !cur) throw new Error('Unlock first.')
    const info = await checkAccess(cfg)
    const sync = await encryptString(key, salt, JSON.stringify(cfg))
    commit({ ...cur, sync })
    setGithub(cfg)
    setSyncState('idle')
    return info.private
      ? 'Connected. The repository is private.'
      : 'Connected, but that repository is PUBLIC. Only ciphertext is uploaded, but make it private.'
  }, [commit])

  const disconnectGithub = useCallback(() => {
    const cur = recordRef.current
    if (!cur) return
    commit({ ...cur, sync: null, remoteSha: null })
    setGithub(null)
    setSyncState('off')
  }, [commit])

  const pullRemote = useCallback(async () => {
    const key = keyRef.current
    if (!key || !github) return
    setSyncState('syncing')
    try {
      const remote = await getFile(github, DOC_FILE)
      if (!remote) {
        setSyncState('idle')
        setSyncMessage('Nothing on GitHub yet — the next sync will create it.')
        return
      }
      const envelope = JSON.parse(remote.content) as Envelope
      if (!isEnvelope(envelope)) throw new Error('The file on GitHub is not a vault export.')
      const next = migrate(JSON.parse(await decryptString(key, envelope)) as Database)
      setDb(next)
      await writeDoc(next)
      commit({ ...recordRef.current!, remoteSha: remote.sha, lastSyncAt: new Date().toISOString() })
      setSyncState('idle')
      setSyncMessage('Pulled the copy from GitHub.')
    } catch (err) {
      setSyncState('error')
      setSyncMessage(err instanceof Error ? err.message : 'Could not read from GitHub.')
    }
  }, [github, writeDoc, commit])

  const resolveConflict = useCallback(async (keep: 'mine' | 'theirs') => {
    if (keep === 'theirs' && remoteConflict.current) {
      const next = remoteConflict.current
      setDb(next)
      await writeDoc(next)
      remoteConflict.current = null
      setSyncState('idle')
      setSyncMessage('Kept the copy from GitHub.')
      return
    }
    remoteConflict.current = null
    // Our sha is now the remote one, so this write wins cleanly.
    await pushDoc()
  }, [writeDoc, pushDoc])

  const syncNow = useCallback(async () => { await pushDoc() }, [pushDoc])

  /* ----------------------------- signatures ------------------------------ */

  const saveSignature = useCallback(async (dataUrl: string): Promise<string> => {
    const key = keyRef.current, salt = saltRef.current, cur = recordRef.current
    if (!key || !salt || !cur) throw new Error('Locked.')
    const ref = toBase64(randomBytes(9)).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)
    const envelope = await encryptString(key, salt, dataUrl)
    localStorage.setItem(SIG_PREFIX + ref, JSON.stringify(envelope))
    sigCache.current.set(ref, dataUrl)
    commit({ ...cur, pending: [...cur.pending, ref] })
    return ref
  }, [commit])

  const loadSignature = useCallback(async (ref: string): Promise<string | null> => {
    const cached = sigCache.current.get(ref)
    if (cached) return cached
    const key = keyRef.current
    if (!key) return null

    let raw = localStorage.getItem(SIG_PREFIX + ref)
    if (!raw && github) {
      const remote = await getFile(github, `sig/${ref}.enc`).catch(() => null)
      if (remote) {
        raw = remote.content
        try { localStorage.setItem(SIG_PREFIX + ref, raw) } catch { /* cache is optional */ }
      }
    }
    if (!raw) return null
    try {
      const dataUrl = await decryptString(key, JSON.parse(raw) as Envelope)
      sigCache.current.set(ref, dataUrl)
      return dataUrl
    } catch {
      return null
    }
  }, [github])

  /* ------------------------------- lifecycle ----------------------------- */

  const changePassphrase = useCallback(async (current: string, next: string) => {
    const cur = recordRef.current
    if (!cur?.doc) throw new Error('No vault to change.')
    const oldSalt = saltOf(cur.doc)
    const oldKey = await deriveKey(current, oldSalt, cur.doc.iter)
    let plain: string, syncPlain: string | null = null
    try {
      plain = await decryptString(oldKey, cur.doc)
      if (cur.sync) syncPlain = await decryptString(oldKey, cur.sync)
    } catch {
      throw new Error('The current passphrase is wrong.')
    }
    const salt = randomBytes(16)
    const key = await deriveKey(next, salt)
    const doc = await encryptString(key, salt, plain)
    const sync = syncPlain ? await encryptString(key, salt, syncPlain) : null

    // Signatures are encrypted under the old key too, so re-wrap what we hold.
    for (const k of Object.keys(localStorage).filter(k => k.startsWith(SIG_PREFIX))) {
      try {
        const sig = await decryptString(oldKey, JSON.parse(localStorage.getItem(k)!) as Envelope)
        localStorage.setItem(k, JSON.stringify(await encryptString(key, salt, sig)))
      } catch { /* leave anything we cannot read */ }
    }

    keyRef.current = key
    saltRef.current = salt
    // Every signature file on GitHub is now stale, so mark them all for re-upload.
    const refs = Object.keys(localStorage)
      .filter(k => k.startsWith(SIG_PREFIX))
      .map(k => k.slice(SIG_PREFIX.length))
    commit({ ...cur, salt: toBase64(salt), doc, sync, pending: refs, remoteSha: null })
  }, [commit])

  const verify = useCallback(async (passphrase: string): Promise<boolean> => {
    const cur = recordRef.current
    if (!cur?.doc) return false
    try {
      const key = await deriveKey(passphrase, saltOf(cur.doc), cur.doc.iter)
      await decryptString(key, cur.doc)
      return true
    } catch {
      return false
    }
  }, [])

  const destroy = useCallback(() => {
    for (const k of Object.keys(localStorage)) {
      if (k === VAULT_KEY || k.startsWith(SIG_PREFIX)) localStorage.removeItem(k)
    }
    keyRef.current = null
    saltRef.current = null
    recordRef.current = null
    sigCache.current.clear()
    setRecord(null)
    setDb(null)
    setGithub(null)
    setSyncState('off')
    setStatus('new')
  }, [])

  // Flush any debounced push when the tab goes away.
  useEffect(() => {
    const flush = () => {
      if (pushTimer.current) {
        window.clearTimeout(pushTimer.current)
        pushTimer.current = null
        void pushDoc()
      }
    }
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [pushDoc])

  const api = useMemo<VaultApi>(() => ({
    status, db, syncState, syncMessage,
    lastSyncAt: record?.lastSyncAt ?? null,
    pendingCount: record?.pending.length ?? 0,
    github,
    create, unlock, lock, changePassphrase, verify,
    persist, replace,
    connectGithub, disconnectGithub, syncNow, pullRemote, resolveConflict,
    saveSignature, loadSignature,
    newRecoveryKey: generateRecoveryKey,
    destroy,
  }), [
    status, db, syncState, syncMessage, record, github,
    create, unlock, lock, changePassphrase, verify, persist, replace,
    connectGithub, disconnectGithub, syncNow, pullRemote, resolveConflict,
    saveSignature, loadSignature, destroy,
  ])

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function useVault(): VaultApi {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useVault must be used inside <VaultProvider>')
  return ctx
}

export { fromBase64 }
