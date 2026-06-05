/* Analyser - CSV / TSV preview
   Detects the delimiter, parses quoted fields, infers per-column types,
   reports numeric statistics, and previews the first 100 rows. */

import { el, row, rowHelp, fmtBytes, fileExt, errorCard, integrityCard } from '../core/util.js';

// Quote-aware CSV/TSV parser. Walks the whole text in a single pass so a
// quoted field may contain the delimiter, CR/LF newlines, or escaped ""
// quotes without breaking the row boundaries. (The previous version split the
// text into lines BEFORE parsing quotes, which silently mangled any quoted
// field that spanned a newline - a common case in exported spreadsheets.)
function parseCsv(text, delim) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQuote = false;
  const endField = () => { row.push(cur); cur = ''; };
  // A record made of a single blank field is an empty line - drop it, matching
  // the old `.filter(l => l.trim())` behaviour.
  const endRow = () => {
    endField();
    if (!(row.length === 1 && row[0].trim() === '')) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }  // escaped quote
        else inQuote = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuote = true;
    } else if (ch === delim) {
      endField();
    } else if (ch === '\r') {
      if (text[i + 1] === '\n') i++;                   // swallow CRLF as one break
      endRow();
    } else if (ch === '\n') {
      endRow();
    } else {
      cur += ch;
    }
  }
  // Flush a trailing record that wasn't terminated by a newline.
  if (cur !== '' || row.length > 0) endRow();
  return rows;
}

function delimiterLabel(d) {
  if (d === '\t') return 'Tab';
  if (d === ',') return 'Comma';
  if (d === ';') return 'Semicolon';
  if (d === '|') return 'Pipe';
  return JSON.stringify(d);
}

// Percentile from an ASCENDING-sorted numeric array (linear interpolation).
function percentile(sorted, p) {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// Trim trailing zeros from a fixed-precision number for compact display.
function num(n) {
  if (!isFinite(n)) return String(n);
  return Number(n.toFixed(4)).toString();
}

// Build the additive "extended" stats: fill rate, numeric quartiles/stddev/
// median, text cardinality + top values, date ranges, and a data-quality
// section (ragged rows, duplicates, BOM/line-endings, delimiter confidence).
function buildProfile(card, ctx) {
  const { headers, dataRows, colCount, colTypes, totalRows, hasHeader, delimiter, hasBom, lineEnding } = ctx;

  // Cap the heavy passes so a giant file stays responsive.
  const SAMPLE_CAP = 50000;
  const sample = dataRows.length > SAMPLE_CAP ? dataRows.slice(0, SAMPLE_CAP) : dataRows;
  const sampled = sample.length < dataRows.length;

  // ---- Per-column profiling ----
  const fillTbl = el('table', { class: 'anr-readout' });
  const numTbl = el('table', { class: 'anr-readout' });
  const textTbl = el('table', { class: 'anr-readout' });
  const dateTbl = el('table', { class: 'anr-readout' });
  let hasNum = false, hasText = false, hasDate = false;

  for (let c = 0; c < colCount; c++) {
    const header = headers[c] || `Col ${c + 1}`;
    let filled = 0;
    const nums = [];
    const dates = [];
    const freq = new Map();

    for (const r of sample) {
      const val = (r[c] || '').trim();
      if (val === '') continue;
      filled++;
      if (colTypes[c] === 'number') {
        const n = Number(val);
        if (!isNaN(n)) nums.push(n);
      } else if (colTypes[c] === 'date') {
        const t = Date.parse(val);
        if (!isNaN(t)) dates.push(t);
      } else {
        freq.set(val, (freq.get(val) || 0) + 1);
      }
    }

    const pct = sample.length ? Math.round((filled / sample.length) * 100) : 0;
    fillTbl.appendChild(row(header, `${pct}% filled  (${filled} of ${sample.length})`));

    if (colTypes[c] === 'number' && nums.length > 0) {
      hasNum = true;
      const sorted = nums.slice().sort((a, b) => a - b);
      const mean = nums.reduce((s, n) => s + n, 0) / nums.length;
      const variance = nums.reduce((s, n) => s + (n - mean) * (n - mean), 0) / nums.length;
      const std = Math.sqrt(variance);
      const q1 = percentile(sorted, 0.25);
      const median = percentile(sorted, 0.5);
      const q3 = percentile(sorted, 0.75);
      numTbl.appendChild(row(header,
        `median: ${num(median)}  Q1: ${num(q1)}  Q3: ${num(q3)}  stddev: ${num(std)}`));
    } else if (colTypes[c] === 'date' && dates.length > 0) {
      hasDate = true;
      const minD = new Date(Math.min(...dates)).toISOString().slice(0, 10);
      const maxD = new Date(Math.max(...dates)).toISOString().slice(0, 10);
      dateTbl.appendChild(row(header, `${minD}  →  ${maxD}  (${dates.length} dates)`));
    } else if (colTypes[c] === 'text' && freq.size > 0) {
      hasText = true;
      const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([v, n]) => `${truncate(v)} (${n})`).join(',  ');
      textTbl.appendChild(row(header, `${freq.size} distinct  •  top: ${top}`));
    }
  }

  card.appendChild(el('div', { class: 'anr-readout-section' },
    sampled ? `Fill rate (sampled ${sample.length} rows)` : 'Fill rate'));
  card.appendChild(fillTbl);

  if (hasNum) {
    card.appendChild(el('div', { class: 'anr-readout-section' }, 'Numeric distribution'));
    card.appendChild(numTbl);
  }
  if (hasText) {
    card.appendChild(el('div', { class: 'anr-readout-section' }, 'Text columns (cardinality / top values)'));
    card.appendChild(textTbl);
  }
  if (hasDate) {
    card.appendChild(el('div', { class: 'anr-readout-section' }, 'Date ranges'));
    card.appendChild(dateTbl);
  }

  // ---- Data-quality checks ----
  const expected = headers.length;
  let ragged = 0;
  for (const r of dataRows) {
    if (r.length !== expected) ragged++;
  }

  // Fully-duplicate data rows (compared by joined cells).
  const seen = new Set();
  let dupes = 0;
  for (const r of sample) {
    const key = r.join('');
    if (seen.has(key)) dupes++;
    else seen.add(key);
  }

  // Delimiter confidence: share of data rows split into exactly `expected` cols.
  let consistent = 0;
  for (const r of dataRows) {
    if (r.length === expected) consistent++;
  }
  const conf = dataRows.length ? Math.round((consistent / dataRows.length) * 100) : 100;

  const issues = [];
  if (ragged > 0) {
    issues.push(['Ragged rows',
      `${ragged} row(s) have a column count different from the header (${expected}).`]);
  }
  if (dupes > 0) {
    issues.push(['Duplicate rows',
      `${dupes} fully-duplicate data row(s)${sampled ? ' in sample' : ''}.`]);
  }
  if (hasBom) {
    issues.push(['Encoding', 'A UTF-8 byte-order mark (BOM) was found at the start of the file.']);
  }
  if (lineEnding === 'Mixed (CRLF + LF)') {
    issues.push(['Line endings', 'File mixes CRLF and LF line endings.']);
  }
  if (conf < 100) {
    issues.push(['Delimiter confidence',
      `Only ${conf}% of rows split cleanly into ${expected} columns with "${delimiterLabel(delimiter)}".`]);
  }

  if (issues.length > 0) {
    card.appendChild(el('div', { class: 'anr-readout-section' }, 'Data quality'));
    const qTbl = el('table', { class: 'anr-readout' });
    for (const [k, v] of issues) qTbl.appendChild(row(k, v));
    card.appendChild(qTbl);
  } else {
    card.appendChild(el('div', { class: 'anr-readout-section' }, 'Data quality'));
    const qTbl = el('table', { class: 'anr-readout' });
    qTbl.appendChild(row('Status', 'No issues detected.'));
    qTbl.appendChild(row('Line endings', lineEnding));
    qTbl.appendChild(row('Delimiter confidence', `${conf}% of rows split cleanly into ${expected} columns.`));
    card.appendChild(qTbl);
  }
}

