/* Analyser - lazy parser chunk: email / calendar / contacts / PIM formats.

   Loaded on demand by renderProprietary() when a file whose FORMATS entry has
   `chunk: 'email'` is opened. Each entry in PARSERS is `({head, file, ext}) => rows`
   where `rows` is a plain object of label->value pairs (rendered as a readout),
   optionally carrying `_sections: [{title, node, open?}]` for collapsible blocks
   and `_previewNode` for an inline preview (e.g. a vCard PHOTO).
   Return null to fall back to the generic identification card.

   Everything here is dependency-free and text-based: MIME/eml, mbox, iCalendar,
   vCard, vCalendar, LDIF and Windows .contact XML are all line-oriented. The
   heavy binary-container PIM formats (msg/pst/ost/nsf/edb/dbx) need an OLE/CFBF
   or proprietary DB engine we don't ship, so they get an identification-only
   card. */

import { el, row, fmtBytes, preBlock } from '../core/util.js';
import { Reader, ascii, findBytes, latin1, utf8, utf16, filetimeToDate } from '../core/binutil.js';
import { parsePlist } from '../lib/plist.js';
import { openCfbf } from '../lib/cfbf.js';

// ---------- shared helpers ----------

// How large a slice we read for the text-based formats (most mail/calendar
// files are small; for mbox/big calendars we sample the head).
const SAMPLE = 4 * 1024 * 1024;   // 4 MB

// Decode a slice of a File as text, tolerant of encoding (we only need ASCII-ish
// headers). Returns '' on failure.
async function readText(file, max = SAMPLE) {
  try { return await file.slice(0, Math.min(file.size, max)).text(); }
  catch (_) { return ''; }
}

// Split a raw email/message blob into [rawHeaders, body] on the first blank line.
function splitHeaderBody(raw) {
  const m = raw.match(/\r?\n\r?\n/);
  if (!m) return [raw, ''];
  return [raw.slice(0, m.index), raw.slice(m.index + m[0].length)];
}

// Unfold RFC 822 / RFC 5322 header continuation lines (a following line that
// begins with whitespace is a continuation of the previous header) and return an
// ordered list of { name, value } plus a case-insensitive lookup map.
function parseHeaders(rawHeaders) {
  const lines = rawHeaders.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (!line) continue;
    if (/^[ \t]/.test(line) && out.length) {
      out[out.length - 1].value += ' ' + line.trim();
      continue;
    }
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    out.push({ name: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() });
  }
  const map = {};
  for (const h of out) {
    const k = h.name.toLowerCase();
    if (map[k] == null) map[k] = h.value;
    else map[k] += '\n' + h.value;   // multi-valued (e.g. Received)
  }
  return { list: out, map };
}

// Decode RFC 2047 encoded-words ("=?utf-8?B?...?=") in a header value so
// subjects/names with non-ASCII show readable. Best-effort; leaves text as-is on
// failure.
function decodeRfc2047(s) {
  if (!s || s.indexOf('=?') < 0) return s || '';
  return s.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (full, charset, enc, data) => {
    try {
      let bytes;
      if (enc.toLowerCase() === 'b') {
        const bin = atob(data.replace(/\s+/g, ''));
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      } else {
        // quoted-printable, '_' = space
        const txt = data.replace(/_/g, ' ');
        const arr = [];
        for (let i = 0; i < txt.length; i++) {
          if (txt[i] === '=' && i + 2 < txt.length) {
            arr.push(parseInt(txt.substr(i + 1, 2), 16)); i += 2;
          } else arr.push(txt.charCodeAt(i));
        }
        bytes = new Uint8Array(arr);
      }
      return new TextDecoder(/utf-?8/i.test(charset) ? 'utf-8' : 'latin1', { fatal: false }).decode(bytes);
    } catch (_) { return full; }
  }).replace(/\?=\s+=\?/g, '');   // join adjacent encoded-words
}

// Parse a Content-Type value -> { type, params{} }.
function parseContentType(v) {
  if (!v) return { type: '', params: {} };
  const parts = v.split(';');
  const type = (parts.shift() || '').trim().toLowerCase();
  const params = {};
  for (const p of parts) {
    const i = p.indexOf('=');
    if (i < 0) continue;
    let val = p.slice(i + 1).trim().replace(/^"|"$/g, '');
    params[p.slice(0, i).trim().toLowerCase()] = val;
  }
  return { type, params };
}

