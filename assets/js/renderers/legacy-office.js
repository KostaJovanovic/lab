/* Analyser - legacy binary Office viewer (DOC / XLS / PPT, 97-2003)
   ============================================================================
   The pre-2007 Office formats are OLE2 / Compound File (CFBF) containers, not
   ZIP+XML. There is no clean styled layout to recover the way DOCX/ODT give us,
   so this is deliberately best-effort: pull the readable content out and show
   it through the same page-sheet preview as the other document viewers.

     .doc  - Word text via the FIB piece table (CLX/PlcPcd), paginated as pages.
     .xls  - Excel BIFF8 cells (SST strings + RK/NUMBER/LABEL), one page/sheet.
     .ppt  - PowerPoint text atoms (TextChars / TextBytes), paginated as pages.

   Every parser is wrapped so a malformed file degrades to a message instead of
   throwing. Formatting, images and exact layout are intentionally not attempted.
   ============================================================================ */

import { el, buildReadout, fmtBytes, integrityCard, errorCard } from '../core/util.js';
import { openCfbf } from '../lib/cfbf.js';
import { paginateFlow, pagedPreviewCard, pagedTextCard, makePage } from './paged.js';

const dvOf = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const u16 = (dv, off) => (off + 2 <= dv.byteLength ? dv.getUint16(off, true) : 0);
const u32 = (dv, off) => (off + 4 <= dv.byteLength ? dv.getUint32(off, true) >>> 0 : 0);

let dec1252, decUtf16;
function cp1252(bytes) {
  if (!dec1252) { try { dec1252 = new TextDecoder('windows-1252'); } catch (_) { dec1252 = new TextDecoder('latin1'); } }
  return dec1252.decode(bytes);
}
function utf16le(bytes) {
  if (!decUtf16) decUtf16 = new TextDecoder('utf-16le');
  return decUtf16.decode(bytes);
}

// Word/PowerPoint use a few control codes as structure; normalise to text.
function cleanText(s) {
  return s
    .replace(/[\x13\x14\x15]/g, '')        // field begin/separator/end markers
    .replace(/[\r\x0B\x07\x0C]/g, '\n')    // para / line / cell / page breaks -> newline
    .replace(/[\x00-\x08\x0E-\x1F]/g, ''); // remaining control chars
}

// Split cleaned text into paragraph <p> blocks for pagination.
function textToContent(text) {
  const container = document.createElement('div');
  const paras = text.split('\n');
  let blanks = 0;
  for (const raw of paras) {
    const line = raw.replace(/\t+$/, '').trimEnd();
    if (!line) { if (++blanks > 1) continue; }
    else blanks = 0;
    const p = document.createElement('p');
    p.style.margin = line ? '0 0 10px' : '0 0 4px';
    p.textContent = line || ' ';
    container.appendChild(p);
  }
  return container;
}

// ---------- .doc (Word 97-2003) ----------

