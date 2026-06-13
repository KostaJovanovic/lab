/* Analyser - structured-data + text-art viewers
   ============================================================================
   Three lightweight viewers that share nothing but a "show the content people
   actually care about" goal:
     - HAR (.har)            - an HTTP Archive: a JSON capture of a browser
                               session. Rendered as a request table (method,
                               status, type, size, time, URL) with summary.
     - JSON supersets        - JSON5 / JSONC / Hjson: shown as selectable source
       (.json5/.jsonc/.hjson)  and, when they parse after comment + trailing-comma
                               stripping, an expandable value tree.
     - NFO (.nfo)            - scene-release ASCII art, decoded from CP437 (its
                               native code page) and shown in a monospace block.
   ============================================================================ */

import { el, row, buildReadout, fmtBytes, rowHelp, integrityCard, errorCard } from '../core/util.js';
import { cp437 } from '../core/binutil.js';

// ---------- JSON value tree (objects/arrays collapsible) ----------
function jsonTree(value, key) {
  const t = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (t === 'object' || t === 'array') {
    const entries = t === 'array' ? value.map((v, i) => [i, v]) : Object.entries(value);
    const det = el('details', { class: 'anr-json-node' });
    const count = entries.length;
    const brace = t === 'array' ? '[' + count + ']' : '{' + count + '}';
    const sum = el('summary', { class: 'anr-json-sum' }, [
      key != null ? el('span', { class: 'anr-json-key' }, String(key) + ': ') : '',
      el('span', { class: 'anr-json-brace' }, brace),
    ]);
    det.appendChild(sum);
    let filled = false;
    det.addEventListener('toggle', () => {
      if (det.open && !filled) {
        filled = true;
        const kids = el('div', { class: 'anr-json-children' });
        for (const [k, v] of entries) kids.appendChild(jsonTree(v, k));
        det.appendChild(kids);
      }
    });
    return det;
  }
  const line = el('div', { class: 'anr-json-leaf' });
  if (key != null) line.appendChild(el('span', { class: 'anr-json-key' }, String(key) + ': '));
  const valEl = el('span', { class: 'anr-json-val anr-json-' + t });
  valEl.textContent = t === 'string' ? JSON.stringify(value) : String(value);
  line.appendChild(valEl);
  return line;
}

// Best-effort relaxed-JSON to value: strip // and /* */ comments and trailing
// commas, then JSON.parse. Returns the parsed value or null on failure.
function looseParse(text) {
  try { return JSON.parse(text); } catch (_) {}
  try {
    const stripped = text
      .replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n\r]*|\/\*[\s\S]*?\*\//g, (m, str) => str || '')
      .replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(stripped);
  } catch (_) { return null; }
}

