/* Analyser - email message viewer (.eml / .emlx / .mbox)
   ============================================================================
   RFC 822 / MIME messages. .eml is the raw message; .emlx (Apple Mail) prefixes
   a byte-count line and appends a plist trailer; .mbox concatenates many
   messages, each starting with a "From " separator line.

   We parse the headers (unfolding continuation lines, decoding RFC 2047 encoded
   words), walk the MIME tree to find the displayable body (preferring text/html,
   sanitised, else text/plain), and list attachments. Sender authentication
   (SPF / DKIM / DMARC) is surfaced from the Authentication-Results header. No
   network fetches and no scripts ever run - the HTML body is sanitised the same
   way the MHTML viewer sanitises saved web pages.
   ============================================================================ */

import { el, row, buildReadout, fmtBytes, rowHelp, integrityCard, errorCard } from '../core/util.js';

// ---------- header parsing ----------
function splitHeaderBody(text) {
  const i = text.search(/\r?\n\r?\n/);
  if (i < 0) return { head: text, body: '' };
  const m = /\r?\n\r?\n/.exec(text.slice(i));
  return { head: text.slice(0, i), body: text.slice(i + m[0].length) };
}
function parseHeaders(head) {
  const map = {};      // lowercased name -> array of values
  const lines = head.replace(/\r\n/g, '\n').split('\n');
  let cur = null;
  for (const ln of lines) {
    if (/^[ \t]/.test(ln) && cur) { cur.v += ' ' + ln.trim(); continue; }
    const c = ln.indexOf(':');
    if (c < 0) continue;
    const name = ln.slice(0, c).trim().toLowerCase();
    cur = { v: ln.slice(c + 1).trim() };
    (map[name] || (map[name] = [])).push(cur);
  }
  const out = {};
  for (const k in map) out[k] = map[k].map((x) => x.v);
  return out;
}
const h1 = (hdrs, name) => (hdrs[name] && hdrs[name][0]) || '';

// RFC 2047 encoded words: =?charset?B?....?= or =?charset?Q?....?=
function decodeWords(s) {
  if (!s || s.indexOf('=?') < 0) return s || '';
  return s.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (m, cs, enc, data) => {
    try {
      let bytes;
      if (enc.toUpperCase() === 'B') {
        const bin = atob(data.replace(/\s+/g, ''));
        bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
      } else {
        const q = data.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
        bytes = Uint8Array.from(q, (ch) => ch.charCodeAt(0));
      }
      return new TextDecoder(/utf-?8/i.test(cs) ? 'utf-8' : 'iso-8859-1').decode(bytes);
    } catch (_) { return m; }
  }).replace(/\?=\s+=\?/g, '');
}

function paramOf(headerVal, key) {
  const re = new RegExp(key + '\\s*=\\s*"?([^";]+)"?', 'i');
  const m = re.exec(headerVal || '');
  return m ? m[1].trim() : '';
}
function decodeBody(body, encoding, charset) {
  const enc = (encoding || '').toLowerCase();
  let bytes;
  if (enc.includes('base64')) {
    try { const bin = atob(body.replace(/\s+/g, '')); bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0)); }
    catch (_) { return body; }
  } else if (enc.includes('quoted-printable')) {
    const q = body.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    bytes = Uint8Array.from(q, (c) => c.charCodeAt(0));
  } else {
    return body;
  }
  try { return new TextDecoder(/utf-?8/i.test(charset || '') ? 'utf-8' : 'iso-8859-1').decode(bytes); }
  catch (_) { return body; }
}