// Decode a quoted-printable body to text (used for body previews).
function decodeQuotedPrintable(s) {
  return s.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

// ---------- eml / MIME ----------

// Core MIME analysis shared by .eml and .emlx. `raw` is the decoded message text.
function analyseMime(raw) {
  const [rawHeaders, body] = splitHeaderBody(raw);
  const { map } = parseHeaders(rawHeaders);
  const get = (k) => decodeRfc2047(map[k] || '');

  const out = {};
  const subj = get('subject');
  if (subj) out['Subject'] = subj;
  if (map['from']) out['From'] = decodeRfc2047(map['from']);
  if (map['to']) out['To'] = decodeRfc2047(map['to']);
  if (map['cc']) out['Cc'] = decodeRfc2047(map['cc']);
  if (map['date']) out['Date'] = map['date'];
  if (map['message-id']) out['Message-ID'] = map['message-id'];

  // Received hops -> rough path length / age indicator.
  const received = (map['received'] || '').split('\n').filter(Boolean);
  out['Received hops'] = received.length;

  // Authentication signals.
  const auth = [];
  const ar = (map['authentication-results'] || '').toLowerCase();
  if (/spf=pass/.test(ar)) auth.push('SPF pass');
  else if (/spf=/.test(ar)) auth.push('SPF ' + (ar.match(/spf=(\w+)/) || [])[1]);
  else if (map['received-spf']) auth.push('SPF (' + (map['received-spf'].split(/\s/)[0] || '?') + ')');
  if (map['dkim-signature'] != null || /dkim=pass/.test(ar)) auth.push(/dkim=pass/.test(ar) ? 'DKIM pass' : 'DKIM signed');
  if (/dmarc=/.test(ar)) auth.push('DMARC ' + (ar.match(/dmarc=(\w+)/) || [])[1]);
  out['Authentication'] = auth.length ? auth.join(', ') : 'none detected';

  // Walk MIME parts (boundary-delimited). Collect parts + attachments.
  const ct = parseContentType(map['content-type']);
  out['Content-Type'] = ct.type || 'text/plain';
  const parts = [];
  const attachments = [];
  let bodyPreview = '';

  if (ct.type.startsWith('multipart/') && ct.params.boundary) {
    const boundary = '--' + ct.params.boundary;
    const chunks = body.split(boundary);
    for (const chunk of chunks) {
      const trimmed = chunk.replace(/^\r?\n/, '');
      if (!trimmed || trimmed.startsWith('--')) continue;
      const [ph, pbRaw] = splitHeaderBody(trimmed);
      const { map: pm } = parseHeaders(ph);
      const pct = parseContentType(pm['content-type']);
      const disp = pm['content-disposition'] || '';
      const fname = decodeRfc2047(
        (pct.params.name) ||
        (disp.match(/filename\*?="?([^";]+)"?/i) || [])[1] || ''
      );
      const isAttach = /attachment/i.test(disp) || fname;
      const sizeApprox = pbRaw.length;
      const label = (pct.type || 'application/octet-stream') + (fname ? ' — ' + fname : '');
      parts.push(label + '  (~' + fmtBytes(sizeApprox) + ')');
      if (isAttach) attachments.push((fname || '(unnamed)') + ' [' + (pct.type || '?') + ', ~' + fmtBytes(sizeApprox) + ']');
      // First text/plain part -> preview.
      if (!bodyPreview && pct.type === 'text/plain') {
        let txt = pbRaw;
        if (/quoted-printable/i.test(pm['content-transfer-encoding'] || '')) txt = decodeQuotedPrintable(txt);
        bodyPreview = txt.trim().slice(0, 4000);
      }
    }
  } else {
    parts.push((ct.type || 'text/plain') + '  (~' + fmtBytes(body.length) + ')');
    let txt = body;
    if (/quoted-printable/i.test(map['content-transfer-encoding'] || '')) txt = decodeQuotedPrintable(txt);
    if (/text\//.test(ct.type || 'text/plain')) bodyPreview = txt.trim().slice(0, 4000);
  }

  out['MIME parts'] = parts.length;
  out['Attachments'] = attachments.length;

  const sections = [];
  sections.push({ title: 'Headers', node: preBlock(rawHeaders.slice(0, 8000)) });
  if (parts.length) sections.push({ title: 'MIME parts (' + parts.length + ')', node: preBlock(parts.join('\n')) });
  if (attachments.length) sections.push({ title: 'Attachments (' + attachments.length + ')', node: preBlock(attachments.join('\n')) });
  if (bodyPreview) sections.push({ title: 'Body preview', node: preBlock(bodyPreview), open: true });

  return { out, sections };
}

async function parseEml(file) {
  const raw = await readText(file);
  if (!raw) return null;
  // Sanity: must look like a header block.
  if (!/^[\w-]+:\s/m.test(raw.slice(0, 2000))) return null;
  const { out, sections } = analyseMime(raw);
  const res = { 'Format': 'Email message (MIME / .eml)', ...out };
  res._sections = sections;
  return res;
}

// ---------- emlx (Apple Mail) ----------
// Layout: first line = decimal byte count of the message, then the raw eml
// message, then a trailing XML plist of Apple Mail flags.
async function parseEmlx(file) {
  const raw = await readText(file);
  if (!raw) return null;
  const nl = raw.indexOf('\n');
  if (nl < 0) return null;
  const firstLine = raw.slice(0, nl).trim();
  const byteCount = parseInt(firstLine, 10);
  if (!Number.isFinite(byteCount) || byteCount <= 0 || !/^\d+$/.test(firstLine)) {
    // Not an emlx wrapper — try as plain eml.
    return parseEml(file);
  }
  const rest = raw.slice(nl + 1);
  const message = rest.slice(0, byteCount);
  const trailer = rest.slice(byteCount);

  const { out, sections } = analyseMime(message);
  const res = { 'Format': 'Apple Mail message (.emlx)', 'Declared message bytes': byteCount.toLocaleString(), ...out };

  // Trailing plist flags.
  const plistStart = trailer.indexOf('<?xml');
  if (plistStart >= 0) {
    try {
      const value = (await parsePlist(new Blob([trailer.slice(plistStart)])).catch(() => null));
      const v = value && value.value;
      if (v && typeof v === 'object') {
        const flagKeys = Object.keys(v).slice(0, 12);
        if (flagKeys.length) {
          res['Apple Mail flags'] = flagKeys.length + ' key(s)';
          const lines = flagKeys.map((k) => k + ': ' + (typeof v[k] === 'object' ? JSON.stringify(v[k]) : v[k]));
          sections.push({ title: 'Trailing plist flags', node: preBlock(lines.join('\n')) });
        }
      }
    } catch (_) {}
  }
  res._sections = sections;
  return res;
}

// ---------- mbox ----------
async function parseMbox(file) {
  const raw = await readText(file);
  if (!raw) return null;
  // Split on "From " at the start of a line (the mbox separator).
  const lines = raw.split(/\r?\n/);
  const msgs = [];           // {from, subject, date}
  let cur = null;
  let inHeaders = false;
  for (const line of lines) {
    // Mbox separator: a line starting with "From " (the envelope sender line).
    if (line.startsWith('From ')) {
      cur = { from: '', subject: '', date: '' };
      msgs.push(cur);
      inHeaders = true;
      continue;
    }
    if (!cur) continue;
    if (inHeaders) {
      if (line === '') { inHeaders = false; continue; }
      const m = line.match(/^(From|Subject|Date):\s*(.*)$/i);
      if (m) {
        const k = m[1].toLowerCase();
        if (k === 'from' && !cur.from) cur.from = decodeRfc2047(m[2]);
        else if (k === 'subject' && !cur.subject) cur.subject = decodeRfc2047(m[2]);
        else if (k === 'date' && !cur.date) cur.date = m[2];
      }
    }
  }
  if (!msgs.length) return null;

  // Date range + top senders.
  const dates = msgs.map((m) => new Date(m.date)).filter((d) => !isNaN(d));
  const senders = {};
  for (const m of msgs) {
    const e = (m.from.match(/[\w.+-]+@[\w.-]+/) || [m.from])[0] || '(unknown)';
    senders[e] = (senders[e] || 0) + 1;
  }
  const topSenders = Object.entries(senders).sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([k, v]) => v + '  ' + k).join('\n');

  const out = {
    'Format': 'Mbox mailbox',
    'Messages (sampled)': msgs.length + (file.size > SAMPLE ? ' (head only)' : ''),
  };
  if (dates.length) {
    const min = new Date(Math.min(...dates)), max = new Date(Math.max(...dates));
    out['Date range'] = min.toLocaleDateString() + ' → ' + max.toLocaleDateString();
  }
  out['Distinct senders'] = Object.keys(senders).length;

  const sample = msgs.slice(0, 200).map((m, i) =>
    (i + 1) + '. ' + (m.subject || '(no subject)') + '\n    ' + (m.from || '?') + (m.date ? '  ·  ' + m.date : '')
  ).join('\n');

  out._sections = [
    { title: 'Top senders', node: preBlock(topSenders) },
    { title: 'Messages (first ' + Math.min(200, msgs.length) + ')', node: preBlock(sample), open: true },
  ];
  return out;
}

// ---------- iCalendar (.ics .ical .ifb) ----------

// Unfold RFC 5545 folded lines: a line beginning with space/tab continues the
// previous one. Returns an array of logical lines.
function unfoldIcal(text) {
  const phys = text.split(/\r?\n/);
  const out = [];
  for (const line of phys) {
    if (/^[ \t]/.test(line) && out.length) out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out;
}

// Split a content line "NAME;PARAM=x:value" -> { name, params, value }.
function icalLine(line) {
  const ci = line.indexOf(':');
  if (ci < 0) return null;
  const head = line.slice(0, ci);
  const value = line.slice(ci + 1);
  const segs = head.split(';');
  const name = segs.shift().toUpperCase();
  const params = {};
  for (const s of segs) { const i = s.indexOf('='); if (i > 0) params[s.slice(0, i).toUpperCase()] = s.slice(i + 1); }
  return { name, params, value };
}

async function parseIcs(file) {
  const text = await readText(file);
  if (!text || !/BEGIN:VCALENDAR/i.test(text)) {
    if (!/BEGIN:V/i.test(text || '')) return null;
  }
  const lines = unfoldIcal(text).map(icalLine).filter(Boolean);
  const out = { 'Format': 'iCalendar' };

  let prodid = '', version = '', method = '';
  const counts = { VEVENT: 0, VTODO: 0, VJOURNAL: 0, VALARM: 0, VFREEBUSY: 0, VTIMEZONE: 0 };
  const events = [];
  let cur = null, curType = null;

  for (const l of lines) {
    if (l.name === 'PRODID') prodid = l.value;
    else if (l.name === 'VERSION' && !version) version = l.value;
    else if (l.name === 'METHOD') method = l.value;
    else if (l.name === 'BEGIN') {
      const t = l.value.toUpperCase();
      if (counts[t] != null) counts[t]++;
      if ((t === 'VEVENT' || t === 'VTODO') && !cur) { cur = { type: t, attendees: 0 }; curType = t; }
    } else if (l.name === 'END') {
      if (cur && l.value.toUpperCase() === curType) {
        if (events.length < 5) events.push(cur);
        cur = null; curType = null;
      }
    } else if (cur) {
      switch (l.name) {
        case 'SUMMARY': cur.summary = l.value; break;
        case 'DTSTART': cur.dtstart = l.value; break;
        case 'DTEND': cur.dtend = l.value; break;
        case 'LOCATION': cur.location = l.value; break;
        case 'ORGANIZER': cur.organizer = (l.params.CN || l.value).replace(/^mailto:/i, ''); break;
        case 'ATTENDEE': cur.attendees++; break;
        case 'RRULE': cur.rrule = l.value; break;
      }
    }
  }

  if (prodid) out['Product (PRODID)'] = prodid;
  if (version) out['Version'] = version;
  if (method) out['Method'] = method;
  out['Events (VEVENT)'] = counts.VEVENT;
  out['To-dos (VTODO)'] = counts.VTODO;
  if (counts.VJOURNAL) out['Journals'] = counts.VJOURNAL;
  if (counts.VFREEBUSY) out['Free/busy'] = counts.VFREEBUSY;
  if (counts.VALARM) out['Alarms'] = counts.VALARM;
  if (counts.VTIMEZONE) out['Timezones'] = counts.VTIMEZONE;

  if (events.length) {
    const lines2 = events.map((e, i) => {
      const bits = [(i + 1) + '. ' + (e.summary || '(no title)')];
      if (e.dtstart) bits.push('   start: ' + e.dtstart);
      if (e.dtend) bits.push('   end:   ' + e.dtend);
      if (e.location) bits.push('   where: ' + e.location);
      if (e.organizer) bits.push('   organizer: ' + e.organizer);
      if (e.attendees) bits.push('   attendees: ' + e.attendees);
      if (e.rrule) bits.push('   repeats: ' + e.rrule);
      return bits.join('\n');
    }).join('\n\n');
    out._sections = [{ title: 'First events', node: preBlock(lines2), open: true }];
  }
  return out;
}

// ---------- vCalendar 1.0 (.vcs) ----------
async function parseVcs(file) {
  const text = await readText(file);
  if (!text || !/BEGIN:VCALENDAR/i.test(text)) return null;
  const lines = unfoldIcal(text).map(icalLine).filter(Boolean);
  const out = { 'Format': 'vCalendar 1.0 (legacy)', 'Legacy': 'yes (superseded by iCalendar/.ics)' };
  let version = '', events = 0, cur = null;
  for (const l of lines) {
    if (l.name === 'VERSION' && !version) version = l.value;
    else if (l.name === 'BEGIN' && l.value.toUpperCase() === 'VEVENT') { events++; if (!cur) cur = {}; }
    else if (cur) {
      if (l.name === 'SUMMARY' && !cur.summary) cur.summary = l.value;
      else if (l.name === 'DTSTART' && !cur.dtstart) cur.dtstart = l.value;
      else if (l.name === 'DTEND' && !cur.dtend) cur.dtend = l.value;
      else if (l.name === 'LOCATION' && !cur.location) cur.location = l.value;
    }
  }
  if (version) out['Version'] = version;
  out['Events'] = events;
  if (cur) {
    if (cur.summary) out['First event'] = cur.summary;
    if (cur.dtstart) out['Start'] = cur.dtstart;
    if (cur.dtend) out['End'] = cur.dtend;
    if (cur.location) out['Location'] = cur.location;
  }
  return out;
}

// ---------- vCard (.vcf .vcard) ----------
async function parseVcf(file) {
  const text = await readText(file);
  if (!text || !/BEGIN:VCARD/i.test(text)) return null;
  const lines = unfoldIcal(text);

  // Split into cards.
  const cards = [];
  let cur = null;
  for (const raw of lines) {
    if (/^BEGIN:VCARD/i.test(raw)) { cur = []; continue; }
    if (/^END:VCARD/i.test(raw)) { if (cur) cards.push(cur); cur = null; continue; }
    if (cur) cur.push(raw);
  }
  if (!cards.length) return null;

  const out = { 'Format': 'vCard', 'Cards': cards.length };

  // Detail the first few cards.
  let photoDataUrl = null;
  const detail = [];
  cards.slice(0, 5).forEach((card, idx) => {
    const props = card.map(icalLine).filter(Boolean);
    const get = (n) => { const p = props.find((x) => x.name === n); return p ? p.value : ''; };
    const all = (n) => props.filter((x) => x.name === n);
    const fn = get('FN') || get('N').split(';').filter(Boolean).reverse().join(' ');
    const bits = [(idx + 1) + '. ' + (fn || '(no name)')];
    const ver = get('VERSION'); if (ver && idx === 0) out['vCard version'] = ver;
    if (get('ORG')) bits.push('   org: ' + get('ORG').replace(/;+$/, ''));
    for (const e of all('EMAIL')) bits.push('   email: ' + e.value);
    for (const t of all('TEL')) bits.push('   tel: ' + t.value);
    for (const a of all('ADR')) bits.push('   adr: ' + a.value.split(';').filter(Boolean).join(', '));
    if (get('BDAY')) bits.push('   bday: ' + get('BDAY'));
    detail.push(bits.join('\n'));

    // First card PHOTO (base64) -> data URL preview.
    if (idx === 0 && !photoDataUrl) {
      const photo = props.find((x) => x.name === 'PHOTO');
      if (photo) {
        const b64 = (photo.params.ENCODING && /b|base64/i.test(photo.params.ENCODING)) ? photo.value.replace(/\s+/g, '') : null;
        // vCard 4.0 may inline a data: URI directly.
        if (/^data:/i.test(photo.value)) photoDataUrl = photo.value.replace(/\s+/g, '');
        else if (b64) {
          const type = (photo.params.TYPE || 'JPEG').toLowerCase();
          const mime = type.indexOf('/') >= 0 ? type : 'image/' + type.replace('jpeg', 'jpeg');
          photoDataUrl = 'data:' + mime + ';base64,' + b64;
        }
      }
    }
  });

  out._sections = [{ title: 'First cards', node: preBlock(detail.join('\n\n')), open: true }];

  if (photoDataUrl) {
    try {
      const img = el('img', { src: photoDataUrl, alt: 'vCard photo', style: 'max-width:160px;max-height:160px;border-radius:6px;display:block;' });
      out._previewNode = el('div', { style: 'margin:8px 0;' }, [
        el('div', { style: 'font-size:12px;opacity:.7;margin-bottom:4px;' }, 'Embedded photo (first card)'),
        img,
      ]);
    } catch (_) {}
  }
  return out;
}

// ---------- LDIF (.ldif .ldi) ----------
async function parseLdif(file) {
  const text = await readText(file);
  if (!text || !/^dn::?\s/im.test(text)) return null;
  // Unfold (LDIF continuation lines start with a single space).
  const phys = text.split(/\r?\n/);
  const logical = [];
  for (const line of phys) {
    if (line.startsWith(' ') && logical.length) logical[logical.length - 1] += line.slice(1);
    else logical.push(line);
  }
  let entries = 0, changes = 0;
  const objectClasses = {};
  const sample = [];
  let curDn = null, curCn = null, curMail = null;
  const flush = () => {
    if (curDn != null) {
      entries++;
      if (sample.length < 5) sample.push('dn: ' + curDn + (curCn ? '\n   cn: ' + curCn : '') + (curMail ? '\n   mail: ' + curMail : ''));
    }
    curDn = curCn = curMail = null;
  };
  for (const line of logical) {
    if (line === '') { flush(); continue; }
    const m = line.match(/^([\w;-]+)::?\s*(.*)$/);
    if (!m) continue;
    const attr = m[1].toLowerCase(), val = m[2];
    if (attr === 'dn') curDn = val;
    else if (attr === 'cn' && !curCn) curCn = val;
    else if (attr === 'mail' && !curMail) curMail = val;
    else if (attr === 'objectclass') objectClasses[val] = (objectClasses[val] || 0) + 1;
    else if (attr === 'changetype') changes++;
  }
  flush();
  if (!entries) return null;

  const out = {
    'Format': 'LDIF (LDAP Data Interchange Format)',
    'Entries': entries,
  };
  if (changes) out['changetype records'] = changes;
  const ocList = Object.entries(objectClasses).sort((a, b) => b[1] - a[1]);
  out['objectClasses'] = ocList.length;

  out._sections = [];
  if (ocList.length) out._sections.push({ title: 'objectClass breakdown', node: preBlock(ocList.map(([k, v]) => v + '  ' + k).join('\n')) });
  if (sample.length) out._sections.push({ title: 'Sample entries', node: preBlock(sample.join('\n\n')), open: true });
  return out;
}

// ---------- Windows .contact (XML) ----------
async function parseContact(file) {
  const text = await readText(file, 1024 * 1024);
  if (!text || !/<c:contact|<contact/i.test(text)) return null;
  let doc;
  try { doc = new DOMParser().parseFromString(text, 'application/xml'); } catch (_) { return null; }
  if (!doc || doc.querySelector('parsererror')) return null;

  // The Windows Contact schema is namespaced (c:); querySelector ignores prefixes
  // by local name in most engines, so match on localName via getElementsByTagName-ish
  // traversal.
  const textOf = (localName) => {
    const els = doc.getElementsByTagName('*');
    for (const e of els) if (e.localName === localName && e.textContent.trim()) return e.textContent.trim();
    return '';
  };
  const allText = (localName) => {
    const res = [];
    const els = doc.getElementsByTagName('*');
    for (const e of els) if (e.localName === localName && e.textContent.trim()) res.push(e.textContent.trim());
    return res;
  };

  const name = textOf('FormattedName') || [textOf('GivenName'), textOf('FamilyName')].filter(Boolean).join(' ');
  const emails = allText('Address').filter((a) => a.indexOf('@') >= 0).concat(allText('EmailAddress'));
  const phones = allText('Number');
  const bday = textOf('Birthday');

  const out = { 'Format': 'Windows Contact (.contact)' };
  if (name) out['Name'] = name;
  if (emails.length) out['Emails'] = emails.length;
  if (phones.length) out['Phone numbers'] = phones.length;
  if (bday) out['Birthday'] = bday;

  const sect = [];
  if (emails.length) sect.push('Emails:\n' + emails.map((e) => '  ' + e).join('\n'));
  if (phones.length) sect.push('Phones:\n' + phones.map((p) => '  ' + p).join('\n'));
  if (sect.length) out._sections = [{ title: 'Contact details', node: preBlock(sect.join('\n\n')), open: true }];
  return out;
}

// ---------- Outlook .msg (CFBF / OLE container) ----------
// An .msg is a Compound File whose streams hold MAPI properties. Each property
// is a directory entry named `__substg1.0_<PROPID><TYPE>` where PROPID is the
// 4-hex-digit MAPI property tag and TYPE is the 4-hex-digit property type:
//   001F = Unicode (UTF-16LE)   001E = 8-bit string (ASCII / code page)
//   0040 = PtypTime (FILETIME)  others (binary etc.) we don't decode here.
// Storages named `__attach_version1.0_<n>` are attachments; each is itself a
// sub-CFBF-storage carrying its own __substg streams (e.g. the long filename).

// Decode a property stream's bytes per its 001F/001E type suffix.
function decodeMapiString(bytes, type) {
  if (!bytes || !bytes.length) return '';
  try {
    if (type === '001f' || type === '101f') return utf16(bytes, true).replace(/\0+$/, '');
    // 001E (and anything 8-bit): try UTF-8, fall back to latin1.
    const s = utf8(bytes);
    return /�/.test(s) ? latin1(bytes).replace(/\0+$/, '') : s.replace(/\0+$/, '');
  } catch (_) { return ''; }
}

// Find a MAPI property string by PROPID (4 hex chars), trying Unicode then ASCII,
// scanning the directory entries of a given CFBF (or a name-prefix subset).
function getMapiProp(cfbf, propid, entryFilter) {
  const want = ('__substg1.0_' + propid).toLowerCase();
  for (const type of ['001f', '001e']) {
    const target = want + type;
    const e = cfbf.rawEntries.find((x) =>
      x.type === 2 && x.name && x.name.toLowerCase() === target &&
      (!entryFilter || entryFilter(x)));
    if (e) {
      const bytes = cfbf.readStream((c) => c.path === e.path) || cfbf.readStream(e.name);
      const s = decodeMapiString(bytes, type);
      if (s) return s;
    }
  }
  return '';
}

// FILETIME property (0040) -> Date. Stored as 8 bytes (lo dword, hi dword) LE.
function getMapiTime(cfbf, propid) {
  const target = ('__substg1.0_' + propid + '0040').toLowerCase();
  const e = cfbf.rawEntries.find((x) => x.type === 2 && x.name && x.name.toLowerCase() === target);
  if (!e) return null;
  const bytes = cfbf.readStream((c) => c.path === e.path) || cfbf.readStream(e.name);
  if (!bytes || bytes.length < 8) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return filetimeToDate(dv.getUint32(0, true), dv.getUint32(4, true));
}

async function parseMsg(file) {
  let cfbf;
  try { cfbf = await openCfbf(file); } catch (_) { return null; }
  if (!cfbf || !cfbf.rawEntries) return null;
  // Must look like a real MAPI message: at least one __substg / __properties /
  // __recip / __attach entry — otherwise it's some other OLE file (doc/xls/msi).
  const looksLikeMsg = cfbf.rawEntries.some((e) =>
    e.name && /^__(substg1\.0_|properties_version1\.0|recip_version1\.0_|attach_version1\.0_)/i.test(e.name));
  if (!looksLikeMsg) return null;

  const subject  = getMapiProp(cfbf, '0037') || getMapiProp(cfbf, '0E1D');   // Subject / normalized
  const senderNm = getMapiProp(cfbf, '0C1A');                                 // Sender display name
  const senderEm = getMapiProp(cfbf, '0C1F') || getMapiProp(cfbf, '5D01');    // Sender email / SMTP
  const toRecip  = getMapiProp(cfbf, '0E04');                                 // Display To
  const ccRecip  = getMapiProp(cfbf, '0E03');                                 // Display Cc
  const bcc      = getMapiProp(cfbf, '0E02');                                 // Display Bcc
  const body     = getMapiProp(cfbf, '1000');                                 // Plain-text body
  const headers  = getMapiProp(cfbf, '007D');                                 // Transport message headers
  const messageId = getMapiProp(cfbf, '1035');                               // Internet Message-ID
  const sentDate = getMapiTime(cfbf, '0039') || getMapiTime(cfbf, '0E06');    // ClientSubmit / DeliveryTime

  // Attachments: storages named __attach_version1.0_<n>. Each has its own
  // __substg children; the long filename is 3707, short name 3704, display 3001.
  const attachStorages = cfbf.rawEntries.filter((e) =>
    e.type === 1 && e.name && /^__attach_version1\.0_/i.test(e.name));
  const attachNames = [];
  for (const st of attachStorages) {
    const prefix = (st.path || st.name) + '/';
    const childFilter = (x) => x.path && x.path.startsWith(prefix);
    const fname =
      getMapiProp(cfbf, '3707', childFilter) ||   // attach long filename
      getMapiProp(cfbf, '3704', childFilter) ||   // attach filename (short)
      getMapiProp(cfbf, '3001', childFilter);     // display name
    attachNames.push(fname || '(unnamed attachment)');
  }

  const from = senderNm
    ? (senderEm ? senderNm + ' <' + senderEm + '>' : senderNm)
    : (senderEm || '');

  const out = { 'Format': 'Outlook Message (.msg, CFBF/OLE)' };
  if (subject)  out['Subject'] = subject;
  if (from)     out['From'] = from;
  if (toRecip)  out['To'] = toRecip;
  if (ccRecip)  out['Cc'] = ccRecip;
  if (bcc)      out['Bcc'] = bcc;
  if (sentDate) out['Date'] = sentDate.toLocaleString();
  if (messageId) out['Message-ID'] = messageId;
  out['Attachments'] = attachNames.length;

  const sections = [];
  if (headers) sections.push({ title: 'Transport headers', node: preBlock(headers.slice(0, 8000)) });
  if (attachNames.length) sections.push({ title: 'Attachments (' + attachNames.length + ')', node: preBlock(attachNames.join('\n')) });
  if (body) sections.push({ title: 'Body preview', node: preBlock(body.trim().slice(0, 4000)), open: true });
  if (sections.length) out._sections = sections;
  return out;
}

// ---------- identification-only (binary container PIM) ----------
// These need a proprietary DB engine (pst/ost/nsf/edb/dbx) we don't ship.
// Surface a minimal identification card.
const IDENT = {
  pst: { Format: 'Outlook Personal Store (.pst)', Note: 'Proprietary !BDN database; requires a PST engine to read folders/messages.' },
  ost: { Format: 'Outlook Offline Store (.ost)', Note: 'Offline cache of an Exchange/Outlook mailbox; same !BDN format as PST.' },
  nsf: { Format: 'IBM/HCL Notes database (.nsf)', Note: 'Notes Storage Facility; on-disk NSF format needs the Notes engine to read documents.' },
  edb: { Format: 'Exchange / ESE database (.edb)', Note: 'Extensible Storage Engine (Jet Blue) page store; requires an ESE reader.' },
  dbx: { Format: 'Outlook Express database (.dbx)', Note: 'Legacy OE mail store; proprietary B-tree index needs a DBX reader.' },
};

function identCard(ext) {
  const e = IDENT[ext];
  return e ? { ...e } : null;
}

// ---------- dispatch ----------
export const PARSERS = {
  eml: (c) => parseEml(c.file),
  emlx: (c) => parseEmlx(c.file),
  mbox: (c) => parseMbox(c.file),
  ics: (c) => parseIcs(c.file),
  ical: (c) => parseIcs(c.file),
  ifb: (c) => parseIcs(c.file),
  vcf: (c) => parseVcf(c.file),
  vcard: (c) => parseVcf(c.file),
  vcs: (c) => parseVcs(c.file),
  ldif: (c) => parseLdif(c.file),
  contact: (c) => parseContact(c.file),
  // Outlook .msg — full CFBF/OLE extraction (falls back to ident card if invalid).
  msg: (c) => parseMsg(c.file),
  // identification-only
  pst: (c) => identCard('pst'),
  ost: (c) => identCard('ost'),
  nsf: (c) => identCard('nsf'),
  edb: (c) => identCard('edb'),
  dbx: (c) => identCard('dbx'),
};
