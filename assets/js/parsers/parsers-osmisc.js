/* Analyser - lazy parser chunk: OS-specific / system / misc / obscure formats.

   Loaded on demand by renderProprietary() when a file whose FORMATS entry has
   `chunk: 'osmisc'` is opened. Each entry in PARSERS is
   `({head, file, ext}) => rows` where `rows` is a plain object of label->value
   pairs (rendered as a readout), optionally carrying `_sections:[{title,node,
   open?}]` for collapsible blocks or `_previewNode`. Return null to fall back to
   the generic identification card.

   Dependency-free: only the shared toolkit (util/binutil/plist) is imported. */

import { el, row, fmtBytes, preBlock, fmtDate } from '../core/util.js';
import { Reader, ascii, cp437, latin1, utf8, filetimeToDate } from '../core/binutil.js';
import { parsePlist } from '../lib/plist.js';

// ---------- small helpers ----------
// A monospace block that preserves ASCII art (no wrapping, horizontal scroll).
function monoBlock(text) {
  return el('pre', { class: 'anr-code', style: 'max-height:480px;overflow:auto;font-size:12px;line-height:1.2;white-space:pre;margin:0;font-family:monospace;' }, text);
}

// Parse an INI / freedesktop-style file into { section: { key: value } } plus an
// ordered list of section names. Comments (#, ;) and blank lines are skipped.
function parseIni(text) {
  const out = {}; const order = [];
  let cur = '';
  out[cur] = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === '#' || line[0] === ';') continue;
    const sec = line.match(/^\[(.+)\]$/);
    if (sec) {
      cur = sec[1];
      if (!out[cur]) { out[cur] = {}; order.push(cur); }
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    if (out[cur][k] == null) out[cur][k] = v;
  }
  return { sections: out, order };
}

// First DOM element matching a tag name (case-insensitive), searched across the
// whole document; returns its trimmed textContent or ''.
function xmlText(doc, sel) {
  const n = doc.querySelector(sel);
  return n ? (n.textContent || '').trim() : '';
}

// ---------- OPML ----------
async function parseOpml(file) {
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror') || !doc.querySelector('opml')) return null;
  const out = { 'Format': 'OPML outline' };
  const head = doc.querySelector('head');
  if (head) {
    const title = xmlText(head, 'title');
    const created = xmlText(head, 'dateCreated');
    const owner = xmlText(head, 'ownerName');
    if (title) out['Title'] = title;
    if (created) out['Date created'] = created;
    if (owner) out['Owner'] = owner;
  }
  const ver = doc.querySelector('opml').getAttribute('version');
  if (ver) out['Version'] = ver;
  // Feed outlines carry an xmlUrl attribute.
  const outlines = Array.from(doc.querySelectorAll('outline'));
  const feeds = outlines.filter((o) => o.getAttribute('xmlUrl'));
  out['Outline nodes'] = outlines.length;
  out['Feeds (subscriptions)'] = feeds.length;
  if (feeds.length) {
    const lines = feeds.slice(0, 500).map((o) => {
      const t = o.getAttribute('title') || o.getAttribute('text') || '(untitled)';
      const x = o.getAttribute('xmlUrl') || '';
      const h = o.getAttribute('htmlUrl');
      return t + '\n    xml:  ' + x + (h ? '\n    html: ' + h : '');
    });
    out._sections = [{ title: 'Feeds (' + feeds.length + ')', node: preBlock(lines.join('\n\n')), open: feeds.length <= 40 }];
  }
  return out;
}

