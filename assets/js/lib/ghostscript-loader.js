/* Analyser - lazy Ghostscript (WASM) loader.

   Rasterizes EPS / PostScript to a PNG preview using a vendored build of
   @jspawn/ghostscript-wasm (the `gs` interpreter compiled to WASM via
   Emscripten, ~15 MB). This module has NO top-level side effects: the heavy
   wasm is fetched and instantiated only the first time renderPostScript() is
   called (i.e. only when an EPS/PS file is actually opened), then cached for
   subsequent calls.

   Vendored files (offline tier — COMPLETE only):
     assets/vendor/ghostscript/gs.mjs     (ESM factory; pulls browser.js + gs.js)
     assets/vendor/ghostscript/browser.js
     assets/vendor/ghostscript/gs.js
     assets/vendor/ghostscript/gs.wasm    (~15 MB)

   The build is a standard Emscripten MODULARIZE module:
     - default export is `async (config) => Module`
     - `Module.callMain(argv)` runs the gs CLI (noInitialRun is set)
     - `Module.FS` is the in-memory Emscripten filesystem
     - `Module.instantiateWasm` is the env-agnostic hook we use to feed the
       vendored gs.wasm bytes (this build does NOT honour Module.wasmBinary). */

const GS_BASE = new URL('../../vendor/ghostscript/', import.meta.url);

let _gsFactoryPromise = null;   // Promise<defaultExport> for gs.mjs
let _wasmBytesPromise = null;   // Promise<ArrayBuffer> for gs.wasm

function loadFactory() {
  if (!_gsFactoryPromise) {
    _gsFactoryPromise = import(new URL('gs.mjs', GS_BASE).href).then((m) => m.default || m);
  }
  return _gsFactoryPromise;
}

function loadWasmBytes() {
  if (!_wasmBytesPromise) {
    _wasmBytesPromise = fetch(new URL('gs.wasm', GS_BASE).href).then((r) => {
      if (!r.ok) throw new Error('gs.wasm fetch failed: ' + r.status);
      return r.arrayBuffer();
    });
  }
  return _wasmBytesPromise;
}

// Build a fresh Emscripten Module instance. Each gs run uses a fresh module so
// the in-memory FS and exit state never leak between conversions; the wasm
// bytes and the JS factory are cached, so only compilation is repeated (cheap
// relative to the multi-MB download/instantiate that happens once).
async function createGs() {
  const [factory, wasmBytes] = await Promise.all([loadFactory(), loadWasmBytes()]);
  return factory({
    noInitialRun: true,
    print() {},
    printErr() {},
    instantiateWasm(imports, success) {
      WebAssembly.instantiate(wasmBytes, imports)
        .then((res) => success(res.instance, res.module))
        .catch((err) => { try { console.warn('gs wasm instantiate failed', err); } catch (_) {} });
      return {};   // async path; success() is called above
    },
  });
}

/**
 * Rasterize the first page of an EPS / PostScript document to a PNG Blob.
 *
 * @param {Uint8Array|ArrayBuffer} bytes  the raw EPS/PS file contents
 * @param {string} ext                    lowercase extension (eps/epsf/epsi/ps)
 * @returns {Promise<Blob|null>}          a PNG Blob (first page) or null on any failure
 */
export async function renderPostScript(bytes, ext) {
  try {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (!u8 || !u8.length) return null;

    const isEps = ext === 'eps' || ext === 'epsf' || ext === 'epsi';
    const inName = isEps ? 'input.eps' : 'input.ps';
    const outName = 'output.png';

    const mod = await createGs();
    if (!mod || typeof mod.callMain !== 'function' || !mod.FS) return null;

    mod.FS.writeFile(inName, u8);

    // First page only (-dLastPage=1), ~150 dpi, white background, EPS cropped to
    // its bounding box. -dSAFER sandboxes the interpreter.
    const args = [
      '-dSAFER', '-dBATCH', '-dNOPAUSE', '-dQUIET',
      '-dFirstPage=1', '-dLastPage=1',
      '-sDEVICE=png16m', '-r150',
      '-dTextAlphaBits=4', '-dGraphicsAlphaBits=4',
      '-dBackgroundColor=16#ffffff',
    ];
    if (isEps) args.push('-dEPSCrop');
    args.push('-o', outName, inName);

    const rc = mod.callMain(args);
    if (rc !== 0 && rc !== undefined && rc !== null) {
      // Non-zero exit: gs failed. Still try to read output in case a partial
      // page was written, but if there's nothing, bail.
    }

    let out;
    try { out = mod.FS.readFile(outName); } catch (_) { return null; }
    if (!out || !out.length) return null;
    // Sanity check PNG signature.
    if (out[0] !== 0x89 || out[1] !== 0x50 || out[2] !== 0x4e || out[3] !== 0x47) return null;

    // Copy into a fresh buffer so the Blob doesn't reference the wasm heap.
    return new Blob([out.slice()], { type: 'image/png' });
  } catch (_) {
    return null;
  }
}

export default renderPostScript;
