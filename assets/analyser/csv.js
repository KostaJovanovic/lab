/* Analyser - CSV / TSV preview
   Detects the delimiter, parses quoted fields, infers per-column types,
   reports numeric statistics, and previews the first 100 rows. */

import { el, row, fmtBytes, fileExt, errorCard } from './util.js';

// Simple CSV parser that handles quoted fields
function parseCsvLine(line, delim) {
  const fields = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"' && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuote = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuote = true;
      } else if (ch === delim) {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

export async function renderCsv(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Parsing "${file.name}"…`));

  let text;
  try {
    text = await file.text();
  } catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Could not read file: ' + (e && e.message)));
    return;
  }

  resultsEl.innerHTML = '';

  // Detect delimiter: tab or comma
  const ext = fileExt(file.name);
  let delimiter;
  if (ext === 'tsv') {
    delimiter = '\t';
  } else {
    // Heuristic: check the first line for tabs vs commas
    const firstLine = text.split('\n')[0] || '';
    const tabs = (firstLine.match(/\t/g) || []).length;
    const commas = (firstLine.match(/,/g) || []).length;
    delimiter = tabs > commas ? '\t' : ',';
  }

  const rawLines = text.split(/\r?\n/).filter((l) => l.trim());
  const allRows = rawLines.map((l) => parseCsvLine(l, delimiter));
  const totalRows = allRows.length;
  const colCount = allRows.length > 0 ? Math.max(...allRows.map((r) => r.length)) : 0;

  // Limit display to 100 rows
  const displayRows = allRows.slice(0, 100);
  const hasHeader = totalRows > 1; // assume first row is a header

  // --- Stats card ---
  const statsCard = el('div', { class: 'anr-card' });
  statsCard.appendChild(el('h3', {}, 'CSV / TSV file'));

  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Application', 'CSV / TSV Spreadsheet'));
  tbl.appendChild(row('Name', file.name));
  tbl.appendChild(row('Size', `${fmtBytes(file.size)}   (${file.size.toLocaleString()} bytes)`));
  tbl.appendChild(row('Delimiter', delimiter === '\t' ? 'Tab' : 'Comma'));
  tbl.appendChild(row('Columns', String(colCount)));
  tbl.appendChild(row('Data rows', String(hasHeader ? totalRows - 1 : totalRows)));
  statsCard.appendChild(tbl);

  // Detect column types and compute stats for numeric columns
  if (hasHeader && allRows.length > 1) {
    const headers = allRows[0];
    const dataRows = allRows.slice(1);
    const colTypes = [];
    const numericStats = [];

    for (let c = 0; c < colCount; c++) {
      let numCount = 0;
      let dateCount = 0;
      let textCount = 0;
      const nums = [];

      for (const r of dataRows) {
        const val = (r[c] || '').trim();
        if (val === '') continue;
        const n = Number(val);
        if (!isNaN(n) && val !== '') {
          numCount++;
          nums.push(n);
        } else if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(val) || /^\d{2}[-/]\d{2}[-/]\d{4}/.test(val)) {
          dateCount++;
        } else {
          textCount++;
        }
      }

      const total = numCount + dateCount + textCount;
      let type;
      if (total === 0) type = 'empty';
      else if (numCount / total > 0.8) type = 'number';
      else if (dateCount / total > 0.8) type = 'date';
      else type = 'text';

      colTypes.push(type);
      if (type === 'number' && nums.length > 0) {
        const min = Math.min(...nums);
        const max = Math.max(...nums);
        const mean = nums.reduce((s, n) => s + n, 0) / nums.length;
        numericStats.push({
          col: headers[c] || `Col ${c + 1}`,
          min, max, mean: mean.toFixed(2), count: nums.length
        });
      }
    }

    // Column types table
    statsCard.appendChild(el('div', { class: 'anr-readout-section' }, 'Column types'));
    const typesTbl = el('table', { class: 'anr-readout' });
    for (let c = 0; c < colCount; c++) {
      const header = headers[c] || `Col ${c + 1}`;
      typesTbl.appendChild(row(header, colTypes[c]));
    }
    statsCard.appendChild(typesTbl);

    // Numeric column stats
    if (numericStats.length > 0) {
      statsCard.appendChild(el('div', { class: 'anr-readout-section' }, 'Numeric column statistics'));
      const numTbl = el('table', { class: 'anr-readout' });
      for (const s of numericStats) {
        numTbl.appendChild(row(s.col, `min: ${s.min}  max: ${s.max}  mean: ${s.mean}  (${s.count} values)`));
      }
      statsCard.appendChild(numTbl);
    }
  }

  resultsEl.appendChild(statsCard);

  // --- Data table card ---
  const tableCard = el('div', { class: 'anr-card' });
  tableCard.appendChild(el('h3', {},
    totalRows > 100 ? `Data preview (first 100 of ${totalRows} rows)` : 'Data'));

  const tableWrap = el('div', { class: 'anr-table-wrap' });
  const table = el('table', { class: 'anr-readout anr-table-data' });

  // Header row
  if (hasHeader && displayRows.length > 0) {
    const thead = el('thead', {});
    const headerRow = el('tr', {});
    for (const h of displayRows[0]) {
      headerRow.appendChild(el('th', { class: 'anr-table-sticky' }, h));
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);
  }

  // Data rows
  const tbody = el('tbody', {});
  const start = hasHeader ? 1 : 0;
  for (let i = start; i < displayRows.length; i++) {
    const tr = el('tr', {});
    for (const cell of displayRows[i]) {
      tr.appendChild(el('td', {}, cell));
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  tableCard.appendChild(tableWrap);
  resultsEl.appendChild(tableCard);
}