// Walk the MIME tree. Returns { html, text, attachments:[{name,type,size}] }.
function walkMime(head, body, acc) {
  const hdrs = parseHeaders(head);
  const ctype = (h1(hdrs, 'content-type') || 'text/plain').toLowerCase();
  const cte = h1(hdrs, 'content-transfer-encoding');
  const cdisp = h1(hdrs, 'content-disposition');

  if (ctype.startsWith('multipart/')) {
    const boundary = paramOf(h1(hdrs, 'content-type'), 'boundary');
    if (!boundary) return;
    const parts = body.split('--' + boundary);
    for (let p of parts) {
      p = p.replace(/^\r?\n/, '');
      if (!p || p.startsWith('--')) continue;
      const sub = splitHeaderBody(p);
      walkMime(sub.head, sub.body, acc);
    }
    return;
  }

  const filename = paramOf(cdisp, 'filename') || paramOf(h1(hdrs, 'content-type'), 'name');
  const isAttach = /attachment/i.test(cdisp) || (filename && !ctype.startsWith('text/'));
  if (isAttach) {
    acc.attachments.push({ name: decodeWords(filename) || '(unnamed)', type: ctype.split(';')[0], size: Math.round(body.replace(/\s+/g, '').length * 0.75) });
    return;
  }
  const charset = paramOf(h1(hdrs, 'content-type'), 'charset');
  const decoded = decodeBody(body, cte, charset);
  if (ctype.startsWith('text/html')) { if (!acc.html) acc.html = decoded; }
  else if (ctype.startsWith('text/plain')) { if (!acc.text) acc.text = decoded; }
}

// Sanitise an HTML body for inert display (no scripts/styles/network/handlers).
function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, link, meta, iframe, object, embed, noscript, base, title').forEach((n) => n.remove());
  for (const node of doc.querySelectorAll('*')) {
    for (const attr of [...node.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) node.removeAttribute(attr.name);
      else if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(attr.value)) node.removeAttribute(attr.name);
      else if (name === 'src' || name === 'srcset' || name === 'background') node.removeAttribute(attr.name);
      else if (name === 'style' && /url\s*\(/i.test(attr.value)) node.removeAttribute(attr.name);
    }
  }
  const container = el('div', { class: 'anr-email-html' });
  const b = doc.body || doc.documentElement;
  for (const child of [...b.childNodes]) container.appendChild(child);
  return container;
}

function authVerdict(hdrs) {
  const blob = ((hdrs['authentication-results'] || []).join(' ') + ' ' +
    (hdrs['received-spf'] || []).join(' ')).toLowerCase();
  const find = (re) => { const m = re.exec(blob); return m ? m[1] : null; };
  return {
    spf: find(/spf=(\w+)/) || (blob.includes('received-spf') ? null : null),
    dkim: find(/dkim=(\w+)/),
    dmarc: find(/dmarc=(\w+)/),
    has: blob.trim().length > 0,
  };
}

// Build a card for one parsed message.
function messageCard(text, title) {
  const { head, body } = splitHeaderBody(text);
  const hdrs = parseHeaders(head);
  const acc = { html: null, text: null, attachments: [] };
  try { walkMime(head, body, acc); } catch (_) {}
  if (!acc.html && !acc.text) acc.text = body;   // not MIME / single part

  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, title || 'Message'));

  const rows = [
    ['From', decodeWords(h1(hdrs, 'from'))],
    ['To', decodeWords(h1(hdrs, 'to'))],
    h1(hdrs, 'cc') && ['Cc', decodeWords(h1(hdrs, 'cc'))],
    ['Subject', decodeWords(h1(hdrs, 'subject')) || '(no subject)'],
    h1(hdrs, 'date') && ['Date', h1(hdrs, 'date')],
    (hdrs['received'] && hdrs['received'].length) && rowHelp('Received hops', String(hdrs['received'].length),
      'How many mail servers relayed this message, counted from the Received: headers - the message\'s delivery path.'),
  ];
  const auth = authVerdict(hdrs);
  if (auth.has) {
    const parts = [];
    if (auth.spf) parts.push('SPF ' + auth.spf);
    if (auth.dkim) parts.push('DKIM ' + auth.dkim);
    if (auth.dmarc) parts.push('DMARC ' + auth.dmarc);
    if (parts.length) rows.push(rowHelp('Authentication', parts.join('  -  '),
      'Sender-authentication results recorded by the receiving server: SPF (sending IP allowed), DKIM (cryptographic signature valid) and DMARC (alignment policy). "pass" is good; "fail" or "none" is worth noting.'));
  }
  card.appendChild(buildReadout(rows.filter(Boolean)));

  if (acc.attachments.length) {
    card.appendChild(el('h4', { class: 'anr-subhead' }, 'Attachments (' + acc.attachments.length + ')'));
    const tbl = el('table', { class: 'anr-readout' });
    for (const a of acc.attachments) tbl.appendChild(row(a.name, a.type + '  -  ' + fmtBytes(a.size)));
    card.appendChild(tbl);
  }

  card.appendChild(el('h4', { class: 'anr-subhead' }, 'Message body'));
  if (acc.html) {
    card.appendChild(sanitizeHtml(acc.html));
  } else {
    const pre = el('pre', { class: 'anr-pagetext' });
    pre.textContent = (acc.text || '').trim() || '(empty body)';
    card.appendChild(pre);
  }
  return card;
}