function truncate(s, n = 24) {
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
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

  // --- Encoding / line-ending sniffing (cheap, on raw text) ---
  // A UTF-8 BOM survives File.text() as U+FEFF at index 0.
  const hasBom = text.charCodeAt(0) === 0xfeff;
  if (hasBom) text = text.slice(1);
  const crlfCount = (text.match(/\r\n/g) || []).length;
  const lfOnly = (text.match(/[^\r]\n/g) || []).length + (text[0] === '\n' ? 1 : 0);
  let lineEnding;
  if (crlfCount > 0 && lfOnly === 0) lineEnding = 'CRLF (Windows)';
  else if (crlfCount === 0 && lfOnly > 0) lineEnding = 'LF (Unix)';
  else if (crlfCount > 0 && lfOnly > 0) lineEnding = 'Mixed (CRLF + LF)';
  else lineEnding = 'None';

  // Detect delimiter. For non-TSV files, score the first line across the four
  // common delimiters (comma, tab, semicolon, pipe) instead of only tab-vs-comma.
  const ext = fileExt(file.name);
  let delimiter;
  if (ext === 'tsv') {
    delimiter = '\t';
  } else {
    const firstLine = text.split('\n')[0] || '';
    const candidates = [
      [',', (firstLine.match(/,/g) || []).length],
      ['\t', (firstLine.match(/\t/g) || []).length],
      [';', (firstLine.match(/;/g) || []).length],
      ['|', (firstLine.match(/\|/g) || []).length],
    ];
    candidates.sort((a, b) => b[1] - a[1]);
    delimiter = candidates[0][1] > 0 ? candidates[0][0] : ',';
  }

  // Quote-aware parse of the whole text (handles fields spanning newlines).
  const allRows = parseCsv(text, delimiter);
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
  tbl.appendChild(rowHelp('Delimiter', delimiterLabel(delimiter), 'The character used to separate columns in the file - a comma (.csv), tab (.tsv), semicolon, or pipe.'));
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

    // --- Additive: richer per-column profiling + data-quality checks ---
    // Wrapped so any malformed data can never break the preview below.
    try {
      buildProfile(statsCard, {
        headers, dataRows, colCount, colTypes,
        totalRows, hasHeader, delimiter, hasBom, lineEnding,
      });
    } catch (e) {
      statsCard.appendChild(el('div', { class: 'anr-info' },
        'Extended statistics unavailable: ' + (e && e.message)));
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

  resultsEl.appendChild(integrityCard(file));
}
