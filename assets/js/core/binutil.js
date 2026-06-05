/* Analyser - shared binary-parsing toolkit.

   Building blocks reused by the lazy parser chunks (parsers-<domain>.js) and the
   deepened renderers: a cursor-based DataView reader, byte/magic helpers, text
   decoders (UTF-16, CP437, latin1), and DecompressionStream wrappers. Keep this
   dependency-free and side-effect-free so it stays cheap to import. */

// ---------- cursor reader ----------
// Sequential reader over an ArrayBuffer / Uint8Array. Big-endian by default
// (network/most container order); pass little:true for LE formats. Multi-byte
// reads advance the cursor; the *At variants don't.
export class Reader {
  constructor(buf, little = false) {
    if (buf instanceof Uint8Array) {
      this.bytes = buf;
      this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    } else if (buf instanceof ArrayBuffer) {
      this.bytes = new Uint8Array(buf);
      this.view = new DataView(buf);
    } else {
      throw new TypeError('Reader expects ArrayBuffer or Uint8Array');
    }
    this.pos = 0;
    this.little = !!little;
    this.length = this.bytes.length;
  }
  get eof() { return this.pos >= this.length; }
  remaining() { return this.length - this.pos; }
  seek(p) { this.pos = p; return this; }
  skip(n) { this.pos += n; return this; }
  tell() { return this.pos; }
  le(on = true) { this.little = on; return this; }

  u8()  { return this.view.getUint8(this.pos++); }
  i8()  { return this.view.getInt8(this.pos++); }
  u16() { const v = this.view.getUint16(this.pos, this.little); this.pos += 2; return v; }
  i16() { const v = this.view.getInt16(this.pos, this.little); this.pos += 2; return v; }
  u24() {
    const a = this.u8(), b = this.u8(), c = this.u8();
    return this.little ? (a | (b << 8) | (c << 16)) : ((a << 16) | (b << 8) | c);
  }
  u32() { const v = this.view.getUint32(this.pos, this.little); this.pos += 4; return v >>> 0; }
  i32() { const v = this.view.getInt32(this.pos, this.little); this.pos += 4; return v; }
  u64() { const v = this.view.getBigUint64(this.pos, this.little); this.pos += 8; return v; }
  f32() { const v = this.view.getFloat32(this.pos, this.little); this.pos += 4; return v; }
  f64() { const v = this.view.getFloat64(this.pos, this.little); this.pos += 8; return v; }

  u16At(p) { return this.view.getUint16(p, this.little); }
  u32At(p) { return this.view.getUint32(p, this.little) >>> 0; }

  // Number from a 64-bit unsigned, clamped to a safe JS integer (good enough for
  // file sizes / sample counts where exactness beyond 2^53 doesn't matter).
  u64num() { const v = this.u64(); return v <= 9007199254740991n ? Number(v) : Number(v); }

  bytes_(n) { const b = this.bytes.subarray(this.pos, this.pos + n); this.pos += n; return b; }
  ascii(n)  { const s = ascii(this.bytes, this.pos, n); this.pos += n; return s; }
  // Read a fixed-length latin1 string (advances n).
  latin1(n) { const s = latin1(this.bytes.subarray(this.pos, this.pos + n)); this.pos += n; return s; }
  // Null-terminated ASCII string starting at the cursor (advances past the NUL).
  cstr(max = Infinity) {
    let s = '';
    while (!this.eof && s.length < max) {
      const c = this.u8();
      if (c === 0) break;
      if (c >= 32 && c < 127) s += String.fromCharCode(c);
    }
    return s;
  }
}

// ---------- byte / magic helpers ----------

// True if `sig` (array/Uint8Array of bytes; null entries = wildcard) matches
// `buf` at `offset`.
export function matchMagic(buf, sig, offset = 0) {
  if (offset + sig.length > buf.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (sig[i] == null) continue;
    if (buf[offset + i] !== sig[i]) return false;
  }
  return true;
}

// True if the buffer begins with the given ASCII string.
export function startsWithAscii(buf, str, offset = 0) {
  for (let i = 0; i < str.length; i++) {
    if (buf[offset + i] !== str.charCodeAt(i)) return false;
  }
  return true;
}