// ---------- entry points ----------
export async function renderEml(file, container) {
  container.hidden = false;
  container.innerHTML = '';
  container.appendChild(el('div', { class: 'anr-info' }, 'Reading message...'));
  try {
    let text = await file.text();
    // .emlx: first line is a byte count; a plist trailer follows the message.
    if (/\.emlx$/i.test(file.name)) {
      const nl = text.indexOf('\n');
      const n = parseInt(text.slice(0, nl), 10);
      if (nl > 0 && Number.isFinite(n)) text = text.slice(nl + 1, nl + 1 + n);
    }
    container.innerHTML = '';
    const info = el('div', { class: 'anr-card' });
    info.appendChild(el('h3', {}, 'Email message'));
    info.appendChild(buildReadout([['File', file.name], ['Size', fmtBytes(file.size)]]));
    container.appendChild(info);
    container.appendChild(messageCard(text));
    if (file.size <= 500 * 1024 * 1024) container.appendChild(integrityCard(file));
  } catch (e) {
    container.innerHTML = '';
    container.appendChild(errorCard('Could not read message: ' + (e && e.message || 'unknown error')));
  }
}

export async function renderMbox(file, container) {
  container.hidden = false;
  container.innerHTML = '';
  container.appendChild(el('div', { class: 'anr-info' }, 'Reading mailbox...'));
  try {
    const text = await file.text();
    // Split on lines beginning with "From " (the mbox message separator).
    const chunks = text.split(/\r?\n(?=From )/).map((c) => c.replace(/^From .*\r?\n/, '')).filter((c) => c.trim());
    container.innerHTML = '';
    const info = el('div', { class: 'anr-card' });
    info.appendChild(el('h3', {}, 'Mailbox (mbox)'));
    info.appendChild(buildReadout([
      ['File', file.name],
      ['Size', fmtBytes(file.size)],
      ['Messages', chunks.length.toLocaleString()],
    ]));
    container.appendChild(info);

    if (!chunks.length) { container.appendChild(el('div', { class: 'anr-card' }, [el('h3', {}, 'Messages'), el('p', { class: 'anr-hint' }, 'No messages found in this mailbox.')])); return; }

    let shown = 0;
    const BATCH = 10;
    const host = el('div');
    container.appendChild(host);
    const btnRow = el('div', { class: 'anr-btn-row' });
    const moreBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Show more messages');
    btnRow.appendChild(moreBtn);
    container.appendChild(btnRow);
    function reveal(upTo) {
      for (; shown < upTo && shown < chunks.length; shown++) host.appendChild(messageCard(chunks[shown], 'Message ' + (shown + 1)));
      if (shown >= chunks.length) btnRow.hidden = true;
      else moreBtn.textContent = 'Show more messages (' + shown + '/' + chunks.length + ')';
    }
    moreBtn.addEventListener('click', () => reveal(shown + BATCH));
    reveal(Math.min(chunks.length, BATCH));

    if (file.size <= 500 * 1024 * 1024) container.appendChild(integrityCard(file));
  } catch (e) {
    container.innerHTML = '';
    container.appendChild(errorCard('Could not read mailbox: ' + (e && e.message || 'unknown error')));
  }
}
