/* Analyser - XLSX viewer
   Reads .xlsx (Office Open XML spreadsheet) and renders each worksheet as a
   table, with sheet tabs and document metadata. */

import { el, row, fmtBytes, integrityCard, errorCard } from '../core/util.js';
import { openZip } from './zip.js';

// "A1" -> { col: 0, row: 0 }; "BC12" -> { col: 54, row: 11 }
function parseRef(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref || '');
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: parseInt(m[2], 10) - 1 };
}

function colName(n) {
  let s = '';
  n += 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function parseXml(text) {
  return new DOMParser().parseFromString(text, 'application/xml');
}

// Built-in number-format ids (a subset). Used to classify columns as date or
// currency when xl/styles.xml references them without an explicit format code.
const BUILTIN_FMT = {
  14: 'date', 15: 'date', 16: 'date', 17: 'date', 22: 'date',
  45: 'date', 46: 'date', 47: 'date',
  5: 'currency', 6: 'currency', 7: 'currency', 8: 'currency',
  41: 'currency', 42: 'currency', 43: 'currency', 44: 'currency'
};

// Classify a format code string as 'date', 'currency', or '' (general).
function classifyFmt(code) {
  if (!code) return '';
  const c = code.toLowerCase();
  // strip quoted literals and bracketed sections so we only look at tokens
  const stripped = c.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
  if (/[$£€¥]|\\u00a3|\\u20ac/.test(c)) return 'currency';
  if (/[dmy]/.test(stripped) && /[dy]|mm/.test(stripped) && !/[#0]/.test(stripped.replace(/[dmyhs:/.\-, ]/g, ''))) {
    // looks date-ish (has d/m/y separators, no general numeric placeholders left)
    if (/\b(d|dd|m|mm|mmm|yy|yyyy|h|hh|ss)\b/.test(stripped) || /[dy]/.test(stripped)) return 'date';
  }
  if (/[#0].*[#0]?\s*[$£€¥]|[$£€¥]\s*[#0]/.test(c)) return 'currency';
  return '';
}

// Excel date serial -> readable date string (1900 date system, with the
// well-known Feb-29-1900 leap bug offset baked into the epoch).
function serialToDate(serial) {
  const n = parseFloat(serial);
  if (!isFinite(n) || n <= 0) return null;
  const ms = (n - 25569) * 86400 * 1000; // 25569 = days from 1899-12-30 to 1970-01-01
  const d = new Date(Math.round(ms));
  if (isNaN(d.getTime())) return null;
  // date-only if no fractional part
  if (n === Math.floor(n)) return d.toISOString().slice(0, 10);
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

export async function renderXlsx(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading spreadsheet "${file.name}"…`));

  let zip;
  try {
    zip = await openZip(file);
  } catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Could not read XLSX: ' + (e && e.message)));
    return;
  }
  resultsEl.innerHTML = '';

  // ---- Shared strings ----
  const shared = [];
  if (zip.has('xl/sharedStrings.xml')) {
    const doc = parseXml(await zip.text('xl/sharedStrings.xml'));
    for (const si of doc.getElementsByTagName('si')) {
      // concatenate all <t> runs inside this string item
      let s = '';
      for (const t of si.getElementsByTagName('t')) s += t.textContent;
      shared.push(s);
    }
  }

  // ---- Workbook: sheet names + relationship ids (+ hidden state, names) ----
  const sheets = [];
  const namedRanges = [];
  let externalLinkCount = 0;
  if (zip.has('xl/workbook.xml')) {
    const wb = parseXml(await zip.text('xl/workbook.xml'));
    for (const s of wb.getElementsByTagName('sheet')) {
      const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      sheets.push({ name: s.getAttribute('name') || 'Sheet', rid, state: s.getAttribute('state') || 'visible' });
    }
    try {
      for (const dn of wb.getElementsByTagName('definedName')) {
        const nm = dn.getAttribute('name') || '';
        if (nm && !/^_xlnm\./i.test(nm)) namedRanges.push(nm);
      }
    } catch (_) { /* ignore */ }
  }
  // External workbook links live in xl/externalLinks/.
  try { externalLinkCount = zip.match(/^xl\/externalLinks\/externalLink\d+\.xml$/).length; } catch (_) { /* ignore */ }
  // VBA macro project presence.
  const hasMacros = zip.has('xl/vbaProject.bin');

  // ---- Number formats from xl/styles.xml (cell xf index -> 'date'|'currency'|'') ----
  const xfKind = [];
  try {
    if (zip.has('xl/styles.xml')) {
      const st = parseXml(await zip.text('xl/styles.xml'));
      const fmtCode = {}; // numFmtId -> format code
      for (const nf of st.getElementsByTagName('numFmt')) {
        const id = parseInt(nf.getAttribute('numFmtId'), 10);
        if (!isNaN(id)) fmtCode[id] = nf.getAttribute('formatCode') || '';
      }
      const cellXfs = st.getElementsByTagName('cellXfs')[0];
      if (cellXfs) {
        for (const xf of cellXfs.getElementsByTagName('xf')) {
          const id = parseInt(xf.getAttribute('numFmtId'), 10);
          let kind = '';
          if (!isNaN(id)) kind = BUILTIN_FMT[id] || classifyFmt(fmtCode[id]);
          xfKind.push(kind);
        }
      }
    }
  } catch (_) { /* ignore - cells just render raw */ }
  // ---- Rels: rid -> worksheet path ----
  const ridToPath = {};
  if (zip.has('xl/_rels/workbook.xml.rels')) {
    const rels = parseXml(await zip.text('xl/_rels/workbook.xml.rels'));
    for (const r of rels.getElementsByTagName('Relationship')) {
      let target = r.getAttribute('Target') || '';
      if (!target.startsWith('xl/') && !target.startsWith('/')) target = 'xl/' + target;
      ridToPath[r.getAttribute('Id')] = target.replace(/^\//, '');
    }
  }

  // ---- Metadata ----
  const metaCard = el('div', { class: 'anr-card' });
  metaCard.appendChild(el('h3', {}, 'Spreadsheet'));
  const metaTbl = el('table', { class: 'anr-readout' });
  metaTbl.appendChild(row('File', file.name));
  metaTbl.appendChild(row('Size', fmtBytes(file.size)));
  metaTbl.appendChild(row('Sheets', sheets.length || '-'));
  if (zip.has('docProps/core.xml')) {
    const core = parseXml(await zip.text('docProps/core.xml'));
    const get = (tag) => { const e = core.getElementsByTagName(tag)[0]; return e ? e.textContent : ''; };
    const creator = get('dc:creator'); if (creator) metaTbl.appendChild(row('Author', creator));
    const modified = get('dcterms:modified'); if (modified) metaTbl.appendChild(row('Modified', modified.replace('T', ' ').replace('Z', '')));
  }
  if (zip.has('docProps/app.xml')) {
    const app = parseXml(await zip.text('docProps/app.xml'));
    const a = app.getElementsByTagName('Application')[0];
    if (a) metaTbl.appendChild(row('Application', a.textContent));
  }
  metaCard.appendChild(metaTbl);
  resultsEl.appendChild(metaCard);

  // ---- Computation & structure (additive) ----
  try {
    const hidden = sheets.filter((s) => s.state === 'hidden' || s.state === 'veryHidden');
    const showCard = hasMacros || hidden.length || namedRanges.length || externalLinkCount;
    if (showCard) {
      const c = el('div', { class: 'anr-card' });
      c.appendChild(el('h3', {}, 'Computation & structure'));
      const t = el('table', { class: 'anr-readout' });
      if (hasMacros) t.appendChild(row('Macros', '⚠ Contains macros (xl/vbaProject.bin)'));
      if (hidden.length) {
        t.appendChild(row('Hidden sheets', hidden.length + ' (' + hidden.map((s) => s.name + (s.state === 'veryHidden' ? ' [very hidden]' : '')).join(', ') + ')'));
      }
      if (namedRanges.length) t.appendChild(row('Named ranges', namedRanges.length));
      if (externalLinkCount) t.appendChild(row('External workbook links', externalLinkCount));
      c.appendChild(t);
      if (namedRanges.length) {
        const det = el('details', { style: 'margin-top:8px;' });
        det.appendChild(el('summary', {}, 'View named ranges (' + namedRanges.length + ')'));
        det.appendChild(el('p', { style: 'margin:6px 0;word-break:break-all;' }, namedRanges.slice(0, 200).join(', ')));
        c.appendChild(det);
      }
      resultsEl.appendChild(c);
    }
  } catch (_) { /* ignore */ }

  // ---- Sheet tabs + table ----
  const sheetCard = el('div', { class: 'anr-card' });
  sheetCard.appendChild(el('h3', {}, 'Sheets'));
  const tabRow = el('div', { class: 'anr-xlsx-tabs' });
  const tableWrap = el('div', { class: 'anr-xlsx-table-wrap' });
  sheetCard.appendChild(tabRow);
  sheetCard.appendChild(tableWrap);
  resultsEl.appendChild(sheetCard);

  async function renderSheet(idx) {
    [...tabRow.children].forEach((c, i) => c.classList.toggle('is-active', i === idx));
    tableWrap.innerHTML = '';
    const sheet = sheets[idx];
    const path = ridToPath[sheet.rid] || ('xl/worksheets/sheet' + (idx + 1) + '.xml');
    if (!zip.has(path)) { tableWrap.appendChild(el('p', { class: 'anr-hint' }, 'Could not locate sheet data.')); return; }
    const doc = parseXml(await zip.text(path));

    // Collect cells into a sparse grid.
    let maxCol = 0, maxRow = 0;
    const cells = {};
    const formulas = []; // { ref, formula } collected during iteration
    let dateCols = new Set(), currencyCols = new Set();
    for (const c of doc.getElementsByTagName('c')) {
      const ref = parseRef(c.getAttribute('r'));
      if (!ref) continue;
      const type = c.getAttribute('t');
      let value = '';
      if (type === 'inlineStr') {
        const is = c.getElementsByTagName('t')[0];
        value = is ? is.textContent : '';
      } else {
        const v = c.getElementsByTagName('v')[0];
        const raw = v ? v.textContent : '';
        if (type === 's') value = shared[parseInt(raw, 10)] || '';
        else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
        else {
          value = raw;
          // Apply number format from the cell's style index, when known.
          try {
            const si = parseInt(c.getAttribute('s'), 10);
            const kind = !isNaN(si) ? xfKind[si] : '';
            if (kind === 'date' && raw !== '') {
              const d = serialToDate(raw);
              if (d) { value = d; dateCols.add(ref.col); }
            } else if (kind === 'currency' && raw !== '') {
              currencyCols.add(ref.col);
            }
          } catch (_) { /* keep raw value */ }
        }
      }
      // Collect formula (cached value already captured above as `value`).
      try {
        const f = c.getElementsByTagName('f')[0];
        if (f && f.textContent) formulas.push({ ref: c.getAttribute('r'), formula: f.textContent });
      } catch (_) { /* ignore */ }
      cells[ref.row + ',' + ref.col] = value;
      if (ref.col > maxCol) maxCol = ref.col;
      if (ref.row > maxRow) maxRow = ref.row;
    }

    // Cap render so a giant sheet doesn't lock the page.
    const ROW_CAP = 200, COL_CAP = 50;
    const showRows = Math.min(maxRow, ROW_CAP);
    const showCols = Math.min(maxCol, COL_CAP);

    const table = el('table', { class: 'anr-xlsx-table' });
    const thead = el('tr', {}, [el('th', { class: 'anr-xlsx-corner' }, '')]);
    for (let c = 0; c <= showCols; c++) thead.appendChild(el('th', {}, colName(c)));
    table.appendChild(thead);
    for (let r = 0; r <= showRows; r++) {
      const tr = el('tr', {}, [el('th', { class: 'anr-xlsx-rownum' }, String(r + 1))]);
      for (let c = 0; c <= showCols; c++) {
        tr.appendChild(el('td', {}, cells[r + ',' + c] || ''));
      }
      table.appendChild(tr);
    }
    tableWrap.appendChild(table);

    // Formulas + format summary for this sheet (additive).
    try {
      if (formulas.length || dateCols.size || currencyCols.size) {
        const sum = el('div', { style: 'margin-top:8px;' });
        const parts = [];
        if (formulas.length) parts.push('Formulas: ' + formulas.length);
        if (dateCols.size) parts.push('Date columns: ' + dateCols.size);
        if (currencyCols.size) parts.push('Currency columns: ' + currencyCols.size);
        sum.appendChild(el('p', { class: 'anr-hint', style: 'margin:0 0 4px;' }, parts.join(' · ')));
        if (formulas.length) {
          const det = el('details');
          det.appendChild(el('summary', {}, 'Sample formulas'));
          const code = el('pre', { style: 'white-space:pre-wrap;word-break:break-all;margin:6px 0;font-size:12px;' });
          code.textContent = formulas.slice(0, 25).map((f) => f.ref + ': =' + f.formula).join('\n');
          det.appendChild(code);
          sum.appendChild(det);
        }
        tableWrap.appendChild(sum);
      }
    } catch (_) { /* ignore */ }

    if (maxRow > ROW_CAP || maxCol > COL_CAP) {
      tableWrap.appendChild(el('p', { class: 'anr-hint', style: 'margin-top:8px;' },
        `Showing ${showRows + 1} of ${maxRow + 1} rows and ${showCols + 1} of ${maxCol + 1} columns.`));
    }
  }

  sheets.forEach((s, i) => {
    const tab = el('button', { type: 'button', class: 'anr-xlsx-tab' }, s.name);
    tab.addEventListener('click', () => renderSheet(i));
    tabRow.appendChild(tab);
  });

  if (sheets.length) renderSheet(0);
  else sheetCard.appendChild(el('p', { class: 'anr-hint' }, 'No sheets found.'));

  resultsEl.appendChild(integrityCard(file));
}
