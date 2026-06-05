/* Analyser - lazy parser chunk: developer / data / serialization formats.

   Loaded on demand by renderProprietary() when a file whose FORMATS entry has
   `chunk: 'dev'` is opened. Each entry in PARSERS is `({head, file, ext}) => rows`
   where `rows` is a plain object of label->value pairs (rendered as a readout),
   optionally carrying `_sections: [{title, node, open?}]` for collapsible blocks.
   Return null to fall back to the generic identification card. */

import { el, row, fmtBytes, preBlock } from '../core/util.js';
import { Reader, ascii, findBytes } from '../core/binutil.js';
import { parsePlist } from '../lib/plist.js';

// ---------- small helpers ----------
function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const b64urlToStr = (s) => new TextDecoder('utf-8').decode(b64urlToBytes(s));

// A simple two-column readout table from an array of [label, value] pairs.
function rowsTable(pairs) {
  const t = el('table', { class: 'anr-readout' });
  for (const [k, v] of pairs) t.appendChild(row(k, String(v)));
  return t;
}

// Unsigned LEB128 from a byte array at cursor {i}.
function uleb(b, cur) { let r = 0, sh = 0, x; do { x = b[cur.i++]; r += (x & 0x7f) * Math.pow(2, sh); sh += 7; } while (x & 0x80); return r; }

// ---------- JSON Web Token ----------
async function parseJwt(file) {
  const text = (await file.text()).trim();
  const parts = text.split('.');
  if (parts.length < 2) return null;
  let header, payload;
  try { header = JSON.parse(b64urlToStr(parts[0])); } catch (_) { return null; }
  try { payload = JSON.parse(b64urlToStr(parts[1])); } catch (_) { payload = null; }
  const out = { 'Token type': 'JSON Web Token' };
  if (header.alg) out['Algorithm'] = header.alg;
  if (header.typ) out['Header typ'] = header.typ;
  if (header.kid) out['Key ID (kid)'] = header.kid;
  out['Signature present'] = parts.length === 3 && parts[2].length ? 'yes' : 'no';
  const claims = [];
  if (payload) {
    const map = { iss: 'Issuer', sub: 'Subject', aud: 'Audience', jti: 'JWT ID', scope: 'Scope', name: 'Name', email: 'Email' };
    for (const [k, label] of Object.entries(map)) if (payload[k] != null) out[label] = Array.isArray(payload[k]) ? payload[k].join(', ') : String(payload[k]);
    for (const [k, label] of [['iat', 'Issued at'], ['nbf', 'Not before'], ['exp', 'Expires']]) {
      if (typeof payload[k] === 'number') out[label] = new Date(payload[k] * 1000).toLocaleString();
    }
    if (typeof payload.exp === 'number') out['Status'] = (payload.exp * 1000 < Date.now()) ? 'EXPIRED' : 'valid';
    for (const [k, v] of Object.entries(payload)) claims.push([k, typeof v === 'object' ? JSON.stringify(v) : String(v)]);
  }
  const warn = [];
  if (String(header.alg).toLowerCase() === 'none') warn.push('alg: none - token is unsigned (accept with caution)');
  if (out['Status'] === 'EXPIRED') warn.push('Token is expired');
  if (warn.length) out['⚠ Warning'] = warn.join('; ');
  const sections = [{ title: 'Header', node: preBlock(JSON.stringify(header, null, 2)) }];
  if (payload) sections.push({ title: 'Payload claims (' + claims.length + ')', node: preBlock(JSON.stringify(payload, null, 2)), open: true });
  out._sections = sections;
  return out;
}

