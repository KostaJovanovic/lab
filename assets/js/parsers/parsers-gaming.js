/* Analyser - lazy parser chunk: gaming / emulation / console / game assets.

   Loaded on demand by renderProprietary() when a file whose FORMATS entry has
   `chunk: 'gaming'` is opened. Each entry in PARSERS is `({head, file, ext}) =>
   rows` where `rows` is a plain object of label->value pairs, optionally carrying
   `_sections: [{title, node, open?}]` for collapsible blocks and `_previewNode`
   for a decoded preview. Return null to fall back to the generic identification
   card. Dependency-free: only the shared toolkit + zip reader. */

import { el, row, fmtBytes, preBlock, readSlice } from '../core/util.js';
import { Reader, ascii, findBytes, matchMagic, startsWithAscii, latin1, gunzip, fmtGuid } from '../core/binutil.js';
import { openZip } from '../renderers/zip.js';

// ---------- small helpers ----------

// CRC32 (IEEE) over a Uint8Array.
let CRC_TABLE = null;
function crc32(bytes, start = 0, end = bytes.length) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
const hex8 = (n) => (n >>> 0).toString(16).toUpperCase().padStart(8, '0');

// Clean a fixed-width ASCII field (drop NULs/control, trim).
function cleanAscii(bytes, start, len) {
  let s = '';
  const end = Math.min(start + len, bytes.length);
  for (let i = start; i < end; i++) {
    const c = bytes[i];
    if (c >= 32 && c < 127) s += String.fromCharCode(c);
  }
  return s.replace(/\s+$/, '').trim();
}

// ---------- iNES / NES 2.0 ----------
const NES_MIRROR = ['Horizontal', 'Vertical'];
function parseNes(head) {
  if (!(head[0] === 0x4E && head[1] === 0x45 && head[2] === 0x53 && head[3] === 0x1A)) return null;
  const f6 = head[6], f7 = head[7];
  const isNes2 = (f7 & 0x0C) === 0x08;
  let prg16 = head[4], chr8 = head[5];
  let mapper = (f6 >> 4) | (f7 & 0xF0);
  const out = { 'Format': isNes2 ? 'NES 2.0 ROM' : 'iNES ROM' };
  if (isNes2) {
    // upper mapper nibble + submapper
    mapper |= (head[8] & 0x0F) << 8;
    const sub = head[8] >> 4;
    // size MSB nibbles in byte 9
    const prgMsb = head[9] & 0x0F, chrMsb = head[9] >> 4;
    if (prgMsb !== 0x0F) prg16 |= prgMsb << 8;
    if (chrMsb !== 0x0F) chr8 |= chrMsb << 8;
    out['Mapper'] = mapper + (sub ? ' (submapper ' + sub + ')' : '');
  } else {
    out['Mapper'] = mapper;
  }
  out['PRG ROM'] = prg16 ? fmtBytes(prg16 * 16384) + ' (' + prg16 + ' x 16KB)' : '0';
  out['CHR ROM'] = chr8 ? fmtBytes(chr8 * 8192) + ' (' + chr8 + ' x 8KB)' : '0 (uses CHR RAM)';
  out['Mirroring'] = (f6 & 0x08) ? 'Four-screen' : NES_MIRROR[f6 & 0x01];
  out['Battery (PRG-RAM)'] = (f6 & 0x02) ? 'yes' : 'no';
  out['Trainer'] = (f6 & 0x04) ? 'present (512 bytes)' : 'no';
  if (isNes2) {
    const tv = head[12] & 0x03;
    out['Timing'] = ['NTSC', 'PAL', 'Multi-region', 'Dendy'][tv];
    const ct = ['NES/Famicom', 'Vs. System', 'Playchoice-10', 'Extended'][f7 & 0x03];
    if (ct) out['Console type'] = ct;
  } else {
    out['TV system'] = (f7 & 0x01) || (head[9] & 0x01) ? 'PAL' : 'NTSC';
    if (f7 & 0x01) out['Console type'] = 'Vs. System';
  }
  return out;
}

// ---------- Game Boy / Game Boy Color ----------
const GB_MBC = {
  0x00: 'ROM only', 0x01: 'MBC1', 0x02: 'MBC1+RAM', 0x03: 'MBC1+RAM+Battery',
  0x05: 'MBC2', 0x06: 'MBC2+Battery', 0x08: 'ROM+RAM', 0x09: 'ROM+RAM+Battery',
  0x0B: 'MMM01', 0x0C: 'MMM01+RAM', 0x0D: 'MMM01+RAM+Battery',
  0x0F: 'MBC3+Timer+Battery', 0x10: 'MBC3+Timer+RAM+Battery', 0x11: 'MBC3',
  0x12: 'MBC3+RAM', 0x13: 'MBC3+RAM+Battery', 0x19: 'MBC5', 0x1A: 'MBC5+RAM',
  0x1B: 'MBC5+RAM+Battery', 0x1C: 'MBC5+Rumble', 0x1D: 'MBC5+Rumble+RAM',
  0x1E: 'MBC5+Rumble+RAM+Battery', 0x20: 'MBC6', 0x22: 'MBC7+Sensor+Rumble+RAM+Battery',
  0xFC: 'Pocket Camera', 0xFD: 'Bandai TAMA5', 0xFE: 'HuC3', 0xFF: 'HuC1+RAM+Battery'
};
const GB_RAM = { 0: 'None', 1: '2 KB', 2: '8 KB', 3: '32 KB (4 banks)', 4: '128 KB (16 banks)', 5: '64 KB (8 banks)' };
function parseGb(head, ext) {
  if (head.length < 0x150) return null;
  // Validate Nintendo logo start (0xCE 0xED 0x66 0x66) at 0x104 - cheap sanity check.
  const logoOk = head[0x104] === 0xCE && head[0x105] === 0xED && head[0x106] === 0x66 && head[0x107] === 0x66;
  const cgbFlag = head[0x143];
  const titleLen = (cgbFlag === 0x80 || cgbFlag === 0xC0) ? 15 : 16;
  let title = cleanAscii(head, 0x134, titleLen);
  const out = { 'Format': 'Game Boy ROM' };
  out['Title'] = title || '(none)';
  if (cgbFlag === 0xC0) out['Format'] = 'Game Boy Color ROM (CGB only)';
  else if (cgbFlag === 0x80) out['Format'] = 'Game Boy Color ROM (CGB+DMG)';
  const sgb = head[0x146] === 0x03;
  out['CGB support'] = cgbFlag === 0xC0 ? 'CGB only' : cgbFlag === 0x80 ? 'CGB enhanced' : 'no (DMG)';
  out['SGB support'] = sgb ? 'yes' : 'no';
  out['Cartridge type'] = GB_MBC[head[0x147]] || ('0x' + head[0x147].toString(16));
  const romCode = head[0x148];
  out['ROM size'] = romCode <= 8 ? fmtBytes(32768 << romCode) + ' (' + (2 << romCode) + ' banks)' : '0x' + romCode.toString(16);
  out['RAM size'] = GB_RAM[head[0x149]] || ('0x' + head[0x149].toString(16));
  out['Region'] = head[0x14A] === 0 ? 'Japan' : 'Non-Japan (overseas)';
  // Licensee
  const oldLic = head[0x14B];
  if (oldLic === 0x33) out['Licensee'] = 'New (' + cleanAscii(head, 0x144, 2) + ')';
  else out['Licensee'] = 'Old code 0x' + oldLic.toString(16);
  out['Mask ROM version'] = head[0x14C];
  // Header checksum: sum over 0x134..0x14C
  let x = 0;
  for (let i = 0x134; i <= 0x14C; i++) x = (x - head[i] - 1) & 0xFF;
  out['Header checksum'] = (x === head[0x14D] ? 'valid' : 'INVALID') + ' (0x' + head[0x14D].toString(16) + ')';
  out['Nintendo logo'] = logoOk ? 'valid' : 'not present';
  return out;
}

