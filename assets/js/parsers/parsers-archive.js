/* Analyser - lazy parser chunk: archives, compression, packages, installers.

   Loaded on demand by renderProprietary() when a file whose FORMATS entry has
   `chunk: 'archive'` is opened. Each entry in PARSERS is
   `({head, file, ext}) => rows` where `rows` is a plain object of label->value
   pairs (rendered as a readout), optionally carrying
   `_sections: [{title, node, open?}]` for collapsible blocks and
   `_previewNode` for a preview. Return null to fall back to the generic card.

   Dependency-free: TAR/GZIP/cpio/ar/deb/cab/rpm and the raw compressors are
   parsed from their headers directly; ZIP-based packages reuse openZip. Heavy
   formats we cannot decode natively (7z/rar bodies, squashfs, snap, stuffit,
   ace, …) stay identification-only. No top-level side effects. */

import { el, row, fmtBytes, loadScript } from '../core/util.js';
import { Reader, ascii, matchMagic, latin1, utf8, gunzip } from '../core/binutil.js';
import { openZip } from '../renderers/zip.js';
import { xzDecompress } from '../lib/xz-loader.js';

// ---------- zstd decompression (lazy fzstd) ----------
// Decompress a zstd byte buffer using the vendored fzstd UMD library, loaded on
// demand the first time a .zst/.conda member is opened. Returns the decompressed
// Uint8Array, or null on any failure (so callers fall back to header-only).
async function zstdDecompress(bytes) {
  try {
    if (!(window.fzstd && window.fzstd.decompress)) await loadScript('assets/vendor/fzstd.js');
    if (!(window.fzstd && window.fzstd.decompress)) return null;
    const out = window.fzstd.decompress(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    return out instanceof Uint8Array ? out : (out ? new Uint8Array(out) : null);
  } catch (_) {
    return null;
  }
}

// ---------- small shared helpers ----------

// A scrollable <pre> for raw text / file lists.
function preBlock(text, cls) {
  return el('pre', {
    class: cls || 'anr-code',
    style: 'max-height:360px;overflow:auto;font-size:12px;white-space:pre-wrap;word-break:break-word;margin:0;',
  }, text);
}

// Read up to `n` bytes from the file (for parses needing more than the 4KB head).
async function readBytes(file, n) {
  return new Uint8Array(await file.slice(0, Math.min(file.size, n)).arrayBuffer());
}

// Read a byte range from the file.
async function readRange(file, start, end) {
  return new Uint8Array(await file.slice(start, Math.min(end, file.size)).arrayBuffer());
}

const fmtDate = (d) => (d instanceof Date && !isNaN(d)) ? d.toLocaleString() : String(d);

// Build a file-list section node from rows of {name, size, extra}.
function fileListSection(title, items, open) {
  const lines = items.map((it) => {
    const sz = it.size != null ? fmtBytes(it.size).padStart(10) : ''.padStart(10);
    return sz + '  ' + (it.extra ? it.extra + '  ' : '') + it.name;
  });
  return { title, node: preBlock(lines.join('\n')), open: !!open };
}

// ---------- TAR ----------
// ustar / GNU / old-style 512-byte member headers.
const TAR_TYPES = {
  '0': 'file', '\0': 'file', '1': 'hardlink', '2': 'symlink', '3': 'char dev',
  '4': 'block dev', '5': 'directory', '6': 'fifo', '7': 'contiguous',
  'g': 'pax global', 'x': 'pax', 'L': 'GNU longname', 'K': 'GNU longlink',
};
function octal(bytes, off, len) {
  let s = '';
  for (let i = off; i < off + len; i++) {
    const c = bytes[i];
    if (c === 0 || c === 0x20) { if (s) break; else continue; }
    if (c < 0x30 || c > 0x37) break;
    s += String.fromCharCode(c);
  }
  return s ? parseInt(s, 8) : 0;
}
function tarStr(bytes, off, len) {
  let end = off;
  while (end < off + len && bytes[end] !== 0) end++;
  return ascii(bytes, off, end - off).trim();
}
async function parseTar(file) {
  // Cap the scan so a giant tar doesn't pull the whole thing into memory.
  const cap = Math.min(file.size, 8 * 1024 * 1024);
  const b = await readBytes(file, cap);
  // Validate: ustar magic, or a plausible octal size field at offset 124.
  const hasUstar = ascii(b, 257, 5) === 'ustar';
  if (!hasUstar) {
    // Old tar: checksum/size fields must be octal-ish. Quick sanity check.
    const sz = octal(b, 124, 12);
    const cksum = tarStr(b, 148, 8);
    if (!/^[0-7]+$/.test(cksum) || sz < 0) return null;
  }
  const items = [];
  let pos = 0, total = 0, members = 0, truncated = false;
  let longName = null;
  while (pos + 512 <= b.length) {
    // Two consecutive zero blocks mark end of archive.
    let allZero = true;
    for (let i = 0; i < 512; i++) { if (b[pos + i] !== 0) { allZero = false; break; } }
    if (allZero) break;
    const name = tarStr(b, pos, 100);
    const mode = octal(b, pos + 100, 8);
    const size = octal(b, pos + 124, 12);
    const mtime = octal(b, pos + 136, 12);
    const typeChar = String.fromCharCode(b[pos + 156] || 0x30);
    const prefix = ascii(b, 257, 5) === 'ustar' ? tarStr(b, pos + 345, 155) : '';
    let full = prefix ? prefix + '/' + name : name;
    if (longName) { full = longName; longName = null; }
    if (typeChar === 'L') {
      // GNU long name: payload (next blocks) is the real name.
      const nameBytes = b.subarray(pos + 512, pos + 512 + size);
      longName = ascii(nameBytes, 0, nameBytes.length).replace(/\0+$/, '');
    } else if (!/[gx]/.test(typeChar)) {
      members++;
      total += size;
      if (items.length < 1000 && full) {
        items.push({
          name: full + (typeChar === '5' ? '/' : ''),
          size,
          extra: (TAR_TYPES[typeChar] || ('type ' + typeChar)),
        });
      }
    }
    const dataBlocks = Math.ceil(size / 512) * 512;
    pos += 512 + dataBlocks;
    if (members > 50000) { truncated = true; break; }
  }
  if (members === 0 && !hasUstar) return null;
  if (cap < file.size) truncated = true;
  const out = {
    'Format': 'TAR archive' + (hasUstar ? ' (ustar / POSIX)' : ' (old-style)'),
    'Members': members.toLocaleString() + (truncated ? '+ (truncated)' : ''),
    'Total uncompressed': fmtBytes(total) + (truncated ? '+' : ''),
  };
  if (items.length) {
    out._sections = [fileListSection('Files (' + items.length + (truncated ? '+' : '') + ')', items, true)];
  }
  return out;
}

// ---------- GZIP (.gz, .tgz) ----------
const GZIP_OS = ['FAT', 'Amiga', 'VMS', 'Unix', 'VM/CMS', 'Atari', 'HPFS', 'Macintosh', 'Z-System', 'CP/M', 'TOPS-20', 'NTFS', 'QDOS', 'Acorn'];
async function parseGzip(file, ext) {
  const b = await readBytes(file, 4096);
  if (!(b[0] === 0x1f && b[1] === 0x8b && b[2] === 0x08)) return null;
  const flags = b[3];
  const mtimeRaw = (b[4] | (b[5] << 8) | (b[6] << 16) | (b[7] << 24)) >>> 0;
  const xfl = b[8];
  const osId = b[9];
  let p = 10;
  let extraField = false, fname = '', comment = '', hasCrc = false;
  if (flags & 0x04) { // FEXTRA
    const xlen = b[p] | (b[p + 1] << 8); p += 2 + xlen; extraField = true;
  }
  if (flags & 0x08) { // FNAME
    let s = ''; while (p < b.length && b[p] !== 0) s += String.fromCharCode(b[p++]); p++;
    fname = latin1(Uint8Array.from(s, (ch) => ch.charCodeAt(0)));
  }
  if (flags & 0x10) { // FCOMMENT
    let s = ''; while (p < b.length && b[p] !== 0) s += String.fromCharCode(b[p++]); p++;
    comment = s;
  }
  if (flags & 0x02) hasCrc = true; // FHCRC
  // ISIZE = uncompressed size mod 2^32 (last 4 bytes of the stream).
  let isize = null;
  try {
    const tail = await readRange(file, file.size - 4, file.size);
    isize = (tail[0] | (tail[1] << 8) | (tail[2] << 16) | (tail[3] << 24)) >>> 0;
  } catch (_) {}
  const out = {
    'Format': 'gzip compressed' + (ext === 'tgz' ? ' (tarball)' : ''),
  };
  if (fname) out['Original filename'] = fname;
  if (mtimeRaw) out['Modified'] = fmtDate(new Date(mtimeRaw * 1000));
  out['OS'] = GZIP_OS[osId] != null ? GZIP_OS[osId] : (osId === 255 ? 'unknown' : 'OS ' + osId);
  if (xfl === 2) out['Deflate level'] = 'best (slowest)';
  else if (xfl === 4) out['Deflate level'] = 'fastest';
  if (isize != null) {
    out['Uncompressed (ISIZE mod 4GiB)'] = fmtBytes(isize);
    const comp = file.size - 18;
    if (comp > 0 && isize > 0) out['Ratio'] = (isize / comp).toFixed(2) + '×';
  }
  out['Compressed size'] = fmtBytes(file.size);
  if (extraField) out['Extra field'] = 'present';
  if (hasCrc) out['Header CRC'] = 'present';
  if (comment) out['Comment'] = comment;
  if (ext === 'tgz') out['Note'] = 'Wraps a TAR archive (gzip → tar member list)';
  return out;
}

// ---------- bzip2 (.bz2) ----------
function parseBzip2(head) {
  if (!(head[0] === 0x42 && head[1] === 0x5a && head[2] === 0x68)) return null; // "BZh"
  const lvl = String.fromCharCode(head[3]);
  if (lvl < '1' || lvl > '9') return null;
  // Block magic: pi (0x314159265359) compressed, or EOS (0x177245385090).
  const blockMagic = head[4] === 0x31 && head[5] === 0x41 && head[6] === 0x59;
  return {
    'Format': 'bzip2 compressed',
    'Block size': lvl + '00 KiB (level ' + lvl + ')',
    'Stream magic': blockMagic ? 'valid (compressed block)' : 'header only',
  };
}

// ---------- xz (.xz) ----------
// Header-only parse is the always-returned base. When `file` is supplied we
// lazily decompress via xzwasm (LZMA2 WASM) and, if the inner stream is a tar
// (e.g. .tar.xz), list its members; otherwise we show the decompressed size and
// the first bytes / detected inner type. Decompression failures leave the
// header-only result intact.
const XZ_CHECK = { 0: 'none', 1: 'CRC32', 4: 'CRC64', 10: 'SHA-256' };
function parseXzHeader(head) {
  // Magic: FD 37 7A 58 5A 00
  if (!matchMagic(head, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) return null;
  const flags = head[7]; // stream flags: low nibble of 2nd byte = check type
  const check = flags & 0x0f;
  return {
    'Format': 'xz compressed (LZMA2)',
    'Integrity check': XZ_CHECK[check] != null ? XZ_CHECK[check] : 'reserved (' + check + ')',
  };
}
async function parseXz(head, file, ext) {
  const out = parseXzHeader(head);
  if (!out || !file) return out;
  try {
    // Cap the compressed input we pull into memory (the output is separately
    // capped inside xzDecompress).
    const MAX_IN = 64 * 1024 * 1024;
    if (file.size > MAX_IN) { out['Note'] = 'inner stream not expanded (over ' + fmtBytes(MAX_IN) + ' compressed)'; return out; }
    const comp = await readBytes(file, file.size);
    const decoded = await xzDecompress(comp);
    if (!decoded || !decoded.length) return out;
    out['Decompressed size'] = fmtBytes(decoded.length);
    // Detect an inner tar (ustar magic at 257, or a plausible octal size field).
    const looksTar = ascii(decoded, 257, 5) === 'ustar' || /^[0-7 ]+$/.test(tarStr(decoded, 148, 8) || ' ');
    const nameIsTar = ext === 'txz' || /\.tar\.xz$/i.test((file.name || '')) || /\.tar$/i.test((file.name || '').replace(/\.xz$/i, ''));
    if (looksTar || nameIsTar) {
      const { items, members, total } = listTarMembers(decoded);
      if (members) {
        out['Inner archive'] = 'TAR (' + members.toLocaleString() + ' members, ' + fmtBytes(total) + ')';
        if (items.length) out._sections = [fileListSection('Files (' + items.length + (members > items.length ? '+' : '') + ')', items, true)];
        return out;
      }
    }
    // Not a tar (or no members found): show the first decompressed bytes.
    const n = Math.min(decoded.length, 64);
    const hex = Array.from(decoded.subarray(0, n)).map((b) => b.toString(16).padStart(2, '0')).join(' ');
    out._sections = [{ title: 'First bytes (decompressed)', node: preBlock(hex) }];
  } catch (_) { /* keep header-only result */ }
  return out;
}

// ---------- zstd (.zst) ----------
// Header-only parse (kept as the base, always returned even if decompression
// fails). `file`/`ext` are optional; when present and the inner stream is a tar,
// we lazily decompress via fzstd and list the tar members.
async function parseZstd(head, file, ext) {
  const out = parseZstdHeader(head);
  if (!out) return out;
  if (!file) return out;
  // Only attempt full decompression for a real zstd frame (not a skippable one),
  // and cap the input so we don't pull a huge file into memory.
  if (out.Format !== 'Zstandard compressed') return out;
  try {
    const MAX_IN = 64 * 1024 * 1024;
    if (file.size > MAX_IN) { out['Note'] = 'inner stream not expanded (over ' + fmtBytes(MAX_IN) + ' compressed)'; return out; }
    const comp = await readBytes(file, file.size);
    const decoded = await zstdDecompress(comp);
    if (!decoded || !decoded.length) return out;
    out['Decompressed size'] = fmtBytes(decoded.length);
    // Detect an inner tar (ustar magic at 257, or a plausible octal size field).
    const looksTar = ascii(decoded, 257, 5) === 'ustar' || /^[0-7 ]+$/.test(tarStr(decoded, 148, 8) || ' ');
    const nameIsTar = ext === 'tzst' || /\.tar\.zst$/i.test((file.name || '')) || /\.tar$/i.test((file.name || '').replace(/\.zst$/i, ''));
    if (looksTar || nameIsTar) {
      const { items, members, total } = listTarMembers(decoded);
      if (members) {
        out['Inner archive'] = 'TAR (' + members.toLocaleString() + ' members, ' + fmtBytes(total) + ')';
        if (items.length) out._sections = [fileListSection('Files (' + items.length + (members > items.length ? '+' : '') + ')', items, true)];
      }
    } else {
      // Show the first bytes of the decompressed payload for context.
      const n = Math.min(decoded.length, 64);
      const hex = Array.from(decoded.subarray(0, n)).map((b) => b.toString(16).padStart(2, '0')).join(' ');
      out._sections = [{ title: 'First bytes (decompressed)', node: preBlock(hex) }];
    }
  } catch (_) { /* keep header-only result */ }
  return out;
}

function parseZstdHeader(head) {
  // Frame magic 0x28 0xB5 0x2F 0xFD (LE).
  if (!(head[0] === 0x28 && head[1] === 0xb5 && head[2] === 0x2f && head[3] === 0xfd)) {
    // Skippable frame magic range 0x184D2A50..5F
    if (head[0] === 0x50 && head[1] === 0x2a && head[2] === 0x4d && (head[3] & 0xf0) === 0x18) {
      return { 'Format': 'Zstandard (skippable frame)' };
    }
    return null;
  }
  const fhd = head[4]; // Frame Header Descriptor
  const fcsFlag = (fhd >> 6) & 0x03;        // Frame Content Size flag
  const singleSeg = (fhd >> 5) & 0x01;
  const hasChecksum = (fhd >> 2) & 0x01;
  const dictFlag = fhd & 0x03;
  let p = 5;
  let windowLog = null;
  if (!singleSeg) {
    const wd = head[p++];
    const exponent = wd >> 3, mantissa = wd & 0x07;
    const windowBase = 1 << (10 + exponent);
    windowLog = windowBase + (windowBase / 8) * mantissa;
  }
  // Dictionary ID
  const dictSizes = [0, 1, 2, 4];
  p += dictSizes[dictFlag];
  // Frame content size
  let contentSize = null;
  const fcsSizes = [singleSeg ? 1 : 0, 2, 4, 8];
  const fcsLen = fcsSizes[fcsFlag];
  if (fcsLen && p + fcsLen <= head.length) {
    let v = 0n;
    for (let i = 0; i < fcsLen; i++) v |= BigInt(head[p + i]) << BigInt(8 * i);
    if (fcsLen === 2) v += 256n;
    contentSize = v;
  }
  const out = {
    'Format': 'Zstandard compressed',
    'Checksum': hasChecksum ? 'present (xxHash64)' : 'none',
  };
  if (windowLog != null) out['Window size'] = fmtBytes(windowLog);
  else if (singleSeg) out['Window size'] = 'single segment (= content size)';
  if (contentSize != null) out['Content size'] = fmtBytes(Number(contentSize));
  if (dictFlag) out['Dictionary ID'] = 'present';
  return out;
}

// ---------- lz4 (.lz4) ----------
function parseLz4(head) {
  // Frame magic 0x184D2204 (LE).
  if (!(head[0] === 0x04 && head[1] === 0x22 && head[2] === 0x4d && head[3] === 0x18)) {
    if (head[0] === 0x02 && head[1] === 0x21 && head[2] === 0x4c && head[3] === 0x18) {
      return { 'Format': 'LZ4 (legacy frame)' };
    }
    return null;
  }
  const flg = head[4];
  const version = (flg >> 6) & 0x03;
  const blockIndep = (flg >> 5) & 0x01;
  const blockChecksum = (flg >> 4) & 0x01;
  const contentSizeFlag = (flg >> 3) & 0x01;
  const contentChecksum = (flg >> 2) & 0x01;
  const dictId = flg & 0x01;
  const bd = head[5];
  const blockMaxBits = (bd >> 4) & 0x07;
  const blockMaxMap = { 4: '64 KiB', 5: '256 KiB', 6: '1 MiB', 7: '4 MiB' };
  let p = 6, contentSize = null;
  if (contentSizeFlag && p + 8 <= head.length) {
    let v = 0n;
    for (let i = 0; i < 8; i++) v |= BigInt(head[p + i]) << BigInt(8 * i);
    contentSize = v; p += 8;
  }
  const out = {
    'Format': 'LZ4 compressed (frame)',
    'Version': version,
    'Block mode': blockIndep ? 'independent' : 'linked',
    'Max block size': blockMaxMap[blockMaxBits] || ('code ' + blockMaxBits),
  };
  if (contentSize != null) out['Content size'] = fmtBytes(Number(contentSize));
  out['Block checksum'] = blockChecksum ? 'yes' : 'no';
  out['Content checksum'] = contentChecksum ? 'yes' : 'no';
  if (dictId) out['Dictionary ID'] = 'present';
  return out;
}

// ---------- lzma (.lzma) ----------
function parseLzma(head) {
  if (head.length < 13) return null;
  const props = head[0];
  if (props >= 225) return null; // lc+lp*9+pb*45 must be < 225
  const lc = props % 9;
  const rem = Math.floor(props / 9);
  const lp = rem % 5;
  const pb = Math.floor(rem / 5);
  const dictSize = (head[1] | (head[2] << 8) | (head[3] << 16) | (head[4] << 24)) >>> 0;
  // Uncompressed size: 8 bytes LE; 0xFFFFFFFFFFFFFFFF = unknown.
  let unknown = true;
  for (let i = 5; i < 13; i++) if (head[i] !== 0xff) { unknown = false; break; }
  let usize = 0n;
  for (let i = 0; i < 8; i++) usize |= BigInt(head[5 + i]) << BigInt(8 * i);
  const out = {
    'Format': 'LZMA compressed (raw .lzma / alone)',
    'Properties': 'lc=' + lc + ' lp=' + lp + ' pb=' + pb,
    'Dictionary size': fmtBytes(dictSize),
    'Uncompressed size': unknown ? 'unknown (streamed)' : fmtBytes(Number(usize)),
  };
  return out;
}

// ---------- compress (.Z) ----------
function parseCompress(head) {
  if (!(head[0] === 0x1f && head[1] === 0x9d)) return null;
  const flags = head[2];
  const maxBits = flags & 0x1f;
  const blockMode = (flags & 0x80) !== 0;
  return {
    'Format': 'compress (.Z, LZW)',
    'Max code width': maxBits + ' bits',
    'Block mode': blockMode ? 'yes' : 'no',
  };
}

// ---------- cpio (.cpio) ----------
function octalAscii(s) { const v = parseInt(s, 8); return isNaN(v) ? 0 : v; }
function hexAscii(s) { const v = parseInt(s, 16); return isNaN(v) ? 0 : v; }
async function parseCpio(file) {
  const cap = Math.min(file.size, 8 * 1024 * 1024);
  const b = await readBytes(file, cap);
  let variant = null;
  if (b[0] === 0x30 && b[1] === 0x37 && b[2] === 0x30 && b[3] === 0x37 && b[4] === 0x30 && b[5] === 0x37) variant = 'odc'; // 070707
  else if (ascii(b, 0, 6) === '070701') variant = 'newc';
  else if (ascii(b, 0, 6) === '070702') variant = 'crc';
  else if ((b[0] === 0xc7 && b[1] === 0x71) || (b[0] === 0x71 && b[1] === 0xc7)) variant = 'bin';
  if (!variant) return null;
  const items = [];
  let pos = 0, count = 0, total = 0, truncated = false;
  try {
    while (pos + 110 <= b.length) {
      if (variant === 'newc' || variant === 'crc') {
        if (ascii(b, pos, 6) !== '070701' && ascii(b, pos, 6) !== '070702') break;
        const namesize = hexAscii(ascii(b, pos + 94, 8));
        const filesize = hexAscii(ascii(b, pos + 54, 8));
        const name = ascii(b, pos + 110, namesize).replace(/\0+$/, '');
        if (name === 'TRAILER!!!') break;
        const headerLen = 110 + namesize;
        const namePad = (4 - (headerLen % 4)) % 4;
        const dataLen = filesize;
        const dataPad = (4 - (dataLen % 4)) % 4;
        count++; total += filesize;
        if (items.length < 1000 && name) items.push({ name, size: filesize });
        pos += headerLen + namePad + dataLen + dataPad;
      } else if (variant === 'odc') {
        if (ascii(b, pos, 6) !== '070707') break;
        const namesize = octalAscii(ascii(b, pos + 59, 6));
        const filesize = octalAscii(ascii(b, pos + 65, 11));
        const name = ascii(b, pos + 76, namesize).replace(/\0+$/, '');
        if (name === 'TRAILER!!!') break;
        count++; total += filesize;
        if (items.length < 1000 && name) items.push({ name, size: filesize });
        pos += 76 + namesize + filesize;
      } else {
        break; // binary variant: identification only
      }
      if (count > 50000) { truncated = true; break; }
    }
  } catch (_) {}
  if (cap < file.size) truncated = true;
  const out = {
    'Format': 'cpio archive (' + variant + ')',
    'Entries': variant === 'bin' ? 'n/a (binary variant)' : count.toLocaleString() + (truncated ? '+' : ''),
  };
  if (variant !== 'bin') out['Total size'] = fmtBytes(total) + (truncated ? '+' : '');
  if (items.length) out._sections = [fileListSection('Files (' + items.length + (truncated ? '+' : '') + ')', items, true)];
  return out;
}

// ---------- ar (.a) ----------
// Also the backbone of .deb. Returns parsed members + buffer.
async function parseArMembers(file, maxBytes = 16 * 1024 * 1024) {
  const b = await readBytes(file, maxBytes);
  if (ascii(b, 0, 8) !== '!<arch>\n') return null;
  const members = [];
  let pos = 8;
  while (pos + 60 <= b.length) {
    const name = ascii(b, pos, 16).trim();
    const mtime = ascii(b, pos + 16, 12).trim();
    const size = parseInt(ascii(b, pos + 48, 10).trim(), 10) || 0;
    if (ascii(b, pos + 58, 2) !== '`\n') break;
    const dataStart = pos + 60;
    members.push({ name: name.replace(/\/$/, ''), size, mtime: parseInt(mtime, 10) || 0, dataStart });
    pos = dataStart + size + (size % 2); // members are 2-byte aligned
  }
  return { members, buf: b };
}
async function parseAr(file) {
  const ar = await parseArMembers(file);
  if (!ar) return null;
  const items = ar.members.map((m) => ({
    name: m.name,
    size: m.size,
    extra: m.mtime ? new Date(m.mtime * 1000).toISOString().slice(0, 10) : '',
  }));
  const hasSymtab = ar.members.some((m) => m.name === '' || m.name === '/' || m.name === '__.SYMDEF');
  return {
    'Format': 'Unix ar archive / static library',
    'Members': ar.members.length,
    'Symbol table': hasSymtab ? 'present' : 'none',
    _sections: items.length ? [fileListSection('Members (' + items.length + ')', items, true)] : null,
  };
}

// ---------- deb (.deb) ----------
function parseControlFields(text) {
  const fields = {};
  let lastKey = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s/.test(line) && lastKey) { fields[lastKey] += '\n' + line.trim(); continue; }
    const m = line.match(/^([A-Za-z0-9-]+):\s?(.*)$/);
    if (m) { fields[m[1]] = m[2]; lastKey = m[1]; }
  }
  return fields;
}
async function parseDeb(file) {
  const ar = await parseArMembers(file);
  if (!ar) return null;
  const out = { 'Format': 'Debian package (.deb)' };
  const verMember = ar.members.find((m) => m.name === 'debian-binary');
  if (verMember) out['Package format'] = ascii(ar.buf, verMember.dataStart, verMember.size).trim();
  const ctrl = ar.members.find((m) => /^control\.tar/.test(m.name));
  if (ctrl) {
    out['Control archive'] = ctrl.name;
    try {
      let tarBytes = ar.buf.subarray(ctrl.dataStart, ctrl.dataStart + ctrl.size);
      if (/\.gz$/.test(ctrl.name)) tarBytes = await gunzip(tarBytes);
      else if (/\.xz$/.test(ctrl.name)) tarBytes = await xzDecompress(tarBytes); // lazy LZMA2 (null on failure)
      else if (/\.zst$/.test(ctrl.name)) tarBytes = null; // can't decode natively
      if (tarBytes) {
        const ctext = findTarMember(tarBytes, './control') || findTarMember(tarBytes, 'control');
        if (ctext) {
          const f = parseControlFields(utf8(ctext));
          for (const [k, label] of [
            ['Package', 'Package'], ['Version', 'Version'], ['Architecture', 'Architecture'],
            ['Maintainer', 'Maintainer'], ['Installed-Size', 'Installed size (KiB)'],
            ['Section', 'Section'], ['Priority', 'Priority'], ['Homepage', 'Homepage'],
          ]) { if (f[k]) out[label] = f[k]; }
          if (f['Depends']) out['Depends'] = f['Depends'];
          if (f['Description']) {
            out._sections = [{ title: 'Description', node: preBlock(f['Description']) }];
          }
        }
      } else if (/\.(xz|zst)$/.test(ctrl.name)) {
        out['Note'] = 'control.tar.' + ctrl.name.split('.').pop() + ' uses a codec not decodable in-browser';
      }
    } catch (_) {}
  }
  out['Members'] = ar.members.map((m) => m.name).join(', ');
  return out;
}
// Find a member's bytes inside an uncompressed tar buffer (used by deb/gem).
function findTarMember(tarBytes, wantName) {
  let pos = 0;
  while (pos + 512 <= tarBytes.length) {
    let allZero = true;
    for (let i = 0; i < 512; i++) if (tarBytes[pos + i] !== 0) { allZero = false; break; }
    if (allZero) break;
    const name = tarStr(tarBytes, pos, 100).replace(/^\.\//, '');
    const size = octal(tarBytes, pos + 124, 12);
    const dataStart = pos + 512;
    if (name === wantName.replace(/^\.\//, '')) return tarBytes.subarray(dataStart, dataStart + size);
    pos = dataStart + Math.ceil(size / 512) * 512;
  }
  return null;
}

// List members of an uncompressed tar buffer: returns { items, members, total }
// where items is [{name, size, extra}] (capped). Used by the .zst tar path.
function listTarMembers(tarBytes, cap = 2000) {
  const items = [];
  let pos = 0, members = 0, total = 0, longName = null;
  while (pos + 512 <= tarBytes.length) {
    let allZero = true;
    for (let i = 0; i < 512; i++) if (tarBytes[pos + i] !== 0) { allZero = false; break; }
    if (allZero) break;
    const name = tarStr(tarBytes, pos, 100);
    const size = octal(tarBytes, pos + 124, 12);
    const typeChar = String.fromCharCode(tarBytes[pos + 156] || 0x30);
    const prefix = ascii(tarBytes, pos + 257, 5) === 'ustar' ? tarStr(tarBytes, pos + 345, 155) : '';
    let full = prefix ? prefix + '/' + name : name;
    if (longName) { full = longName; longName = null; }
    const dataStart = pos + 512;
    if (typeChar === 'L') {
      longName = ascii(tarBytes, dataStart, size).replace(/\0+$/, '');
    } else if (!/[gx]/.test(typeChar)) {
      members++; total += size;
      if (items.length < cap && full) {
        items.push({ name: full + (typeChar === '5' ? '/' : ''), size, extra: (TAR_TYPES[typeChar] || ('type ' + typeChar)) });
      }
    }
    pos = dataStart + Math.ceil(size / 512) * 512;
    if (members > 200000) break;
  }
  return { items, members, total };
}

// ---------- rpm (.rpm) ----------
const RPM_TAGS = {
  1000: 'Name', 1001: 'Version', 1002: 'Release', 1004: 'Summary', 1005: 'Description',
  1007: 'BuildHost', 1009: 'Size', 1011: 'Vendor', 1014: 'License', 1015: 'Packager',
  1016: 'Group', 1020: 'URL', 1022: 'Arch', 1021: 'OS', 1006: 'BuildTime',
};
async function parseRpm(file) {
  const b = await readBytes(file, 65536);
  // Lead magic ED AB EE DB
  if (!(b[0] === 0xed && b[1] === 0xab && b[2] === 0xee && b[3] === 0xdb)) return null;
  const r = new Reader(b); // big-endian
  r.seek(4);
  const major = r.u8(), minor = r.u8();
  const type = r.u16(); // 0 = binary, 1 = source
  const arch = r.u16();
  const name = tarStr(b, 10, 66);
  const out = {
    'Format': 'RPM package',
    'RPM version': major + '.' + minor,
    'Type': type === 1 ? 'source (.src.rpm)' : 'binary',
    'Lead name': name,
  };
  // After 96-byte lead: signature header, then main header. Each header:
  // 8-byte magic (8E AD E8 01 00 00 00 00), u32 nindex, u32 hsize.
  function readHeader(off) {
    if (!(b[off] === 0x8e && b[off + 1] === 0xad && b[off + 2] === 0xe8)) return null;
    const hr = new Reader(b); hr.seek(off + 8);
    const nIndex = hr.u32();
    const dataSize = hr.u32();
    const indexStart = off + 16;
    const dataStart = indexStart + nIndex * 16;
    return { nIndex, dataSize, indexStart, dataStart, end: dataStart + dataSize };
  }
  let off = 96;
  const sig = readHeader(off);
  if (sig) {
    // signature header padded to 8-byte boundary
    off = sig.end;
    off = (off + 7) & ~7;
  }
  const hdr = readHeader(off);
  if (hdr) {
    const fields = {};
    const hr = new Reader(b);
    for (let i = 0; i < hdr.nIndex && i < 2000; i++) {
      const e = hdr.indexStart + i * 16;
      if (e + 16 > b.length) break;
      hr.seek(e);
      const tag = hr.u32();
      const dtype = hr.u32();
      const offset = hr.u32();
      const count = hr.u32();
      if (!RPM_TAGS[tag]) continue;
      const dpos = hdr.dataStart + offset;
      if (dpos >= b.length) continue;
      if (dtype === 6 || dtype === 8 || dtype === 9) { // string / string-array / i18n
        fields[RPM_TAGS[tag]] = tarStr(b, dpos, 4096);
      } else if (dtype === 4) { // int32
        fields[RPM_TAGS[tag]] = b.length >= dpos + 4 ? ((b[dpos] << 24) | (b[dpos + 1] << 16) | (b[dpos + 2] << 8) | b[dpos + 3]) >>> 0 : null;
      }
    }
    for (const [k, label] of [
      ['Name', 'Name'], ['Version', 'Version'], ['Release', 'Release'], ['Arch', 'Arch'],
      ['License', 'License'], ['Vendor', 'Vendor'], ['Group', 'Group'], ['URL', 'URL'],
      ['Summary', 'Summary'], ['Size', 'Install size'], ['BuildHost', 'Build host'],
    ]) { if (fields[k] != null) out[label] = k === 'Size' ? fmtBytes(fields[k]) : fields[k]; }
    if (fields['BuildTime']) out['Build time'] = fmtDate(new Date(fields['BuildTime'] * 1000));
    if (fields['Description']) out._sections = [{ title: 'Description', node: preBlock(String(fields['Description'])) }];
  }
  return out;
}

// ---------- gem (.gem) ----------
async function parseGem(file) {
  const cap = Math.min(file.size, 4 * 1024 * 1024);
  const b = await readBytes(file, cap);
  // A .gem is itself an (uncompressed) tar containing metadata.gz + data.tar.gz.
  if (ascii(b, 257, 5) !== 'ustar' && octal(b, 124, 12) <= 0) return null;
  const out = { 'Format': 'RubyGems package (.gem)' };
  const metaGz = findTarMember(b, 'metadata.gz');
  if (metaGz) {
    try {
      const yaml = utf8(await gunzip(metaGz) || new Uint8Array());
      const pick = (k) => { const m = yaml.match(new RegExp('^' + k + ':\\s*(.+)$', 'm')); return m ? m[1].trim() : null; };
      if (pick('name')) out['Name'] = pick('name');
      const ver = yaml.match(/version:\s*!ruby\/object[^\n]*\n\s*version:\s*(.+)/);
      if (ver) out['Version'] = ver[1].trim();
      if (pick('summary')) out['Summary'] = pick('summary');
      if (pick('homepage')) out['Homepage'] = pick('homepage');
      const licenses = (yaml.match(/^licenses:\n((?:\s*-\s*.+\n?)+)/m) || [])[1];
      if (licenses) out['Licenses'] = licenses.replace(/\s*-\s*/g, '').trim().split(/\s+/).join(', ');
      const authors = (yaml.match(/^authors:\n((?:\s*-\s*.+\n?)+)/m) || [])[1];
      if (authors) out['Authors'] = authors.replace(/\s*-\s*/g, '').trim().split(/\n/).map((s) => s.trim()).join(', ');
      out._sections = [{ title: 'metadata.yaml', node: preBlock(yaml.length > 16000 ? yaml.slice(0, 16000) + '\n…' : yaml) }];
    } catch (_) {}
  } else {
    out['Note'] = 'Could not locate metadata.gz member';
  }
  return out;
}

// ---------- cab (.cab) ----------
async function parseCab(file) {
  const b = await readBytes(file, 65536);
  if (ascii(b, 0, 4) !== 'MSCF') return null;
  const r = new Reader(b, true); // little-endian
  r.seek(8);
  const cbCabinet = r.u32();      // total size
  r.skip(4);
  const coffFiles = r.u32();      // offset of first CFFILE
  r.skip(4);
  const verMinor = r.u8(), verMajor = r.u8();
  const cFolders = r.u16();
  const cFiles = r.u16();
  const flags = r.u16();
  const setID = r.u16();
  const iCabinet = r.u16();
  const out = {
    'Format': 'Microsoft Cabinet (.cab)',
    'Version': verMajor + '.' + verMinor,
    'Folders': cFolders,
    'Files': cFiles,
    'Cabinet size': fmtBytes(cbCabinet),
    'Set ID': setID,
    'Cabinet index': iCabinet,
  };
  if (flags & 0x0001) out['Prev cabinet'] = 'this is a continuation (multi-part set)';
  if (flags & 0x0002) out['Next cabinet'] = 'continues in another file';
  // Walk CFFILE entries for names (each is 16 bytes + null-terminated name).
  try {
    let pos = coffFiles;
    const items = [];
    for (let i = 0; i < cFiles && pos + 16 < b.length && items.length < 1000; i++) {
      const fr = new Reader(b, true); fr.seek(pos);
      const cbFile = fr.u32();
      fr.skip(4); // uoffFolderStart
      fr.skip(2); // iFolder
      const date = fr.u16();
      const time = fr.u16();
      const attribs = fr.u16();
      let name = ''; let np = fr.tell();
      while (np < b.length && b[np] !== 0) name += String.fromCharCode(b[np++]);
      np++;
      const day = date & 0x1f, mon = (date >> 5) & 0x0f, yr = ((date >> 9) & 0x7f) + 1980;
      items.push({ name, size: cbFile, extra: yr + '-' + String(mon).padStart(2, '0') + '-' + String(day).padStart(2, '0') });
      pos = np;
    }
    if (items.length) out._sections = [fileListSection('Files (' + items.length + ')', items, true)];
  } catch (_) {}
  return out;
}

// ---------- ZIP-based packages (openZip) ----------

async function zipText(zip, name) { try { return await zip.text(name); } catch (_) { return null; } }
function jsonTry(s) { try { return JSON.parse(s); } catch (_) { return null; } }
function depList(out, obj, key, label) {
  if (obj && obj[key] && typeof obj[key] === 'object') {
    const keys = Object.keys(obj[key]);
    if (keys.length) out[label] = keys.length + ': ' + keys.slice(0, 25).join(', ');
  }
}

// .whl (Python wheel)
async function parseWhl(file) {
  let zip; try { zip = await openZip(file); } catch (_) { return null; }
  const metaEntry = zip.entries.find((e) => /\.dist-info\/METADATA$/.test(e.name));
  const out = { 'Format': 'Python wheel (.whl)' };
  if (metaEntry) {
    const text = await zipText(zip, metaEntry.name);
    if (text) {
      const f = parseControlFields(text);
      if (f['Name']) out['Name'] = f['Name'];
      if (f['Version']) out['Version'] = f['Version'];
      if (f['License']) out['License'] = f['License'];
      if (f['Summary']) out['Summary'] = f['Summary'];
      if (f['Author'] || f['Author-email']) out['Author'] = f['Author'] || f['Author-email'];
      if (f['Requires-Python']) out['Requires Python'] = f['Requires-Python'];
      const reqs = text.split(/\r?\n/).filter((l) => /^Requires-Dist:/.test(l)).map((l) => l.replace(/^Requires-Dist:\s*/, ''));
      if (reqs.length) {
        out['Dependencies'] = reqs.length;
        out._sections = [{ title: 'Requires-Dist (' + reqs.length + ')', node: preBlock(reqs.join('\n')) }];
      }
    }
  }
  const wheelEntry = zip.entries.find((e) => /\.dist-info\/WHEEL$/.test(e.name));
  if (wheelEntry) { const w = parseControlFields(await zipText(zip, wheelEntry.name) || ''); if (w['Tag']) out['Build tag'] = w['Tag']; }
  return Object.keys(out).length > 1 ? out : null;
}

// .nupkg (NuGet)
async function parseNupkg(file) {
  let zip; try { zip = await openZip(file); } catch (_) { return null; }
  const nuspec = zip.entries.find((e) => /\.nuspec$/i.test(e.name) && !e.name.includes('/'));
  const out = { 'Format': 'NuGet package (.nupkg)' };
  if (nuspec) {
    const xml = await zipText(zip, nuspec.name);
    if (xml) {
      const pick = (t) => { const m = xml.match(new RegExp('<' + t + '>([^<]*)</' + t + '>', 'i')); return m ? m[1].trim() : null; };
      if (pick('id')) out['ID'] = pick('id');
      if (pick('version')) out['Version'] = pick('version');
      if (pick('authors')) out['Authors'] = pick('authors');
      if (pick('license')) out['License'] = pick('license');
      if (pick('projectUrl')) out['Project URL'] = pick('projectUrl');
      if (pick('description')) out['Description'] = pick('description');
      const deps = Array.from(xml.matchAll(/<dependency\s+id="([^"]+)"(?:\s+version="([^"]+)")?/gi)).map((m) => m[1] + (m[2] ? ' ' + m[2] : ''));
      if (deps.length) {
        out['Dependencies'] = deps.length;
        out._sections = [{ title: 'Dependencies (' + deps.length + ')', node: preBlock(Array.from(new Set(deps)).join('\n')) }];
      }
    }
  }
  return Object.keys(out).length > 1 ? out : null;
}

// .crx (Chrome extension) - Cr24 header then inner ZIP.
async function parseCrx(file) {
  const head = await readBytes(file, 16);
  if (ascii(head, 0, 4) !== 'Cr24') return null;
  const r = new Reader(head, true); r.seek(4);
  const version = r.u32();
  let zipOffset;
  if (version === 2) {
    const pubKeyLen = r.u32();
    const sigLen = r.u32();
    zipOffset = 16 + pubKeyLen + sigLen;
  } else { // version 3
    const headerLen = r.u32();
    zipOffset = 12 + headerLen;
  }
  const out = { 'Format': 'Chrome extension (.crx)', 'CRX version': version };
  try {
    const innerBlob = file.slice(zipOffset);
    const zip = await openZip(new File([innerBlob], 'inner.zip'));
    const mtext = await zipText(zip, 'manifest.json');
    const m = mtext && jsonTry(mtext);
    if (m) {
      if (m.name) out['Name'] = m.name;
      if (m.version) out['Version'] = m.version;
      if (m.manifest_version) out['Manifest version'] = m.manifest_version;
      if (m.description) out['Description'] = m.description;
      const perms = [].concat(m.permissions || [], m.host_permissions || []);
      if (perms.length) {
        out['Permissions'] = perms.length;
        out._sections = [{ title: 'Permissions', node: preBlock(perms.join('\n')) }];
      }
    }
  } catch (_) {}
  return out;
}

// .xpi (Firefox add-on)
async function parseXpi(file) {
  let zip; try { zip = await openZip(file); } catch (_) { return null; }
  const out = { 'Format': 'Firefox add-on (.xpi)' };
  const mtext = await zipText(zip, 'manifest.json');
  const m = mtext && jsonTry(mtext);
  if (m) {
    if (m.name) out['Name'] = m.name;
    if (m.version) out['Version'] = m.version;
    if (m.description) out['Description'] = m.description;
    const gecko = m.browser_specific_settings?.gecko || m.applications?.gecko;
    if (gecko?.id) out['Gecko ID'] = gecko.id;
    if (gecko?.strict_min_version) out['Min Firefox'] = gecko.strict_min_version;
    const perms = [].concat(m.permissions || []);
    if (perms.length) { out['Permissions'] = perms.length; out._sections = [{ title: 'Permissions', node: preBlock(perms.join('\n')) }]; }
  } else if (zip.has('install.rdf')) {
    out['Manifest'] = 'legacy install.rdf';
    const rdf = await zipText(zip, 'install.rdf');
    const id = rdf && (rdf.match(/<em:id>([^<]+)<\/em:id>/) || [])[1];
    if (id) out['Add-on ID'] = id;
  }
  return out;
}

// .vsix (VS / VS Code extension)
async function parseVsix(file) {
  let zip; try { zip = await openZip(file); } catch (_) { return null; }
  const manEntry = zip.entries.find((e) => /vsixmanifest$/i.test(e.name)) || zip.entries.find((e) => /extension\.vsixmanifest$/i.test(e.name));
  const out = { 'Format': 'VS / VS Code extension (.vsix)' };
  if (manEntry) {
    const xml = await zipText(zip, manEntry.name);
    if (xml) {
      const attr = (re) => { const m = xml.match(re); return m ? m[1] : null; };
      out['ID'] = attr(/<Identity[^>]*\bId="([^"]+)"/i) || '-';
      out['Version'] = attr(/<Identity[^>]*\bVersion="([^"]+)"/i) || '-';
      out['Publisher'] = attr(/<Identity[^>]*\bPublisher="([^"]+)"/i) || '-';
      out['Display name'] = (xml.match(/<DisplayName>([^<]*)<\/DisplayName>/i) || [])[1] || '-';
      const desc = (xml.match(/<Description[^>]*>([^<]*)<\/Description>/i) || [])[1];
      if (desc) out['Description'] = desc.trim();
    }
  }
  // VS Code extensions also carry extension/package.json
  const pkgEntry = zip.entries.find((e) => /extension\/package\.json$/i.test(e.name));
  if (pkgEntry) {
    const p = jsonTry(await zipText(zip, pkgEntry.name) || '');
    if (p) {
      if (p.engines?.vscode) out['VS Code engine'] = p.engines.vscode;
      if (Array.isArray(p.activationEvents)) out['Activation events'] = p.activationEvents.length;
      if (p.contributes?.commands) out['Commands'] = p.contributes.commands.length;
    }
  }
  return Object.keys(out).length > 1 ? out : null;
}

