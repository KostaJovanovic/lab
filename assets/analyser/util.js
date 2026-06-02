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

export function h3help(title, helpHtml) {
  const h = el('h3', {});
  h.appendChild(document.createTextNode(title));
  const btn = el('button', { type: 'button', class: 'anr-info-btn', title: 'Info' }, '[?]');
  const panel = el('div', { class: 'anr-info-panel is-hidden', html: helpHtml });
  btn.addEventListener('click', () => { panel.classList.toggle('is-hidden'); });
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
  const hashRow = row('SHA-256', '');
  const td = hashRow.querySelector('td');
  const bar = el('div', {
    style: 'height:3px;margin-top:4px;background:var(--rule);border-radius:2px;overflow:hidden;'
  });
  const fill = el('div', {
    style: 'height:100%;width:30%;background:var(--accent);animation:anr-sha-slide 1s ease-in-out infinite alternate;'
  });
  bar.appendChild(fill);
  td.textContent = 'computing…';
  td.appendChild(bar);
  if (!document.getElementById('anr-sha-keyframes')) {
    const style = document.createElement('style');
    style.id = 'anr-sha-keyframes';
    style.textContent = '@keyframes anr-sha-slide{from{transform:translateX(0)}to{transform:translateX(233%)}}';
    document.head.appendChild(style);
  }
  sha256Hex(file).then(h => {
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
//   isDir(value)   — true if value is a directory node (a sub-object)
//   fileSize(value) — byte size for a file node (number)
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
        frag.appendChild(el('div', { class: 'anr-tree-file' }, [
          el('span', { class: 'anr-tree-name' }, key),
          el('span', { class: 'anr-tree-meta' }, fmtBytes(fileSize(val) || 0))
        ]));
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