// ---------- HTTP Archive (.har) ----------
async function parseHar(file) {
  let j; try { j = JSON.parse(await file.text()); } catch (_) { return null; }
  const log = j.log; if (!log) return null;
  const entries = log.entries || [];
  const out = { 'Format': 'HTTP Archive (HAR ' + (log.version || '?') + ')' };
  if (log.creator) out['Creator'] = (log.creator.name || '') + ' ' + (log.creator.version || '');
  out['Requests'] = entries.length;
  let bytes = 0, slow = 0, secrets = 0;
  const status = {}, types = {};
  for (const e of entries) {
    const r = e.response || {};
    bytes += (r.content && r.content.size) || 0;
    if ((e.time || 0) > 1000) slow++;
    const code = r.status || 0; status[code] = (status[code] || 0) + 1;
    const ct = ((r.content && r.content.mimeType) || '').split(';')[0]; if (ct) types[ct] = (types[ct] || 0) + 1;
    const hdrs = ((e.request && e.request.headers) || []).concat((r.headers) || []);
    if (hdrs.some((h) => /^(authorization|cookie|set-cookie)$/i.test(h.name || ''))) secrets++;
  }
  out['Total content size'] = fmtBytes(bytes);
  out['Slow requests (>1s)'] = slow;
  if (secrets) out['⚠ Auth/cookie headers'] = secrets + ' request(s) carry credentials';
  const topStatus = Object.entries(status).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ': ' + v).join('  ');
  const topTypes = Object.entries(types).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => k + ' (' + v + ')').join('\n');
  out['Status codes'] = topStatus;
  out._sections = [{ title: 'Content types', node: preBlock(topTypes) }];
  return out;
}

// ---------- Jupyter Notebook ----------
async function parseIpynb(file) {
  let j; try { j = JSON.parse(await file.text()); } catch (_) { return null; }
  if (!Array.isArray(j.cells)) return null;
  const out = { 'Format': 'Jupyter Notebook' };
  out['nbformat'] = (j.nbformat || '?') + '.' + (j.nbformat_minor || 0);
  const ks = (j.metadata && j.metadata.kernelspec) || {};
  const li = (j.metadata && j.metadata.language_info) || {};
  if (ks.display_name || ks.name) out['Kernel'] = ks.display_name || ks.name;
  if (li.name) out['Language'] = li.name + (li.version ? ' ' + li.version : '');
  const counts = {}; let codeLines = 0, outputs = 0;
  for (const c of j.cells) {
    counts[c.cell_type] = (counts[c.cell_type] || 0) + 1;
    if (c.cell_type === 'code') {
      codeLines += (Array.isArray(c.source) ? c.source.length : String(c.source || '').split('\n').length);
      outputs += (c.outputs || []).length;
    }
  }
  out['Cells'] = j.cells.length + ' (' + Object.entries(counts).map(([k, v]) => v + ' ' + k).join(', ') + ')';
  out['Code lines'] = codeLines;
  out['Outputs'] = outputs;
  return out;
}

// ---------- JSON Lines / NDJSON ----------
async function parseJsonl(file) {
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  let valid = 0; const keys = new Set();
  for (const l of lines.slice(0, 5000)) {
    try { const o = JSON.parse(l); valid++; if (o && typeof o === 'object' && !Array.isArray(o)) for (const k of Object.keys(o)) keys.add(k); } catch (_) {}
  }
  return {
    'Format': 'JSON Lines / NDJSON',
    'Records': lines.length,
    'Valid (first 5k)': valid,
    'Union keys': keys.size + (keys.size ? ': ' + Array.from(keys).slice(0, 20).join(', ') : ''),
  };
}

// ---------- Unified diff / patch ----------
async function parseDiff(file) {
  const text = await file.text();
  const lines = text.split(/\r?\n/);
  const files = new Set(); let add = 0, del = 0;
  for (const l of lines) {
    if (l.startsWith('diff --git')) { const m = l.match(/ b\/(.+)$/); if (m) files.add(m[1]); }
    else if (l.startsWith('+++ ')) { const m = l.match(/\+\+\+ b?\/?(.+)$/); if (m && m[1] !== '/dev/null') files.add(m[1].trim()); }
    else if (l.startsWith('+') && !l.startsWith('+++')) add++;
    else if (l.startsWith('-') && !l.startsWith('---')) del++;
  }
  return {
    'Format': 'Unified diff / patch',
    'Files changed': files.size,
    'Additions': '+' + add,
    'Deletions': '-' + del,
    _sections: files.size ? [{ title: 'Files (' + files.size + ')', node: preBlock(Array.from(files).join('\n')) }] : null,
  };
}