// ---------- Game Boy Advance ----------
function parseGba(head) {
  if (head.length < 0xC0) return null;
  // Fixed value 0x96 at 0xB2 is the strongest GBA signature.
  if (head[0xB2] !== 0x96) return null;
  // First instruction is a branch (B) - opcode byte 0x03 at offset 3.
  const out = { 'Format': 'Game Boy Advance ROM' };
  out['Title'] = cleanAscii(head, 0xA0, 12) || '(none)';
  out['Game code'] = cleanAscii(head, 0xAC, 4) || '-';
  out['Maker code'] = cleanAscii(head, 0xB0, 2) || '-';
  out['Fixed value (0xB2)'] = '0x96 (valid)';
  out['Main unit code'] = head[0xB3];
  out['Software version'] = head[0xBC];
  // Header checksum over 0xA0..0xBC
  let chk = 0;
  for (let i = 0xA0; i <= 0xBC; i++) chk = (chk - head[i]) & 0xFF;
  chk = (chk - 0x19) & 0xFF;
  out['Header checksum'] = (chk === head[0xBD] ? 'valid' : 'INVALID') + ' (0x' + head[0xBD].toString(16) + ')';
  return out;
}

// ---------- SNES ----------
const SNES_REGION = {
  0: 'Japan', 1: 'USA/Canada (NTSC)', 2: 'Europe/Oceania/Asia (PAL)', 3: 'Sweden/Scandinavia',
  4: 'Finland', 5: 'Denmark', 6: 'France', 7: 'Netherlands', 8: 'Spain', 9: 'Germany',
  10: 'Italy', 11: 'China', 13: 'South Korea', 14: 'Common', 15: 'Canada', 16: 'Brazil', 17: 'Australia'
};
function scoreSnesHeader(b, base) {
  if (base + 0x30 > b.length) return -1;
  let score = 0;
  // Title region: mostly printable
  let printable = 0;
  for (let i = 0; i < 21; i++) { const c = b[base + 0x10 + i]; if (c >= 32 && c < 127) printable++; }
  score += printable;
  // Checksum + complement should sum to 0xFFFF
  const chk = b[base + 0x2E] | (b[base + 0x2F] << 8);
  const cmp = b[base + 0x2C] | (b[base + 0x2D] << 8);
  if (((chk + cmp) & 0xFFFF) === 0xFFFF) score += 32;
  return score;
}
async function parseSnes(file) {
  const size = file.size;
  // Detect 512-byte copier (SMC) header.
  const hasCopier = (size % 1024) === 512;
  const off = hasCopier ? 512 : 0;
  // Header lives at 0x7FC0 (LoROM) or 0xFFC0 (HiROM), relative to ROM start.
  const buf = await readSlice(file, off, 0x10000);
  if (buf.length < 0x8000) return null;
  const candidates = [['LoROM', 0x7FC0], ['HiROM', 0xFFC0]];
  let best = null, bestScore = -1, bestMap = '';
  for (const [map, base] of candidates) {
    if (base + 0x30 > buf.length) continue;
    const s = scoreSnesHeader(buf, base);
    if (s > bestScore) { bestScore = s; best = base; bestMap = map; }
  }
  if (best == null || bestScore < 10) return null;
  const out = { 'Format': 'SNES / Super Famicom ROM' };
  if (hasCopier) out['Copier header'] = 'stripped 512-byte SMC header';
  out['Internal title'] = cleanAscii(buf, best + 0x10, 21) || '(none)';
  out['Mapping'] = bestMap + ((buf[best + 0x25] & 0x10) ? ' (FastROM)' : '');
  const romCode = buf[best + 0x27];
  out['ROM size'] = romCode ? fmtBytes(1024 << romCode) : '-';
  const ramCode = buf[best + 0x28];
  out['RAM size'] = ramCode ? fmtBytes(1024 << ramCode) : 'None';
  out['Region'] = SNES_REGION[buf[best + 0x29]] || ('code ' + buf[best + 0x29]);
  const lic = buf[best + 0x2A];
  out['Licensee'] = lic === 0x33 ? 'New (extended header)' : '0x' + lic.toString(16);
  out['Version'] = '1.' + buf[best + 0x2B];
  const chk = buf[best + 0x2E] | (buf[best + 0x2F] << 8);
  const cmp = buf[best + 0x2C] | (buf[best + 0x2D] << 8);
  out['Checksum'] = '0x' + chk.toString(16).toUpperCase().padStart(4, '0') +
    (((chk + cmp) & 0xFFFF) === 0xFFFF ? ' (valid pair)' : ' (mismatch)');
  return out;
}

// ---------- Nintendo DS / DSi ----------
function parseNds(head) {
  if (head.length < 0x170) return null;
  const out = { 'Format': 'Nintendo DS / DSi ROM' };
  out['Title'] = cleanAscii(head, 0x00, 12) || '(none)';
  out['Game code'] = cleanAscii(head, 0x0C, 4) || '-';
  out['Maker code'] = cleanAscii(head, 0x10, 2) || '-';
  const unit = head[0x12];
  out['Unit code'] = unit === 0 ? 'NDS' : unit === 2 ? 'NDS+DSi' : unit === 3 ? 'DSi only' : '0x' + unit.toString(16);
  const cap = head[0x14];
  out['Capacity'] = cap <= 0x10 ? fmtBytes(131072 << cap) : '0x' + cap.toString(16);
  const region = head[0x1D];
  out['Region'] = region === 0 ? 'Normal (worldwide)' : region === 0x40 ? 'Korea' : region === 0x80 ? 'China' : '0x' + region.toString(16);
  out['ROM version'] = head[0x1E];
  // DSi/NDS header CRC16 at 0x15E - just surface stored value
  out['Header CRC16'] = '0x' + (head[0x15E] | (head[0x15F] << 8)).toString(16).toUpperCase().padStart(4, '0');
  return out;
}

