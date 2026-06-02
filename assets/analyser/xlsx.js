/* Analyser - XLSX viewer
   Reads .xlsx (Office Open XML spreadsheet) and renders each worksheet as a
   table, with sheet tabs and document metadata. */

import { el, row, fmtBytes, sha256Row } from './util.js';
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

export async function renderXlsx(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading spreadsheet "${file.name}"…`));

  let zip;
  try {
    zip = await openZip(file);
  } catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(el('div', { class: 'anr-error' }, 'Could not read XLSX: ' + (e && e.message)));
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

  // ---- Workbook: sheet names + relationship ids ----
  const sheets = [];
  if (zip.has('xl/workbook.xml')) {
    const wb = parseXml(await zip.text('xl/workbook.xml'));
    for (const s of wb.getElementsByTagName('sheet')) {
      const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      sheets.push({ name: s.getAttribute('name') || 'Sheet', rid });
    }
  }
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
        else value = raw;
      }
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

  // ---- Integrity ----
  const hashCard = el('div', { class: 'anr-card' });
  hashCard.appendChild(el('h3', {}, 'Integrity'));
  const hashTbl = el('table', { class: 'anr-readout' });
  hashTbl.appendChild(sha256Row(file));
  hashCard.appendChild(hashTbl);
  resultsEl.appendChild(hashCard);
}