// ---------- RSS / Atom ----------
async function parseFeed(file) {
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) return null;
  const isAtom = !!doc.querySelector('feed');
  const isRss = !!doc.querySelector('rss, rdf\\:RDF, RDF');
  if (!isAtom && !isRss) return null;

  const out = {};
  let items, enclosures = [];
  const dates = [];

  if (isAtom) {
    out['Format'] = 'Atom feed';
    const feed = doc.querySelector('feed');
    out['Title'] = xmlText(feed, 'title') || '-';
    const sub = xmlText(feed, 'subtitle'); if (sub) out['Subtitle'] = sub;
    out['Items (entries)'] = (items = Array.from(doc.querySelectorAll('entry'))).length;
    for (const e of items) {
      const d = xmlText(e, 'updated') || xmlText(e, 'published');
      if (d) dates.push(new Date(d));
      for (const l of Array.from(e.querySelectorAll('link'))) {
        if (l.getAttribute('rel') === 'enclosure' && l.getAttribute('href')) {
          enclosures.push({ url: l.getAttribute('href'), len: l.getAttribute('length') });
        }
      }
    }
  } else {
    out['Format'] = 'RSS feed';
    const chan = doc.querySelector('channel') || doc.documentElement;
    out['Title'] = xmlText(chan, 'title') || '-';
    const desc = xmlText(chan, 'description'); if (desc) out['Description'] = desc.slice(0, 200);
    const lang = xmlText(chan, 'language'); if (lang) out['Language'] = lang;
    out['Items'] = (items = Array.from(doc.querySelectorAll('item'))).length;
    for (const it of items) {
      const d = xmlText(it, 'pubDate') || xmlText(it, 'date');
      if (d) dates.push(new Date(d));
      for (const en of Array.from(it.querySelectorAll('enclosure'))) {
        if (en.getAttribute('url')) enclosures.push({ url: en.getAttribute('url'), len: en.getAttribute('length') });
      }
    }
  }

  const valid = dates.filter((d) => d instanceof Date && !isNaN(d));
  if (valid.length) {
    const min = new Date(Math.min(...valid)), max = new Date(Math.max(...valid));
    out['Date range'] = fmtDate(min) + '  →  ' + fmtDate(max);
  }
  if (enclosures.length) {
    out['Enclosures'] = enclosures.length;
    const lines = enclosures.slice(0, 300).map((e) => e.url + (e.len ? '  (' + fmtBytes(parseInt(e.len, 10)) + ')' : ''));
    out._sections = [{ title: 'Enclosures (' + enclosures.length + ')', node: preBlock(lines.join('\n')) }];
  }
  return out;
}

// ---------- .desktop (freedesktop entry) ----------
async function parseDesktop(file) {
  const text = await file.text();
  if (!/\[Desktop Entry\]/.test(text)) return null;
  const { sections } = parseIni(text);
  const e = sections['Desktop Entry'] || {};
  const out = { 'Format': 'Freedesktop .desktop entry' };
  for (const [k, label] of [['Type', 'Type'], ['Name', 'Name'], ['GenericName', 'Generic name'],
    ['Comment', 'Comment'], ['Exec', 'Exec'], ['TryExec', 'TryExec'], ['Icon', 'Icon'],
    ['Categories', 'Categories'], ['MimeType', 'MIME types'], ['Terminal', 'Terminal'],
    ['NoDisplay', 'NoDisplay'], ['Hidden', 'Hidden'], ['Version', 'Spec version']]) {
    if (e[k] != null) out[label] = e[k];
  }
  return out;
}

// ---------- .nfo (CP437 scene art, or XML sidecar) ----------
async function parseNfo(file) {
  const bytes = new Uint8Array(await file.slice(0, Math.min(file.size, 2_000_000)).arrayBuffer());
  // Skip a UTF-8/UTF-16 BOM when deciding XML-vs-art.
  let i = 0;
  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) i = 3;
  const firstNonWs = (() => { let p = i; while (p < bytes.length && (bytes[p] === 0x20 || bytes[p] === 0x09 || bytes[p] === 0x0A || bytes[p] === 0x0D)) p++; return bytes[p]; })();
  const isXml = firstNonWs === 0x3C; // '<'

  let textOut;
  if (isXml) {
    textOut = utf8(bytes);
  } else {
    textOut = cp437(bytes);
  }
  const lines = textOut.split(/\r?\n/);
  const out = {
    'Format': isXml ? 'NFO (XML sidecar)' : 'NFO (scene info, CP437)',
    'Encoding': isXml ? 'UTF-8 / XML' : 'CP437 (DOS OEM)',
    'Lines': lines.length,
    'Characters': textOut.length,
  };
  const shown = textOut.length > 200000 ? textOut.slice(0, 200000) + '\n…(truncated)' : textOut;
  out._sections = [{ title: isXml ? 'Document' : 'ASCII art', node: monoBlock(shown), open: true }];
  return out;
}

