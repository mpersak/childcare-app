import { deriveKey, encryptString, decryptString, randomBytes, toBase64, fromBase64, type Envelope } from './crypto'

/**
 * PIN unlock.
 *
 * A PIN is short, so on its own it would be a disaster: 10,000 combinations is
 * an offline brute force in milliseconds for anyone who copies localStorage.
 *
 * So the passphrase is wrapped twice. First under a key stretched from the PIN,
 * then again under a random AES key that lives in IndexedDB as a
 * **non-extractable** CryptoKey — the browser never exposes its bytes to
 * JavaScript, and it cannot be copied out with the rest of the stored data.
 * Getting in therefore needs both the PIN and code running in this origin on
 * this device, rather than a stolen file.
 *
 * This is still weaker than the passphrase, and it is meant to be: it trades
 * some strength for not typing 20 characters at the door. The passphrase
 * remains the only thing protecting the data on GitHub, and the only way back
 * in if the PIN wrapper is cleared.
 */

const DB_NAME = 'childcare-device'
const STORE = 'keys'
const KEY_ID = 'wrapper-v1'
const PIN_ITERATIONS = 300_000

/** Attempts allowed before the PIN wrapper is destroyed and the passphrase is required. */
export const MAX_PIN_ATTEMPTS = 5

export interface PinWrapper {
  /** Passphrase encrypted under the PIN, then under the device key. */
  outer: Envelope
  pinSalt: string
  attempts: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Could not open the device key store.'))
  })
}

function idbGet(db: IDBDatabase, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function idbPut(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

function idbDelete(db: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

/**
 * The device key. Generated with `extractable: false`, so even this app cannot
 * read its bytes — it can only ask the browser to encrypt and decrypt with it.
 */
async function getDeviceKey(create: boolean): Promise<CryptoKey | null> {
  const db = await openDb()
  const existing = await idbGet(db, KEY_ID)
  if (existing) return existing as CryptoKey
  if (!create) return null

  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable: the whole point
    ['encrypt', 'decrypt'],
  )
  await idbPut(db, KEY_ID, key)
  return key
}

export async function forgetDeviceKey(): Promise<void> {
  try {
    await idbDelete(await openDb(), KEY_ID)
  } catch {
    /* nothing to remove */
  }
}

async function wrapWithDevice(deviceKey: CryptoKey, plaintext: string): Promise<Envelope> {
  const iv = randomBytes(12)
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    deviceKey,
    new TextEncoder().encode(plaintext),
  )
  return {
    v: 1, kdf: 'PBKDF2-SHA256', iter: 0,
    salt: '', iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)),
  }
}

async function unwrapWithDevice(deviceKey: CryptoKey, envelope: Envelope): Promise<string> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(envelope.iv) as BufferSource },
    deviceKey,
    fromBase64(envelope.ct) as BufferSource,
  )
  return new TextDecoder().decode(plain)
}

/** Called once, while unlocked, with the passphrase the user has just confirmed. */
export async function createPinWrapper(passphrase: string, pin: string): Promise<PinWrapper> {
  const deviceKey = await getDeviceKey(true)
  if (!deviceKey) throw new Error('This browser cannot store a device key, so PIN unlock is unavailable.')

  const pinSalt = randomBytes(16)
  const pinKey = await deriveKey(pin, pinSalt, PIN_ITERATIONS)
  const inner = await encryptString(pinKey, pinSalt, passphrase)
  const outer = await wrapWithDevice(deviceKey, JSON.stringify(inner))

  return { outer, pinSalt: toBase64(pinSalt), attempts: 0 }
}

/** Returns the passphrase, or null when the PIN is wrong. */
export async function passphraseFromPin(wrapper: PinWrapper, pin: string): Promise<string | null> {
  const deviceKey = await getDeviceKey(false)
  if (!deviceKey) return null

  let inner: Envelope
  try {
    inner = JSON.parse(await unwrapWithDevice(deviceKey, wrapper.outer)) as Envelope
  } catch {
    // The device key does not match this wrapper — a copied profile, or a reset.
    return null
  }

  try {
    const pinKey = await deriveKey(pin, fromBase64(wrapper.pinSalt), PIN_ITERATIONS)
    return await decryptString(pinKey, inner)
  } catch {
    return null
  }
}

export function pinLooksValid(pin: string): boolean {
  return /^\d{4,8}$/.test(pin)
}