// ---------- Nintendo 64 ----------
function n64Order(head) {
  // First 4 bytes encode byte order. Standard header word is 0x80371240.
  const b = head;
  if (b[0] === 0x80 && b[1] === 0x37 && b[2] === 0x12 && b[3] === 0x40) return 'z64'; // big-endian (native)
  if (b[0] === 0x37 && b[1] === 0x80 && b[2] === 0x40 && b[3] === 0x12) return 'v64'; // byteswapped (16-bit)
  if (b[0] === 0x40 && b[1] === 0x12 && b[2] === 0x37 && b[3] === 0x80) return 'n64'; // little-endian (32-bit)
  return null;
}
// Reorder a chunk into big-endian (z64) layout given a detected order.
function n64ToBig(bytes, order) {
  if (order === 'z64') return bytes;
  const out = new Uint8Array(bytes.length);
  if (order === 'v64') {           // swap each 2-byte pair
    for (let i = 0; i + 1 < bytes.length; i += 2) { out[i] = bytes[i + 1]; out[i + 1] = bytes[i]; }
  } else if (order === 'n64') {    // reverse each 4-byte word
    for (let i = 0; i + 3 < bytes.length; i += 4) { out[i] = bytes[i + 3]; out[i + 1] = bytes[i + 2]; out[i + 2] = bytes[i + 1]; out[i + 3] = bytes[i]; }
  }
  return out;
}
const N64_REGION = {
  0x37: 'Beta', 0x41: 'Asia (NTSC)', 0x42: 'Brazil', 0x43: 'China', 0x44: 'Germany',
  0x45: 'North America', 0x46: 'France', 0x47: 'Gateway 64 (NTSC)', 0x48: 'Netherlands',
  0x49: 'Italy', 0x4A: 'Japan', 0x4B: 'Korea', 0x4C: 'Gateway 64 (PAL)', 0x4E: 'Canada',
  0x50: 'Europe', 0x53: 'Spain', 0x55: 'Australia', 0x57: 'Scandinavia', 0x58: 'Europe', 0x59: 'Europe'
};
function parseN64(head) {
  const order = n64Order(head);
  if (!order || head.length < 0x40) return null;
  const b = n64ToBig(head.subarray(0, 0x40), order);
  const out = { 'Format': 'Nintendo 64 ROM' };
  out['Byte order'] = order === 'z64' ? 'Big-endian (.z64, native)' : order === 'v64' ? 'Byteswapped (.v64)' : 'Little-endian (.n64)';
  const r = new Reader(b);
  r.seek(0x0C); // clock rate at 0x04, PC at 0x08, release at 0x0C
  out['Internal title'] = cleanAscii(b, 0x20, 20) || '(none)';
  out['Game serial'] = cleanAscii(b, 0x3B, 3) || '-';
  out['Region'] = N64_REGION[b[0x3E]] || ('0x' + b[0x3E].toString(16));
  out['Cartridge ID'] = cleanAscii(b, 0x3C, 2) || '-';
  out['Clock rate'] = '0x' + (new Reader(b).seek(0x04).u32()).toString(16).toUpperCase();
  out['CRC1'] = hex8(new Reader(b).seek(0x10).u32());
  out['CRC2'] = hex8(new Reader(b).seek(0x14).u32());
  return out;
}

// ---------- Sega Genesis / Mega Drive ----------
async function parseGenesis(file) {
  // SMD interleaved format has a 512-byte header; "SEGA" sits at 0x100 in the
  // de-interleaved ROM. Read enough to inspect both raw and +512 offsets.
  const buf = await readSlice(file, 0, 0x300);
  // "SEGA" sits at 0x100 in a plain ROM; with a 512-byte copier header at 0x300.
  let base = -1;
  if (startsWithAscii(buf, 'SEGA', 0x100)) base = 0x100;
  if (base < 0) return null;
  const out = { 'Format': 'Sega Genesis / Mega Drive ROM' };
  out['System'] = cleanAscii(buf, base, 16) || 'SEGA';
  out['Copyright'] = cleanAscii(buf, base + 0x10, 16) || '-';
  out['Domestic title'] = cleanAscii(buf, base + 0x20, 48) || '-';
  out['Overseas title'] = cleanAscii(buf, base + 0x50, 48) || '-';
  out['Serial / version'] = cleanAscii(buf, base + 0x80, 14) || '-';
  out['Checksum'] = '0x' + ((buf[base + 0x8E] << 8) | buf[base + 0x8F]).toString(16).toUpperCase().padStart(4, '0');
  out['Region'] = cleanAscii(buf, base + 0xF0, 16) || '-';
  return out;
}

// ---------- IPS patch ----------
async function parseIps(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (!startsWithAscii(buf, 'PATCH')) return null;
  let i = 5, records = 0, rle = 0, changed = 0, maxOff = 0, ok = true;
  while (i + 3 <= buf.length) {
    if (buf[i] === 0x45 && buf[i + 1] === 0x4F && buf[i + 2] === 0x46) { i += 3; break; } // "EOF"
    const off = (buf[i] << 16) | (buf[i + 1] << 8) | buf[i + 2]; i += 3;
    if (i + 2 > buf.length) { ok = false; break; }
    const len = (buf[i] << 8) | buf[i + 1]; i += 2;
    records++;
    if (len === 0) {            // RLE record: 2-byte run length + 1 byte value
      if (i + 3 > buf.length) { ok = false; break; }
      const run = (buf[i] << 8) | buf[i + 1]; i += 3;
      rle++; changed += run; maxOff = Math.max(maxOff, off + run);
    } else {
      i += len; changed += len; maxOff = Math.max(maxOff, off + len);
    }
    if (records > 1_000_000) break;
  }
  return {
    'Format': 'IPS ROM patch',
    'Records': records,
    'RLE records': rle,
    'Bytes changed': changed.toLocaleString(),
    'Highest patched offset': '0x' + maxOff.toString(16).toUpperCase(),
    'EOF marker': ok ? 'found' : 'truncated / missing',
  };
}

// ---------- BPS patch ----------
function readVarint(b, cur) {
  let data = 0, shift = 1;
  for (;;) {
    const x = b[cur.i++];
    data += (x & 0x7f) * shift;
    if (x & 0x80) break;
    shift <<= 7;
    data += shift;
  }
  return data;
}
async function parseBps(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (!startsWithAscii(buf, 'BPS1')) return null;
  const cur = { i: 4 };
  let srcSize, tgtSize, metaSize;
  try {
    srcSize = readVarint(buf, cur);
    tgtSize = readVarint(buf, cur);
    metaSize = readVarint(buf, cur);
  } catch (_) { return null; }
  let meta = '';
  if (metaSize > 0 && cur.i + metaSize <= buf.length) {
    meta = latin1(buf.subarray(cur.i, cur.i + metaSize));
  }
  const out = {
    'Format': 'BPS ROM patch',
    'Source size': fmtBytes(srcSize),
    'Target size': fmtBytes(tgtSize),
  };
  if (buf.length >= 12) {
    const dv = new DataView(buf.buffer, buf.byteOffset);
    out['Source CRC32'] = hex8(dv.getUint32(buf.length - 12, true));
    out['Target CRC32'] = hex8(dv.getUint32(buf.length - 8, true));
    out['Patch CRC32'] = hex8(dv.getUint32(buf.length - 4, true));
  }
  if (meta) out._sections = [{ title: 'Metadata', node: preBlock(meta.slice(0, 4000)) }];
  return out;
}