// ---------- systemd .service unit ----------
async function parseService(file) {
  const text = await file.text();
  if (!/\[Unit\]|\[Service\]|\[Install\]/.test(text)) return null;
  const { sections } = parseIni(text);
  const unit = sections['Unit'] || {}, svc = sections['Service'] || {}, inst = sections['Install'] || {};
  const out = { 'Format': 'systemd unit file' };
  if (unit['Description']) out['Description'] = unit['Description'];
  if (svc['Type']) out['Service type'] = svc['Type'];
  if (svc['ExecStart']) out['ExecStart'] = svc['ExecStart'];
  if (svc['ExecStop']) out['ExecStop'] = svc['ExecStop'];
  if (svc['User']) out['User'] = svc['User'];
  if (svc['Restart']) out['Restart'] = svc['Restart'];
  if (svc['WorkingDirectory']) out['Working directory'] = svc['WorkingDirectory'];
  const deps = [];
  for (const k of ['Requires', 'Wants', 'After', 'Before', 'BindsTo', 'PartOf']) {
    if (unit[k]) deps.push(k + '=' + unit[k]);
  }
  if (deps.length) out['Dependencies'] = deps.length;
  if (inst['WantedBy']) out['WantedBy'] = inst['WantedBy'];
  if (inst['RequiredBy']) out['RequiredBy'] = inst['RequiredBy'];
  if (deps.length) out._sections = [{ title: 'Dependencies', node: preBlock(deps.join('\n')) }];
  return out;
}

// ---------- .crash / Apple .ips crash report ----------
async function parseCrash(file) {
  const text = await file.slice(0, Math.min(file.size, 2_000_000)).text();
  const trimmed = text.replace(/^﻿/, '').trimStart();

  // Apple .ips: a JSON header line, then a JSON body. Or a single JSON object.
  if (trimmed[0] === '{') {
    return parseAppleCrash(trimmed);
  }
  // Plain-text crash log (legacy Apple / generic).
  return parseTextCrash(text);
}

function parseAppleCrash(text) {
  // Try whole-document JSON first.
  let whole = null;
  try { whole = JSON.parse(text); } catch (_) {}
  let header = null, body = null;
  if (whole && (whole.app_name || whole.bug_type || whole.timestamp) && !whole.product) {
    // Some .ips are a single object; treat it as the body and also harvest header-ish keys.
    header = whole; body = whole;
  } else {
    // Header line + body: split on the first newline that ends a complete JSON object.
    const nl = text.indexOf('\n');
    if (nl > 0) {
      try { header = JSON.parse(text.slice(0, nl)); } catch (_) {}
      try { body = JSON.parse(text.slice(nl + 1)); } catch (_) {}
    }
    if (!body) { try { body = JSON.parse(text); } catch (_) {} }
  }
  if (!header && !body) return null;
  const h = header || {}, b = body || {};
  const out = { 'Format': 'Apple crash report (.ips)' };
  const app = b.procName || h.app_name || (b.application_specific_information && b.app_name);
  if (app) out['Process / app'] = app;
  if (h.app_version || b.bundleInfo) out['Version'] = h.app_version || (b.bundleInfo && b.bundleInfo.CFBundleShortVersionString) || '-';
  const bundle = (b.bundleInfo && b.bundleInfo.CFBundleIdentifier) || h.bundleID || b.coalitionName;
  if (bundle) out['Bundle ID'] = bundle;
  if (h.bug_type) out['Bug type'] = h.bug_type;
  if (h.os_version || (b.osVersion && b.osVersion.train)) out['OS version'] = h.os_version || b.osVersion.train;
  if (h.incident_id) out['Incident ID'] = h.incident_id;
  if (h.timestamp || b.captureTime) out['Timestamp'] = h.timestamp || b.captureTime;
  const model = b.modelCode || h.model || (b.deviceInfo);
  if (model) out['Device'] = model;
  if (b.exception) {
    const ex = b.exception;
    if (ex.type) out['Exception type'] = ex.type + (ex.signal ? ' (' + ex.signal + ')' : '');
    if (ex.codes) out['Exception codes'] = ex.codes;
    if (ex.subtype) out['Exception subtype'] = ex.subtype;
  }
  if (typeof b.faultingThread === 'number') out['Faulting thread'] = b.faultingThread;
  if (b.termination) out['Termination'] = (b.termination.indicator || '') + (b.termination.reasons ? ' ' + b.termination.reasons.join(' ') : '');
  // Binary images / UUIDs.
  if (Array.isArray(b.usedImages)) {
    out['Loaded images'] = b.usedImages.length;
    const uuids = b.usedImages.slice(0, 50).map((im) => (im.name || '?') + '  ' + (im.uuid || ''));
    out._sections = [{ title: 'Binary images (' + b.usedImages.length + ')', node: preBlock(uuids.join('\n')) }];
  }
  return out;
}