// ---------- HAR ----------
function statusClass(s) {
  if (s >= 500) return 'anr-har-5xx';
  if (s >= 400) return 'anr-har-4xx';
  if (s >= 300) return 'anr-har-3xx';
  if (s >= 200) return 'anr-har-2xx';
  return '';
}
function shortType(mime) {
  if (!mime) return '';
  const m = mime.split(';')[0].trim();
  return m.replace(/^application\//, '').replace(/^text\//, '').replace(/^image\//, 'img/');
}

export async function renderHar(file, container) {
  container.hidden = false;
  container.innerHTML = '';
  container.appendChild(el('div', { class: 'anr-info' }, 'Reading HAR capture...'));
  let har;
  try { har = JSON.parse(await file.text()); }
  catch (e) { container.innerHTML = ''; container.appendChild(errorCard('This .har file is not valid JSON: ' + (e && e.message || 'parse error'))); return; }

  const log = har.log || {};
  const entries = Array.isArray(log.entries) ? log.entries : [];
  let totalBytes = 0, totalTime = 0;
  for (const e of entries) {
    totalBytes += (e.response && e.response.content && e.response.content.size) || 0;
    totalTime += e.time || 0;
  }

  container.innerHTML = '';
  const info = el('div', { class: 'anr-card' });
  info.appendChild(el('h3', {}, 'HTTP Archive (HAR)'));
  info.appendChild(buildReadout([
    ['File', file.name],
    ['Size', fmtBytes(file.size)],
    log.version && ['HAR version', log.version],
    log.creator && ['Captured by', [log.creator.name, log.creator.version].filter(Boolean).join(' ')],
    (log.pages && log.pages.length) && ['Pages', String(log.pages.length)],
    ['Requests', entries.length.toLocaleString()],
    ['Total content', fmtBytes(totalBytes)],
    ['Total time', (totalTime / 1000).toFixed(2) + ' s'],
  ]));
  container.appendChild(info);

  if (!entries.length) { container.appendChild(el('div', { class: 'anr-card' }, [el('h3', {}, 'Requests'), el('p', { class: 'anr-hint' }, 'No requests in this capture.')])); return; }

  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Requests'));
  const tbl = el('table', { class: 'anr-har-table' });
  const thead = el('tr', {}, ['Method', 'Status', 'Type', 'Size', 'Time', 'URL'].map((h) => el('th', {}, h)));
  tbl.appendChild(thead);
  card.appendChild(tbl);

  const btnRow = el('div', { class: 'anr-btn-row' });
  const moreBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Show more');
  const allBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Show all');
  btnRow.appendChild(moreBtn); btnRow.appendChild(allBtn);
  card.appendChild(btnRow);

  let shown = 0;
  const BATCH = 100;
  function addRow(i) {
    const e = entries[i];
    const req = e.request || {}, res = e.response || {};
    const status = res.status || 0;
    const size = (res.content && res.content.size) || 0;
    const url = req.url || '';
    const tr = el('tr', {}, [
      el('td', {}, req.method || ''),
      el('td', { class: statusClass(status) }, status ? String(status) : '-'),
      el('td', {}, shortType(res.content && res.content.mimeType)),
      el('td', { class: 'anr-har-num' }, size ? fmtBytes(size) : '-'),
      el('td', { class: 'anr-har-num' }, e.time != null ? Math.round(e.time) + ' ms' : '-'),
      el('td', { class: 'anr-har-url', title: url }, url),
    ]);
    tbl.appendChild(tr);
  }
  function reveal(upTo) {
    for (; shown < upTo && shown < entries.length; shown++) addRow(shown);
    if (shown >= entries.length) btnRow.hidden = true;
    else moreBtn.textContent = 'Show more (' + shown + '/' + entries.length + ')';
  }
  moreBtn.addEventListener('click', () => reveal(shown + BATCH));
  allBtn.addEventListener('click', () => reveal(entries.length));
  reveal(Math.min(entries.length, BATCH));
  container.appendChild(card);

  if (file.size <= 500 * 1024 * 1024) container.appendChild(integrityCard(file));
}

// ---------- JSON supersets (JSON5 / JSONC / Hjson) ----------
const JSON_LABELS = { json5: 'JSON5', jsonc: 'JSON with comments (JSONC)', hjson: 'Hjson' };
export async function renderJsonData(file, container) {
  container.hidden = false;
  container.innerHTML = '';
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  try {
    const text = await file.text();
    const parsed = looseParse(text);
    container.innerHTML = '';
    const info = el('div', { class: 'anr-card' });
    info.appendChild(el('h3', {}, JSON_LABELS[ext] || 'JSON data'));
    info.appendChild(buildReadout([
      ['File', file.name],
      ['Size', fmtBytes(file.size)],
      ['Lines', text.split('\n').length.toLocaleString()],
      rowHelp('Parses', parsed != null ? 'Yes (after comment / trailing-comma stripping)' : 'No - shown as source only',
        'These formats relax standard JSON (comments, trailing commas, unquoted keys). Analyser tries to parse them by stripping comments and trailing commas; full JSON5 / Hjson syntax (single quotes, unquoted keys) may not parse, in which case only the source is shown.'),
    ]));
    container.appendChild(info);

    if (parsed != null && typeof parsed === 'object') {
      const treeCard = el('div', { class: 'anr-card' });
      treeCard.appendChild(el('h3', {}, 'Value tree'));
      const tree = el('div', { class: 'anr-json-tree' });
      const rootDetails = jsonTree(parsed);
      if (rootDetails.tagName === 'DETAILS') rootDetails.open = true;
      tree.appendChild(rootDetails);
      treeCard.appendChild(tree);
      container.appendChild(treeCard);
    }

    const srcCard = el('div', { class: 'anr-card' });
    srcCard.appendChild(el('h3', {}, 'Source'));
    const pre = el('pre', { class: 'anr-pagetext anr-code-src' });
    pre.textContent = text.length > 500_000 ? text.slice(0, 500_000) + '\n... (truncated)' : text;
    srcCard.appendChild(pre);
    container.appendChild(srcCard);

    if (file.size <= 500 * 1024 * 1024) container.appendChild(integrityCard(file));
  } catch (e) {
    container.innerHTML = '';
    container.appendChild(errorCard('Could not read file: ' + (e && e.message || 'unknown error')));
  }
}

// ---------- NFO (CP437 ASCII art) ----------
export async function renderNfo(file, container) {
  container.hidden = false;
  container.innerHTML = '';
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const text = cp437(bytes);
    container.innerHTML = '';
    const info = el('div', { class: 'anr-card' });
    info.appendChild(el('h3', {}, 'NFO / scene info'));
    info.appendChild(buildReadout([
      ['File', file.name],
      ['Size', fmtBytes(file.size)],
      rowHelp('Encoding', 'CP437 (IBM PC OEM)', 'NFO files are scene-release notes drawn with the original IBM PC code page (CP437) box-drawing and block characters. Analyser decodes them from CP437 so the ASCII art renders the way it was authored, rather than as mojibake.'),
      ['Lines', text.split('\n').length.toLocaleString()],
    ]));
    container.appendChild(info);

    const art = el('div', { class: 'anr-card' });
    art.appendChild(el('h3', {}, 'Content'));
    const pre = el('pre', { class: 'anr-nfo-art' });
    pre.textContent = text;
    art.appendChild(pre);
    container.appendChild(art);

    if (file.size <= 500 * 1024 * 1024) container.appendChild(integrityCard(file));
  } catch (e) {
    container.innerHTML = '';
    container.appendChild(errorCard('Could not read file: ' + (e && e.message || 'unknown error')));
  }
}