function extractDocText(cf) {
  const wd = cf.readStream('WordDocument');
  if (!wd) return null;
  const dv = dvOf(wd);
  if (u16(dv, 0) !== 0xA5EC) {
    // Not a Word97 FIB - fall back to a printable scrape below.
    return scrapeText(wd);
  }
  const flags = u16(dv, 0x0A);
  const tableName = (flags & 0x0200) ? '1Table' : '0Table';
  const ccpText = u32(dv, 0x4C);
  const fcClx = u32(dv, 0x1A2);
  const lcbClx = u32(dv, 0x1A6);
  const tbl = cf.readStream(tableName) || cf.readStream(tableName === '1Table' ? '0Table' : '1Table');
  if (!tbl || !lcbClx) return scrapeText(wd);

  const tdv = dvOf(tbl);
  // Walk the CLX to find the Pcdt (0x02), skipping any Prc (0x01) blocks.
  let pos = fcClx;
  const end = Math.min(fcClx + lcbClx, tbl.length);
  let plcStart = -1, plcLen = 0;
  while (pos < end) {
    const clxt = tbl[pos];
    if (clxt === 0x01) {            // Prc: 2-byte size + that many bytes
      const cb = u16(tdv, pos + 1);
      pos += 3 + cb;
    } else if (clxt === 0x02) {     // Pcdt: 4-byte lcb + PlcPcd
      plcLen = u32(tdv, pos + 1);
      plcStart = pos + 5;
      break;
    } else break;
  }
  if (plcStart < 0 || plcLen < 4) return scrapeText(wd);

  const n = Math.floor((plcLen - 4) / 12);           // pieces
  const cpBase = plcStart;                            // (n+1) CPs, 4 bytes each
  const pcdBase = plcStart + (n + 1) * 4;             // n PCDs, 8 bytes each
  let out = '';
  const cap = 5000000;
  for (let i = 0; i < n && out.length < cap; i++) {
    const cpStart = u32(tdv, cpBase + i * 4);
    const cpEnd = u32(tdv, cpBase + (i + 1) * 4);
    const fc = u32(tdv, pcdBase + i * 8 + 2);
    const chars = cpEnd - cpStart;
    if (chars <= 0 || chars > cap) continue;
    let text;
    if (fc & 0x40000000) {                            // compressed: 8-bit cp1252
      const off = (fc & 0x3FFFFFFF) >>> 1;
      text = cp1252(wd.subarray(off, off + chars));
    } else {                                          // 16-bit UTF-16LE
      text = utf16le(wd.subarray(fc, fc + chars * 2));
    }
    out += text;
  }
  void ccpText;
  return cleanText(out);
}

// Last-resort: pull printable runs out of a stream when structured parsing
// is not possible. Chooses whichever of cp1252 / utf-16le reads better.
function scrapeText(bytes) {
  const a = cleanText(cp1252(bytes));
  const b = cleanText(utf16le(bytes));
  const score = (s) => (s.match(/[A-Za-zÀ-ɏ]/g) || []).length;
  const pick = score(b) > score(a) * 1.2 ? b : a;
  // Drop control noise; keep lines that still carry a real word or number.
  const lines = pick.split('\n').map((l) => l.replace(/[\x00-\x1F\x7F]/g, '').trim())
    .filter((l) => /[A-Za-z0-9]{3,}/.test(l));
  return lines.join('\n');
}

// ---------- .xls (Excel BIFF8) ----------

function decodeRK(rk) {
  let n;
  if (rk & 0x02) n = rk >> 2;                          // signed 30-bit integer
  else {
    const buf = new ArrayBuffer(8), d = new DataView(buf);
    d.setUint32(0, 0, true);
    d.setUint32(4, (rk & 0xFFFFFFFC) >>> 0, true);
    n = d.getFloat64(0, true);
  }
  if (rk & 0x01) n = n / 100;
  return n;
}

function fmtNum(n) {
  if (!isFinite(n)) return '';
  if (Number.isInteger(n)) return String(n);
  return String(parseFloat(n.toPrecision(12)));
}

// Read a BIFF8 unicode string at `off`; returns {text, next}. Does not follow
// CONTINUE records (used for short inline strings only).
function readShortStr(dv, bytes, off) {
  const cch = u16(dv, off);
  const grbit = bytes[off + 2];
  const high = grbit & 0x01;
  let p = off + 3;
  let text;
  if (high) { text = utf16le(bytes.subarray(p, p + cch * 2)); p += cch * 2; }
  else { text = cp1252(bytes.subarray(p, p + cch)); p += cch; }
  return { text, next: p };
}