function parseTextCrash(text) {
  const out = { 'Format': 'Crash report (text)' };
  const grab = (re) => { const m = text.match(re); return m ? m[1].trim() : null; };
  const fields = [
    ['Process', /^Process:\s*(.+)$/m],
    ['Identifier', /^Identifier:\s*(.+)$/m],
    ['Version', /^Version:\s*(.+)$/m],
    ['OS Version', /^OS Version:\s*(.+)$/m],
    ['Hardware Model', /^Hardware Model:\s*(.+)$/m],
    ['Exception Type', /^Exception Type:\s*(.+)$/m],
    ['Exception Codes', /^Exception Codes:\s*(.+)$/m],
    ['Crashed Thread', /^Crashed Thread:\s*(.+)$/m],
  ];
  let any = false;
  for (const [label, re] of fields) { const v = grab(re); if (v) { out[label] = v; any = true; } }
  // Generic fallback: count UUIDs and dump first lines.
  const uuids = (text.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g) || []);
  if (uuids.length) out['UUID references'] = new Set(uuids).size;
  if (!any && !uuids.length && !/Thread \d+|backtrace|signal/i.test(text)) return null;
  out['Lines'] = text.split(/\r?\n/).length;
  out._sections = [{ title: 'Report', node: monoBlock(text.length > 200000 ? text.slice(0, 200000) + '\n…' : text) }];
  return out;
}

// ---------- .ab Android Backup ----------
async function parseAb(file) {
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  if (ascii(head, 0, 14) !== 'ANDROID BACKUP') return null;
  // Format: 5 newline-terminated text lines: magic, version, compressed flag,
  // encryption algorithm, [encryption params...]. Then the tar payload.
  const text = latin1(head);
  const lines = text.split('\n');
  const out = { 'Format': 'Android Backup (.ab)' };
  const version = lines[1] || '';
  const compressed = lines[2] || '';
  const encryption = lines[3] || '';
  out['Backup version'] = version || '?';
  out['Compression'] = compressed === '1' ? 'zlib (deflate)' : compressed === '0' ? 'none' : compressed;
  out['Encryption'] = (encryption && encryption !== 'none') ? encryption : 'none';
  if (compressed === '0' && (!encryption || encryption === 'none')) {
    out['Payload'] = 'uncompressed tar stream follows the header';
  } else {
    out['Payload'] = 'deflate-compressed tar' + (encryption && encryption !== 'none' ? ', AES-encrypted' : '') + ' (adb backup)';
  }
  return out;
}

