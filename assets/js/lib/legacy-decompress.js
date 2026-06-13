/* Analyser - small pure-JS decompressors for single-stream legacy codecs.

   Two compact, dependency-free decoders for bare (non-tar) compressed files that
   the bundled libarchive engine cannot open on its own:

   - unlz4()  : the modern LZ4 frame format (magic 04 22 4D 18), as written by the
                `lz4` CLI. Skippable/legacy frames are not handled.
   - unlzw()  : Unix `compress` / .Z (magic 1F 9D), the classic variable-width LZW
                with the compress(1) bit-group padding at each code-width change.

   Both take the full file bytes (header included) and return a Uint8Array, or
   null if the input is malformed / not the expected format, so callers can fall
   back to header-only identification. A hard output cap guards against
   decompression bombs. (Legacy .lzma lives in lzma-loader.js; gzip/xz/zstd are
   handled elsewhere.) */

const MAX_OUTPUT = 256 * 1024 * 1024;   // 256 MB ceiling on decompressed output

// Growable output buffer helper shared by both decoders.
function makeSink() {
  let buf = new Uint8Array(1 << 16);
  let len = 0;
  return {
    ensure(n) {
      if (len + n > MAX_OUTPUT) throw new Error('output too large');
      if (len + n <= buf.length) return;
      let cap = buf.length;
      while (cap < len + n) cap *= 2;
      const nb = new Uint8Array(cap);
      nb.set(buf.subarray(0, len));
      buf = nb;
    },
    push(b) { this.ensure(1); buf[len++] = b; },
    set(src, from, count) { this.ensure(count); buf.set(src.subarray(from, from + count), len); len += count; },
    get pos() { return len; },
    byte(i) { return buf[i]; },
    copy(from, count) { this.ensure(count); let s = from; for (let k = 0; k < count; k++) buf[len++] = buf[s++]; },
    result() { return buf.subarray(0, len); },
  };
}

// ---- LZ4 frame ----------------------------------------------------------------
// https://github.com/lz4/lz4/blob/dev/doc/lz4_Frame_format.md
export function unlz4(input) {
  try {
    const b = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (b.length < 7) return null;
    if (!(b[0] === 0x04 && b[1] === 0x22 && b[2] === 0x4D && b[3] === 0x18)) return null;

    let p = 4;
    const flg = b[p++];
    p++;                                  // BD (block max size) - not needed to decode
    if (((flg >> 6) & 0x03) !== 1) return null;   // version must be 01
    const contentSize = (flg >> 3) & 1;
    const contentChecksum = (flg >> 2) & 1;
    const blockChecksum = (flg >> 4) & 1;
    const dictId = flg & 1;
    if (contentSize) p += 8;
    if (dictId) p += 4;
    p += 1;                               // HC (header checksum) - skip verifying

    const sink = makeSink();
    while (p + 4 <= b.length) {
      const blockSize = (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;
      p += 4;
      if (blockSize === 0) break;         // EndMark
      const uncompressed = (blockSize & 0x80000000) !== 0;
      const size = blockSize & 0x7FFFFFFF;
      if (p + size > b.length) return null;

      if (uncompressed) {
        sink.set(b, p, size);
        p += size;
      } else {
        const end = p + size;
        let i = p;
        while (i < end) {
          const token = b[i++];
          let litLen = token >> 4;
          if (litLen === 15) { let x; do { x = b[i++]; litLen += x; } while (x === 255); }
          sink.set(b, i, litLen);
          i += litLen;
          if (i >= end) break;            // last sequence is literals only
          const offset = b[i] | (b[i + 1] << 8);
          i += 2;
          if (offset === 0 || offset > sink.pos) return null;
          let matchLen = token & 0x0F;
          if (matchLen === 15) { let x; do { x = b[i++]; matchLen += x; } while (x === 255); }
          matchLen += 4;                  // minmatch
          sink.copy(sink.pos - offset, matchLen);
        }
        p = end;
      }
      if (blockChecksum) p += 4;
    }
    if (contentChecksum) p += 4;
    return sink.result();
  } catch (_) {
    return null;
  }
}

// ---- Unix compress / .Z (LZW) -------------------------------------------------
// Mirrors compress(1): codes are variable-width (9..maxbits), packed LSB-first,
// and at every code-width increase or table clear the encoder pads to the next
// (n_bits * 8)-bit group boundary, which the decoder must skip in step.
export function unlzw(input) {
  try {
    const b = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (b.length < 3 || b[0] !== 0x1F || b[1] !== 0x9D) return null;
    const maxbits = b[2] & 0x1F;
    const blockMode = (b[2] & 0x80) !== 0;
    if (maxbits < 9 || maxbits > 16) return null;

    const INIT_BITS = 9, CLEAR = 256, FIRST = 257;
    const maxmaxcode = 1 << maxbits;
    const prefix = new Int32Array(maxmaxcode);
    const suffix = new Uint8Array(maxmaxcode);
    for (let i = 0; i < 256; i++) suffix[i] = i;
    const stack = new Uint8Array(maxmaxcode + 2);
    const sink = makeSink();

    const dataOff = 3;
    const n = b.length;
    // compress(1) measures its bit-group padding from a moving origin that resets
    // (the input buffer is "shifted") at every code-width change and table clear.
    // `base` is the byte offset of that origin; `posbits` is the bit offset from it.
    let base = dataOff;
    let posbits = 0;
    let n_bits = INIT_BITS;
    let maxcode = (1 << n_bits) - 1;
    let free_ent = blockMode ? FIRST : 256;
    let oldcode = -1, finchar = 0;

    // Round posbits up to the next (n_bits*8) group boundary, then re-origin so the
    // next width's groups are measured afresh (mirrors ncompress's resetbuf shift).
    const realign = () => {
      const g = n_bits << 3;
      posbits = (posbits - 1) + (g - ((posbits - 1 + g) % g));
      base += posbits >> 3;
      posbits = 0;
    };
    const readCode = () => {
      const p = base + (posbits >> 3);
      const r = ((b[p] || 0) | ((b[p + 1] || 0) << 8) | ((b[p + 2] || 0) << 16)) >>> (posbits & 7);
      return r & ((1 << n_bits) - 1);
    };

    while (posbits + n_bits <= (n - base) * 8) {
      if (free_ent > maxcode) {
        realign();
        n_bits++;
        maxcode = (n_bits === maxbits) ? maxmaxcode : (1 << n_bits) - 1;
        continue;
      }
      const code = readCode();
      posbits += n_bits;

      if (oldcode === -1) {
        if (code >= 256) return null;
        finchar = code; oldcode = code;
        sink.push(finchar);
        continue;
      }
      if (code === CLEAR && blockMode) {
        free_ent = FIRST - 1;
        realign();
        n_bits = INIT_BITS;
        maxcode = (1 << n_bits) - 1;
        continue;
      }

      let c = code, sp = 0;
      if (c >= free_ent) {                // KwKwK special case
        if (c > free_ent) return null;
        stack[sp++] = finchar;
        c = oldcode;
      }
      while (c >= 256) { stack[sp++] = suffix[c]; c = prefix[c]; }
      finchar = suffix[c];
      stack[sp++] = finchar;
      sink.ensure(sp);
      while (sp > 0) sink.push(stack[--sp]);

      if (free_ent < maxmaxcode) {
        prefix[free_ent] = oldcode;
        suffix[free_ent] = finchar;
        free_ent++;
      }
      oldcode = code;
    }
    return sink.result();
  } catch (_) {
    return null;
  }
}