// ---------- WebAssembly binary ----------
const WASM_SECTIONS = ['Custom', 'Type', 'Import', 'Function', 'Table', 'Memory', 'Global', 'Export', 'Start', 'Element', 'Code', 'Data', 'DataCount', 'Tag'];
async function parseWasm(file) {
  const b = new Uint8Array(await file.slice(0, Math.min(file.size, 262144)).arrayBuffer());
  if (!(b[0] === 0x00 && b[1] === 0x61 && b[2] === 0x73 && b[3] === 0x6d)) return null;
  const version = b[4] | (b[5] << 8) | (b[6] << 16) | (b[7] << 24);
  const out = { 'Format': 'WebAssembly binary', 'Version': version };
  const cur = { i: 8 }; const secCounts = {}; const found = []; let producer = null;
  try {
    while (cur.i < b.length) {
      const id = b[cur.i++];
      const size = uleb(b, cur);
      const end = cur.i + size;
      const name = WASM_SECTIONS[id] || ('id ' + id);
      found.push(name);
      if (id === 2 || id === 3 || id === 7) {           // Import / Function / Export vectors
        const c2 = { i: cur.i }; const n = uleb(b, c2); secCounts[name] = n;
      }
      if (id === 0) {                                    // Custom section - grab its name
        const c2 = { i: cur.i }; const nlen = uleb(b, c2);
        const nm = ascii(b, c2.i, nlen);
        if (/producers|name/.test(nm)) producer = nm;
      }
      cur.i = end;
      if (found.length > 200) break;
    }
  } catch (_) {}
  if (secCounts['Import'] != null) out['Imports'] = secCounts['Import'];
  if (secCounts['Function'] != null) out['Functions'] = secCounts['Function'];
  if (secCounts['Export'] != null) out['Exports'] = secCounts['Export'];
  out['Sections'] = found.join(', ');
  if (producer) out['Custom section'] = producer;
  return out;
}

// ---------- Java .class ----------
const JDK = { 45: '1.1', 46: '1.2', 47: '1.3', 48: '1.4', 49: '5', 50: '6', 51: '7', 52: '8', 53: '9', 54: '10', 55: '11', 56: '12', 57: '13', 58: '14', 59: '15', 60: '16', 61: '17', 62: '18', 63: '19', 64: '20', 65: '21', 66: '22', 67: '23' };
function parseClass(head) {
  if (!(head[0] === 0xCA && head[1] === 0xFE && head[2] === 0xBA && head[3] === 0xBE)) return null;
  const r = new Reader(head); r.skip(4);
  const minor = r.u16(), major = r.u16();
  const cpCount = r.u16();
  return {
    'Format': 'Java class file',
    'Bytecode version': major + '.' + minor + (JDK[major] ? ' (Java ' + JDK[major] + ')' : ''),
    'Constant pool entries': cpCount - 1,
  };
}

// ---------- NumPy .npy ----------
async function parseNpy(file) {
  const b = new Uint8Array(await file.slice(0, 256).arrayBuffer());
  if (!(b[0] === 0x93 && b[1] === 0x4e && b[2] === 0x55 && b[3] === 0x4d && b[4] === 0x50 && b[5] === 0x59)) return null;
  const major = b[6];
  const r = new Reader(b, true); r.seek(8);
  const hlen = major >= 2 ? r.u32() : r.u16();
  const header = new TextDecoder('latin1').decode(b.subarray(r.tell(), r.tell() + hlen));
  const dtype = (header.match(/'descr':\s*'([^']+)'/) || [])[1];
  const fortran = /'fortran_order':\s*True/.test(header);
  const shape = (header.match(/'shape':\s*\(([^)]*)\)/) || [])[1];
  const dims = shape ? shape.split(',').map((s) => s.trim()).filter(Boolean) : [];
  return {
    'Format': 'NumPy array (.npy v' + major + ')',
    'Data type': dtype || '?',
    'Shape': '(' + dims.join(', ') + ')',
    'Elements': dims.reduce((a, d) => a * (parseInt(d, 10) || 1), 1).toLocaleString(),
    'Order': fortran ? 'Fortran (column-major)' : 'C (row-major)',
  };
}

