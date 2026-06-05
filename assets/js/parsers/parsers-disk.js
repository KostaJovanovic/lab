/* Analyser - lazy parser chunk: disk images, filesystems, firmware, virtualization.

   Loaded on demand by renderProprietary() when a file whose FORMATS entry has
   `chunk: 'disk'` is opened. Each entry in PARSERS is
   `({head, file, ext}) => rows` where `rows` is a plain object of label->value
   pairs (rendered as a readout), optionally carrying
   `_sections: [{title, node, open?}]` for collapsible blocks and
   `_previewNode` for a preview. Return null to fall back to the generic card.

   Dependency-free: VM descriptors (OVF/OVA/VBOX/VMX), cue sheets, MCU images
   (Intel HEX / S-record / UF2 / ELF / DTB / uImage), partition tables (MBR/GPT)
   and Linux filesystem superblocks (ext, squashfs, cramfs, romfs) plus a few
   optical/WIM headers are decoded from their headers directly. Formats whose
   payload needs a heavy decompressor (squashfs/cramfs file bodies use LZ4/XZ/
   zstd/gzip; esd uses LZMS) stay metadata-only. Anything rated rare AND hard is
   identification-only. No top-level side effects. */

import { el, row, fmtBytes } from '../core/util.js';
import { Reader, ascii, findBytes, matchMagic, startsWithAscii, latin1, utf8, utf16, fmtGuid } from '../core/binutil.js';
import { openZip } from '../renderers/zip.js';

// ---------- small shared helpers ----------

function preBlock(text, cls) {
  return el('pre', {
    class: cls || 'anr-code',
    style: 'max-height:360px;overflow:auto;font-size:12px;white-space:pre-wrap;word-break:break-word;margin:0;',
  }, text);
}

async function readBytes(file, n) {
  return new Uint8Array(await file.slice(0, Math.min(file.size, n)).arrayBuffer());
}
async function readRange(file, start, end) {
  start = Math.max(0, start);
  end = Math.min(end, file.size);
  if (end <= start) return new Uint8Array(0);
  return new Uint8Array(await file.slice(start, end).arrayBuffer());
}

const fmtDate = (d) => (d instanceof Date && !isNaN(d)) ? d.toLocaleString() : String(d);
const hex = (n, w = 8) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(w, '0');
const hex64 = (n) => '0x' + n.toString(16).toUpperCase();

// Pull a tag's text content out of an XML string (first match), namespace-loose.
function xmlText(xml, tag) {
  const m = xml.match(new RegExp('<(?:\\w+:)?' + tag + '\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?' + tag + '>', 'i'));
  return m ? m[1].replace(/<[^>]+>/g, '').trim() : null;
}
function xmlAttr(xml, tag, attr) {
  const m = xml.match(new RegExp('<(?:\\w+:)?' + tag + '\\b[^>]*\\b' + attr + '="([^"]*)"', 'i'));
  return m ? m[1] : null;
}

// ===================================================================
//                       Virtualization
// ===================================================================

// ---------- OVF descriptor (XML) ----------
function parseOvfXml(xml) {
  const out = { 'Format': 'OVF (Open Virtualization Format)' };
  const vsId = xmlAttr(xml, 'VirtualSystem', 'ovf:id') || xmlAttr(xml, 'VirtualSystem', 'id');
  if (vsId) out['VM name'] = vsId;
  const prodName = xmlText(xml, 'Product');
  if (prodName) out['Product'] = prodName;
  const vendor = xmlText(xml, 'Vendor');
  if (vendor) out['Vendor'] = vendor;
  const version = xmlText(xml, 'Version') || xmlText(xml, 'ProductVersion');
  if (version) out['Version'] = version;
  // OperatingSystemSection: ovf:id / vmw:osType / Description
  const osDesc = xmlText(xml, 'Description');
  const osId = xmlAttr(xml, 'OperatingSystemSection', 'ovf:id') || xmlAttr(xml, 'OperatingSystemSection', 'id');
  if (osId || osDesc) out['Guest OS'] = [osDesc, osId ? 'id ' + osId : ''].filter(Boolean).join(' ');
  // Hardware: resource type 3 = CPU, 4 = memory
  let vcpu = null, mem = null;
  const items = xml.match(/<(?:\w+:)?Item\b[\s\S]*?<\/(?:\w+:)?Item>/gi) || [];
  let nics = 0; const disks = [];
  for (const it of items) {
    const rt = xmlText(it, 'ResourceType');
    const qty = xmlText(it, 'VirtualQuantity');
    if (rt === '3' && qty) vcpu = qty;
    else if (rt === '4' && qty) mem = qty; // MB (per AllocationUnits, usually)
    else if (rt === '10') nics++; // ethernet adapter
  }
  if (vcpu) out['vCPU'] = vcpu;
  if (mem) out['Memory'] = mem + ' MB';
  if (nics) out['Network adapters'] = nics;
  // Disks: <Disk ovf:capacity=... ovf:diskId=.../>
  const diskTags = xml.match(/<(?:\w+:)?Disk\b[^>]*\/?>/gi) || [];
  for (const d of diskTags) {
    const cap = (d.match(/\bcapacity="([^"]+)"/i) || [])[1];
    const id = (d.match(/\bdiskId="([^"]+)"/i) || [])[1];
    const units = (d.match(/\bcapacityAllocationUnits="([^"]+)"/i) || [])[1];
    if (cap) disks.push((id ? id + ': ' : '') + cap + (units ? ' ' + units : ' bytes'));
  }
  if (diskTags.length) out['Disks'] = diskTags.length;
  const hw = xmlAttr(xml, 'System', 'vssd:VirtualSystemType') || xmlText(xml, 'VirtualSystemType');
  if (hw) out['Hardware type'] = hw;
  const eula = xmlText(xml, 'License') || xmlText(xml, 'EulaSection');
  const sections = [];
  if (disks.length) sections.push({ title: 'Disk capacities (' + disks.length + ')', node: preBlock(disks.join('\n')) });
  if (eula) sections.push({ title: 'EULA / License', node: preBlock(eula.slice(0, 8000)) });
  if (sections.length) out._sections = sections;
  return out;
}
async function parseOvf(file) {
  const text = await file.slice(0, Math.min(file.size, 2 * 1024 * 1024)).text();
  if (!/<\s*(?:\w+:)?Envelope/i.test(text)) return null;
  try { return parseOvfXml(text); } catch (_) { return null; }
}