// ---------- UPS patch ----------
async function parseUps(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (!startsWithAscii(buf, 'UPS1')) return null;
  const cur = { i: 4 };
  let inSize, outSize;
  try { inSize = readVarint(buf, cur); outSize = readVarint(buf, cur); } catch (_) { return null; }
  const out = {
    'Format': 'UPS ROM patch',
    'Input file size': fmtBytes(inSize),
    'Output file size': fmtBytes(outSize),
  };
  if (buf.length >= 12) {
    const dv = new DataView(buf.buffer, buf.byteOffset);
    out['Input CRC32'] = hex8(dv.getUint32(buf.length - 12, true));
    out['Output CRC32'] = hex8(dv.getUint32(buf.length - 8, true));
    out['Patch CRC32'] = hex8(dv.getUint32(buf.length - 4, true));
  }
  return out;
}

// ---------- PPF patch ----------
async function parsePpf(file) {
  const buf = await readSlice(file, 0, 1024);
  if (!startsWithAscii(buf, 'PPF')) return null;
  const ver = buf[3] === 0x33 ? 3 : buf[3] === 0x32 ? 2 : buf[3] === 0x30 ? 1 : 0;
  const out = { 'Format': 'PPF ROM/CD patch (v' + (ver || '?') + ')' };
  out['Encoding method'] = buf[5];
  out['Description'] = cleanAscii(buf, 6, 50) || '-';
  return out;
}

// ---------- Doom WAD ----------
async function parseWad(file) {
  const head = await readSlice(file, 0, 12);
  const id = ascii(head, 0, 4);
  if (id !== 'IWAD' && id !== 'PWAD') return null;
  const r = new Reader(head, true); r.seek(4);
  const numLumps = r.u32();
  const dirOff = r.u32();
  const out = { 'Format': id === 'IWAD' ? 'Doom IWAD (full game)' : 'Doom PWAD (patch/mod)', 'Lumps': numLumps };
  // Read the lump directory (16 bytes each: offset, size, 8-char name).
  const dirSize = Math.min(numLumps * 16, 4 * 1024 * 1024);
  const dir = await readSlice(file, dirOff, dirSize);
  const names = [];
  const maps = [];
  const count = Math.min(numLumps, Math.floor(dir.length / 16));
  for (let i = 0; i < count; i++) {
    const nm = cleanAscii(dir, i * 16 + 8, 8);
    names.push(nm);
    if (/^E\dM\d$/.test(nm) || /^MAP\d\d$/.test(nm)) maps.push(nm);
  }
  out['Maps detected'] = maps.length + (maps.length ? ' (' + maps.slice(0, 12).join(', ') + (maps.length > 12 ? ', …' : '') + ')' : '');
  if (names.length) out._sections = [{ title: 'Lump names (' + names.length + ', sample)', node: preBlock(names.slice(0, 400).join('\n')) }];
  return out;
}