// .asar (Electron) - pickle header -> JSON file tree.
function walkAsarTree(node, prefix, out, sizeRef) {
  if (!node || !node.files) return;
  for (const [name, info] of Object.entries(node.files)) {
    const path = prefix + name;
    if (info.files) walkAsarTree(info, path + '/', out, sizeRef);
    else {
      const size = info.size || 0; sizeRef.total += size; sizeRef.count++;
      if (out.length < 1000) out.push({ name: path + (info.executable ? '  [exec]' : ''), size });
    }
  }
}
async function parseAsar(file) {
  const head = await readBytes(file, 16);
  const r = new Reader(head, true);
  // Pickle: u32 headerSize wrapper. Layout: [u32=4][u32 jsonStrSize][u32 jsonDataSize][u32 actualLen][json...]
  const p1 = r.u32(); // should be 4
  if (p1 !== 4) return null;
  const headerObjSize = r.u32();
  r.skip(4); // json string size (padded)
  const jsonLen = r.u32();
  if (jsonLen <= 0 || jsonLen > 64 * 1024 * 1024) return null;
  let json;
  try {
    const jb = await readRange(file, 16, 16 + jsonLen);
    json = JSON.parse(utf8(jb));
  } catch (_) { return null; }
  if (!json || !json.files) return null;
  const items = []; const ref = { total: 0, count: 0 };
  walkAsarTree(json, '', items, ref);
  const out = {
    'Format': 'Electron ASAR archive',
    'Files': ref.count.toLocaleString() + (items.length >= 1000 ? '+' : ''),
    'Total size': fmtBytes(ref.total),
  };
  // package.json if present at root
  if (json.files && json.files['package.json']) {
    const info = json.files['package.json'];
    if (info.offset != null && info.size) {
      try {
        const baseOff = 16 + jsonLen + (8 - (jsonLen % 8)) % 8;
        const pj = jsonTry(utf8(await readRange(file, baseOff + Number(info.offset), baseOff + Number(info.offset) + info.size)));
        if (pj) { if (pj.name) out['App name'] = pj.name; if (pj.version) out['App version'] = pj.version; }
      } catch (_) {}
    }
  }
  if (items.length) out._sections = [fileListSection('Files (' + items.length + ')', items, true)];
  return out;
}

