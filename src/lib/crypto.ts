/**
 * Client-side encryption. Everything that leaves this device is ciphertext.
 *
 * PBKDF2-SHA256 to stretch the passphrase, then AES-GCM for the payload.
 * AES-GCM is authenticated, so a wrong passphrase fails to decrypt rather than
 * returning junk — that is what the unlock screen relies on.
 */

export const KDF_ITERATIONS = 600_000

export interface Envelope {
  v: 1
  kdf: 'PBKDF2-SHA256'
  iter: number
  salt: string
  iv: string
  ct: string
}

const enc = new TextEncoder()
const dec = new TextDecoder()

function toBase64(bytes: Uint8Array): string {
  let s = ''
  // Chunked: String.fromCharCode(...bigArray) blows the call stack on large payloads.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(s)
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n))
}

export async function deriveKey(passphrase: string, salt: Uint8Array, iter = KDF_ITERATIONS): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: iter, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** A fresh salt per vault; kept alongside the ciphertext so any device can re-derive. */
export async function encryptString(key: CryptoKey, salt: Uint8Array, plaintext: string): Promise<Envelope> {
  const iv = randomBytes(12)
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    enc.encode(plaintext),
  )
  return {
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iter: KDF_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ct: toBase64(new Uint8Array(ct)),
  }
}

export async function decryptString(key: CryptoKey, envelope: Envelope): Promise<string> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(envelope.iv) as BufferSource },
    key,
    fromBase64(envelope.ct) as BufferSource,
  )
  return dec.decode(plain)
}

export function saltOf(envelope: Envelope): Uint8Array {
  return fromBase64(envelope.salt)
}

export function isEnvelope(value: unknown): value is Envelope {
  const e = value as Envelope
  return !!e && typeof e === 'object' && e.v === 1 && typeof e.ct === 'string' && typeof e.salt === 'string'
}

/**
 * Hash for the teacher PIN.
 *
 * This guards a *mode switch*, not the data: by the time it is checked the vault
 * is already unlocked and the key is in memory. It stops a parent at the door
 * idly tapping into the records; it is not, and cannot be, a defence against
 * someone with the decrypted document. Hashed anyway so a PIN never appears in
 * a plaintext backup export.
 */
export async function hashPin(pin: string, salt: Uint8Array): Promise<string> {
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 100_000, hash: 'SHA-256' },
    base,
    256,
  )
  return toBase64(new Uint8Array(bits))
}

/** Constant-time-ish comparison; both sides are fixed-length base64 here. */
export function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * A printable recovery key. The passphrase is the only way into the data, so
 * this exists to be written down and stored somewhere physical.
 */
export function generateRecoveryKey(): string {
  const bytes = randomBytes(20)
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no I/O/0/1
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    if (i > 0 && i % 5 === 0) out += '-'
    out += alphabet[bytes[i] % alphabet.length]
  }
  return out
}

export { toBase64, fromBase64 }