// ---------- NBT (Minecraft) ----------
const NBT_TYPES = ['End', 'Byte', 'Short', 'Int', 'Long', 'Float', 'Double', 'ByteArray', 'String', 'List', 'Compound', 'IntArray', 'LongArray'];
// Minimal NBT walker: collects scalar tags by name into a flat map, capped.
function walkNbt(b) {
  const r = new Reader(b); // NBT is big-endian
  const found = {};
  let depth = 0, visited = 0;
  function readName() {
    const len = r.u16();
    const s = ascii(r.bytes, r.pos, len); r.skip(len);
    return s;
  }
  function readPayload(type, name) {
    visited++;
    if (visited > 20000) throw new Error('cap');
    switch (type) {
      case 1: { const v = r.i8(); record(name, v); break; }
      case 2: { const v = r.i16(); record(name, v); break; }
      case 3: { const v = r.i32(); record(name, v); break; }
      case 4: { const v = r.u64(); record(name, v.toString()); break; }
      case 5: { const v = r.f32(); record(name, v); break; }
      case 6: { const v = r.f64(); record(name, v); break; }
      case 7: { const n = r.u32(); r.skip(n); record(name, '[' + n + ' bytes]'); break; }
      case 8: { const len = r.u16(); const s = ascii(r.bytes, r.pos, len); r.skip(len); record(name, s); break; }
      case 9: {
        const elemType = r.u8(); const n = r.u32();
        record(name, NBT_TYPES[elemType] + '[' + n + ']');
        depth++;
        if (depth < 24) for (let i = 0; i < n; i++) readPayload(elemType, '');
        else for (let i = 0; i < n; i++) skipPayload(elemType);
        depth--;
        break;
      }
      case 10: {
        depth++;
        if (depth > 48) throw new Error('depth');
        for (;;) {
          const t = r.u8();
          if (t === 0) break;
          const nm = readName();
          readPayload(t, nm);
        }
        depth--;
        break;
      }
      case 11: { const n = r.u32(); r.skip(n * 4); record(name, 'int[' + n + ']'); break; }
      case 12: { const n = r.u32(); r.skip(n * 8); record(name, 'long[' + n + ']'); break; }
      default: throw new Error('badtype');
    }
  }
  function skipPayload(type) {
    switch (type) {
      case 1: r.skip(1); break; case 2: r.skip(2); break; case 3: case 5: r.skip(4); break;
      case 4: case 6: r.skip(8); break;
      case 7: r.skip(r.u32()); break;
      case 8: r.skip(r.u16()); break;
      case 9: { const et = r.u8(); const n = r.u32(); for (let i = 0; i < n; i++) skipPayload(et); break; }
      case 10: { for (;;) { const t = r.u8(); if (t === 0) break; r.skip(r.u16()); skipPayload(t); } break; }
      case 11: r.skip(r.u32() * 4); break; case 12: r.skip(r.u32() * 8); break;
      default: throw new Error('badtype');
    }
  }
  function record(name, v) {
    if (!name) return;
    if (Object.keys(found).length < 400 && found[name] === undefined) found[name] = v;
  }
  // Root: a single named compound (or list, in newer network NBT). Read tag id.
  const rootType = r.u8();
  if (rootType !== 10 && rootType !== 9) throw new Error('root');
  readName(); // root name
  if (rootType === 10) {
    for (;;) {
      const t = r.u8();
      if (t === 0) break;
      const nm = readName();
      readPayload(t, nm);
    }
  }
  return found;
}
async function parseNbt(file, ext) {
  let bytes = new Uint8Array(await file.arrayBuffer());
  // gzip-compressed (most .nbt level files) or raw.
  if (bytes[0] === 0x1F && bytes[1] === 0x8B) {
    const inflated = await gunzip(bytes);
    if (inflated) bytes = inflated;
  } else if (bytes[0] === 0x78) {
    // zlib (schematics often). Try deflate via DecompressionStream wrapper.
    try {
      const ds = new DecompressionStream('deflate');
      const stream = new Blob([bytes]).stream().pipeThrough(ds);
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (_) { /* keep raw */ }
  }
  let tags;
  try { tags = walkNbt(bytes); } catch (_) { return null; }
  if (!tags) return null;
  const out = { 'Format': ext === 'nbt' ? 'Minecraft NBT data' : 'Minecraft schematic (' + ext + ')' };
  const pick = ['LevelName', 'Name', 'name', 'Author', 'author', 'DataVersion', 'Version', 'version', 'MCEdit', 'Width', 'Height', 'Length', 'GameType', 'Difficulty', 'seed', 'RandomSeed', 'SpawnX', 'SpawnY', 'SpawnZ', 'Time', 'DayTime'];
  for (const k of pick) if (tags[k] !== undefined) out[k] = String(tags[k]);
  out['Tags decoded'] = Object.keys(tags).length;
  const dump = Object.entries(tags).slice(0, 120).map(([k, v]) => k + ': ' + v).join('\n');
  out._sections = [{ title: 'NBT tags (' + Object.keys(tags).length + ', sample)', node: preBlock(dump) }];
  return out;
}

// ---------- Bedrock bundles (.mcworld/.mcpack/.mcaddon, ZIP) ----------
async function parseMcZip(file, ext) {
  let zip;
  try { zip = await openZip(file); } catch (_) { return null; }
  if (!zip || !zip.entries.length) return null;
  const out = { 'Format': 'Minecraft Bedrock ' + ext.replace('mc', '') + ' (.' + ext + ')' };
  out['Entries'] = zip.entries.length;
  // manifest.json (anywhere in tree)
  const manEntry = zip.entries.find((e) => /(^|\/)manifest\.json$/.test(e.name));
  if (manEntry) {
    try {
      const txt = await zip.text(manEntry.name);
      const j = JSON.parse(txt);
      const h = j.header || {};
      if (h.name) out['Pack name'] = String(h.name);
      if (h.description) out['Description'] = String(h.description).slice(0, 200);
      if (h.uuid) out['UUID'] = String(h.uuid);
      if (Array.isArray(h.version)) out['Version'] = h.version.join('.');
      if (Array.isArray(h.min_engine_version)) out['Min engine version'] = h.min_engine_version.join('.');
      const mods = (j.modules || []).map((m) => m.type).filter(Boolean);
      if (mods.length) out['Module types'] = mods.join(', ');
    } catch (_) { /* ignore */ }
  }
  if (zip.has('levelname.txt')) {
    try { out['Level name'] = (await zip.text('levelname.txt')).trim().slice(0, 120); } catch (_) {}
  } else {
    const lvl = zip.entries.find((e) => /levelname\.txt$/i.test(e.name));
    if (lvl) { try { out['Level name'] = (await zip.text(lvl.name)).trim().slice(0, 120); } catch (_) {} }
  }
  out._sections = [{ title: 'Files (' + zip.entries.length + ', sample)', node: preBlock(zip.names().slice(0, 300).join('\n')) }];
  return out;
}

// ---------- Aseprite ----------
const ASE_DEPTH = { 8: 'Indexed (8bpp)', 16: 'Grayscale (16bpp)', 32: 'RGBA (32bpp)' };
async function parseAseprite(file) {
  const head = await readSlice(file, 0, 128);
  const r = new Reader(head, true);
  const fileSize = r.u32();
  const magic = r.u16();
  if (magic !== 0xA5E0) return null;
  const frames = r.u16();
  const w = r.u16();
  const h = r.u16();
  const depth = r.u16();
  r.skip(4 + 2); // flags + speed (deprecated)
  const out = { 'Format': 'Aseprite sprite' };
  out['Canvas'] = w + ' x ' + h;
  out['Color depth'] = ASE_DEPTH[depth] || (depth + 'bpp');
  out['Frames'] = frames;
  out['Declared size'] = fmtBytes(fileSize);
  // Count layers by scanning frame 1 chunks (type 0x2004 = new layer chunk).
  try {
    const scanLen = Math.min(file.size, 1 << 20);
    const buf = await readSlice(file, 0, scanLen);
    const rr = new Reader(buf, true);
    rr.seek(128); // frame 1 header at 0x80
    rr.u32(); // frame bytes
    const fmagic = rr.u16();
    if (fmagic === 0xF1FA) {
      const oldChunks = rr.u16();
      rr.u16(); // duration
      rr.skip(2);
      const newChunks = rr.u32();
      const nChunks = newChunks || oldChunks;
      let layers = 0, tags = 0, palettes = 0;
      for (let c = 0; c < nChunks && rr.pos + 6 <= buf.length; c++) {
        const start = rr.pos;
        const csize = rr.u32();
        const ctype = rr.u16();
        if (ctype === 0x2004) layers++;
        else if (ctype === 0x2018) tags++;
        else if (ctype === 0x2019 || ctype === 0x0004 || ctype === 0x0011) palettes++;
        if (csize < 6) break;
        rr.seek(start + csize);
      }
      out['Layers'] = layers;
      if (tags) out['Tag chunks'] = tags;
    }
  } catch (_) { /* best effort */ }
  return out;
}

// ---------- Godot PCK ----------
async function parseGodotPck(file) {
  const head = await readSlice(file, 0, 32);
  if (ascii(head, 0, 4) !== 'GDPC') return null;
  const r = new Reader(head, true); r.seek(4);
  const fmtVer = r.u32();
  const major = r.u32(), minor = r.u32(), patch = r.u32();
  const out = {
    'Format': 'Godot resource pack (.pck)',
    'Pack format version': fmtVer,
    'Godot version': major + '.' + minor + '.' + patch,
  };
  // File count location depends on pack version; v2 has a reserved area then count.
  try {
    const buf = await readSlice(file, 0, 200);
    const rr = new Reader(buf, true);
    rr.seek(16);
    if (fmtVer >= 2) { const flags = rr.u32(); const fileBase = rr.u64(); rr.skip(16 * 4); }
    else rr.skip(16 * 4);
    const fileCount = rr.u32();
    if (fileCount > 0 && fileCount < 1_000_000) out['Files'] = fileCount;
  } catch (_) {}
  return out;
}

// ---------- Quake PACK (.pak) ----------
async function parsePak(file) {
  const head = await readSlice(file, 0, 12);
  if (ascii(head, 0, 4) !== 'PACK') return null;
  const r = new Reader(head, true); r.seek(4);
  const dirOff = r.u32();
  const dirLen = r.u32();
  const count = Math.floor(dirLen / 64);
  const out = { 'Format': 'Quake PACK archive (.pak)', 'Files': count };
  if (count > 0 && count < 200000) {
    const dir = await readSlice(file, dirOff, Math.min(dirLen, 4 * 1024 * 1024));
    const names = [];
    const n = Math.min(count, Math.floor(dir.length / 64));
    for (let i = 0; i < n; i++) names.push(cleanAscii(dir, i * 64, 56));
    out._sections = [{ title: 'Files (' + names.length + ', sample)', node: preBlock(names.slice(0, 300).join('\n')) }];
  }
  return out;
}

// ---------- PK3 / PK4 (ZIP) ----------
async function parsePk3(file, ext) {
  let zip;
  try { zip = await openZip(file); } catch (_) { return null; }
  if (!zip || !zip.entries.length) return null;
  const names = zip.names();
  const out = { 'Format': (ext === 'pk4' ? 'id Tech 4' : 'id Tech 3') + ' archive (.' + ext + ', ZIP)', 'Entries': names.length };
  out['BSP maps'] = zip.match(/\.bsp$/i).length;
  out['MD3 models'] = zip.match(/\.md3$/i).length;
  out['Textures'] = zip.match(/\/(textures|gfx)\//i).length;
  out._sections = [{ title: 'Files (' + names.length + ', sample)', node: preBlock(names.slice(0, 300).join('\n')) }];
  return out;
}

// ---------- Source BSP ----------
async function parseBsp(file) {
  const head = await readSlice(file, 0, 1036);
  const id = ascii(head, 0, 4);
  const r = new Reader(head, true);
  const out = { 'Format': 'Compiled map (BSP)' };
  let lumpBase = 8, lumpCount = 64, entLumpIdx = 0;
  if (id === 'VBSP') {           // Valve Source
    r.seek(4);
    const version = r.i32();
    out['Engine'] = 'Valve Source (VBSP)';
    out['Map version'] = version;
    lumpBase = 8;
  } else {
    // GoldSrc/Quake: first int is BSP version (29/30/38/...)
    r.seek(0);
    const version = r.i32();
    if (version < 0 || version > 100) return null;
    out['Engine'] = version === 30 ? 'GoldSrc (Half-Life)' : version === 29 ? 'Quake' : version === 38 ? 'Quake II' : 'Quake-family';
    out['BSP version'] = version;
    lumpBase = 4;
  }
  // Entity lump is index 0; read its offset/length and scan classnames.
  try {
    const r2 = new Reader(head, true); r2.seek(lumpBase);
    const entOff = r2.u32();
    const entLen = r2.u32();
    if (entOff > 0 && entLen > 0 && entLen < 16 * 1024 * 1024) {
      const ent = await readSlice(file, entOff, Math.min(entLen, 512 * 1024));
      const text = latin1(ent);
      const classes = {};
      let spawns = 0;
      for (const m of text.matchAll(/"classname"\s*"([^"]+)"/g)) {
        classes[m[1]] = (classes[m[1]] || 0) + 1; spawns++;
      }
      out['Entities'] = spawns;
      const top = Object.entries(classes).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, v]) => k + ' x' + v).join('\n');
      if (top) out._sections = [{ title: 'Entity classnames (' + Object.keys(classes).length + ' types)', node: preBlock(top) }];
    }
  } catch (_) {}
  return out;
}