// ---------- Safetensors ----------
async function parseSafetensors(file) {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const r = new Reader(head, true);
  const n = Number(r.u64());
  if (n <= 0 || n > 100_000_000 || n + 8 > file.size) return null;
  let meta; try { meta = JSON.parse(new TextDecoder('utf-8').decode(new Uint8Array(await file.slice(8, 8 + n).arrayBuffer()))); } catch (_) { return null; }
  const names = Object.keys(meta).filter((k) => k !== '__metadata__');
  const dtypes = {}; let params = 0;
  for (const k of names) {
    const t = meta[k]; if (!t || !t.shape) continue;
    dtypes[t.dtype] = (dtypes[t.dtype] || 0) + 1;
    params += (t.shape.length ? t.shape.reduce((a, b) => a * b, 1) : 0);
  }
  const out = {
    'Format': 'Safetensors',
    'Tensors': names.length,
    'Parameters': params.toLocaleString(),
    'Dtypes': Object.entries(dtypes).map(([k, v]) => k + ' (' + v + ')').join(', '),
  };
  if (meta.__metadata__) out._sections = [{ title: 'Metadata', node: preBlock(JSON.stringify(meta.__metadata__, null, 2)) }];
  return out;
}

// ---------- GGUF (llama.cpp) ----------
async function parseGguf(file) {
  const b = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  if (ascii(b, 0, 4) !== 'GGUF') return null;
  const r = new Reader(b, true); r.seek(4);
  const version = r.u32();
  const tensorCount = Number(r.u64());
  const kvCount = Number(r.u64());
  return {
    'Format': 'GGUF (GGML model, v' + version + ')',
    'Tensors': tensorCount.toLocaleString(),
    'Metadata entries': kvCount,
    'Note': 'llama.cpp / GGML quantised model container',
  };
}

// ---------- Source map ----------
async function parseSourceMap(file) {
  let j; try { j = JSON.parse(await file.text()); } catch (_) { return null; }
  if (j.version == null || !j.mappings) return null;
  return {
    'Format': 'Source map v' + j.version,
    'Target file': j.file || '-',
    'Original sources': (j.sources || []).length,
    'Names': (j.names || []).length,
    'Embedded source': j.sourcesContent ? 'yes (sourcesContent)' : 'no',
    'Source root': j.sourceRoot || '-',
  };
}