// Parse the SST shared-string table, threading through CONTINUE records. Each
// record's data is concatenated, but string char-data that crosses a boundary
// resumes with a fresh 1-byte grbit at the start of the next CONTINUE.
function parseSST(records, startIdx) {
  const strings = [];
  try {
    const bufs = [records[startIdx].data];
    for (let i = startIdx + 1; i < records.length; i++) {
      if (records[i].type === 0x003C) bufs.push(records[i].data); else break;
    }
    let bi = 0, bo = 0;
    const advanceBuf = () => { bi++; bo = 0; };
    const readU8 = () => { while (bi < bufs.length && bo >= bufs[bi].length) advanceBuf(); const v = bufs[bi][bo]; bo++; return v; };
    const readU16 = () => { const a = readU8(); const b = readU8(); return a | (b << 8); };
    const readU32 = () => { const a = readU16(), b = readU16(); return (a | (b << 16)) >>> 0; };
    // Read `nChars` characters of `high` width, splitting across buffers and
    // honouring the per-buffer grbit reset at each boundary.
    const readChars = (nChars, high) => {
      let s = '';
      let left = nChars;
      while (left > 0) {
        while (bi < bufs.length && bo >= bufs[bi].length) {
          advanceBuf();
          if (bi < bufs.length) high = bufs[bi][bo++] & 0x01;   // continuation grbit
        }
        if (bi >= bufs.length) break;
        const avail = bufs[bi].length - bo;
        const width = high ? 2 : 1;
        const canChars = Math.min(left, Math.floor(avail / width));
        if (canChars <= 0) { advanceBuf(); if (bi < bufs.length) high = bufs[bi][bo++] & 0x01; continue; }
        const slice = bufs[bi].subarray(bo, bo + canChars * width);
        s += high ? utf16le(slice) : cp1252(slice);
        bo += canChars * width;
        left -= canChars;
      }
      return s;
    };

    readU32();                          // cstTotal
    const cstUnique = readU32();
    for (let k = 0; k < cstUnique; k++) {
      const cch = readU16();
      const grbit = readU8();
      const high = grbit & 0x01;
      const rich = grbit & 0x08;
      const ext = grbit & 0x04;
      const cRun = rich ? readU16() : 0;
      const cbExt = ext ? readU32() : 0;
      strings.push(readChars(cch, high));
      for (let r = 0; r < cRun * 4; r++) readU8();    // skip rich-text runs
      for (let e = 0; e < cbExt; e++) readU8();        // skip phonetic ext data
    }
  } catch (_) { /* return what we have */ }
  return strings;
}