// ---------- Valve VPK ----------
async function parseVpk(file) {
  const head = await readSlice(file, 0, 28);
  const r = new Reader(head, true);
  const sig = r.u32();
  if (sig !== 0x55AA1234) return null;
  const version = r.u32();
  const treeSize = r.u32();
  const out = { 'Format': 'Valve Pak (.vpk)', 'Version': version, 'Directory tree size': fmtBytes(treeSize) };
  if (version === 2) {
    const fileDataSize = r.u32();
    const archiveMD5 = r.u32();
    const otherMD5 = r.u32();
    const sigSize = r.u32();
    out['File data section'] = fmtBytes(fileDataSize);
  }
  out['Note'] = 'Multi-part Valve archive (_dir.vpk indexes _NNN.vpk parts)';
  return out;
}

// ---------- Valve VTF ----------
const VTF_FORMATS = { 0: 'RGBA8888', 1: 'ABGR8888', 2: 'RGB888', 3: 'BGR888', 4: 'RGB565', 12: 'BGRA8888', 13: 'DXT1', 14: 'DXT3', 15: 'DXT5', 24: 'RGBA16161616F' };
async function parseVtf(file) {
  const head = await readSlice(file, 0, 64);
  if (!(head[0] === 0x56 && head[1] === 0x54 && head[2] === 0x46 && head[3] === 0x00)) return null;
  const r = new Reader(head, true); r.seek(4);
  const vMaj = r.u32(), vMin = r.u32();
  const headerSize = r.u32();
  const width = r.u16(), height = r.u16();
  const flags = r.u32();
  const frames = r.u16();
  const firstFrame = r.u16();
  r.skip(4 + 12 + 4); // padding + reflectivity + padding
  const bumpScale = r.f32();
  const hiResFmt = r.i32();
  const out = {
    'Format': 'Valve Texture (.vtf v' + vMaj + '.' + vMin + ')',
    'Dimensions': width + ' x ' + height,
    'Frames': frames,
    'Pixel format': VTF_FORMATS[hiResFmt] || ('format ' + hiResFmt),
    'Flags': '0x' + (flags >>> 0).toString(16),
  };
  return out;
}

// ---------- Valve VMT ----------
async function parseVmt(file) {
  const text = (await file.slice(0, Math.min(file.size, 65536)).text());
  const shaderMatch = text.match(/^\s*"?([A-Za-z0-9_]+)"?\s*\{/m);
  if (!shaderMatch) return null;
  const out = { 'Format': 'Valve Material (.vmt)', 'Shader': shaderMatch[1] };
  const params = {};
  for (const m of text.matchAll(/"(\$[A-Za-z0-9_]+)"\s+"?([^"\r\n}]*)"?/g)) params[m[1]] = m[2].trim();
  const keys = Object.keys(params);
  out['Parameters'] = keys.length;
  if (keys.length) out._sections = [{ title: 'Material parameters', node: preBlock(keys.map((k) => k + ' = ' + params[k]).join('\n')) }];
  return out;
}

