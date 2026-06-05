/* Analyser - photo format conversion
   Browsers can't decode HEIC/HEIF or camera RAW directly, so before the photo
   module analyses them we convert to JPEG: heic2any for HEIC, an embedded-JPEG
   scan for RAW (fast, no decode), and ImageMagick-WASM as the heavyweight RAW
   fallback. Each loads its library lazily so a normal JPEG/PNG never pays for
   them. Used by photo.js (renderPhoto). */

import { el, loadScript } from '../core/util.js';

const HEIC2ANY_URL    = 'assets/vendor/heic2any.min.js';
const MAGICK_WASM_URL = new URL('../../vendor/imagemagick/index.mjs', import.meta.url).href;
const MAGICK_WASM_DIR = 'assets/vendor/imagemagick/';

// Fetch with a 0..1 progress callback driven by Content-Length. Falls back to a
// plain arrayBuffer read when the length/stream isn't available.
async function fetchWithProgress(url, onProgress) {
  const resp = await fetch(url);
  const total = parseInt(resp.headers.get('content-length') || '0', 10);
  if (!total || !resp.body) return new Uint8Array(await resp.arrayBuffer());
  const reader = resp.body.getReader();
  const chunks = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (onProgress) onProgress(loaded / total);
  }
  const out = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

// HEIC/HEIF -> JPEG via heic2any.
export async function convertHeic(file) {
  await loadScript(HEIC2ANY_URL);
  const blob = await window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
  const out = Array.isArray(blob) ? blob[0] : blob;
  return new File([out], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' });
}

// Pull the largest embedded JPEG preview out of a RAW file by scanning for
// SOI/EOI (FFD8..FFD9) markers - most RAWs ship a full-size JPEG preview, so
// this avoids a full RAW decode. Throws if none is found.
export async function extractRawPreview(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const jpegs = [];
  for (let i = 0; i < buf.length - 1; i++) {
    if (buf[i] === 0xFF && buf[i + 1] === 0xD8) {
      for (let j = i + 2; j < buf.length - 1; j++) {
        if (buf[j] === 0xFF && buf[j + 1] === 0xD9) {
          jpegs.push({ offset: i, length: j + 2 - i });
          i = j + 1;
          break;
        }
      }
    }
  }
  if (jpegs.length === 0) throw new Error('No embedded JPEG found');
  jpegs.sort((a, b) => b.length - a.length);
  const best = jpegs[0];
  const jpegData = buf.slice(best.offset, best.offset + best.length);
  return new File([jpegData], file.name.replace(/\.[^.]+$/, '_preview.jpg'), { type: 'image/jpeg' });
}

let magickReady = null;

// Full RAW -> JPEG decode via ImageMagick-WASM (~15 MB, loaded once). Renders an
// ASCII progress bar into `container` while the wasm downloads/initialises.
export async function convertWithImageMagick(file, container) {
  const barEl = el('div', { class: 'anr-progress-bar' }, '[                    ]');
  const labelEl = el('div', { class: 'anr-progress-label' }, 'loading imagemagick (~15 mb)');
  const wrap = el('div', { class: 'anr-progress' }, [barEl, labelEl]);
  if (container) container.appendChild(wrap);

  function setBar(frac) {
    const ch = parseFloat(getComputedStyle(barEl).fontSize) * 0.6 || 8;
    const total = Math.max(10, Math.floor((barEl.parentElement.clientWidth - ch * 2) / ch));
    const filled = Math.round(Math.max(0, Math.min(1, frac)) * total);
    barEl.innerHTML = '[<span class="anr-bar-fill">' + '/'.repeat(filled) + '</span>' + ' '.repeat(total - filled) + ']';
  }

  if (!magickReady) {
    setBar(0);
    const mod = await import(MAGICK_WASM_URL);
    const wasmBytes = await fetchWithProgress(MAGICK_WASM_DIR + 'magick.wasm', (p) => setBar(p * 0.9));
    setBar(0.95);
    labelEl.textContent = 'initialising';
    await mod.initializeImageMagick(wasmBytes);
    magickReady = mod;
  }
  setBar(1);
  labelEl.textContent = 'converting raw';

  const { ImageMagick, MagickFormat } = magickReady;
  const data = new Uint8Array(await file.arrayBuffer());
  return new Promise((resolve, reject) => {
    try {
      ImageMagick.read(data, (image) => {
        image.quality = 92;
        image.write(MagickFormat.Jpeg, (jpegData) => {
          wrap.remove();
          const blob = new Blob([jpegData], { type: 'image/jpeg' });
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
        });
      });
    } catch (e) {
      wrap.remove();
      reject(e);
    }
  });
}
