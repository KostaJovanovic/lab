/* Analyser - lazy xz (LZMA2) decompressor.

   Wraps the vendored xzwasm UMD bundle (assets/vendor/xzwasm/xzwasm.min.js),
   loaded on demand the first time an .xz / .tar.xz / xz-compressed package member
   is opened. xzwasm exposes `XzReadableStream` (a ReadableStream subclass that
   wraps a compressed ReadableStream and yields decompressed bytes via the WASM
   build of xz-embedded). The .wasm is embedded in the JS as a base64 data URI,
   so there is no separate file to host.

   No top-level side effects: the script is only injected when xzDecompress runs. */

import { loadScript } from '../core/util.js';

// Hard cap on decompressed output so a tiny "xz bomb" can't exhaust memory.
const MAX_OUTPUT = 256 * 1024 * 1024; // 256 MB

// Decompress an xz byte buffer. Returns the decompressed Uint8Array, or null on
// any failure (unsupported, corrupt, over the cap, or wasm load error) so callers
// can fall back to header-only parsing.
export async function xzDecompress(bytes) {
  try {
    if (!(window.xzwasm && window.xzwasm.XzReadableStream)) {
      await loadScript('assets/vendor/xzwasm/xzwasm.min.js');
    }
    const XzReadableStream = window.xzwasm && window.xzwasm.XzReadableStream;
    if (typeof XzReadableStream !== 'function') return null;

    const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

    // Feed the compressed bytes in as a one-shot ReadableStream; xzwasm pulls
    // from it and emits decompressed chunks through the Streams API.
    const compressedStream = new Response(input).body;
    if (!compressedStream) return null;

    const reader = new XzReadableStream(compressedStream).getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength) {
        // The WASM reuses one output buffer across pulls, so copy each chunk.
        chunks.push(value.slice());
        total += value.byteLength;
        if (total > MAX_OUTPUT) {
          try { await reader.cancel(); } catch (_) {}
          return null;
        }
      }
    }
    if (!total) return new Uint8Array(0);

    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.byteLength; }
    return out;
  } catch (_) {
    return null;
  }
}
