/**
 * A minimal store-only (uncompressed) ZIP writer.
 *
 * Hand-rolled rather than pulled from npm: the backup bundle is the one artefact
 * that has to keep working years from now, and a 100-line writer with no
 * dependencies is easier to trust than a supply chain.
 */

export interface ZipEntry {
  name: string
  data: Uint8Array
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** MS-DOS date/time, which is what the ZIP header carries. */
function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2)),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

class Writer {
  private parts: Uint8Array[] = []
  length = 0

  push(bytes: Uint8Array) {
    this.parts.push(bytes)
    this.length += bytes.length
  }

  u16(n: number) {
    const b = new Uint8Array(2)
    new DataView(b.buffer).setUint16(0, n & 0xffff, true)
    this.push(b)
  }

  u32(n: number) {
    const b = new Uint8Array(4)
    new DataView(b.buffer).setUint32(0, n >>> 0, true)
    this.push(b)
  }

  concat(): Uint8Array {
    const out = new Uint8Array(this.length)
    let at = 0
    for (const p of this.parts) { out.set(p, at); at += p.length }
    return out
  }
}

export function makeZip(entries: ZipEntry[], now = new Date()): Blob {
  const { time, date } = dosDateTime(now)
  const enc = new TextEncoder()
  const out = new Writer()
  const central: { name: Uint8Array; crc: number; size: number; offset: number }[] = []

  for (const entry of entries) {
    const name = enc.encode(entry.name)
    const crc = crc32(entry.data)
    const offset = out.length

    out.u32(0x04034b50)   // local file header
    out.u16(20)           // version needed
    out.u16(0x0800)       // UTF-8 filenames
    out.u16(0)            // stored, no compression
    out.u16(time)
    out.u16(date)
    out.u32(crc)
    out.u32(entry.data.length)
    out.u32(entry.data.length)
    out.u16(name.length)
    out.u16(0)
    out.push(name)
    out.push(entry.data)

    central.push({ name, crc, size: entry.data.length, offset })
  }

  const centralStart = out.length
  for (const e of central) {
    out.u32(0x02014b50)   // central directory header
    out.u16(20)           // version made by
    out.u16(20)           // version needed
    out.u16(0x0800)
    out.u16(0)
    out.u16(time)
    out.u16(date)
    out.u32(e.crc)
    out.u32(e.size)
    out.u32(e.size)
    out.u16(e.name.length)
    out.u16(0)            // extra
    out.u16(0)            // comment
    out.u16(0)            // disk number
    out.u16(0)            // internal attrs
    out.u32(0)            // external attrs
    out.u32(e.offset)
    out.push(e.name)
  }
  const centralSize = out.length - centralStart

  out.u32(0x06054b50)     // end of central directory
  out.u16(0)
  out.u16(0)
  out.u16(central.length)
  out.u16(central.length)
  out.u32(centralSize)
  out.u32(centralStart)
  out.u16(0)

  return new Blob([out.concat() as BlobPart], { type: 'application/zip' })
}

export function textEntry(name: string, text: string): ZipEntry {
  return { name, data: new TextEncoder().encode(text) }
}

/** Turns a `data:` URL into raw bytes for storing in the archive. */
export function dataUrlEntry(name: string, dataUrl: string): ZipEntry | null {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return null
  const bin = atob(dataUrl.slice(comma + 1))
  const data = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i)
  return { name, data }
}