// ---------- .job Windows Task Scheduler (legacy v1) ----------
async function parseJob(file) {
  const b = new Uint8Array(await file.slice(0, Math.min(file.size, 8192)).arrayBuffer());
  if (b.length < 0x44) return null;
  const r = new Reader(b, true); // little-endian
  // FIXDLEN_DATA header (.job v1 format).
  const productVersion = r.u16();
  const fileVersion = r.u16();
  if (fileVersion !== 1) return null; // sanity: known .job file version is 1
  r.skip(16); // UUID
  const appNameOffset = r.u16();
  const triggerOffset = r.u16();
  const errorRetryCount = r.u16();
  const errorRetryInterval = r.u16();
  const idleDeadline = r.u16();
  const idleWait = r.u16();
  const priority = r.u32();
  const maxRunTime = r.u32();
  const exitCode = r.u32();
  const status = r.u32();
  const flags = r.u32();

  const PRODUCTS = { 0x0400: 'Windows NT 4.0', 0x0500: 'Windows 2000', 0x0501: 'Windows XP', 0x0600: 'Windows Vista' };
  const out = {
    'Format': 'Windows Task Scheduler job (.job v1)',
    'Product version': PRODUCTS[productVersion] || ('0x' + productVersion.toString(16)),
    'File format version': fileVersion,
    'Error retry count': errorRetryCount,
    'Max run time (ms)': maxRunTime === 0xFFFFFFFF ? 'infinite' : maxRunTime,
    'Priority flags': '0x' + priority.toString(16),
  };

  // Variable-length section starts at appNameOffset: each field is a Unicode
  // counted string (u16 length in chars, then UTF-16LE chars incl. trailing NUL).
  try {
    let p = appNameOffset;
    const readUStr = () => {
      if (p + 2 > b.length) return null;
      const len = b[p] | (b[p + 1] << 8); p += 2;
      const bytes = len * 2;
      if (bytes < 0 || p + bytes > b.length) { return null; }
      const s = new TextDecoder('utf-16le').decode(b.subarray(p, p + bytes)).replace(/\0+$/, '');
      p += bytes;
      return s;
    };
    // Running instance count (u16) precedes the application name in the var section.
    if (p + 2 <= b.length) p += 2;
    const appName = readUStr();
    const params = readUStr();
    const workingDir = readUStr();
    const author = readUStr();
    const comment = readUStr();
    if (appName) out['Application'] = appName;
    if (params) out['Parameters'] = params;
    if (workingDir) out['Working directory'] = workingDir;
    if (author) out['Author'] = author;
    if (comment) out['Comment'] = comment;
  } catch (_) {}
  return out;
}

// ---------- .pol Group Policy Registry.pol ----------
async function parsePol(file) {
  const b = new Uint8Array(await file.slice(0, Math.min(file.size, 1_000_000)).arrayBuffer());
  // Header: "PReg" (0x67655250 LE) + version u32.
  if (!(b[0] === 0x50 && b[1] === 0x52 && b[2] === 0x65 && b[3] === 0x67)) return null;
  const r = new Reader(b, true);
  r.skip(4);
  const version = r.u32();
  // Records: '[' key ; value ; type ; size ; data ']' all UTF-16LE, ';' = 0x3B00.
  // Count opening '[' (0x5B 0x00) brackets that start a record.
  let records = 0;
  for (let i = 8; i + 1 < b.length; i += 2) {
    if (b[i] === 0x5B && b[i + 1] === 0x00) records++;
  }
  return {
    'Format': 'Group Policy Registry.pol',
    'Signature': 'PReg',
    'Version': version,
    'Policy records': records,
    'Note': 'Each record = [key;value;type;size;data] applied to HKLM/HKCU',
  };
}