// ---------- OVA (TAR of ovf + manifest) ----------
function tarStr(bytes, off, len) {
  let end = off;
  while (end < off + len && bytes[end] !== 0) end++;
  return ascii(bytes, off, end - off).trim();
}
function tarOctal(bytes, off, len) {
  let s = '';
  for (let i = off; i < off + len; i++) {
    const c = bytes[i];
    if (c === 0 || c === 0x20) { if (s) break; else continue; }
    if (c < 0x30 || c > 0x37) break;
    s += String.fromCharCode(c);
  }
  return s ? parseInt(s, 8) : 0;
}
async function parseOva(file) {
  // Walk the tar members; the .ovf member tends to be first and small.
  const cap = Math.min(file.size, 4 * 1024 * 1024);
  const b = await readBytes(file, cap);
  if (ascii(b, 257, 5) !== 'ustar' && tarOctal(b, 124, 12) <= 0) return null;
  const members = [];
  let pos = 0, ovfBytes = null;
  while (pos + 512 <= b.length) {
    let allZero = true;
    for (let i = 0; i < 512; i++) if (b[pos + i] !== 0) { allZero = false; break; }
    if (allZero) break;
    const name = tarStr(b, pos, 100);
    const size = tarOctal(b, pos + 124, 12);
    const dataStart = pos + 512;
    if (name) members.push({ name, size });
    if (/\.ovf$/i.test(name) && !ovfBytes && dataStart + size <= b.length) {
      ovfBytes = b.subarray(dataStart, dataStart + size);
    }
    pos = dataStart + Math.ceil(size / 512) * 512;
    if (members.length > 200) break;
  }
  let out;
  if (ovfBytes) {
    try { out = parseOvfXml(utf8(ovfBytes)); } catch (_) { out = null; }
  }
  if (!out) out = { 'Format': 'OVA (OVF appliance)' };
  out['Format'] = 'OVA appliance (' + out['Format'] + ')';
  out['TAR members'] = members.length;
  const lines = members.map((m) => fmtBytes(m.size).padStart(11) + '  ' + m.name);
  const sect = { title: 'Appliance files (' + members.length + ')', node: preBlock(lines.join('\n')) };
  out._sections = (out._sections || []).concat([sect]);
  return out;
}