// ---------- KTX / KTX2 ----------
const KTX1 = [0xAB, 0x4B, 0x54, 0x58, 0x20, 0x31, 0x31, 0xBB, 0x0D, 0x0A, 0x1A, 0x0A];
const KTX2 = [0xAB, 0x4B, 0x54, 0x58, 0x20, 0x32, 0x30, 0xBB, 0x0D, 0x0A, 0x1A, 0x0A];
const VK_FORMATS = { 0: 'UNDEFINED', 23: 'R8G8B8_UNORM', 37: 'R8G8B8A8_UNORM', 43: 'R8G8B8A8_SRGB', 131: 'BC1_RGB_UNORM', 137: 'BC3_UNORM', 145: 'BC7_UNORM', 147: 'BC7_SRGB', 157: 'ETC2_R8G8B8_UNORM', 184: 'ASTC_4x4_UNORM' };
const KTX_SUPERCOMP = { 0: 'None', 1: 'BasisLZ', 2: 'Zstandard', 3: 'ZLIB' };
async function parseKtx(file) {
  const head = await readSlice(file, 0, 80);
  if (matchMagic(head, KTX2)) {
    const r = new Reader(head, true); r.seek(12);
    const vkFormat = r.u32();
    const typeSize = r.u32();
    const w = r.u32(), h = r.u32(), d = r.u32();
    const layers = r.u32(), faces = r.u32(), levels = r.u32();
    const sc = r.u32();
    return {
      'Format': 'KTX2 GPU texture',
      'Dimensions': w + ' x ' + (h || 1) + (d > 1 ? ' x ' + d : ''),
      'VkFormat': VK_FORMATS[vkFormat] || ('VK ' + vkFormat),
      'Mip levels': levels,
      'Array layers': layers || 1,
      'Faces': faces + (faces === 6 ? ' (cubemap)' : ''),
      'Supercompression': KTX_SUPERCOMP[sc] || ('scheme ' + sc),
    };
  }
  if (matchMagic(head, KTX1)) {
    const r = new Reader(head, true); r.seek(12);
    const endianness = r.u32();
    const little = endianness === 0x04030201;
    r.le(little);
    const glType = r.u32(); r.u32(); r.u32();
    const glInternalFormat = r.u32(); r.u32();
    const w = r.u32(), h = r.u32(), d = r.u32();
    const arrayElems = r.u32(), faces = r.u32(), levels = r.u32();
    return {
      'Format': 'KTX GPU texture (v1)',
      'Dimensions': w + ' x ' + (h || 1) + (d > 1 ? ' x ' + d : ''),
      'GL internal format': '0x' + glInternalFormat.toString(16),
      'Mip levels': levels,
      'Array elements': arrayElems || 1,
      'Faces': faces + (faces === 6 ? ' (cubemap)' : ''),
    };
  }
  return null;
}

// ---------- Tiled XML (.tmx / .tsx) ----------
async function parseTiledXml(file, ext) {
  const text = await file.slice(0, Math.min(file.size, 1 << 20)).text();
  if (!/<(map|tileset)\b/.test(text)) return null;
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) return null;
  if (ext === 'tsx') {
    const ts = doc.querySelector('tileset');
    if (!ts) return null;
    return {
      'Format': 'Tiled tileset (.tsx)',
      'Name': ts.getAttribute('name') || '-',
      'Tile size': (ts.getAttribute('tilewidth') || '?') + ' x ' + (ts.getAttribute('tileheight') || '?'),
      'Tile count': ts.getAttribute('tilecount') || '-',
      'Columns': ts.getAttribute('columns') || '-',
    };
  }
  const map = doc.querySelector('map');
  if (!map) return null;
  const layers = doc.querySelectorAll('layer').length;
  const objGroups = doc.querySelectorAll('objectgroup').length;
  const objects = doc.querySelectorAll('object').length;
  const tilesets = Array.from(doc.querySelectorAll('tileset')).map((t) => t.getAttribute('source') || t.getAttribute('name') || '(embedded)');
  const out = {
    'Format': 'Tiled map (.tmx)',
    'Orientation': map.getAttribute('orientation') || '-',
    'Map size': (map.getAttribute('width') || '?') + ' x ' + (map.getAttribute('height') || '?') + ' tiles',
    'Tile size': (map.getAttribute('tilewidth') || '?') + ' x ' + (map.getAttribute('tileheight') || '?') + ' px',
    'Tile layers': layers,
    'Object groups': objGroups,
    'Objects': objects,
    'Tilesets': tilesets.length,
  };
  if (tilesets.length) out._sections = [{ title: 'Tilesets', node: preBlock(tilesets.join('\n')) }];
  return out;
}

// ---------- Tiled JSON (.tmj / .tsj) ----------
async function parseTiledJson(file, ext) {
  let j; try { j = JSON.parse(await file.text()); } catch (_) { return null; }
  if (ext === 'tsj' || j.type === 'tileset') {
    return {
      'Format': 'Tiled tileset (JSON)',
      'Name': j.name || '-',
      'Tile size': (j.tilewidth || '?') + ' x ' + (j.tileheight || '?'),
      'Tile count': j.tilecount != null ? j.tilecount : '-',
      'Columns': j.columns != null ? j.columns : '-',
    };
  }
  if (j.type !== 'map' && !(j.width && j.layers)) return null;
  const layers = j.layers || [];
  const objects = layers.reduce((a, l) => a + ((l.objects && l.objects.length) || 0), 0);
  const out = {
    'Format': 'Tiled map (JSON)',
    'Orientation': j.orientation || '-',
    'Map size': (j.width || '?') + ' x ' + (j.height || '?') + ' tiles',
    'Tile size': (j.tilewidth || '?') + ' x ' + (j.tileheight || '?') + ' px',
    'Layers': layers.length,
    'Objects': objects,
    'Tilesets': (j.tilesets || []).length,
    'Tiled version': j.tiledversion || j.version || '-',
  };
  return out;
}

// ---------- LÖVE (.love, ZIP) ----------
async function parseLove(file) {
  let zip;
  try { zip = await openZip(file); } catch (_) { return null; }
  if (!zip || !zip.entries.length) return null;
  const names = zip.names();
  const hasMain = names.some((n) => /(^|\/)main\.lua$/.test(n));
  const hasConf = names.some((n) => /(^|\/)conf\.lua$/.test(n));
  if (!hasMain && !hasConf) return null;
  const out = { 'Format': 'LÖVE (Love2D) game (.love, ZIP)', 'Entries': names.length };
  out['main.lua'] = hasMain ? 'present' : 'missing';
  out['conf.lua'] = hasConf ? 'present' : 'missing';
  // Asset breakdown by extension.
  const byExt = {};
  for (const n of names) { const m = n.match(/\.([a-z0-9]+)$/i); if (m) byExt[m[1].toLowerCase()] = (byExt[m[1].toLowerCase()] || 0) + 1; }
  const breakdown = Object.entries(byExt).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => k + ': ' + v).join('  ');
  out['Asset types'] = breakdown;
  // Try to read game identity from conf.lua.
  if (hasConf) {
    try {
      const confName = names.find((n) => /(^|\/)conf\.lua$/.test(n));
      const conf = await zip.text(confName);
      const title = conf && conf.match(/window\.title\s*=\s*["']([^"']+)["']/);
      const ident = conf && conf.match(/\.identity\s*=\s*["']([^"']+)["']/);
      if (title) out['Window title'] = title[1];
      if (ident) out['Identity'] = ident[1];
    } catch (_) {}
  }
  out._sections = [{ title: 'Files (' + names.length + ', sample)', node: preBlock(names.slice(0, 300).join('\n')) }];
  return out;
}

// ---------- PICO-8 cart (.p8) ----------
async function parseP8(file) {
  const text = await file.slice(0, Math.min(file.size, 1 << 20)).text();
  if (!/^pico-8 cartridge/i.test(text)) return null;
  const ver = (text.match(/version (\d+)/i) || [])[1];
  const sections = ['__lua__', '__gfx__', '__gff__', '__label__', '__map__', '__sfx__', '__music__'];
  const present = sections.filter((s) => text.includes(s));
  const out = { 'Format': 'PICO-8 cartridge (.p8)', 'Cart version': ver || '?' };
  out['Sections present'] = present.map((s) => s.replace(/__/g, '')).join(', ') || '(none)';
  const luaIdx = text.indexOf('__lua__');
  const nextIdx = text.indexOf('__gfx__', luaIdx);
  if (luaIdx >= 0) {
    const end = nextIdx >= 0 ? nextIdx : text.length;
    out['Lua code size'] = fmtBytes(end - luaIdx - 8);
  }
  return out;
}