function extractXlsSheets(cf) {
  const wb = cf.readStream('Workbook') || cf.readStream('Book');
  if (!wb) return null;
  // Split the whole stream into BIFF records once.
  const records = [];
  const wdv = dvOf(wb);
  for (let p = 0; p + 4 <= wb.length;) {
    const type = u16(wdv, p);
    const len = u16(wdv, p + 2);
    const start = p + 4;
    if (start + len > wb.length) break;
    records.push({ type, len, start, data: wb.subarray(start, start + len) });
    p = start + len;
    if (type === 0 && len === 0) break;
  }

  // Globals: BOUNDSHEET names + positions, and the SST.
  const sheets = [];   // { name, pos }
  let sst = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.type === 0x0085) {           // BOUNDSHEET
      const d = dvOf(r.data);
      const pos = u32(d, 0);
      const cch = r.data[6];
      const high = r.data[7] & 0x01;
      const nameBytes = r.data.subarray(8, 8 + (high ? cch * 2 : cch));
      const name = high ? utf16le(nameBytes) : cp1252(nameBytes);
      sheets.push({ name: name || ('Sheet' + (sheets.length + 1)), pos });
    } else if (r.type === 0x00FC) {    // SST
      sst = parseSST(records, i);
    }
  }

  // Map a stream byte-offset (BOUNDSHEET.pos) to a record index.
  const recAtPos = new Map();
  for (let i = 0; i < records.length; i++) recAtPos.set(records[i].start - 4, i);

  const MAX_ROWS = 400, MAX_COLS = 60;
  const out = [];
  const sheetList = sheets.length ? sheets : [{ name: 'Sheet1', pos: -1 }];
  for (let s = 0; s < sheetList.length; s++) {
    let startRec = recAtPos.get(sheetList[s].pos);
    if (startRec == null) startRec = 0;
    const grid = [];
    let maxCol = 0;
    const put = (r, c, v) => {
      if (r >= MAX_ROWS || c >= MAX_COLS) return;
      if (!grid[r]) grid[r] = [];
      grid[r][c] = v;
      if (c > maxCol) maxCol = c;
    };
    for (let i = startRec; i < records.length; i++) {
      const r = records[i];
      if (i > startRec && r.type === 0x0809) break;   // next substream BOF
      if (i > startRec && r.type === 0x000A) break;    // EOF
      const d = dvOf(r.data);
      if (r.type === 0x00FD) {                         // LABELSST
        put(u16(d, 0), u16(d, 2), sst[u32(d, 6)] || '');
      } else if (r.type === 0x0204) {                  // LABEL (inline string)
        try { put(u16(d, 0), u16(d, 2), readShortStr(d, r.data, 6).text); } catch (_) {}
      } else if (r.type === 0x027E) {                  // RK
        put(u16(d, 0), u16(d, 2), fmtNum(decodeRK(u32(d, 6))));
      } else if (r.type === 0x00BD) {                  // MULRK
        const rr = u16(d, 0), cFirst = u16(d, 2);
        const cLast = u16(d, r.data.length - 2);
        let off = 4, c = cFirst;
        while (c <= cLast && off + 6 <= r.data.length) { put(rr, c, fmtNum(decodeRK(u32(d, off + 2)))); off += 6; c++; }
      } else if (r.type === 0x0203) {                  // NUMBER
        put(u16(d, 0), u16(d, 2), fmtNum(d.getFloat64(6, true)));
      } else if (r.type === 0x0006) {                  // FORMULA
        const rr = u16(d, 0), cc = u16(d, 2);
        if (r.data[6] === 0 && r.data[12] === 0xFF && r.data[13] === 0xFF) {
          // string result delivered by the following STRING record
          const nxt = records[i + 1];
          if (nxt && nxt.type === 0x0207) { try { put(rr, cc, readShortStr(dvOf(nxt.data), nxt.data, 0).text); } catch (_) {} }
        } else {
          put(rr, cc, fmtNum(d.getFloat64(6, true)));
        }
      }
    }
    out.push({ name: sheetList[s].name, grid, cols: maxCol + 1 });
  }
  return out;
}

function renderXlsSheetPage(sheet) {
  const page = makePage('sheet');
  page.appendChild(el('div', { class: 'anr-sheet-name' }, sheet.name));
  if (!sheet.grid.length) { page.appendChild(el('p', { style: 'color:#888;' }, '(empty sheet)')); return page; }
  const table = document.createElement('table');
  for (let r = 0; r < sheet.grid.length; r++) {
    const tr = document.createElement('tr');
    const rowArr = sheet.grid[r] || [];
    for (let c = 0; c < sheet.cols; c++) {
      const cell = document.createElement(r === 0 ? 'th' : 'td');
      cell.textContent = rowArr[c] != null ? rowArr[c] : '';
      tr.appendChild(cell);
    }
    table.appendChild(tr);
  }
  page.appendChild(table);
  return page;
}

// ---------- .ppt (PowerPoint 97-2003) ----------

function extractPptText(cf) {
  const doc = cf.readStream('PowerPoint Document') || cf.readStream(/PowerPoint Document/);
  if (!doc) return null;
  const dv = dvOf(doc);
  const runs = [];
  // Walk the record tree; collect TextCharsAtom / TextBytesAtom in order.
  const walk = (start, end, depth) => {
    let p = start;
    while (p + 8 <= end && depth < 30) {
      const verInst = u16(dv, p);
      const type = u16(dv, p + 2);
      const len = u32(dv, p + 4);
      const dataStart = p + 8;
      const dataEnd = Math.min(dataStart + len, end);
      if (dataStart > end) break;
      const isContainer = (verInst & 0x000F) === 0x000F;
      if (isContainer) {
        walk(dataStart, dataEnd, depth + 1);
      } else if (type === 0x0FA0) {                    // TextCharsAtom (UTF-16)
        runs.push(cleanText(utf16le(doc.subarray(dataStart, dataEnd))));
      } else if (type === 0x0FA8) {                    // TextBytesAtom (cp1252)
        runs.push(cleanText(cp1252(doc.subarray(dataStart, dataEnd))));
      }
      p = dataEnd;
    }
  };
  walk(0, doc.length, 0);
  return runs.filter((t) => t && t.trim()).join('\n\n');
}

