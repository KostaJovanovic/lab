/* Analyser - subtitle files (SRT / WebVTT / ASS / SSA)
   Parses cues into a timed list and reports counts, timing, and styling info.
   Pure text parsing, no dependencies. */

import { el, row, rowHelp, h3help, errorCard, fmtBytes } from '../core/util.js';

function fmtTime(sec) {
  if (sec == null || !isFinite(sec)) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const ss = s.toFixed(s < 10 ? 2 : 2).padStart(5, '0');
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + ss;
}

// Parse "HH:MM:SS,mmm" / "HH:MM:SS.mmm" / "MM:SS.mmm" / "H:MM:SS.cc" -> seconds.
function parseTime(t) {
  t = t.trim().replace(',', '.');
  const parts = t.split(':');
  if (!parts.length) return null;
  let s = 0;
  for (const p of parts) s = s * 60 + parseFloat(p);
  return isFinite(s) ? s : null;
}

function parseSrtVtt(text, isVtt) {
  const cues = [];
  // Split on blank lines into blocks.
  const blocks = text.replace(/\r/g, '').split(/\n{2,}/);
  const TIME = /(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})/;
  for (let block of blocks) {
    const lines = block.split('\n').filter((l) => l.length);
    if (!lines.length) continue;
    if (isVtt && /^WEBVTT/.test(lines[0])) continue;
    if (/^(NOTE|STYLE|REGION)\b/.test(lines[0])) continue;   // VTT metadata blocks
    // Find the timing line (may be preceded by an index / cue id line).
    let ti = lines.findIndex((l) => TIME.test(l));
    if (ti < 0) continue;
    const m = lines[ti].match(TIME);
    const start = parseTime(m[1]), end = parseTime(m[2]);
    const txt = lines.slice(ti + 1).join('\n')
      .replace(/<[^>]+>/g, '')      // strip VTT/HTML tags
      .trim();
    if (start != null) cues.push({ start, end, text: txt });
  }
  return cues;
}

function parseAss(text) {
  const cues = [];
  const lines = text.replace(/\r/g, '').split('\n');
  let fmt = null, styles = 0;
  for (const line of lines) {
    if (/^Style:/i.test(line)) styles++;
    if (/^Format:/i.test(line) && fmt === null && /Start/i.test(line) && /Text/i.test(line)) {
      fmt = line.replace(/^Format:\s*/i, '').split(',').map((s) => s.trim().toLowerCase());
    }
    if (/^Dialogue:/i.test(line)) {
      const rest = line.replace(/^Dialogue:\s*/i, '');
      // Split into the fixed fields; Text is the last field (may contain commas).
      const cols = fmt || ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
      const n = cols.length;
      const parts = rest.split(',');
      const head = parts.slice(0, n - 1);
      const txt = parts.slice(n - 1).join(',');
      const obj = {};
      cols.forEach((c, i) => { obj[c] = i < n - 1 ? head[i] : txt; });
      const start = parseTime(obj.start || ''), end = parseTime(obj.end || '');
      const clean = (obj.text || '').replace(/\{[^}]*\}/g, '').replace(/\\N/gi, '\n').trim();
      if (start != null) cues.push({ start, end, text: clean });
    }
  }
  return { cues, styles };
}

export async function renderSubtitles(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';

  let text = '';
  try { text = await file.text(); }
  catch (e) { resultsEl.appendChild(errorCard('Could not read this subtitle file.')); return; }

  const ext = (file.name.split('.').pop() || '').toLowerCase();
  let format, cues = [], styles = 0;
  if (ext === 'ass' || ext === 'ssa' || /^\s*\[Script Info\]/i.test(text)) {
    format = ext === 'ssa' ? 'SubStation Alpha (SSA)' : 'Advanced SubStation Alpha (ASS)';
    const r = parseAss(text); cues = r.cues; styles = r.styles;
  } else if (ext === 'vtt' || /^﻿?WEBVTT/.test(text)) {
    format = 'WebVTT';
    cues = parseSrtVtt(text, true);
  } else {
    format = 'SubRip (SRT)';
    cues = parseSrtVtt(text, false);
  }

  cues.sort((a, b) => a.start - b.start);

  // ---- Stats ----
  const [h, help] = h3help('Subtitles', 'Parses subtitle cues and their timing. SRT, WebVTT, and ASS/SSA are supported.');
  const infoCard = el('div', { class: 'anr-card' });
  infoCard.appendChild(h); infoCard.appendChild(help);
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('File', file.name));
  tbl.appendChild(row('Size', fmtBytes(file.size)));
  tbl.appendChild(row('Format', format));
  tbl.appendChild(row('Cues', String(cues.length)));
  if (styles) tbl.appendChild(row('Styles', String(styles)));
  if (cues.length) {
    const first = cues[0].start;
    const last = cues.reduce((mx, c) => Math.max(mx, c.end || c.start), 0);
    const covered = cues.reduce((sum, c) => sum + Math.max(0, (c.end || c.start) - c.start), 0);
    const chars = cues.reduce((sum, c) => sum + c.text.replace(/\s+/g, ' ').length, 0);
    tbl.appendChild(row('First cue', fmtTime(first)));
    tbl.appendChild(row('Last cue end', fmtTime(last)));
    tbl.appendChild(rowHelp('On-screen time', fmtTime(covered),
      'Total time at least one cue is visible (sum of cue durations).'));
    tbl.appendChild(row('Total characters', chars.toLocaleString()));
  }
  infoCard.appendChild(tbl);
  resultsEl.appendChild(infoCard);

  // ---- Cue list ----
  if (cues.length) {
    const card = el('div', { class: 'anr-card' });
    card.appendChild(el('h3', {}, 'Cues'));
    const list = el('div', { class: 'anr-lrc-list' });
    for (const c of cues) {
      list.appendChild(el('div', { class: 'anr-lrc-line' }, [
        el('span', { class: 'anr-lrc-time' }, fmtTime(c.start)),
        el('span', { class: 'anr-lrc-text' }, c.text || ' '),
      ]));
    }
    card.appendChild(list);
    resultsEl.appendChild(card);
  }
}
