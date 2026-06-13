/* Analyser - lazy LZMA-alone (.lzma) decompressor.

   Wraps the vendored js-lzma decode-only core (assets/vendor/lzma/lzma-decode.js
   by Juan Mellado, MIT), loaded on demand the first time a bare .lzma stream is
   opened. The core exposes a global `LZMA` namespace with a Decoder that reads
   the 13-byte legacy "LZMA alone" header (properties + dictionary size + 64-bit
   uncompressed size) and emits bytes through a tiny write-stream interface. The
   core ships without the io stream classes, so we supply minimal ones here.

   This is the legacy single-stream .lzma container, NOT .xz (LZMA2) - that path
   stays in xz-loader.js. No top-level side effects: the script is only injected
   when lzmaDecompress runs. */

import { loadScript } from '../core/util.js';

// Hard caps so a tiny "decompression bomb" can't exhaust memory: a maximum
// decompressed size, and a refusal to allocate an absurd dictionary window.
const MAX_OUTPUT = 256 * 1024 * 1024;   // 256 MB of output
const MAX_DICT = 128 * 1024 * 1024;     // 128 MB dictionary window

// Decompress a legacy .lzma byte buffer. Returns the decompressed Uint8Array, or
// null on any failure (unsupported, corrupt, over a cap, or load error) so the
// caller can fall back to header-only identification.
export async function lzmaDecompress(bytes) {
  try {
    if (!(window.LZMA && window.LZMA.Decoder)) {
      await loadScript('assets/vendor/lzma/lzma-decode.js');
    }
    const LZMA = window.LZMA;
    if (!LZMA || typeof LZMA.Decoder !== 'function') return null;

    const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (input.length < 13) return null;

    // Input stream: byte-at-a-time reader; reads past the end yield 0 (the
    // end-of-stream marker terminates decoding well before that).
    const inStream = {
      data: input,
      offset: 0,
      size: input.length,
      readByte() { return this.offset < this.size ? this.data[this.offset++] : 0; },
    };

    // Output stream: collect window flushes (the WASM-free core reuses one window
    // buffer, so each chunk must be copied) and enforce the output cap.
    let total = 0;
    const chunks = [];
    const outStream = {
      writeBytes(buf, len) {
        if (total + len > MAX_OUTPUT) throw new Error('lzma output too large');
        chunks.push(buf.slice(0, len));
        total += len;
      },
      writeByte(b) {
        if (total + 1 > MAX_OUTPUT) throw new Error('lzma output too large');
        chunks.push(new Uint8Array([b]));
        total += 1;
      },
    };

    const decoder = new LZMA.Decoder();
    const header = decoder.decodeHeader(inStream);
    if (!header) return null;
    if (!(header.dictionarySize >= 0) || header.dictionarySize > MAX_DICT) return null;
    decoder.setProperties(header);

    // The core reads only the low 32 bits of the 64-bit size; 0xFFFFFFFF is the
    // "size unknown" sentinel, decoded to the end-of-stream marker instead.
    let maxSize = header.uncompressedSize;
    if (!(maxSize >= 0) || maxSize >= 0xFFFFFFFF) maxSize = -1;

    if (!decoder.decodeBody(inStream, outStream, maxSize)) return null;
    if (!total) return new Uint8Array(0);

    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  } catch (_) {
    return null;
  }
}