// .appx / .msix (Windows App Package)
async function parseAppx(file) {
  let zip; try { zip = await openZip(file); } catch (_) { return null; }
  const out = { 'Format': 'Windows App Package (.appx / .msix)' };
  const xml = await zipText(zip, 'AppxManifest.xml');
  if (xml) {
    const attr = (re) => { const m = xml.match(re); return m ? m[1] : null; };
    out['Name'] = attr(/<Identity[^>]*\bName="([^"]+)"/i) || '-';
    out['Version'] = attr(/<Identity[^>]*\bVersion="([^"]+)"/i) || '-';
    out['Publisher'] = attr(/<Identity[^>]*\bPublisher="([^"]+)"/i) || '-';
    out['Architecture'] = attr(/<Identity[^>]*\bProcessorArchitecture="([^"]+)"/i) || '-';
    out['Display name'] = (xml.match(/<DisplayName>([^<]*)<\/DisplayName>/i) || [])[1] || '-';
    const caps = Array.from(xml.matchAll(/<(?:rescap:|uap:)?Capability[^>]*\bName="([^"]+)"/gi)).map((m) => m[1]);
    if (caps.length) {
      out['Capabilities'] = caps.length;
      out._sections = [{ title: 'Capabilities', node: preBlock(Array.from(new Set(caps)).join('\n')) }];
    }
  }
  if (zip.has('AppxBundleManifest.xml') || zip.entries.some((e) => /AppxBundleManifest/i.test(e.name))) out['Bundle'] = 'yes (.appxbundle / .msixbundle)';
  return Object.keys(out).length > 1 ? out : null;
}