// ---------- shared shell ----------

function infoCard(file, appLabel, extraRows) {
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, appLabel));
  card.appendChild(buildReadout([
    ['Application', appLabel],
    ['File', file.name],
    ['Size', fmtBytes(file.size)],
    ...(extraRows || []),
    file.lastModified && ['Last modified', new Date(file.lastModified).toLocaleString()],
  ]));
  card.appendChild(el('p', { class: 'anr-hint', style: 'font-size:12px;margin:10px 0 0;' },
    'Legacy binary Office format - content is extracted best-effort. Original fonts, styling, images and exact page layout are not reconstructed.'));
  return card;
}

export async function renderLegacyOffice(file, container, kind) {
  container.hidden = false;
  container.innerHTML = '';
  container.appendChild(el('div', { class: 'anr-info' }, 'Reading document...'));

  try {
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    // A renamed OOXML/ODF (ZIP) file gives a clearer message than a parse failure.
    if (head[0] === 0x50 && head[1] === 0x4B) {
      container.innerHTML = '';
      container.appendChild(errorCard('This file is a ZIP-based Office document (OOXML/ODF) with a legacy extension. Rename it to .' + (kind === 'xls' ? 'xlsx' : kind === 'ppt' ? 'pptx' : 'docx') + ' (or .od*) to view it.'));
      return;
    }

    const cf = await openCfbf(file);
    if (!cf) {
      container.innerHTML = '';
      container.appendChild(errorCard('Not a valid legacy Office (OLE2) file - could not read its compound-file structure.'));
      return;
    }

    container.innerHTML = '';
    let pages = [], fullText = '', appLabel = 'Office document', pageLabel = 'Page';
    const extraRows = [['Container', 'OLE2 / Compound File v' + cf.version]];

    if (kind === 'xls') {
      appLabel = 'Microsoft Excel 97-2003';
      pageLabel = 'Sheet';
      const sheets = extractXlsSheets(cf) || [];
      pages = sheets.map(renderXlsSheetPage);
      fullText = sheets.map((s) => s.grid.map((r) => (r || []).join('\t')).join('\n')).join('\n\n');
      extraRows.push(['Sheets', String(sheets.length)]);
    } else if (kind === 'ppt') {
      appLabel = 'Microsoft PowerPoint 97-2003';
      fullText = extractPptText(cf) || '';
      pages = paginateFlow(textToContent(fullText));
    } else {
      appLabel = 'Microsoft Word 97-2003';
      fullText = extractDocText(cf) || '';
      pages = paginateFlow(textToContent(fullText));
    }

    container.appendChild(infoCard(file, appLabel, extraRows));
    if (pages.length && (fullText.trim() || kind === 'xls')) {
      container.appendChild(pagedPreviewCard(pages, { title: 'Page previews', label: pageLabel }));
      const pageTexts = pages.map((p) => p.textContent);
      if (pageTexts.some((t) => t.trim())) {
        container.appendChild(pagedTextCard(pageTexts, { label: pageLabel }));
      }
    } else {
      container.appendChild(el('div', { class: 'anr-card' }, [
        el('h3', {}, 'Page previews'),
        el('p', { class: 'anr-hint' }, 'No readable content could be extracted from this file.'),
      ]));
    }

    if (file.size <= 500 * 1024 * 1024) container.appendChild(integrityCard(file));
  } catch (e) {
    container.innerHTML = '';
    container.appendChild(errorCard('Could not read document: ' + (e && e.message || 'unknown error')));
  }
}

export const renderDoc = (file, container) => renderLegacyOffice(file, container, 'doc');
export const renderXls = (file, container) => renderLegacyOffice(file, container, 'xls');
export const renderPpt = (file, container) => renderLegacyOffice(file, container, 'ppt');