// ---------- VirtualBox settings (.vbox XML) ----------
async function parseVbox(file) {
  const text = await file.slice(0, Math.min(file.size, 2 * 1024 * 1024)).text();
  if (!/<VirtualBox\b/i.test(text) && !/<Machine\b/i.test(text)) return null;
  const out = { 'Format': 'VirtualBox machine settings (.vbox)' };
  const name = xmlAttr(text, 'Machine', 'name');
  if (name) out['VM name'] = name;
  const uuid = xmlAttr(text, 'Machine', 'uuid');
  if (uuid) out['UUID'] = uuid.replace(/[{}]/g, '');
  const os = xmlAttr(text, 'Machine', 'OSType');
  if (os) out['Guest OS'] = os;
  const cpus = xmlAttr(text, 'CPU', 'count');
  if (cpus) out['CPUs'] = cpus;
  const ram = xmlAttr(text, 'Memory', 'RAMSize');
  if (ram) out['RAM'] = ram + ' MB';
  const fwType = xmlAttr(text, 'Firmware', 'type');
  if (fwType) out['Firmware'] = fwType;
  const controllers = (text.match(/<StorageController\b[^>]*\bname="([^"]+)"/gi) || [])
    .map((m) => (m.match(/name="([^"]+)"/i) || [])[1]).filter(Boolean);
  if (controllers.length) out['Storage controllers'] = controllers.join(', ');
  const disks = (text.match(/<HardDisk\b[^>]*\blocation="([^"]+)"/gi) || [])
    .map((m) => (m.match(/location="([^"]+)"/i) || [])[1]).filter(Boolean);
  if (disks.length) out['Hard disks'] = disks.length;
  const nics = (text.match(/<Adapter\b[^>]*\benabled="true"/gi) || []).length;
  if (nics) out['Network adapters'] = nics;
  const snaps = (text.match(/<Snapshot\b/gi) || []).length;
  if (snaps) out['Snapshots'] = snaps;
  const sections = [];
  if (disks.length) sections.push({ title: 'Attached disks (' + disks.length + ')', node: preBlock(disks.join('\n')) });
  if (snaps) {
    const names = (text.match(/<Snapshot\b[^>]*\bname="([^"]+)"/gi) || [])
      .map((m) => (m.match(/name="([^"]+)"/i) || [])[1]).filter(Boolean);
    if (names.length) sections.push({ title: 'Snapshot tree (' + names.length + ')', node: preBlock(names.join('\n')) });
  }
  if (sections.length) out._sections = sections;
  return out;
}

// ---------- VMware VM config (.vmx key=value) ----------
async function parseVmx(file) {
  const text = await file.slice(0, Math.min(file.size, 1024 * 1024)).text();
  const kv = {};
  let lines = 0;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([\w:.]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m) { kv[m[1].toLowerCase()] = m[2]; lines++; }
  }
  if (lines < 2) return null;
  // Sanity: a real vmx almost always carries config.version / virtualHW.version.
  if (!('config.version' in kv) && !('virtualhw.version' in kv) && !('displayname' in kv)) return null;
  const out = { 'Format': 'VMware VM config (.vmx)' };
  if (kv['displayname']) out['Display name'] = kv['displayname'];
  if (kv['guestos']) out['Guest OS'] = kv['guestos'];
  if (kv['memsize']) out['Memory'] = kv['memsize'] + ' MB';
  if (kv['numvcpus']) out['vCPU'] = kv['numvcpus'];
  if (kv['cpuid.corespersocket']) out['Cores/socket'] = kv['cpuid.corespersocket'];
  if (kv['virtualhw.version']) out['Hardware version'] = kv['virtualhw.version'];
  if (kv['firmware']) out['Firmware'] = kv['firmware'];
  if (kv['uuid.bios']) out['BIOS UUID'] = kv['uuid.bios'].trim();
  // Disks: <ctrl><n>:<m>.fileName referencing a vmdk
  const disks = [];
  for (const [k, v] of Object.entries(kv)) {
    if (/\.filename$/.test(k) && /\.vmdk$/i.test(v)) disks.push(v);
  }
  if (disks.length) out['Disks'] = disks.length;
  // NICs: ethernetN.present = TRUE
  let nics = 0;
  for (const [k, v] of Object.entries(kv)) if (/^ethernet\d+\.present$/.test(k) && /true/i.test(v)) nics++;
  if (nics) out['Network adapters'] = nics;
  const sections = [];
  if (disks.length) sections.push({ title: 'Virtual disks (' + disks.length + ')', node: preBlock(disks.join('\n')) });
  if (sections.length) out._sections = sections;
  return out;
}

// ===================================================================
//                       Optical / cue sheets
// ===================================================================

// ---------- cue sheet (text) ----------
async function parseCue(file) {
  const text = await file.slice(0, Math.min(file.size, 512 * 1024)).text();
  if (!/^\s*(FILE|REM|TRACK)\b/im.test(text)) return null;
  const files = [];
  const modes = {};
  let tracks = 0;
  const indexes = [];
  const cdtext = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    let m;
    if ((m = line.match(/^FILE\s+"?(.+?)"?\s+(\w+)\s*$/i))) files.push(m[1] + ' (' + m[2] + ')');
    else if ((m = line.match(/^TRACK\s+(\d+)\s+(\S+)/i))) { tracks++; modes[m[2]] = (modes[m[2]] || 0) + 1; }
    else if ((m = line.match(/^INDEX\s+(\d+)\s+(\d+:\d+:\d+)/i))) indexes.push('idx ' + m[1] + ' @ ' + m[2]);
    else if ((m = line.match(/^(TITLE|PERFORMER|SONGWRITER)\s+"?(.+?)"?\s*$/i))) cdtext.push(m[1] + ': ' + m[2]);
  }
  if (!files.length && !tracks) return null;
  const out = {
    'Format': 'Cue sheet (CD/DVD TOC)',
    'Referenced files': files.length ? files.join(', ') : '-',
    'Tracks': tracks,
    'Track modes': Object.entries(modes).map(([k, v]) => k + ' (' + v + ')').join(', ') || '-',
  };
  const sections = [];
  if (cdtext.length) sections.push({ title: 'CD-TEXT', node: preBlock(cdtext.join('\n')) });
  if (indexes.length) sections.push({ title: 'Index points (' + indexes.length + ')', node: preBlock(indexes.join('\n')) });
  if (sections.length) out._sections = sections;
  return out;
}

// ---------- CloneCD control (.ccd INI) ----------
async function parseCcd(file) {
  const text = await file.slice(0, Math.min(file.size, 512 * 1024)).text();
  if (!/\[CloneCD\]/i.test(text) && !/\[Disc\]/i.test(text)) return null;
  const get = (k) => { const m = text.match(new RegExp('^' + k + '\\s*=\\s*(.+)$', 'im')); return m ? m[1].trim() : null; };
  const out = { 'Format': 'CloneCD control file (.ccd)' };
  const ver = (text.match(/\[CloneCD\][\s\S]*?Version\s*=\s*(\d+)/i) || [])[1];
  if (ver) out['Version'] = ver;
  const sessions = get('Sessions');
  if (sessions) out['Sessions'] = sessions;
  const tocEntries = get('TocEntries');
  if (tocEntries) out['TOC entries'] = tocEntries;
  const dataTracks = get('DataTracksScrambled');
  if (dataTracks != null) out['Data tracks scrambled'] = dataTracks;
  const entries = (text.match(/\[Entry \d+\]/gi) || []).length;
  if (entries) out['Track/TOC entries'] = entries;
  return out;
}

// ---------- Nero image (.nrg, trailer-based) ----------
async function parseNrg(file) {
  // Footer holds NER5 (v2, 8-byte offset) or NERO (v1, 4-byte offset).
  const out = { 'Format': 'Nero CD/DVD image (.nrg)' };
  try {
    const tail = await readRange(file, file.size - 12, file.size);
    if (ascii(tail, 0, 4) === 'NER5') {
      out['Version'] = '2 (NER5)';
      out['Image size'] = fmtBytes(file.size);
      return out;
    }
    const tail8 = await readRange(file, file.size - 8, file.size);
    if (ascii(tail8, 0, 4) === 'NERO') {
      out['Version'] = '1 (NERO)';
      out['Image size'] = fmtBytes(file.size);
      return out;
    }
  } catch (_) {}
  // Some tools embed it at start; ext-driven fallback identification.
  out['Note'] = 'Nero burning image; TOC chunks (CUEX/DAOX/ETN2) live in the trailer.';
  out['Image size'] = fmtBytes(file.size);
  return out;
}

// ---------- Alcohol 120% (.mds / .mdf) ----------
async function parseMds(file, ext) {
  if (ext === 'mdf') {
    return { 'Format': 'Alcohol 120% media data (.mdf)', 'Note': 'Raw track payload; metadata lives in the companion .mds descriptor.', 'Size': fmtBytes(file.size) };
  }
  const b = await readBytes(file, 4096);
  // .mds signature: "MEDIA DESCRIPTOR"
  if (ascii(b, 0, 16) !== 'MEDIA DESCRIPTOR') return null;
  const r = new Reader(b, true); r.seek(16);
  const verMajor = r.u8(), verMinor = r.u8();
  const mediaType = r.u16();
  const MEDIA = { 0: 'CD-ROM', 1: 'CD-R', 2: 'CD-RW', 16: 'DVD-ROM', 18: 'DVD-R' };
  const out = {
    'Format': 'Alcohol 120% media descriptor (.mds)',
    'Version': verMajor + '.' + verMinor,
    'Media type': MEDIA[mediaType] != null ? MEDIA[mediaType] : ('type ' + mediaType),
  };
  return out;
}

// ===================================================================
//                       MCU / firmware images (text)
// ===================================================================

// ---------- Intel HEX (text) ----------
async function parseIntelHex(file) {
  const text = await file.slice(0, Math.min(file.size, 8 * 1024 * 1024)).text();
  const lines = text.split(/\r?\n/);
  if (!/^:[0-9A-Fa-f]{8}/.test(lines.find((l) => l.trim()) || '')) return null;
  const types = {}; let dataBytes = 0, records = 0, badCksum = 0;
  let base = 0, minAddr = Infinity, maxAddr = -Infinity;
  for (const line of lines) {
    if (line[0] !== ':') continue;
    const bytes = line.slice(1).trim();
    if (bytes.length < 10 || bytes.length % 2) continue;
    const len = parseInt(bytes.slice(0, 2), 16);
    const addr = parseInt(bytes.slice(2, 6), 16);
    const type = parseInt(bytes.slice(6, 8), 16);
    records++;
    types[type] = (types[type] || 0) + 1;
    // checksum: two's complement of sum of all bytes incl checksum == 0
    let sum = 0;
    for (let i = 0; i < bytes.length; i += 2) sum += parseInt(bytes.slice(i, i + 2), 16);
    if ((sum & 0xff) !== 0) badCksum++;
    if (type === 0x00) {
      dataBytes += len;
      const a = base + addr;
      if (a < minAddr) minAddr = a;
      if (a + len > maxAddr) maxAddr = a + len;
    } else if (type === 0x04) {
      base = parseInt(bytes.slice(8, 12), 16) << 16;
    } else if (type === 0x02) {
      base = parseInt(bytes.slice(8, 12), 16) << 4;
    }
    if (records > 2000000) break;
  }
  if (!records) return null;
  const TNAMES = { 0: 'Data', 1: 'EOF', 2: 'Ext seg addr', 3: 'Start seg addr', 4: 'Ext linear addr', 5: 'Start linear addr' };
  const out = {
    'Format': 'Intel HEX',
    'Records': records.toLocaleString(),
    'Data bytes': dataBytes.toLocaleString(),
    'Record types': Object.entries(types).map(([k, v]) => (TNAMES[k] || ('type ' + k)) + ': ' + v).join(', '),
    'Checksum errors': badCksum,
  };
  if (isFinite(minAddr)) out['Address range'] = hex(minAddr) + ' – ' + hex(maxAddr);
  return out;
}

// ---------- Motorola S-record (text) ----------
async function parseSrec(file) {
  const text = await file.slice(0, Math.min(file.size, 8 * 1024 * 1024)).text();
  const lines = text.split(/\r?\n/);
  const first = lines.find((l) => l.trim());
  if (!first || first[0] !== 'S' || !/^S[0-9]/.test(first)) return null;
  const counts = {}; let dataBytes = 0, records = 0, badCksum = 0;
  let minAddr = Infinity, maxAddr = -Infinity, headerText = null;
  const ADDR_WIDTH = { '1': 2, '2': 3, '3': 4, '5': 2, '6': 3, '7': 4, '8': 3, '9': 2 };
  for (const line of lines) {
    const l = line.trim();
    if (l.length < 4 || l[0] !== 'S') continue;
    const type = l[1];
    if (!/[0-9]/.test(type)) continue;
    const count = parseInt(l.slice(2, 4), 16);
    if (isNaN(count)) continue;
    records++; counts[type] = (counts[type] || 0) + 1;
    // checksum: ones-complement of sum of count+address+data bytes
    let sum = 0;
    for (let i = 2; i < l.length; i += 2) { const v = parseInt(l.slice(i, i + 2), 16); if (!isNaN(v)) sum += v; }
    if ((sum & 0xff) !== 0xff) badCksum++;
    const aw = ADDR_WIDTH[type] || 2;
    const addr = parseInt(l.slice(4, 4 + aw * 2), 16);
    const dataLen = count - aw - 1;
    if (type === '0') {
      // S0 header text is ASCII in the data field
      let s = '';
      for (let i = 4 + aw * 2; i + 1 < l.length - 2; i += 2) {
        const c = parseInt(l.slice(i, i + 2), 16);
        if (c >= 32 && c < 127) s += String.fromCharCode(c);
      }
      headerText = s;
    } else if (type === '1' || type === '2' || type === '3') {
      dataBytes += Math.max(0, dataLen);
      if (addr < minAddr) minAddr = addr;
      if (addr + dataLen > maxAddr) maxAddr = addr + dataLen;
    }
    if (records > 2000000) break;
  }
  if (!records) return null;
  const dataType = counts['3'] ? '32-bit (S3)' : counts['2'] ? '24-bit (S2)' : '16-bit (S1)';
  const out = {
    'Format': 'Motorola S-record',
    'S0 header': headerText || '-',
    'Address width': dataType,
    'Records': records.toLocaleString(),
    'Data bytes': dataBytes.toLocaleString(),
    'Record counts': Object.entries(counts).sort().map(([k, v]) => 'S' + k + ': ' + v).join(', '),
    'Checksum errors': badCksum,
  };
  if (isFinite(minAddr)) out['Address span'] = hex(minAddr) + ' – ' + hex(maxAddr);
  return out;
}

// ---------- UF2 (binary, 512-byte blocks) ----------
async function parseUf2(file) {
  const head = await readBytes(file, 512);
  // First magic 0x0A324655 ("UF2\n") at offset 0, second 0x9E5D5157 at 4.
  if (!(head[0] === 0x55 && head[1] === 0x46 && head[2] === 0x32 && head[3] === 0x0a)) return null;
  if (!(head[4] === 0x57 && head[5] === 0x51 && head[6] === 0x5d && head[7] === 0x9e)) return null;
  const r = new Reader(head, true); r.seek(8);
  const flags = r.u32();
  const firstAddr = r.u32();
  r.u32(); // payloadSize
  r.u32(); // blockNo
  const numBlocks = r.u32();
  const familyId = r.u32(); // or fileSize, depending on flags
  const out = {
    'Format': 'UF2 (USB Flashing Format)',
    'Blocks': numBlocks.toLocaleString(),
    'First flash address': hex(firstAddr),
  };
  if (flags & 0x00002000) out['Family ID'] = hex(familyId);
  if (flags & 0x00000001) out['Note'] = 'block(s) not for flashing (NOFLASH)';
  // Last block address: read last 512-byte block's targetAddr.
  try {
    if (file.size >= 512 && file.size % 512 === 0) {
      const last = await readRange(file, file.size - 512, file.size);
      const lr = new Reader(last, true); lr.seek(12);
      const lastAddr = lr.u32();
      lr.u32();
      out['Flash address range'] = hex(firstAddr) + ' – ' + hex(lastAddr);
      out['Total blocks (by size)'] = (file.size / 512).toLocaleString();
    }
  } catch (_) {}
  return out;
}

// ---------- ELF (binary header) ----------
const ELF_TYPE = { 0: 'none', 1: 'relocatable (.o)', 2: 'executable', 3: 'shared object (.so)', 4: 'core dump' };
const ELF_MACHINE = {
  0: 'none', 2: 'SPARC', 3: 'x86', 8: 'MIPS', 0x14: 'PowerPC', 0x15: 'PowerPC64',
  0x16: 'S390', 0x28: 'ARM', 0x2a: 'SuperH', 0x32: 'IA-64', 0x3e: 'x86-64',
  0x53: 'AVR', 0xb7: 'AArch64 (ARM64)', 0xf3: 'RISC-V', 0x5441: 'PowerPC (cygnus)',
  0xdc: 'Renesas RX', 0x18: 'PA-RISC', 0x4c: 'Renesas H8/300', 0x52: 'Motorola M32C',
};
const ELF_OSABI = {
  0: 'System V', 1: 'HP-UX', 2: 'NetBSD', 3: 'Linux', 6: 'Solaris', 7: 'AIX',
  9: 'FreeBSD', 0x0c: 'OpenBSD', 0x40: 'ARM EABI', 0x61: 'ARM',
};
function parseElf(head) {
  if (!(head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46)) return null;
  const ei_class = head[4];   // 1 = 32-bit, 2 = 64-bit
  const ei_data = head[5];    // 1 = LE, 2 = BE
  const ei_osabi = head[7];
  const little = ei_data === 1;
  const is64 = ei_class === 2;
  const r = new Reader(head, little);
  r.seek(16);
  const e_type = r.u16();
  const e_machine = r.u16();
  r.u32(); // e_version
  let entry;
  if (is64) entry = r.u64();
  else entry = BigInt(r.u32());
  // Skip phoff/shoff to reach the count fields.
  if (is64) { r.u64(); r.u64(); } else { r.u32(); r.u32(); }
  r.u32(); // flags
  r.u16(); // ehsize
  r.u16(); // phentsize
  const phnum = r.u16();
  r.u16(); // shentsize
  const shnum = r.u16();
  const out = {
    'Format': 'ELF (' + (is64 ? '64-bit' : '32-bit') + ')',
    'Endianness': little ? 'little-endian' : 'big-endian',
    'OS/ABI': ELF_OSABI[ei_osabi] != null ? ELF_OSABI[ei_osabi] : ('ABI ' + ei_osabi),
    'Type': ELF_TYPE[e_type] != null ? ELF_TYPE[e_type] : ('type ' + e_type),
    'Machine': ELF_MACHINE[e_machine] != null ? ELF_MACHINE[e_machine] : ('machine ' + hex(e_machine, 4)),
    'Entry point': hex64(entry),
    'Program headers': phnum,
    'Section headers': shnum,
  };
  return out;
}

// ---------- Device Tree Blob (.dtb / .dtbo) ----------
async function parseDtb(file) {
  const head = await readBytes(file, 4096);
  // FDT magic 0xD00DFEED (big-endian).
  if (!(head[0] === 0xd0 && head[1] === 0x0d && head[2] === 0xfe && head[3] === 0xed)) return null;
  const r = new Reader(head); // big-endian default
  r.seek(4);
  const totalsize = r.u32();
  const offDtStruct = r.u32();
  const offDtStrings = r.u32();
  r.u32(); // off_mem_rsvmap
  const version = r.u32();
  const lastCompVersion = r.u32();
  const out = {
    'Format': 'Device Tree Blob (FDT)',
    'Version': version + ' (last compat ' + lastCompVersion + ')',
    'Total size': fmtBytes(totalsize),
    'Struct offset': hex(offDtStruct),
    'Strings offset': hex(offDtStrings),
  };
  // Cheap root property scan: model / compatible appear as ASCII in struct block.
  try {
    const scan = head.subarray(offDtStruct, Math.min(head.length, offDtStruct + 2048));
    const txt = latin1(scan);
    const printable = txt.replace(/[^\x20-\x7e]+/g, ' ').trim();
    if (printable.length > 4) out['Root strings'] = printable.slice(0, 120);
  } catch (_) {}
  return out;
}

// ---------- U-Boot uImage ----------
const UIMG_OS = { 0: 'invalid', 1: 'OpenBSD', 2: 'NetBSD', 3: 'FreeBSD', 4: '4.4BSD', 5: 'Linux', 6: 'SVR4', 7: 'Esix', 8: 'Solaris', 17: 'QNX', 18: 'U-Boot', 19: 'RTEMS', 22: 'VxWorks' };
const UIMG_ARCH = { 0: 'invalid', 1: 'Alpha', 2: 'ARM', 3: 'x86', 4: 'IA64', 5: 'MIPS', 6: 'MIPS64', 7: 'PowerPC', 8: 'S390', 9: 'SuperH', 10: 'SPARC', 11: 'SPARC64', 12: 'M68K', 16: 'MicroBlaze', 17: 'Nios2', 22: 'AArch64', 26: 'RISC-V' };
const UIMG_TYPE = { 0: 'invalid', 1: 'standalone', 2: 'kernel', 3: 'ramdisk', 4: 'multi', 5: 'firmware', 6: 'script', 7: 'filesystem', 8: 'flat DT' };
const UIMG_COMP = { 0: 'none', 1: 'gzip', 2: 'bzip2', 3: 'lzma', 4: 'lzo', 5: 'lz4', 6: 'zstd' };
async function parseUImage(file) {
  const head = await readBytes(file, 64);
  if (!(head[0] === 0x27 && head[1] === 0x05 && head[2] === 0x19 && head[3] === 0x56)) return null;
  const r = new Reader(head); // big-endian
  r.seek(4);
  const hcrc = r.u32();
  const time = r.u32();
  const size = r.u32();
  const load = r.u32();
  const ep = r.u32();
  const dcrc = r.u32();
  const os = r.u8(), arch = r.u8(), type = r.u8(), comp = r.u8();
  const name = r.cstr(32);
  return {
    'Format': 'U-Boot uImage',
    'Image name': name || '-',
    'OS': UIMG_OS[os] != null ? UIMG_OS[os] : ('os ' + os),
    'Architecture': UIMG_ARCH[arch] != null ? UIMG_ARCH[arch] : ('arch ' + arch),
    'Image type': UIMG_TYPE[type] != null ? UIMG_TYPE[type] : ('type ' + type),
    'Compression': UIMG_COMP[comp] != null ? UIMG_COMP[comp] : ('comp ' + comp),
    'Data size': fmtBytes(size),
    'Load address': hex(load),
    'Entry point': hex(ep),
    'Created': fmtDate(new Date(time * 1000)),
    'Header CRC': hex(hcrc),
    'Data CRC': hex(dcrc),
  };
}

// ===================================================================
//                       Partition tables
// ===================================================================

const MBR_TYPES = {
  0x00: 'empty', 0x05: 'extended (CHS)', 0x07: 'NTFS / exFAT', 0x0b: 'FAT32 (CHS)',
  0x0c: 'FAT32 (LBA)', 0x0e: 'FAT16 (LBA)', 0x0f: 'extended (LBA)', 0x82: 'Linux swap',
  0x83: 'Linux', 0x8e: 'Linux LVM', 0xa5: 'FreeBSD', 0xa8: 'macOS UFS', 0xaf: 'HFS / HFS+',
  0xee: 'GPT protective', 0xef: 'EFI System', 0xfd: 'Linux RAID',
};
function parseMbrEntries(b, out) {
  const parts = [];
  for (let i = 0; i < 4; i++) {
    const off = 446 + i * 16;
    const status = b[off];
    const type = b[off + 4];
    const lba = (b[off + 8] | (b[off + 9] << 8) | (b[off + 10] << 16) | (b[off + 11] << 24)) >>> 0;
    const sectors = (b[off + 12] | (b[off + 13] << 8) | (b[off + 14] << 16) | (b[off + 15] << 24)) >>> 0;
    if (type === 0 && lba === 0 && sectors === 0) continue;
    parts.push({
      boot: status === 0x80 ? 'boot' : '',
      type, lba, sectors,
      label: MBR_TYPES[type] != null ? MBR_TYPES[type] : ('0x' + type.toString(16)),
    });
  }
  out['MBR partitions'] = parts.length;
  if (parts.length) {
    const lines = parts.map((p, i) =>
      '#' + (i + 1) + '  ' + (p.boot ? '* ' : '  ') + p.label.padEnd(16) +
      '  LBA ' + p.lba + '  ' + fmtBytes(p.sectors * 512));
    out._sections = (out._sections || []).concat([{ title: 'MBR partition entries', node: preBlock(lines.join('\n')), open: true }]);
  }
  return parts;
}
async function parseMbr(file) {
  const b = await readBytes(file, 512);
  if (b.length < 512 || !(b[510] === 0x55 && b[511] === 0xaa)) return null;
  const out = { 'Format': 'Master Boot Record (MBR)' };
  const sig = (b[440] | (b[441] << 8) | (b[442] << 16) | (b[443] << 24)) >>> 0;
  if (sig) out['Disk signature'] = hex(sig);
  const parts = parseMbrEntries(b, out);
  if (parts.some((p) => p.type === 0xee)) out['Note'] = 'Protective MBR — disk is GPT-partitioned (see .gpt).';
  return out;
}
async function parseGpt(file) {
  // Primary GPT header lives in LBA 1 (offset 512). The image might also start
  // directly at the header. Probe both.
  const b = await readBytes(file, 512 * 40 + 512);
  let hdrOff = -1;
  if (ascii(b, 512, 8) === 'EFI PART') hdrOff = 512;
  else if (ascii(b, 0, 8) === 'EFI PART') hdrOff = 0;
  if (hdrOff < 0) {
    // Maybe a plain MBR dump without GPT.
    if (b.length >= 512 && b[510] === 0x55 && b[511] === 0xaa) return parseMbr(file);
    return null;
  }
  const r = new Reader(b, true);
  r.seek(hdrOff + 8);
  const revision = r.u32();
  r.u32(); // header size
  r.u32(); // header crc
  r.u32(); // reserved
  const currentLba = r.u64();
  const backupLba = r.u64();
  const firstUsable = r.u64();
  const lastUsable = r.u64();
  const diskGuid = fmtGuid(b, hdrOff + 56);
  const partEntryLba = Number(r.seek(hdrOff + 72).u64());
  const numParts = r.u32();
  const partSize = r.u32();
  const out = {
    'Format': 'GUID Partition Table (GPT)',
    'Revision': (revision >>> 16) + '.' + (revision & 0xffff),
    'Disk GUID': diskGuid,
    'Partition entries': numParts,
    'Usable LBA': Number(firstUsable) + ' – ' + Number(lastUsable),
  };
  // Parse partition entries (commonly at LBA 2 => offset 1024).
  const baseOff = partEntryLba * 512;
  const parts = [];
  try {
    let pb = b;
    if (baseOff + numParts * partSize > b.length) {
      pb = await readRange(file, baseOff, baseOff + Math.min(numParts, 128) * partSize);
    }
    const adj = (baseOff + numParts * partSize <= b.length) ? baseOff : 0;
    const buf = (adj === baseOff) ? b : pb;
    for (let i = 0; i < numParts && i < 128; i++) {
      const off = adj + i * partSize;
      if (off + partSize > buf.length) break;
      // Type GUID all-zero => unused.
      let zero = true;
      for (let j = 0; j < 16; j++) if (buf[off + j] !== 0) { zero = false; break; }
      if (zero) continue;
      const typeGuid = fmtGuid(buf, off);
      const partGuid = fmtGuid(buf, off + 16);
      const firstLba = Number(new DataView(buf.buffer, buf.byteOffset + off + 32, 8).getBigUint64(0, true));
      const lastLba = Number(new DataView(buf.buffer, buf.byteOffset + off + 40, 8).getBigUint64(0, true));
      const nameBytes = buf.subarray(off + 56, off + 56 + 72);
      const name = utf16(nameBytes, true).replace(/ +$/, '').replace(/ /g, '').trim();
      parts.push({ typeGuid, partGuid, firstLba, lastLba, name });
    }
  } catch (_) {}
  if (parts.length) {
    const lines = parts.map((p, i) =>
      '#' + (i + 1) + '  ' + (p.name || '(unnamed)').padEnd(20) +
      '  ' + fmtBytes((p.lastLba - p.firstLba + 1) * 512).padStart(11) +
      '\n      type ' + p.typeGuid + '  id ' + p.partGuid);
    out['Used partitions'] = parts.length;
    out._sections = [{ title: 'Partitions (' + parts.length + ')', node: preBlock(lines.join('\n')), open: true }];
  }
  return out;
}

// ===================================================================
//                       Linux filesystem superblocks
// ===================================================================

// ---------- ext2/3/4 superblock @1024 ----------
async function parseExt(file) {
  const b = await readRange(file, 1024, 1024 + 1024);
  if (b.length < 256) return null;
  const r = new Reader(b, true);
  // s_magic at offset 56 in the superblock (0xEF53)
  if (!(b[56] === 0x53 && b[57] === 0xef)) return null;
  const inodesCount = r.seek(0).u32();
  const blocksCountLo = r.u32();
  r.seek(24);
  const logBlockSize = r.u32();
  const blockSize = 1024 << logBlockSize;
  r.seek(40);
  const blocksPerGroup = r.u32();
  r.seek(76);
  const revLevel = r.u32();
  r.seek(0x54);
  const featCompat = r.u32();
  const featIncompat = r.u32();
  const featRoCompat = r.u32();
  // s_uuid @ 0x68 (16 bytes), s_volume_name @ 0x78 (16 bytes)
  const uuidBytes = b.subarray(0x68, 0x68 + 16);
  let uuid = ''; for (let i = 0; i < 16; i++) { uuid += uuidBytes[i].toString(16).padStart(2, '0'); if (i === 3 || i === 5 || i === 7 || i === 9) uuid += '-'; }
  const label = ascii(b, 0x78, 16).replace(/\0+$/, '');
  const mountPath = ascii(b, 0x88, 64).replace(/\0+$/, '');
  r.seek(0x2c);
  const mtime = r.u32();
  const wtime = r.u32();
  // ext type from incompat features: EXTENTS (0x40) => ext4 typically; JOURNAL => ext3.
  let type = 'ext2';
  if (featIncompat & 0x40 || featRoCompat & 0x8) type = 'ext4';
  else if (featCompat & 0x4) type = 'ext3';
  const out = {
    'Format': type + ' filesystem',
    'Block size': fmtBytes(blockSize),
    'Total blocks': blocksCountLo.toLocaleString(),
    'Total inodes': inodesCount.toLocaleString(),
    'Volume size': fmtBytes(blocksCountLo * blockSize),
    'Volume label': label || '(none)',
    'UUID': uuid,
  };
  if (mountPath) out['Last mount path'] = mountPath;
  if (wtime) out['Last written'] = fmtDate(new Date(wtime * 1000));
  if (mtime) out['Last mounted'] = fmtDate(new Date(mtime * 1000));
  return out;
}

// ---------- SquashFS ----------
const SQ_COMP = { 1: 'gzip', 2: 'lzma', 3: 'lzo', 4: 'xz', 5: 'lz4', 6: 'zstd' };
async function parseSquashfs(file) {
  const b = await readBytes(file, 96);
  // 'hsqs' (LE) or 'sqsh' (BE).
  let little;
  if (b[0] === 0x68 && b[1] === 0x73 && b[2] === 0x71 && b[3] === 0x73) little = true;       // hsqs
  else if (b[0] === 0x73 && b[1] === 0x71 && b[2] === 0x73 && b[3] === 0x68) little = false;  // sqsh
  else return null;
  const r = new Reader(b, little);
  r.seek(4);
  const inodeCount = r.u32();
  const modTime = r.u32();
  const blockSize = r.u32();
  const fragCount = r.u32();
  const compId = r.u16();
  const blockLog = r.u16();
  r.u16(); // flags
  r.u16(); // ids
  const verMajor = r.u16();
  const verMinor = r.u16();
  r.u64(); // root inode
  let bytesUsed = null;
  if (r.remaining() >= 8) bytesUsed = Number(r.u64());
  const out = {
    'Format': 'SquashFS' + (little ? '' : ' (big-endian)'),
    'Version': verMajor + '.' + verMinor,
    'Compression': SQ_COMP[compId] != null ? SQ_COMP[compId] : ('id ' + compId),
    'Block size': fmtBytes(blockSize),
    'Inodes': inodeCount.toLocaleString(),
    'Fragments': fragCount.toLocaleString(),
    'Created/modified': modTime ? fmtDate(new Date(modTime * 1000)) : '-',
  };
  if (bytesUsed != null) out['Bytes used'] = fmtBytes(bytesUsed);
  out['Note'] = 'File payload is ' + (SQ_COMP[compId] || 'block') + '-compressed (decoder not bundled).';
  return out;
}

// ---------- cramfs ----------
async function parseCramfs(file) {
  const b = await readBytes(file, 76);
  // magic 0x28cd3d45 (LE) at 0, or BE.
  let little;
  if (b[0] === 0x45 && b[1] === 0x3d && b[2] === 0xcd && b[3] === 0x28) little = true;
  else if (b[0] === 0x28 && b[1] === 0xcd && b[2] === 0x3d && b[3] === 0x45) little = false;
  else return null;
  const r = new Reader(b, little);
  r.seek(4);
  const size = r.u32();
  const flags = r.u32();
  r.u32(); // future
  const sig = ascii(b, 16, 16); // "Compressed ROMFS"
  r.seek(32);
  r.u32(); // crc
  r.u32(); // edition
  const blocks = r.u32();
  const files = r.u32();
  const name = ascii(b, 48, 16).replace(/\0+$/, '');
  if (!/Compressed ROMFS/i.test(sig)) return null;
  return {
    'Format': 'cramfs (Compressed ROM filesystem)',
    'Endianness': little ? 'little-endian' : 'big-endian',
    'Size': fmtBytes(size),
    'Volume name': name || '(none)',
    'Files': files.toLocaleString(),
    'Blocks': blocks.toLocaleString(),
    'Note': 'File data is zlib-compressed (decoder not bundled).',
  };
}

// ---------- romfs ----------
async function parseRomfs(file) {
  const b = await readBytes(file, 128);
  if (ascii(b, 0, 8) !== '-rom1fs-') return null;
  const r = new Reader(b); // big-endian
  r.seek(8);
  const size = r.u32();
  r.u32(); // checksum
  const name = r.cstr(64);
  return {
    'Format': 'romfs (ROM filesystem)',
    'Size': fmtBytes(size),
    'Volume name': name || '(none)',
    'Note': 'genromfs read-only image; volume name from header.',
  };
}

// ===================================================================
//                       WIM (Windows Imaging)
// ===================================================================

const WIM_COMP = (flags) => {
  if (flags & 0x00020000) return 'XPRESS';
  if (flags & 0x00040000) return 'LZX';
  if (flags & 0x00080000) return 'LZMS';
  if (flags & 0x00000002) return 'none (FLAG_COMPRESSION)';
  return 'none';
};
async function parseWim(file, ext) {
  const b = await readBytes(file, 208);
  if (ascii(b, 0, 8) !== 'MSWIM\0\0\0') return null;
  const r = new Reader(b, true);
  r.seek(8);
  const headerSize = r.u32();
  const version = r.u32();
  const flags = r.u32();
  r.u32(); // chunk size
  // GUID @ 24 (16 bytes)
  const guid = fmtGuid(b, 24);
  r.seek(40);
  const partNumber = r.u16();
  const totalParts = r.u16();
  const imageCount = r.u32();
  const out = {
    'Format': (ext === 'esd' ? 'Windows ESD' : ext === 'swm' ? 'Split WIM (.swm)' : 'Windows Imaging (.wim)'),
    'Version': hex(version, 8),
    'Header size': headerSize,
    'Compression': WIM_COMP(flags),
    'Images': imageCount,
    'WIM GUID': guid,
  };
  if (totalParts > 1) out['Part'] = partNumber + ' of ' + totalParts + ' (split set)';
  if (flags & 0x00000001) out['Reserved flag'] = 'set';
  if (ext === 'esd' || (flags & 0x00080000)) out['Note'] = 'LZMS-compressed (ESD); image XML not decoded (decoder not bundled).';
  return out;
}

// ===================================================================
//                       identification-only (rare AND hard)
// ===================================================================
function ident(name, note) { return () => ({ 'Format': name, 'Note': note }); }

// ===================================================================
//                       dispatch
// ===================================================================
export const PARSERS = {
  // Virtualization
  ovf: (c) => parseOvf(c.file),
  ova: (c) => parseOva(c.file),
  vbox: (c) => parseVbox(c.file),
  vmx: (c) => parseVmx(c.file),
  // Optical / cue
  cue: (c) => parseCue(c.file),
  ccd: (c) => parseCcd(c.file),
  nrg: (c) => parseNrg(c.file),
  mds: (c) => parseMds(c.file, c.ext),
  mdf: (c) => parseMds(c.file, c.ext),
  // MCU / firmware text + binary
  hex: (c) => parseIntelHex(c.file),
  srec: (c) => parseSrec(c.file),
  s19: (c) => parseSrec(c.file),
  s28: (c) => parseSrec(c.file),
  s37: (c) => parseSrec(c.file),
  mot: (c) => parseSrec(c.file),
  uf2: (c) => parseUf2(c.file),
  elf: (c) => parseElf(c.head),
  axf: (c) => parseElf(c.head),
  o: (c) => parseElf(c.head),
  so: (c) => parseElf(c.head),
  dtb: (c) => parseDtb(c.file),
  dtbo: (c) => parseDtb(c.file),
  uimage: (c) => parseUImage(c.file),
  // Partition tables
  gpt: (c) => parseGpt(c.file),
  mbr: (c) => parseMbr(c.file),
  // Linux filesystems
  ext4: (c) => parseExt(c.file),
  ext: (c) => parseExt(c.file),
  squashfs: (c) => parseSquashfs(c.file),
  sfs: (c) => parseSquashfs(c.file),
  cramfs: (c) => parseCramfs(c.file),
  romfs: (c) => parseRomfs(c.file),
  // WIM family
  wim: (c) => parseWim(c.file, c.ext),
  swm: (c) => parseWim(c.file, c.ext),
  esd: (c) => parseWim(c.file, c.ext),
  // identification-only: rare AND hard (no native decoder)
  e01: ident('EnCase / EWF forensic image', 'Expert Witness Format; sectioned container with case/hash metadata. Identification only (no in-browser decoder).'),
  ewf: ident('EnCase / EWF forensic image', 'Expert Witness Format. Identification only.'),
  jffs2: ident('JFFS2 firmware', 'Linux MTD journalling flash filesystem; node-walk needs per-node decompression. Identification only.'),
  ubifs: ident('UBI / UBIFS firmware', 'Linux MTD UBIFS volume; LEB-structured. Identification only.'),
  yaffs2: ident('YAFFS2 image', 'Android/NAND filesystem; layout depends on OOB/spare geometry. Identification only.'),
  isz: ident('Compressed ISO (.isz)', 'UltraISO ISZ; zlib/bzip2-segmented ISO. Identification only (segment decoder not bundled).'),
  cdi: ident('DiscJuggler image (.cdi)', 'Padus DiscJuggler optical image; trailer-based TOC. Identification only.'),
  vmsn: ident('VMware snapshot state (.vmsn)', 'VMware suspended/snapshot device state. Identification only.'),
  vmem: ident('VMware guest memory (.vmem)', 'Raw guest RAM dump (size ≈ configured memory). Identification only.'),
  binwalk: ident('Raw firmware dump', 'Monolithic flash/firmware blob; needs entropy + signature carving (binwalk-style). Identification only.'),
};
