/* Analyser - LRC lyric files
   Parses .lrc (timed lyrics): ID tags like [ar:Artist] and timestamped lines
   like [00:12.34]text (including multiple timestamps per line and enhanced
   word-level <00:12.34> tags). Renders the metadata and the timed lines. */

import { el, row, errorCard } from '../core/util.js';

const META_NAMES = {
  ti: 'Title', ar: 'Artist', al: 'Album', au: 'Author', by: 'Created by',
  offset: 'Offset (ms)', length: 'Length', re: 'Editor', tool: 'Editor', ve: 'Version', '#': 'Comment',
};

// [mm:ss], [mm:ss.xx] or [mm:ss:xx]
const TIME_RE = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
const WORD_RE = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g;

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m + ':' + s.toFixed(2).padStart(5, '0');
}

export async function renderLrc(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';

  let text = '';
  try { text = await file.text(); }
  catch (e) { resultsEl.appendChild(errorCard('Could not read this .lrc file.')); return; }

  const meta = [];
  const lines = [];   // { time: number|null, text: string }

  for (const raw of text.split(/\r?\n/)) {
    // ID tag: [key:value] where key is letters (so it isn't a timestamp).
    const idm = raw.match(/^\s*\[([a-zA-Z#]+):(.*)\]\s*$/);
    if (idm) {
      const key = idm[1].toLowerCase();
      meta.push([META_NAMES[key] || idm[1], idm[2].trim()]);
      continue;
    }
    // Timed lyric line (possibly several timestamps sharing one text).
    const times = [];
    let m;
    TIME_RE.lastIndex = 0;
    while ((m = TIME_RE.exec(raw))) {
      const min = parseInt(m[1], 10);
      const sec = parseFloat(m[2].replace(':', '.'));
      if (isFinite(min) && isFinite(sec)) times.push(min * 60 + sec);
    }
    const lyric = raw.replace(TIME_RE, '').replace(WORD_RE, '').trim();
    if (times.length) { for (const t of times) lines.push({ time: t, text: lyric }); }
    else if (lyric) lines.push({ time: null, text: lyric });
  }

  lines.sort((a, b) => (a.time == null ? Infinity : a.time) - (b.time == null ? Infinity : b.time));

  // ---- Metadata card ----
  const infoCard = el('div', { class: 'anr-card' });
  infoCard.appendChild(el('h3', {}, 'LRC lyrics'));
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('File', file.name));
  tbl.appendChild(row('Lines', String(lines.length)));
  const timed = lines.filter((l) => l.time != null).length;
  tbl.appendChild(row('Timestamped', timed + ' / ' + lines.length + (timed ? '' : ' (plain text)')));
  for (const [name, value] of meta) tbl.appendChild(row(name, value));
  infoCard.appendChild(tbl);
  resultsEl.appendChild(infoCard);

  // ---- Lyrics card ----
  const lyrCard = el('div', { class: 'anr-card' });
  lyrCard.appendChild(el('h3', {}, 'Lyrics'));
  const list = el('div', { class: 'anr-lrc-list' });
  for (const l of lines) {
    const rowEl = el('div', { class: 'anr-lrc-line' }, [
      el('span', { class: 'anr-lrc-time' }, l.time == null ? '' : fmtTime(l.time)),
      el('span', { class: 'anr-lrc-text' }, l.text || ' '),
    ]);
    list.appendChild(rowEl);
  }
  lyrCard.appendChild(list);
  resultsEl.appendChild(lyrCard);
}