// ---------- SQL dump ----------
async function parseSql(file) {
  const LIMIT = 5_000_000;
  const text = await file.slice(0, Math.min(file.size, LIMIT)).text();
  const truncated = file.size > LIMIT;
  const creates = (text.match(/CREATE\s+TABLE/gi) || []).length;
  const inserts = (text.match(/INSERT\s+INTO/gi) || []).length;
  const views = (text.match(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW/gi) || []).length;
  const indexes = (text.match(/CREATE\s+(?:UNIQUE\s+)?INDEX/gi) || []).length;
  const triggers = (text.match(/CREATE\s+TRIGGER/gi) || []).length;
  const fks = (text.match(/FOREIGN\s+KEY|\bREFERENCES\s+/gi) || []).length;

  let dialect = 'Generic SQL';
  if (/ENGINE=|AUTO_INCREMENT|`/.test(text)) dialect = 'MySQL / MariaDB';
  else if (/SERIAL\b|pg_catalog|OWNER TO|::|^COPY\s+/im.test(text)) dialect = 'PostgreSQL';
  else if (/PRAGMA|sqlite_sequence|AUTOINCREMENT/.test(text)) dialect = 'SQLite';
  else if (/\bGO\s*$|nvarchar|\[dbo\]|IDENTITY\(/im.test(text)) dialect = 'SQL Server (T-SQL)';

  // Per-table schema: capture each CREATE TABLE name ( ... ) block, then split its
  // body on top-level commas and pull "<column> <type>" from each definition line
  // (skipping table-level constraints).
  const tables = [];
  const reTable = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"'\[]?([A-Za-z0-9_.]+)[`"'\]]?\s*\(([\s\S]*?)\)\s*(?:ENGINE|DEFAULT|;|WITHOUT|STRICT|AS\b)/gi;
  let m;
  while ((m = reTable.exec(text)) && tables.length < 300) {
    const name = m[1].replace(/^.*\./, '');
    let depth = 0, cur = '';
    const parts = [];
    for (const ch of m[2]) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; } else cur += ch;
    }
    if (cur.trim()) parts.push(cur.trim());
    const cols = parts
      .filter((c) => c && !/^(PRIMARY|FOREIGN|UNIQUE|KEY|CONSTRAINT|CHECK|INDEX)\b/i.test(c))
      .map((c) => {
        const mm = c.match(/^[`"'\[]?([A-Za-z0-9_]+)[`"'\]]?\s+([A-Za-z0-9_]+(?:\s*\([^)]*\))?)/);
        return mm ? mm[1] + '  ' + mm[2].replace(/\s+/g, '') : c.split(/\s+/).slice(0, 2).join('  ');
      });
    tables.push({ name, cols });
  }

  const out = {
    'Format': 'SQL dump' + (truncated ? ' (first 5 MB scanned)' : ''),
    'Dialect': dialect,
    'Tables (CREATE)': creates,
    'INSERT statements': inserts.toLocaleString(),
  };
  if (views) out['Views'] = views;
  if (indexes) out['Indexes'] = indexes;
  if (triggers) out['Triggers'] = triggers;
  if (fks) out['Foreign-key refs'] = fks;

  if (tables.length) {
    const node = el('div', {});
    for (const t of tables) {
      node.appendChild(el('div', { class: 'anr-readout-section' }, t.name + ' (' + t.cols.length + ' columns)'));
      node.appendChild(preBlock(t.cols.join('\n') || '(no columns parsed)'));
    }
    out._sections = [{ title: 'Schema — ' + tables.length + ' table' + (tables.length > 1 ? 's' : ''), node, open: true }];
  }
  return out;
}

// ---------- Visual Studio solution ----------
async function parseSln(file) {
  const text = await file.text();
  const ver = (text.match(/Format Version ([\d.]+)/) || [])[1];
  const projects = Array.from(text.matchAll(/^Project\("\{[^}]+\}"\)\s*=\s*"([^"]+)"/gm)).map((m) => m[1]);
  return {
    'Format': 'Visual Studio Solution',
    'Format version': ver || '?',
    'Projects': projects.length,
    _sections: projects.length ? [{ title: 'Projects', node: preBlock(projects.join('\n')) }] : null,
  };
}

// ---------- .NET project ----------
async function parseDotnetProj(file) {
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) return null;
  const sdk = doc.documentElement.getAttribute('Sdk');
  const tf = Array.from(doc.querySelectorAll('TargetFramework, TargetFrameworks')).map((n) => n.textContent).join(', ');
  const pkgs = Array.from(doc.querySelectorAll('PackageReference')).map((n) => (n.getAttribute('Include') || '') + (n.getAttribute('Version') ? ' ' + n.getAttribute('Version') : ''));
  const projRefs = doc.querySelectorAll('ProjectReference').length;
  const outType = (doc.querySelector('OutputType') || {}).textContent;
  const out = {
    'Format': '.NET project (MSBuild)',
    'SDK': sdk || '-',
    'Target framework': tf || '-',
    'Output type': outType || '-',
    'Package references': pkgs.length,
    'Project references': projRefs,
  };
  if (pkgs.length) out._sections = [{ title: 'NuGet packages', node: preBlock(pkgs.join('\n')) }];
  return out;
}

