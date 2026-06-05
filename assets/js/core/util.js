/* Analyser - shared utilities
   DOM helpers and small formatters used by every module. */

export function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const k in attrs) {
    if (k === 'class') e.className = attrs[k];
    else if (k === 'html') e.innerHTML = attrs[k];
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
    else e.setAttribute(k, attrs[k]);
  }
  for (const c of (Array.isArray(children) ? children : [children])) {
    if (c == null) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

export function row(label, value) {
  return el('tr', {}, [
    el('th', {}, label),
    el('td', {}, value == null || value === '' ? '-' : String(value))
  ]);
}

// True when a read failure looks like an unavailable/cloud-only file rather than
// a corrupt/unsupported one. OneDrive/iCloud/etc. "online-only" placeholders
// throw NotReadableError/NotFoundError when their sync app can't hydrate them.
export function isUnreadableError(e) {
  if (!e) return false;
  const name = e.name || '';
  const msg = (e.message || '').toLowerCase();
  return name === 'NotReadableError' || name === 'NotFoundError' ||
    msg.includes('could not be read') ||
    msg.includes('a requested file or directory could not be found') ||
    (msg.includes('permission') && msg.includes('file'));
}

// Probe whether a File's bytes are actually readable. Returns null on success,
// or the thrown error on failure. Used to detect cloud-only placeholders before
// a renderer fails deep in its pipeline. Reads the head AND the last byte: a
// OneDrive/iCloud "online-only" file often serves a cached header (so a 1-byte
// head read passes) while the body/tail isn't on disk, so the tail read is what
// reliably trips. (Any successful read also triggers the sync app to hydrate the
// whole file, which is what a renderer would do anyway.)
export async function probeReadable(file) {
  if (!file || file.size === 0) return null;
  try {
    await file.slice(0, Math.min(file.size, 65536)).arrayBuffer();
    if (file.size > 65536) await file.slice(file.size - 1, file.size).arrayBuffer();
    return null;
  } catch (e) {
    return e;
  }
}

// A friendly "this file can't be read" card body, tailored to the cloud-only
// case (the overwhelmingly common cause of an otherwise-valid File failing).
export function cloudFileWarning(file) {
  const box = el('div', { class: 'anr-error anr-cloud-warning' });
  box.appendChild(el('p', { style: 'margin:0 0 10px; font-weight:600;' },
    'Couldn’t read “' + ((file && file.name) || 'this file') + '”.'));
  box.appendChild(el('p', { style: 'margin:0 0 10px;' },
    'It looks like a cloud-only file (OneDrive, iCloud Drive, Google Drive, Dropbox…) whose contents aren’t on this device yet, or whose sync app isn’t running. The name and size are known, but the actual bytes couldn’t be downloaded.'));
  const ul = el('ul', { style: 'margin:0; padding-left:18px;' }, [
    el('li', {}, 'Make sure OneDrive (or your sync app) is running and signed in.'),
    el('li', {}, 'In the file manager, right-click the file → “Always keep on this device”, wait for the download to finish, then try again.'),
  ]);
  box.appendChild(ul);
  return box;
}

// Standard inline error notice (styled by .anr-error). The canonical way for a
// renderer to report that a file couldn't be read or parsed.
export function errorCard(message) {
  return el('div', { class: 'anr-error' }, message);
}

// Monospace ASCII progress bar - the [////////        ] look used everywhere a
// loading bar appears. Two modes share the same glyphs so every loader reads the
// same way:
//   bar.set(frac)        determinate fill (0–1), left-to-right
//   bar.indeterminate()  a window of slashes that bounces left↔right, for work
//                        whose length isn't known up front
//   bar.stop()           halt the animation
// The indeterminate animation runs on rAF and stops itself once the element is
// detached from the DOM, so callers don't have to tear it down.
export function asciiBar(opts = {}) {
  if (typeof opts === 'number') opts = { width: opts };   // back-compat
  const fit = !!opts.fit;            // size to fill the parent (e.g. popup card)
  const SWEEP = 1900;                // ms for one left→right pass (indeterminate)
  let W = opts.width || 20;
  let win = Math.max(4, Math.round(W * 0.25));
  const bar = el('div', { class: 'anr-progress-bar' });
  let raf = null, seen = false, t0 = null;

  // fit:true → recompute the character count so the bar spans its container.
  // Measured lazily, once the bar is actually in the DOM (clientWidth is 0
  // before that). Uses the same font-size×0.6 monospace estimate as the app's
  // other progress bars.
  function measure() {
    if (!fit || !bar.parentElement) return;
    const ch = (parseFloat(getComputedStyle(bar).fontSize) || 13) * 0.6;
    // Measure the bar's own content box, not the parent's clientWidth - the
    // latter includes the container padding, which would over-count characters
    // and overflow the box, clipping the trailing "]".
    const avail = bar.clientWidth || bar.parentElement.clientWidth;
    const n = Math.floor(avail / ch) - 2; // minus brackets
    W = Math.max(10, Math.min(80, n));
    win = Math.max(4, Math.round(W * 0.25));
  }
  function paintRange(start, len) {
    start = Math.max(0, Math.min(W - len, start));
    bar.innerHTML = '[' + ' '.repeat(start) +
      '<span class="anr-bar-fill">' + '/'.repeat(len) + '</span>' +
      ' '.repeat(Math.max(0, W - len - start)) + ']';
  }
  bar.set = (frac) => {
    bar.stop();
    measure();
    const filled = Math.round(Math.max(0, Math.min(1, frac)) * W);
    bar.innerHTML = '[<span class="anr-bar-fill">' + '/'.repeat(filled) + '</span>' +
      ' '.repeat(Math.max(0, W - filled)) + ']';
  };
  bar.indeterminate = () => {
    if (raf) return;
    let measured = false;
    const loop = (ts) => {
      if (bar.isConnected) seen = true;
      else if (seen) { raf = null; return; }   // removed from DOM → self-stop
      if (!measured && bar.isConnected) { measure(); measured = true; }
      if (t0 == null) t0 = ts;
      const span = Math.max(1, W - win);
      const u = ((ts - t0) % (2 * SWEEP)) / SWEEP;   // 0..2 over a full cycle
      const tri = u <= 1 ? u : 2 - u;                // 0→1→0 triangle (bounce)
      paintRange(Math.round(tri * span), win);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  };
  bar.stop = () => { if (raf) { cancelAnimationFrame(raf); raf = null; } };
  bar.set(0);
  return bar;
}

// Small inline "working…" indicator with an indeterminate ASCII bar. Used to
// fill a card while a slower piece (e.g. a treemap for a huge folder) builds.
export function inlineLoader(text) {
  const bar = asciiBar();
  bar.indeterminate();
  return el('div', { class: 'anr-inline-loader' }, [
    el('span', { class: 'anr-inline-loader-label' }, text || 'Loading…'),
    bar
  ]);
}

export function rowHelp(label, value, helpText) {
  if (!rowHelp._init) {
    rowHelp._init = true;
    document.addEventListener('click', () => {
      document.querySelectorAll('.anr-tip.is-active').forEach(t => t.classList.remove('is-active'));
    });
  }
  const th = el('th', {});
  th.appendChild(document.createTextNode(label + ' '));
  const btn = el('button', { type: 'button', class: 'anr-tip-btn', title: 'Info' }, '[?]');
  const tip = el('div', { class: 'anr-tip' }, helpText);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasActive = tip.classList.contains('is-active');
    document.querySelectorAll('.anr-tip.is-active').forEach(t => t.classList.remove('is-active'));
    if (!wasActive) tip.classList.add('is-active');
  });
  th.appendChild(btn);
  th.appendChild(tip);
  return el('tr', {}, [
    th,
    el('td', {}, value == null || value === '' ? '-' : String(value))
  ]);
}