// ---------- identification-only (rare AND hard) ----------
async function idOnly(file, ext) {
  const notes = {
    sc2replay: 'StarCraft II replay (MPQ container). Full parse needs an MPQ/StormLib reader + replay protocol decode.',
    mpq: 'Blizzard MoPaQ archive. Hash/block tables are obfuscated; full listing needs an MPQ reader.',
    cia: 'Nintendo 3DS CIA package. Encrypted NCCH content; identification only.',
    nsp: 'Nintendo Switch package (PFS0). Encrypted NCA content; identification only.',
    xci: 'Nintendo Switch gamecard image. Encrypted; identification only.',
    rpa: 'Ren\'Py archive. Index is zlib-compressed and key-obfuscated; full listing needs the RPA reader.',
    rgssad: 'RPG Maker XP/VX encrypted archive. Index is XOR-encrypted with a rolling key.',
    rgss3a: 'RPG Maker VX Ace encrypted archive. Index is XOR-encrypted with a rolling key.',
  };
  const labels = {
    sc2replay: 'StarCraft II replay (MPQ)', mpq: 'Blizzard MoPaQ archive',
    cia: 'Nintendo 3DS CIA package', nsp: 'Nintendo Switch NSP package',
    xci: 'Nintendo Switch XCI cartridge', rpa: 'Ren\'Py archive',
    rgssad: 'RPG Maker XP/VX archive', rgss3a: 'RPG Maker VX Ace archive',
  };
  const head = await readSlice(file, 0, 8);
  const out = { 'Format': labels[ext] || ext.toUpperCase() };
  const sig = ascii(head, 0, 4).replace(/[^\x20-\x7e]/g, '.');
  if (sig.trim()) out['Header signature'] = sig;
  out['Note'] = notes[ext] || 'Identification only.';
  return out;
}

// ---------- dispatch ----------
function wrap(fn) {
  return async (c) => { try { return await fn(c); } catch (_) { return null; } };
}

// The Sims / Maxis DBPF package (.package): Sims 2/3/4, SimCity 4, Spore all use
// the Database Packed File container. The fixed little-endian header gives the
// resource (index entry) count and index location without decoding contents.
async function parsePackage(file) {
  const b = await readSlice(file, 0, 96);
  if (b.length < 68 || ascii(b, 0, 4) !== 'DBPF') return null;
  const r = new Reader(b, true); r.seek(4);
  const major = r.u32(), minor = r.u32();
  r.seek(36); const indexCount = r.u32();
  r.seek(44); const indexSize = r.u32();
  const indexOffset = major >= 2 ? r.seek(64).u32() : r.seek(40).u32();
  let game = 'Maxis DBPF';
  if (major === 1) game = 'The Sims 2 / SimCity 4 / Spore';
  else if (major === 2 && minor === 0) game = 'The Sims 3';
  else if (major === 2 && minor === 1) game = 'The Sims 4';
  return {
    'Format': 'DBPF package',
    'Game / app': game,
    'DBPF version': major + '.' + minor,
    'Resources (index entries)': indexCount.toLocaleString(),
    'Index size': fmtBytes(indexSize),
    'Index offset': '0x' + indexOffset.toString(16),
    'Note': 'Database Packed File - a container of game resources (meshes, textures, tuning XML, CAS parts).',
  };
}

export const PARSERS = {
  // ROM headers
  nes: wrap((c) => parseNes(c.head)),
  gb: wrap((c) => parseGb(c.head, c.ext)),
  gbc: wrap((c) => parseGb(c.head, c.ext)),
  gba: wrap((c) => parseGba(c.head)),
  sfc: wrap((c) => parseSnes(c.file)),
  smc: wrap((c) => parseSnes(c.file)),
  nds: wrap((c) => parseNds(c.head)),
  dsi: wrap((c) => parseNds(c.head)),
  z64: wrap((c) => parseN64(c.head)),
  n64: wrap((c) => parseN64(c.head)),
  v64: wrap((c) => parseN64(c.head)),
  gen: wrap((c) => parseGenesis(c.file)),
  smd: wrap((c) => parseGenesis(c.file)),

  // Patches
  ips: wrap((c) => parseIps(c.file)),
  bps: wrap((c) => parseBps(c.file)),
  ups: wrap((c) => parseUps(c.file)),
  ppf: wrap((c) => parsePpf(c.file)),

  // Game data / engines
  wad: wrap((c) => parseWad(c.file)),
  nbt: wrap((c) => parseNbt(c.file, c.ext)),
  schematic: wrap((c) => parseNbt(c.file, c.ext)),
  schem: wrap((c) => parseNbt(c.file, c.ext)),
  litematic: wrap((c) => parseNbt(c.file, c.ext)),
  mcworld: wrap((c) => parseMcZip(c.file, c.ext)),
  mcpack: wrap((c) => parseMcZip(c.file, c.ext)),
  mcaddon: wrap((c) => parseMcZip(c.file, c.ext)),
  ase: wrap((c) => parseAseprite(c.file)),
  aseprite: wrap((c) => parseAseprite(c.file)),
  pck: wrap((c) => parseGodotPck(c.file)),
  pak: wrap((c) => parsePak(c.file)),
  pk3: wrap((c) => parsePk3(c.file, c.ext)),
  pk4: wrap((c) => parsePk3(c.file, c.ext)),

  // Source / Valve
  bsp: wrap((c) => parseBsp(c.file)),
  vpk: wrap((c) => parseVpk(c.file)),
  vtf: wrap((c) => parseVtf(c.file)),
  vmt: wrap((c) => parseVmt(c.file)),

  // GPU textures
  ktx: wrap((c) => parseKtx(c.file)),
  ktx2: wrap((c) => parseKtx(c.file)),

  // Tiled
  tmx: wrap((c) => parseTiledXml(c.file, c.ext)),
  tmj: wrap((c) => parseTiledJson(c.file, c.ext)),
  tsj: wrap((c) => parseTiledJson(c.file, c.ext)),

  // LÖVE / fantasy console
  love: wrap((c) => parseLove(c.file)),
  p8: wrap((c) => parseP8(c.file)),
  package: wrap((c) => parsePackage(c.file)),

  // identification-only (rare + hard)
  sc2replay: wrap((c) => idOnly(c.file, c.ext)),
  mpq: wrap((c) => idOnly(c.file, c.ext)),
  cia: wrap((c) => idOnly(c.file, c.ext)),
  nsp: wrap((c) => idOnly(c.file, c.ext)),
  xci: wrap((c) => idOnly(c.file, c.ext)),
  rpa: wrap((c) => idOnly(c.file, c.ext)),
  rgssad: wrap((c) => idOnly(c.file, c.ext)),
  rgss3a: wrap((c) => idOnly(c.file, c.ext)),
};
