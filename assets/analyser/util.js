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