// ---------- PE header (.scr screensaver) ----------
const PE_MACHINE = { 0x014c: 'x86 (i386)', 0x8664: 'x64 (AMD64)', 0x01c0: 'ARM', 0xaa64: 'ARM64', 0x0200: 'IA-64' };
const PE_SUBSYSTEM = { 1: 'Native', 2: 'Windows GUI', 3: 'Windows console', 7: 'POSIX', 9: 'Windows CE GUI', 10: 'EFI application' };
async function parseScr(file) {
  const b = new Uint8Array(await file.slice(0, Math.min(file.size, 4096)).arrayBuffer());
  if (!(b[0] === 0x4D && b[1] === 0x5A)) return null; // 'MZ'
  const r = new Reader(b, true);
  const peOff = r.seek(0x3C).u32();
  if (peOff + 24 > b.length) return null;
  if (!(b[peOff] === 0x50 && b[peOff + 1] === 0x45 && b[peOff + 2] === 0 && b[peOff + 3] === 0)) return null; // 'PE\0\0'
  r.seek(peOff + 4);
  const machine = r.u16();
  const numSections = r.u16();
  const timestamp = r.u32();
  r.skip(4 + 4); // ptr to symbol table, num symbols
  const optHeaderSize = r.u16();
  const characteristics = r.u16();
  const optStart = peOff + 24;
  let magic = 0, subsystem = 0;
  if (optStart + 2 <= b.length) {
    magic = b[optStart] | (b[optStart + 1] << 8);
    // Subsystem sits at offset 68 in the optional header (same for PE32/PE32+).
    const subOff = optStart + 68;
    if (subOff + 2 <= b.length) subsystem = b[subOff] | (b[subOff + 1] << 8);
  }
  const isDll = !!(characteristics & 0x2000);
  const isExe = !!(characteristics & 0x0002);
  const out = {
    'Format': 'Windows screensaver (PE executable)',
    'Machine': PE_MACHINE[machine] || ('0x' + machine.toString(16)),
    'PE type': magic === 0x20b ? 'PE32+ (64-bit)' : magic === 0x10b ? 'PE32 (32-bit)' : 'unknown',
    'Subsystem': PE_SUBSYSTEM[subsystem] || ('0x' + subsystem.toString(16)),
    'Sections': numSections,
    'Executable': isExe ? 'yes' + (isDll ? ' (DLL flag set)' : '') : (isDll ? 'DLL' : 'no'),
  };
  const ts = timestamp ? new Date(timestamp * 1000) : null;
  if (ts && !isNaN(ts) && timestamp < 0xFFFFFFFF) out['Link timestamp'] = fmtDate(ts);
  out['Note'] = '.scr screensavers are standard PE executables run with /s, /c, /p';
  return out;
}

// ---------- identification-only (rare AND hard) ----------
function identDsStore() {
  return { 'Format': 'macOS .DS_Store', 'Note': 'Finder folder-view metadata (Buddy-allocator B-tree). Identification only.' };
}
function identThumbsDb() {
  return { 'Format': 'Windows Thumbs.db', 'Note': 'OLE compound thumbnail cache (legacy Windows Explorer). Identification only.' };
}
function identDsym() {
  return { 'Format': 'dSYM / DWARF debug info', 'Note': 'Mach-O debug symbols (DWARF). Identification only.' };
}
function identSdb() {
  return { 'Format': 'Windows Shim Database (.sdb)', 'Note': 'Application Compatibility shim database. Identification only.' };
}

// ---------- dispatch ----------
export const PARSERS = {
  opml: (c) => parseOpml(c.file),
  rss: (c) => parseFeed(c.file),
  atom: (c) => parseFeed(c.file),
  desktop: (c) => parseDesktop(c.file),
  nfo: (c) => parseNfo(c.file),
  service: (c) => parseService(c.file),
  crash: (c) => parseCrash(c.file),
  ab: (c) => parseAb(c.file),
  job: (c) => parseJob(c.file),
  pol: (c) => parsePol(c.file),
  scr: (c) => parseScr(c.file),
  // identification-only (rare AND hard)
  ds_store: () => identDsStore(),
  thumbsdb: () => identThumbsDb(),
  dsym: () => identDsym(),
  dwarf: () => identDsym(),
  sdb: () => identSdb(),
};