// .apkg (Anki deck)
async function parseApkg(file) {
  let zip; try { zip = await openZip(file); } catch (_) { return null; }
  const out = { 'Format': 'Anki deck package (.apkg)' };
  const hasNewDb = zip.has('collection.anki21') || zip.entries.some((e) => /collection\.anki2/.test(e.name));
  out['Collection DB'] = hasNewDb ? (zip.has('collection.anki21') ? 'collection.anki21 (newer)' : 'collection.anki2') : 'not found';
  const mediaText = await zipText(zip, 'media');
  if (mediaText) {
    const m = jsonTry(mediaText);
    if (m) out['Media files'] = Object.keys(m).length;
  }
  const mediaFiles = zip.entries.filter((e) => /^\d+$/.test(e.name)).length;
  if (mediaFiles && !out['Media files']) out['Media files'] = mediaFiles;
  return out;
}

// .conda (zip wrapping zstd-compressed tarballs)
async function parseConda(file) {
  let zip; try { zip = await openZip(file); } catch (_) { return null; }
  const out = { 'Format': 'Conda package (.conda)' };
  const inner = zip.names().filter((n) => /\.tar\.zst$/.test(n));
  out['Inner archives'] = inner.join(', ') || '-';
  const meta = await zipText(zip, 'metadata.json');
  if (meta) { const m = jsonTry(meta); if (m && m.conda_pkg_format_version) out['Format version'] = m.conda_pkg_format_version; }

  // Decompress the info-*.tar.zst member to read info/index.json (name/version/
  // build/depends). Wrapped so a failure just leaves the header-only summary.
  try {
    const infoName = inner.find((n) => /(^|\/)info[-.].*\.tar\.zst$/.test(n)) || inner.find((n) => /info/.test(n));
    if (infoName) {
      const zstBytes = await zip.bytes(infoName);
      if (zstBytes && zstBytes.length) {
        const tarBytes = await zstdDecompress(zstBytes);
        if (tarBytes && tarBytes.length) {
          const idxBytes = findTarMember(tarBytes, 'info/index.json') || findTarMember(tarBytes, './info/index.json');
          if (idxBytes) {
            const idx = jsonTry(utf8(idxBytes));
            if (idx) {
              if (idx.name) out['Package'] = idx.name;
              if (idx.version) out['Version'] = idx.version;
              if (idx.build) out['Build'] = idx.build;
              if (idx.subdir || idx.platform) out['Platform'] = idx.subdir || idx.platform;
              if (Array.isArray(idx.depends) && idx.depends.length) {
                out['Dependencies'] = idx.depends.length;
                out._sections = [{ title: 'Dependencies (' + idx.depends.length + ')', node: preBlock(idx.depends.join('\n')) }];
              }
            }
          }
        }
      }
    }
  } catch (_) { /* keep header-only summary */ }

  if (!out['Package']) out['Note'] = 'info/index.json lives inside a .tar.zst member; could not be decompressed.';
  return out;
}