export function fmtBytes(n) {
  if (n == null) return '-';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(2) + ' MB';
  return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// A scrollable, wrapping <pre> for raw text payloads (hex dumps, headers, etc.).
// Shared by the lazy parser chunks so every readout block looks the same.
export function preBlock(text, cls) {
  return el('pre', {
    class: cls || 'anr-code',
    style: 'max-height:360px;overflow:auto;font-size:12px;white-space:pre-wrap;word-break:break-word;margin:0;',
  }, text || '');
}

// Format a Date for display, tolerating non-Date / invalid values.
export const fmtDate = (d) => (d instanceof Date && !isNaN(d)) ? d.toLocaleString() : String(d);

// Read up to `n` bytes from a File starting at `off`. Returns a Uint8Array
// (empty when the offset is past EOF). Shared by the binary parser chunks.
export async function readSlice(file, off, n) {
  const end = Math.min(file.size, off + n);
  if (off >= file.size || end <= off) return new Uint8Array(0);
  return new Uint8Array(await file.slice(off, end).arrayBuffer());
}

// Wire a [?] info button to an inline dropdown panel (.anr-info-panel shown/hidden
// via .is-hidden). The button label flips between [?] (closed) and [-] (open). If
// the button sits inside a collapsed <details>, the first click also opens that
// section so the panel is actually visible. Use this for every dropdown-style [?]
// (the popup [?] in rowHelp is intentionally left as a plain tip).
export function wireInfoToggle(btn, panel) {
  const sync = () => { btn.textContent = panel.classList.contains('is-hidden') ? '[?]' : '[-]'; };
  sync();
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const det = btn.closest('details');
    if (det && !det.open) {
      det.open = true;
      panel.classList.remove('is-hidden');
    } else {
      panel.classList.toggle('is-hidden');
    }
    sync();
  });
}