// ---------- Gradle build ----------
async function parseGradle(file) {
  const text = await file.text();
  const plugins = Array.from(text.matchAll(/(?:id\s*[('"]|apply plugin:\s*['"])([\w.-]+)/g)).map((m) => m[1]);
  const deps = (text.match(/^\s*(implementation|api|compile|testImplementation|runtimeOnly|classpath)\b/gm) || []).length;
  return {
    'Format': 'Gradle build script',
    'Plugins': plugins.length + (plugins.length ? ': ' + Array.from(new Set(plugins)).slice(0, 10).join(', ') : ''),
    'Dependency declarations': deps,
  };
}

// ---------- Terraform ----------
async function parseTerraform(file, ext) {
  const text = await file.text();
  if (ext === 'tfstate') {
    let j; try { j = JSON.parse(text); } catch (_) { return null; }
    const byType = {};
    for (const r of (j.resources || [])) byType[r.type] = (byType[r.type] || 0) + (r.instances ? r.instances.length : 1);
    return {
      'Format': 'Terraform state',
      'State version': j.version,
      'Terraform version': j.terraform_version || '-',
      'Serial': j.serial,
      'Resources': (j.resources || []).reduce((a, r) => a + (r.instances ? r.instances.length : 1), 0),
      'Lineage': j.lineage || '-',
    };
  }
  const count = (kw) => (text.match(new RegExp('^\\s*' + kw + '\\s', 'gm')) || []).length;
  return {
    'Format': 'Terraform config (HCL)',
    'resource blocks': count('resource'),
    'data blocks': count('data'),
    'module blocks': count('module'),
    'variable blocks': count('variable'),
    'output blocks': count('output'),
    'provider blocks': count('provider'),
  };
}

// ---------- EditorConfig ----------
async function parseEditorConfig(file) {
  const text = await file.text();
  const root = /^\s*root\s*=\s*true/im.test(text);
  const sections = Array.from(text.matchAll(/^\[(.+)\]/gm)).map((m) => m[1]);
  return {
    'Format': 'EditorConfig',
    'root': root ? 'true' : 'false',
    'Sections (globs)': sections.length,
    _sections: sections.length ? [{ title: 'Globs', node: preBlock(sections.join('\n')) }] : null,
  };
}

// ---------- Protobuf schema ----------
async function parseProto(file) {
  const text = await file.text();
  return {
    'Format': 'Protocol Buffers schema',
    'Syntax': (text.match(/syntax\s*=\s*"([^"]+)"/) || [])[1] || 'proto2',
    'Package': (text.match(/package\s+([\w.]+)/) || [])[1] || '-',
    'Messages': (text.match(/^\s*message\s+\w+/gm) || []).length,
    'Enums': (text.match(/^\s*enum\s+\w+/gm) || []).length,
    'Services': (text.match(/^\s*service\s+\w+/gm) || []).length,
    'RPC methods': (text.match(/^\s*rpc\s+\w+/gm) || []).length,
    'Imports': (text.match(/^\s*import\s+/gm) || []).length,
  };
}

// ---------- GraphQL SDL ----------
async function parseGraphql(file) {
  const text = await file.text();
  const cnt = (kw) => (text.match(new RegExp('^\\s*' + kw + '\\s+\\w+', 'gm')) || []).length;
  return {
    'Format': 'GraphQL schema (SDL)',
    'Types': cnt('type'),
    'Inputs': cnt('input'),
    'Enums': cnt('enum'),
    'Interfaces': cnt('interface'),
    'Scalars': cnt('scalar'),
    'Unions': cnt('union'),
  };
}

// ---------- SARIF ----------
async function parseSarif(file) {
  let j; try { j = JSON.parse(await file.text()); } catch (_) { return null; }
  if (!j.runs) return null;
  const out = { 'Format': 'SARIF ' + (j.version || ''), 'Runs': j.runs.length };
  let results = 0; const tools = new Set(); const sev = {};
  for (const r of j.runs) {
    const td = r.tool && r.tool.driver; if (td) tools.add(td.name + (td.version ? ' ' + td.version : ''));
    for (const res of (r.results || [])) { results++; const s = res.level || 'none'; sev[s] = (sev[s] || 0) + 1; }
  }
  out['Tools'] = Array.from(tools).join(', ');
  out['Results'] = results;
  out['By level'] = Object.entries(sev).map(([k, v]) => k + ': ' + v).join('  ');
  return out;
}

// ---------- Python .pyc ----------
const PYC_MAGIC = { 3394: '3.7', 3413: '3.7', 3420: '3.8', 3425: '3.8', 3430: '3.9', 3439: '3.9', 3450: '3.10', 3495: '3.11', 3531: '3.12', 3571: '3.13' };
function parsePyc(head) {
  const r = new Reader(head, true);
  const magic = r.u16();
  if (head[2] !== 0x0d || head[3] !== 0x0a) return null;
  return {
    'Format': 'Python compiled bytecode',
    'Magic': magic,
    'Python version': PYC_MAGIC[magic] || 'unknown (magic ' + magic + ')',
  };
}

// ---------- Apple plist ----------
async function parsePlistRows(file) {
  const res = await parsePlist(file);
  if (!res) return null;
  const v = res.value;
  const out = { 'Format': 'Property List (' + res.format + ')' };
  const topKeys = (v && typeof v === 'object' && !Array.isArray(v)) ? Object.keys(v) : [];
  if (topKeys.length) out['Root keys'] = topKeys.length;
  for (const k of ['CFBundleIdentifier', 'CFBundleName', 'CFBundleShortVersionString', 'CFBundleVersion', 'PayloadType', 'URL']) {
    if (v && v[k] != null) out[k] = String(v[k]);
  }
  let json; try { json = JSON.stringify(v, (key, val) => (val instanceof Uint8Array ? '<' + val.length + ' bytes>' : val), 2); } catch (_) { json = null; }
  if (json) out._sections = [{ title: 'Contents', node: preBlock(json.length > 20000 ? json.slice(0, 20000) + '\n…' : json) }];
  return out;
}

// ---------- dispatch ----------
export const PARSERS = {
  jwt: (c) => parseJwt(c.file),
  har: (c) => parseHar(c.file),
  ipynb: (c) => parseIpynb(c.file),
  jsonl: (c) => parseJsonl(c.file),
  ndjson: (c) => parseJsonl(c.file),
  diff: (c) => parseDiff(c.file),
  patch: (c) => parseDiff(c.file),
  wasm: (c) => parseWasm(c.file),
  class: (c) => parseClass(c.head),
  npy: (c) => parseNpy(c.file),
  safetensors: (c) => parseSafetensors(c.file),
  gguf: (c) => parseGguf(c.file),
  map: (c) => parseSourceMap(c.file),
  sql: (c) => parseSql(c.file),
  sln: (c) => parseSln(c.file),
  csproj: (c) => parseDotnetProj(c.file),
  vbproj: (c) => parseDotnetProj(c.file),
  fsproj: (c) => parseDotnetProj(c.file),
  vcxproj: (c) => parseDotnetProj(c.file),
  gradle: (c) => parseGradle(c.file),
  tf: (c) => parseTerraform(c.file, c.ext),
  tfstate: (c) => parseTerraform(c.file, c.ext),
  editorconfig: (c) => parseEditorConfig(c.file),
  proto: (c) => parseProto(c.file),
  graphql: (c) => parseGraphql(c.file),
  gql: (c) => parseGraphql(c.file),
  sarif: (c) => parseSarif(c.file),
  pyc: (c) => parsePyc(c.head),
  plist: (c) => parsePlistRows(c.file),
};
