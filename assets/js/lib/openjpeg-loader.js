/* Analyser - lazy OpenJPEG (JPEG 2000) decoder glue.

   Wraps the vendored @cornerstonejs/codec-openjpeg Emscripten build
   (assets/vendor/openjpeg/openjpegwasm.js + .wasm). The factory and the
   decoder instance are created on first use and cached, so the ~360 KB WASM
   is only fetched when a JPEG 2000 file is actually opened.

   Public API:
     decodeJ2K(bytes: Uint8Array)
       -> { width, height, components, bitDepth, rgba: Uint8ClampedArray }
        | null   (on any failure)

   The cornerstone J2KDecoder API (confirmed against the vendored build):
     const mod = await OpenJPEGWASM({ locateFile });
     const dec = new mod.J2KDecoder();
     const enc = dec.getEncodedBuffer(len);   // HEAP view to fill
     enc.set(bytes);
     dec.decode();
     const info = dec.getFrameInfo();          // {width,height,bitsPerSample,componentCount,isSigned}
     const out  = dec.getDecodedBuffer();      // interleaved samples, ceil(bits/8) bytes each
*/

import { loadScript } from '../core/util.js';

// Paths to the vendored assets, relative to the document (works from / and
// /about.html — both live at the site root).
const WASM_URL = 'assets/vendor/openjpeg/openjpegwasm.wasm';
const JS_URL = 'assets/vendor/openjpeg/openjpegwasm.js';

let _modulePromise = null;   // cached Promise<EmscriptenModule>

// Lazily load the Emscripten factory and instantiate the module once.
async function getModule() {
  if (_modulePromise) return _modulePromise;
  _modulePromise = (async () => {
    // The vendored file is a UMD/Emscripten build: loaded as a classic <script>
    // it assigns the factory to the global `OpenJPEGWASM`.
    await loadScript(JS_URL);
    const factory = (typeof globalThis !== 'undefined' && globalThis.OpenJPEGWASM) || null;
    if (typeof factory !== 'function') {
      throw new Error('OpenJPEG factory not found');
    }
    return factory({
      locateFile: (path) => (path && path.endsWith('.wasm')) ? WASM_URL : path,
    });
  })();
  // Don't cache a rejected promise — allow a later retry.
  _modulePromise.catch(() => { _modulePromise = null; });
  return _modulePromise;
}

// Scale a single sample from `bitDepth` bits down to 8-bit (0..255).
function scaleTo8(v, bitDepth) {
  if (bitDepth <= 8) return v & 0xff;
  const shift = bitDepth - 8;
  return (v >> shift) & 0xff;
}

/* Decode a JPEG 2000 codestream/JP2 to RGBA. Returns null on any failure. */
export async function decodeJ2K(bytes) {
  let decoder = null;
  try {
    if (!bytes || !bytes.length) return null;
    const mod = await getModule();
    if (!mod || typeof mod.J2KDecoder !== 'function') return null;

    decoder = new mod.J2KDecoder();

    // Copy the encoded bytes into the decoder's HEAP-backed buffer.
    const encoded = decoder.getEncodedBuffer(bytes.length);
    encoded.set(bytes);

    decoder.decode();

    const info = decoder.getFrameInfo();
    const width = info.width | 0;
    const height = info.height | 0;
    const components = info.componentCount | 0;
    const bitDepth = info.bitsPerSample | 0;
    if (!width || !height || width > 65535 || height > 65535) return null;
    if (components < 1 || components > 4) return null;

    const decoded = decoder.getDecodedBuffer();
    if (!decoded || !decoded.length) return null;

    const bytesPerSample = Math.max(1, Math.ceil(bitDepth / 8));
    const px = width * height;
    const expected = px * components * bytesPerSample;
    if (decoded.length < expected) return null;

    // Read a sample (interleaved layout, little-endian) at sample index `i`.
    let read;
    if (bytesPerSample === 1) {
      read = (i) => decoded[i];
    } else {
      read = (i) => {
        const o = i * bytesPerSample;
        let v = 0;
        for (let k = 0; k < bytesPerSample; k++) v |= decoded[o + k] << (8 * k);
        return v >>> 0;
      };
    }

    const rgba = new Uint8ClampedArray(px * 4);
    if (components === 1) {                       // grayscale
      for (let i = 0; i < px; i++) {
        const g = scaleTo8(read(i), bitDepth);
        const d = i * 4;
        rgba[d] = rgba[d + 1] = rgba[d + 2] = g; rgba[d + 3] = 255;
      }
    } else if (components === 2) {                // gray + alpha
      for (let i = 0; i < px; i++) {
        const g = scaleTo8(read(i * 2), bitDepth);
        const a = scaleTo8(read(i * 2 + 1), bitDepth);
        const d = i * 4;
        rgba[d] = rgba[d + 1] = rgba[d + 2] = g; rgba[d + 3] = a;
      }
    } else {                                      // 3 = RGB, 4 = RGBA (interleaved)
      for (let i = 0; i < px; i++) {
        const s = i * components;
        const d = i * 4;
        rgba[d] = scaleTo8(read(s), bitDepth);
        rgba[d + 1] = scaleTo8(read(s + 1), bitDepth);
        rgba[d + 2] = scaleTo8(read(s + 2), bitDepth);
        rgba[d + 3] = components === 4 ? scaleTo8(read(s + 3), bitDepth) : 255;
      }
    }

    return { width, height, components, bitDepth, rgba };
  } catch (_) {
    return null;
  } finally {
    // Free the Emscripten-side instance if the build exposes a destructor.
    try { if (decoder && typeof decoder.delete === 'function') decoder.delete(); } catch (_) {}
  }
}