export function h3help(title, helpHtml) {
  const h = el('h3', {});
  h.appendChild(document.createTextNode(title));
  const btn = el('button', { type: 'button', class: 'anr-info-btn', title: 'Info' }, '[?]');
  const panel = el('div', { class: 'anr-info-panel is-hidden', html: helpHtml });
  wireInfoToggle(btn, panel);
  h.appendChild(btn);
  return [h, panel];
}

export function fileExt(name) {
  const m = (name || '').match(/\.([^.]+)$/);
  return m ? m[1].toLowerCase() : '';
}

export async function sha256Hex(file) {
  if (!crypto.subtle) return null;
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function sha256Row(file) {
  const hashRow = rowHelp('SHA-256', '',
    "SHA-256 is a cryptographic fingerprint of the file's exact bytes. Identical files share the same hash; changing even a single byte changes it completely - useful for verifying a file hasn't been altered or matches a known copy.");
  const td = hashRow.querySelector('td');
  const bar = asciiBar();
  bar.indeterminate();
  td.textContent = '';
  td.appendChild(bar);
  sha256Hex(file).then(h => {
    bar.stop();
    td.textContent = h || 'unavailable';
    td.style.wordBreak = 'break-all';
  });
  return hashRow;
}

// Standard "Integrity" card: a heading + readout table whose last row is the
// (async) SHA-256. Pass extraRows as [[label, value], …] to prepend rows.
export function integrityCard(file, extraRows = []) {
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Integrity'));
  const tbl = el('table', { class: 'anr-readout' });
  for (const [label, value] of extraRows) tbl.appendChild(row(label, value));
  tbl.appendChild(sha256Row(file));
  card.appendChild(tbl);
  return card;
}

// Build a collapsible directory tree from a nested object. Directories are
// rendered as <details>/<summary> nodes (closed by default, children rendered
// lazily on first expand); files as plain rows. Shared by folder.js and
// archive.js. Callers supply:
//   isDir(value)   - true if value is a directory node (a sub-object)
//   fileSize(value) - byte size for a file node (number)
export function buildFileTree(obj, opts) {
  const isDir = opts.isDir;
  const fileSize = opts.fileSize;

  function countAndSize(node) {
    let files = 0, bytes = 0;
    for (const v of Object.values(node)) {
      if (isDir(v)) { const r = countAndSize(v); files += r.files; bytes += r.bytes; }
      else { files++; bytes += fileSize(v) || 0; }
    }
    return { files, bytes };
  }

  function sortedKeys(node) {
    return Object.keys(node).sort((a, b) => {
      const ad = isDir(node[a]), bd = isDir(node[b]);
      if (ad !== bd) return ad ? -1 : 1;
      return a.localeCompare(b);
    });
  }

  function renderNode(node) {
    const frag = document.createDocumentFragment();
    for (const key of sortedKeys(node)) {
      const val = node[key];
      if (isDir(val)) {
        const { files, bytes } = countAndSize(val);
        const details = el('details', { class: 'anr-tree-dir' });
        const summary = el('summary', { class: 'anr-tree-summary' }, [
          el('span', { class: 'anr-tree-icon' }, '▸'),
          el('span', { class: 'anr-tree-name' }, key),
          el('span', { class: 'anr-tree-meta' }, files + (files === 1 ? ' file · ' : ' files · ') + fmtBytes(bytes))
        ]);
        details.appendChild(summary);
        let filled = false;
        details.addEventListener('toggle', () => {
          if (details.open && !filled) {
            filled = true;
            const kids = el('div', { class: 'anr-tree-children' });
            kids.appendChild(renderNode(val));
            details.appendChild(kids);
          }
        });
        frag.appendChild(details);
      } else {
        const cls = opts.onFileClick ? 'anr-tree-file is-clickable' : 'anr-tree-file';
        const lead = el('span', { class: 'anr-tree-lead' });
        if (opts.fileAccent) {
          const color = opts.fileAccent(key, val);
          if (color) lead.appendChild(el('span', { class: 'anr-tree-dot', style: 'background:' + color }));
        }
        const fileDiv = el('div', { class: cls }, [
          lead,
          el('span', { class: 'anr-tree-name' }, key),
          el('span', { class: 'anr-tree-meta' }, fmtBytes(fileSize(val) || 0))
        ]);
        if (opts.copyPath) {
          const path = opts.copyPath(key, val);
          if (path) {
            const copyBtn = el('button', { class: 'anr-tree-copy', type: 'button', title: 'Copy path' }, '⧉');
            copyBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              const done = () => { copyBtn.textContent = '✓'; setTimeout(() => { copyBtn.textContent = '⧉'; }, 1000); };
              if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(path).then(done).catch(() => {});
              } else {
                const ta = document.createElement('textarea');
                ta.value = path; document.body.appendChild(ta); ta.select();
                try { document.execCommand('copy'); done(); } catch (_) {}
                ta.remove();
              }
            });
            fileDiv.appendChild(copyBtn);
          }
        }
        if (opts.onFileClick) {
          fileDiv.addEventListener('click', () => opts.onFileClick(key, val));
        }
        frag.appendChild(fileDiv);
      }
    }
    return frag;
  }

  const rootTotals = countAndSize(obj);
  const wrap = el('div', { class: 'anr-tree' });
  wrap.appendChild(renderNode(obj));
  wrap._totals = rootTotals;
  return wrap;
}

// Lazy-load an external stylesheet/script by injecting a <link>/<script> tag,
// resolving once it's ready (and immediately if already present). Used to pull
// in heavy optional libraries (Leaflet, Tesseract, heic2any, jsQR) on demand.
export function loadCss(href) {
  return new Promise((resolve) => {
    if (document.querySelector(`link[href="${href}"]`)) return resolve();
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href;
    l.onload = resolve; l.onerror = resolve;
    document.head.appendChild(l);
  });
}
export function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

// Snap a measured frame rate to the nearest standard rate when it's within
// 0.5 fps (so 29.96 reads as 29.97), otherwise keep two decimals. Shared by the
// video module and its container parser.
export function roundFps(raw) {
  const standard = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120, 240];
  let closest = raw, minDiff = Infinity;
  for (const s of standard) {
    const d = Math.abs(raw - s);
    if (d < minDiff) { minDiff = d; closest = s; }
  }
  return minDiff < 0.5 ? closest : Math.round(raw * 100) / 100;
}