// Index of the first occurrence of `needle` (array/Uint8Array) in `buf` at or
// after `start`, or -1. Plain byte scan - fine for headers, not huge files.
export function findBytes(buf, needle, start = 0, end = buf.length) {
  const n = needle.length;
  const last = Math.min(end, buf.length) - n;
  outer: for (let i = start; i <= last; i++) {
    for (let j = 0; j < n; j++) if (buf[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

// Printable-ASCII slice (control/8-bit chars dropped).
export function ascii(buf, start = 0, len = buf.length - start) {
  let s = '';
  const end = Math.min(start + len, buf.length);
  for (let i = start; i < end; i++) {
    const c = buf[i];
    if (c >= 32 && c < 127) s += String.fromCharCode(c);
  }
  return s;
}

// ---------- text decoders ----------

export function latin1(bytes) {
  return new TextDecoder('latin1').decode(bytes);
}
export function utf8(bytes) {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}
export function utf16(bytes, little = true) {
  return new TextDecoder(little ? 'utf-16le' : 'utf-16be').decode(bytes);
}

// CP437 (original IBM PC / OEM code page) - needed for .nfo scene art and other
// DOS-era text so box-drawing and accented characters survive.
const CP437_HIGH = [
  0x00C7,0x00FC,0x00E9,0x00E2,0x00E4,0x00E0,0x00E5,0x00E7,0x00EA,0x00EB,0x00E8,0x00EF,0x00EE,0x00EC,0x00C4,0x00C5,
  0x00C9,0x00E6,0x00C6,0x00F4,0x00F6,0x00F2,0x00FB,0x00F9,0x00FF,0x00D6,0x00DC,0x00A2,0x00A3,0x00A5,0x20A7,0x0192,
  0x00E1,0x00ED,0x00F3,0x00FA,0x00F1,0x00D1,0x00AA,0x00BA,0x00BF,0x2310,0x00AC,0x00BD,0x00BC,0x00A1,0x00AB,0x00BB,
  0x2591,0x2592,0x2593,0x2502,0x2524,0x2561,0x2562,0x2556,0x2555,0x2563,0x2551,0x2557,0x255D,0x255C,0x255B,0x2510,
  0x2514,0x2534,0x252C,0x251C,0x2500,0x253C,0x255E,0x255F,0x255A,0x2554,0x2569,0x2566,0x2560,0x2550,0x256C,0x2567,
  0x2568,0x2564,0x2565,0x2559,0x2558,0x2552,0x2553,0x256B,0x256A,0x2518,0x250C,0x2588,0x2584,0x258C,0x2590,0x2580,
  0x03B1,0x00DF,0x0393,0x03C0,0x03A3,0x03C3,0x00B5,0x03C4,0x03A6,0x0398,0x03A9,0x03B4,0x221E,0x03C6,0x03B5,0x2229,
  0x2261,0x00B1,0x2265,0x2264,0x2320,0x2321,0x00F7,0x2248,0x00B0,0x2219,0x00B7,0x221A,0x207F,0x00B2,0x25A0,0x00A0
];
export function cp437(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    if (c === 0x09 || c === 0x0A || c === 0x0D) { s += String.fromCharCode(c); continue; }
    if (c < 0x20) continue;                       // drop other control bytes
    s += c < 0x80 ? String.fromCharCode(c) : String.fromCharCode(CP437_HIGH[c - 0x80]);
  }
  return s;
}

// ---------- decompression ----------

// Inflate a stream via the browser's DecompressionStream. `format` is
// 'gzip' | 'deflate' | 'deflate-raw'. Returns a Uint8Array, or null if the
// platform lacks DecompressionStream or the data is corrupt.
export async function inflate(bytes, format = 'gzip') {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const ds = new DecompressionStream(format);
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    const out = new Uint8Array(await new Response(stream).arrayBuffer());
    return out;
  } catch (_) {
    return null;
  }
}
export const gunzip = (bytes) => inflate(bytes, 'gzip');

// ---------- misc formatters used by binary parsers ----------

// FILETIME (100-ns ticks since 1601-01-01 UTC) -> JS Date, or null.
export function filetimeToDate(lo, hi) {
  const ticks = (BigInt(hi >>> 0) << 32n) | BigInt(lo >>> 0);
  if (ticks === 0n) return null;
  const ms = ticks / 10000n - 11644473600000n;
  const n = Number(ms);
  return Number.isFinite(n) ? new Date(n) : null;
}

// Format a GUID from 16 bytes (mixed-endian, as stored in MS structures).
export function fmtGuid(b, off = 0) {
  const h = (i) => b[off + i].toString(16).padStart(2, '0');
  return (
    h(3) + h(2) + h(1) + h(0) + '-' + h(5) + h(4) + '-' + h(7) + h(6) + '-' +
    h(8) + h(9) + '-' + h(10) + h(11) + h(12) + h(13) + h(14) + h(15)
  ).toUpperCase();
}