// ---------- identification-only (rare AND hard) ----------
function ident(name, note) { return () => ({ 'Format': name, 'Note': note }); }

// ---------- dispatch ----------
export const PARSERS = {
  tar: (c) => parseTar(c.file),
  gz: (c) => parseGzip(c.file, c.ext),
  tgz: (c) => parseGzip(c.file, c.ext),
  bz2: (c) => parseBzip2(c.head),
  xz: (c) => parseXz(c.head, c.file, c.ext),
  txz: (c) => parseXz(c.head, c.file, c.ext),
  zst: (c) => parseZstd(c.head, c.file, c.ext),
  tzst: (c) => parseZstd(c.head, c.file, c.ext),
  lz4: (c) => parseLz4(c.head),
  lzma: (c) => parseLzma(c.head),
  z: (c) => parseCompress(c.head),
  cpio: (c) => parseCpio(c.file),
  a: (c) => parseAr(c.file),
  whl: (c) => parseWhl(c.file),
  nupkg: (c) => parseNupkg(c.file),
  crx: (c) => parseCrx(c.file),
  xpi: (c) => parseXpi(c.file),
  vsix: (c) => parseVsix(c.file),
  asar: (c) => parseAsar(c.file),
  appx: (c) => parseAppx(c.file),
  msix: (c) => parseAppx(c.file),
  apkg: (c) => parseApkg(c.file),
  conda: (c) => parseConda(c.file),
  deb: (c) => parseDeb(c.file),
  rpm: (c) => parseRpm(c.file),
  gem: (c) => parseGem(c.file),
  cab: (c) => parseCab(c.file),
  // identification-only: rare AND hard formats with no native decoder
  ace: ident('ACE archive', 'WinAce proprietary; header-only identification (no in-browser decoder).'),
  arj: ident('ARJ archive', 'Robert K. Jung ARJ; identification only.'),
  lzh: ident('LHA / LZH archive', 'LHarc/LHA; identification only.'),
  lha: ident('LHA / LZH archive', 'LHarc/LHA; identification only.'),
  zoo: ident('Zoo archive', 'Rahul Dhesi Zoo; identification only.'),
  arc: ident('ARC archive', 'SEA/PKWARE ARC; identification only.'),
};
