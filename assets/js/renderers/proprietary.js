/* Analyser - proprietary file format identification
   Identifies Adobe, CAD, 3D, and other proprietary formats by extension
   and magic bytes. Extracts whatever metadata is accessible without
   full format parsers. */

import { el, row, rowHelp, fmtBytes, sha256Row, preBlock } from '../core/util.js';
import { findBytes, utf16, utf8 } from '../core/binutil.js';
import { openZip } from './zip.js';
import { FORMATS } from './proprietary-formats.js';
import { parseNrbf } from '../lib/nrbf.js';

// ---------- helpers ----------
function extFromName(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/^\./, '') : '';
}

function ascii(buf, start, len) {
  let s = '';
  for (let i = start; i < start + len && i < buf.length; i++) {
    const c = buf[i];
    if (c >= 32 && c < 127) s += String.fromCharCode(c);
  }
  return s;
}

// ---------- PSD header ----------
function parsePsd(buf) {
  if (buf.length < 30) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const sig = ascii(buf, 0, 4);
  if (sig !== '8BPS') return null;
  const version = view.getUint16(4);
  const channels = view.getUint16(12);
  const height = view.getUint32(14);
  const width = view.getUint32(18);
  const depth = view.getUint16(22);
  const modeMap = { 0: 'Bitmap', 1: 'Grayscale', 2: 'Indexed', 3: 'RGB', 4: 'CMYK', 7: 'Multichannel', 8: 'Duotone', 9: 'Lab' };
  const mode = modeMap[view.getUint16(24)] || 'Unknown';
  return {
    'Version': version === 2 ? 'PSB (Large Document)' : 'PSD',
    'Dimensions': width + ' × ' + height,
    'Channels': channels,
    'Bit depth': depth + ' bits/channel',
    'Color mode': mode
  };
}

// ---------- DWG version ----------
function parseDwg(buf) {
  const ver = ascii(buf, 0, 6);
  const versions = {
    'AC1032': '2018–2024', 'AC1027': '2013–2017', 'AC1024': '2010–2012',
    'AC1021': '2007–2009', 'AC1018': '2004–2006', 'AC1015': '2000–2003',
    'AC1014': 'R14', 'AC1012': 'R13', 'AC1009': 'R11/R12'
  };
  const mapped = versions[ver];
  if (!mapped) return null;
  return { 'DWG version': ver, 'AutoCAD version': mapped };
}

// ---------- Blender header ----------
function parseBlender(buf) {
  const sig = ascii(buf, 0, 7);
  if (sig !== 'BLENDER') return null;
  const ptrSize = buf[7] === 0x5F ? '32-bit' : '64-bit';
  const endian = buf[8] === 0x56 ? 'Little-endian' : 'Big-endian';
  const version = ascii(buf, 9, 3);
  const major = version[0];
  const minor = version.slice(1);
  return {
    'Blender version': major + '.' + minor,
    'Pointer size': ptrSize,
    'Endianness': endian
  };
}

// ---------- FBX ----------
function parseFbx(buf) {
  const sig = ascii(buf, 0, 20);
  if (!sig.startsWith('Kaydara FBX Binary')) return null;
  if (buf.length < 27) return { 'Format': 'FBX Binary' };
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const version = view.getUint32(23, true);
  return {
    'Format': 'FBX Binary',
    'FBX version': (version / 1000).toFixed(1)
  };
}

// ---------- glTF / GLB ----------
function parseGlb(buf) {
  if (buf.length < 12) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const magic = view.getUint32(0, true);
  if (magic !== 0x46546C67) return null;
  const version = view.getUint32(4, true);
  const totalLen = view.getUint32(8, true);
  return {
    'Format': 'glTF Binary (GLB)',
    'glTF version': version + '.0',
    'Total size': fmtBytes(totalLen)
  };
}

// ---------- STL ----------
function parseStl(buf) {
  const head = ascii(buf, 0, 5);
  if (head === 'solid') {
    const headerLine = ascii(buf, 0, Math.min(80, buf.length)).trim();
    const name = headerLine.slice(5).trim();
    return { 'Format': 'STL ASCII', 'Name': name || '(unnamed)' };
  }
  if (buf.length >= 84) {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const triangles = view.getUint32(80, true);
    return { 'Format': 'STL Binary', 'Triangles': triangles.toLocaleString() };
  }
  return null;
}

// ---------- SWF ----------
function parseSwf(buf) {
  if (buf.length < 8) return null;
  const sig = String.fromCharCode(buf[0]) + 'WS';
  if (buf[1] !== 0x57 || buf[2] !== 0x53) return null;
  const compressed = buf[0] === 0x43 ? 'zlib' : buf[0] === 0x5A ? 'LZMA' : 'none';
  const version = buf[3];
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const fileLen = view.getUint32(4, true);
  return {
    'SWF version': version,
    'Compression': compressed,
    'Uncompressed size': fmtBytes(fileLen)
  };
}

// ---------- XMP sidecar (XML) ----------
async function parseXmp(file) {
  try {
    const text = await file.text();
    const fields = {};
    const tags = [
      ['xmp:CreatorTool', 'Creator tool'],
      ['xmp:CreateDate', 'Created'],
      ['xmp:ModifyDate', 'Modified'],
      ['xmp:MetadataDate', 'Metadata date'],
      ['dc:creator', 'Author'],
      ['dc:title', 'Title'],
      ['dc:description', 'Description'],
      ['dc:subject', 'Keywords'],
      ['photoshop:ColorMode', 'Color mode'],
      ['photoshop:ICCProfile', 'ICC profile'],
      ['tiff:Make', 'Camera make'],
      ['tiff:Model', 'Camera model'],
      ['exif:ExposureTime', 'Exposure'],
      ['exif:FNumber', 'Aperture'],
      ['exif:ISOSpeedRatings', 'ISO'],
      ['crs:Version', 'Camera Raw version'],
      ['crs:ProcessVersion', 'Process version'],
      ['crs:WhiteBalance', 'White balance'],
    ];
    for (const [tag, label] of tags) {
      const re = new RegExp('<' + tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^>]*>([^<]+)</', 'i');
      const m = text.match(re);
      if (m) fields[label] = m[1].trim();
    }
    // Also try rdf:li for lists
    for (const [tag, label] of tags) {
      if (fields[label]) continue;
      const blockRe = new RegExp('<' + tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?<\\/[^>]+>', 'i');
      const block = text.match(blockRe);
      if (block) {
        const items = [...block[0].matchAll(/<rdf:li[^>]*>([^<]+)<\/rdf:li>/gi)].map(m => m[1].trim());
        if (items.length) fields[label] = items.join(', ');
      }
    }
    return { fields, raw: text };
  } catch (_) {
    return null;
  }
}

// ---------- PE / EXE ----------

// Per-field explanations for the PE/EXE readout. Attached to the parse result as
// `_help` so the generic renderer shows them as tooltips (scoped to PE results, so
// e.g. a STEP file's own "Description" field isn't given the PE meaning).
const PE_HELP = {
  'Format': 'The Portable Executable format and bitness of this file: PE32 = 32-bit, PE32+ = 64-bit. This describes the executable itself.',
  'Architecture': 'The CPU the executable’s own machine code targets (x86 = 32-bit, x64 = 64-bit, ARM64). Note: software installers (NSIS, Inno Setup, …) are usually 32-bit stubs even when the program they install is 64-bit - so a file named "win64" can correctly read as 32-bit here.',
  'Sections': 'Number of PE sections - contiguous regions such as code (.text), data (.data) and resources (.rsrc) the loader maps into memory.',
  'Compile date': 'The timestamp the linker wrote into the PE header at build time. It can be zeroed or forged, so treat it as a hint.',
  'Characteristics': 'COFF header flags describing the image: whether it’s an EXE or DLL, large-address-aware, relocations stripped, and so on.',
  'Section names': 'The names of the PE sections. Unusual names hint at the toolchain or a packer (e.g. UPX0/UPX1 = UPX-packed; .ndata = NSIS installer).',
  'Linker version': 'Version of the linker that produced the file - often maps to the Visual Studio / toolchain version used.',
  'Subsystem': 'The environment the executable expects: Windows GUI, Console, native driver, EFI application, etc.',
  'Subsystem version': 'Minimum OS subsystem version required to load and run the image.',
  'Image size': 'Total size the image occupies in memory once loaded - not the file size on disk.',
  'Security mitigations': 'Exploit-mitigation flags compiled into the binary: ASLR, DEP/NX, Control Flow Guard, Force-Integrity, No-SEH, and similar.',
  'Entry point': 'The relative virtual address where execution begins after the loader maps the image.',
  '.NET': 'The file carries a .NET CLR header - it’s a managed (.NET) assembly rather than pure native code.',
  'Imported DLLs': 'How many external DLLs the executable links against, counted from its import table.',
  'File version': 'The file’s version number from its VS_VERSIONINFO resource (FILEVERSION).',
  'Product version': 'The version of the product this file belongs to, from VS_VERSIONINFO (PRODUCTVERSION).',
  'Product name': 'The product name declared in the file’s version resource.',
  'Description': 'The file description from the version resource - what the vendor calls this binary.',
  'Company': 'The publisher / company name from the version resource.',
  'Copyright': 'The legal copyright string from the version resource.',
  'Original filename': 'The name the file was built as, from the version resource - useful when a file has since been renamed.',
  'Internal name': 'The internal module name from the version resource.',
  'Installer': 'The installer framework that produced this executable. Installer stubs are typically 32-bit even when they deploy 64-bit software.'
};

function parsePe(buf) {
  if (buf.length < 64 || buf[0] !== 0x4D || buf[1] !== 0x5A) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const peOffset = view.getUint32(0x3C, true);
  if (peOffset + 6 > buf.length) return { 'Format': 'MS-DOS / PE' };
  if (buf[peOffset] !== 0x50 || buf[peOffset + 1] !== 0x45) return { 'Format': 'MS-DOS executable' };
  const machine = view.getUint16(peOffset + 4, true);
  const machines = { 0x14C: 'x86 (32-bit)', 0x8664: 'x64 (64-bit)', 0xAA64: 'ARM64' };
  const arch = machines[machine] || '0x' + machine.toString(16);
  const numSections = view.getUint16(peOffset + 6, true);
  const timestamp = view.getUint32(peOffset + 8, true);
  const date = timestamp ? new Date(timestamp * 1000).toISOString().slice(0, 19).replace('T', ' ') : 'N/A';
  const optMagic = peOffset + 24 < buf.length ? view.getUint16(peOffset + 24, true) : 0;
  const is64 = optMagic === 0x20B;
  const peType = is64 ? 'PE32+ (64-bit)' : optMagic === 0x10B ? 'PE32 (32-bit)' : 'PE';
  const result = {
    'Format': peType,
    'Architecture': arch,
    'Sections': numSections,
    'Compile date': date,
    _help: PE_HELP
  };

  // COFF characteristics (peOffset + 22)
  const characteristics = view.getUint16(peOffset + 22, true);
  const chFlags = [];
  if (characteristics & 0x2000) chFlags.push('DLL');
  else if (characteristics & 0x0002) chFlags.push('Executable');
  if (characteristics & 0x0020) chFlags.push('Large-address-aware');
  if (characteristics & 0x0001) chFlags.push('Relocs-stripped');
  if (characteristics & 0x0100) chFlags.push('32-bit-machine');
  if (chFlags.length) result['Characteristics'] = chFlags.join(', ');

  // Section names (table starts after the optional header)
  const sizeOfOptHdr = view.getUint16(peOffset + 20, true);
  const secTableOff = peOffset + 24 + sizeOfOptHdr;
  const secNames = [];
  for (let s = 0; s < numSections && secTableOff + s * 40 + 8 <= buf.length; s++) {
    let nm = '';
    for (let b = 0; b < 8; b++) {
      const ch = buf[secTableOff + s * 40 + b];
      if (!ch) break;
      if (ch >= 32 && ch < 127) nm += String.fromCharCode(ch);
    }
    if (nm) secNames.push(nm);
  }
  if (secNames.length) result['Section names'] = secNames.join(', ');

  // Installer-stub detection. Explains the common "win64 installer reads as
  // 32-bit" surprise: NSIS / Inno stubs are 32-bit even when the bundled
  // software is 64-bit. Section names are the most reliable signal; otherwise
  // scan the head for the framework's ASCII marker.
  let installer = null;
  if (secNames.includes('.ndata')) installer = 'NSIS (Nullsoft Scriptable Install System)';
  else if (secNames.includes('.wixburn')) installer = 'WiX Burn bundle';
  else {
    try {
      const txt = new TextDecoder('latin1').decode(buf.subarray(0, Math.min(buf.length, 65536)));
      if (/Inno Setup/.test(txt)) installer = 'Inno Setup';
      else if (/InstallShield/.test(txt)) installer = 'InstallShield';
      else if (/Nullsoft|\bNSIS\b/.test(txt)) installer = 'NSIS (Nullsoft Scriptable Install System)';
    } catch (_) {}
  }
  if (installer) result['Installer'] = installer;

  const optBase = peOffset + 24;
  if (optBase + 2 > buf.length) return result;
  try {
    // Linker version (optBase + 2 / + 3)
    if (optBase + 4 <= buf.length) {
      result['Linker version'] = buf[optBase + 2] + '.' + buf[optBase + 3];
    }
    const subsysOff = optBase + 68;
    if (subsysOff + 2 <= buf.length) {
      const ss = view.getUint16(subsysOff, true);
      const subsystems = { 1: 'Native', 2: 'Windows GUI', 3: 'Windows Console', 5: 'OS/2 Console', 7: 'POSIX Console', 9: 'Windows CE GUI', 10: 'EFI Application', 14: 'Xbox' };
      result['Subsystem'] = subsystems[ss] || 'Unknown (' + ss + ')';
    }
    // Subsystem version (optBase + 48 major / + 50 minor)
    if (optBase + 52 <= buf.length) {
      const maj = view.getUint16(optBase + 48, true);
      const min = view.getUint16(optBase + 50, true);
      if (maj || min) result['Subsystem version'] = maj + '.' + min;
    }
    // Image size (optBase + 56)
    if (optBase + 60 <= buf.length) {
      const imgSize = view.getUint32(optBase + 56, true);
      if (imgSize) result['Image size'] = fmtBytes(imgSize);
    }
    // DllCharacteristics (optBase + 70) - security mitigations
    if (optBase + 72 <= buf.length) {
      const dc = view.getUint16(optBase + 70, true);
      const sec = [];
      if (dc & 0x0020) sec.push('High-entropy ASLR');
      if (dc & 0x0040) sec.push('ASLR');
      if (dc & 0x0080) sec.push('Force-integrity');
      if (dc & 0x0100) sec.push('DEP/NX');
      if (dc & 0x0400) sec.push('No-SEH');
      if (dc & 0x4000) sec.push('Control-Flow-Guard');
      if (dc & 0x8000) sec.push('Terminal-server-aware');
      if (sec.length) result['Security mitigations'] = sec.join(', ');
    }
    const entryOff = optBase + 16;
    if (entryOff + 4 <= buf.length) {
      const ep = view.getUint32(entryOff, true);
      if (ep) result['Entry point'] = '0x' + ep.toString(16).toUpperCase();
    }
    const ddBase = optBase + (is64 ? 112 : 96);
    const ddCount = ddBase >= 4 ? view.getUint32(ddBase - 4, true) : 0;
    if (ddCount > 14 && ddBase + 14 * 8 + 4 <= buf.length) {
      const clrRva = view.getUint32(ddBase + 14 * 8, true);
      if (clrRva) result['.NET'] = 'Yes (CLR)';
    }
    // Resource directory (data dir index 2) → file offset, for VS_VERSIONINFO.
    if (ddCount > 2 && ddBase + 2 * 8 + 4 <= buf.length) {
      const rsrcRva = view.getUint32(ddBase + 2 * 8, true);
      const rsrcSize = view.getUint32(ddBase + 2 * 8 + 4, true);
      if (rsrcRva && rsrcSize) {
        for (let s = 0; s < numSections && secTableOff + s * 40 + 40 <= buf.length; s++) {
          const secVa = view.getUint32(secTableOff + s * 40 + 12, true);
          const secVSize = view.getUint32(secTableOff + s * 40 + 8, true);
          const secRaw = view.getUint32(secTableOff + s * 40 + 20, true);
          if (rsrcRva >= secVa && rsrcRva < secVa + secVSize) {
            // `rva` is the resource section's virtual address; resource data
            // entries store their payload as an RVA, so file-offset-within-rsrc =
            // dataRVA - rva. Kept so the icon extractor can resolve RT_ICON bytes.
            result._rsrc = { off: secRaw + (rsrcRva - secVa), size: rsrcSize, rva: rsrcRva };
            break;
          }
        }
      }
    }
    if (ddCount > 1 && ddBase + 1 * 8 + 4 <= buf.length) {
      const importRva = view.getUint32(ddBase + 1 * 8, true);
      const importSize = view.getUint32(ddBase + 1 * 8 + 4, true);
      if (importRva && importSize) {
        const sizeOfOptHdr = view.getUint16(peOffset + 20, true);
        const secTableOff = peOffset + 24 + sizeOfOptHdr;
        let importFileOff = 0;
        for (let s = 0; s < numSections && secTableOff + s * 40 + 40 <= buf.length; s++) {
          const secVa = view.getUint32(secTableOff + s * 40 + 12, true);
          const secVSize = view.getUint32(secTableOff + s * 40 + 8, true);
          const secRaw = view.getUint32(secTableOff + s * 40 + 20, true);
          if (importRva >= secVa && importRva < secVa + secVSize) {
            importFileOff = secRaw + (importRva - secVa);
            break;
          }
        }
        if (importFileOff && importFileOff + 20 <= buf.length) {
          let dllCount = 0;
          for (let off = importFileOff; off + 20 <= buf.length; off += 20) {
            const nameRva = view.getUint32(off + 12, true);
            if (!nameRva) break;
            dllCount++;
            if (dllCount > 200) break;
          }
          if (dllCount) result['Imported DLLs'] = dllCount;
        }
      }
    }
  } catch (_) {}
  return result;
}

// VS_VERSIONINFO string reader. A "String" entry is laid out as:
//   wLength(2) wValueLength(2) wType(2) szKey(UTF-16, null-term) [pad to 4]
//   Value(UTF-16, wValueLength words, null-term)
// We find szKey as a real key (it must be followed by a UTF-16 null terminator,
// which rejects the same text appearing inside an embedded manifest/resource),
// then read exactly the declared value length so we never spill into the next
// entry or pick up alignment padding.
function readUtf16Value(buf, key) {
  const kb = [];
  for (let i = 0; i < key.length; i++) { kb.push(key.charCodeAt(i) & 0xFF, 0); }
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  outer:
  for (let i = 6; i + kb.length + 2 <= buf.length; i++) {
    for (let j = 0; j < kb.length; j++) { if (buf[i + j] !== kb[j]) continue outer; }
    const after = i + kb.length;
    // Must be a genuine szKey: terminated by a UTF-16 NUL right after the name.
    if (buf[after] !== 0 || buf[after + 1] !== 0) continue;
    const wValueLength = dv.getUint16(i - 4, true); // value length in words
    const structStart = i - 6;
    let p = after + 2; // past key + its NUL terminator
    // Value is 32-bit aligned relative to the (DWORD-aligned) struct start.
    p += (4 - ((p - structStart) % 4)) % 4;
    const maxWords = wValueLength > 0 ? wValueLength : 256;
    let s = '';
    for (let w = 0; w < maxWords && p + 1 < buf.length; w++) {
      const c = buf[p] | (buf[p + 1] << 8);
      p += 2;
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    s = s.trim();
    if (s) return s;
  }
  return null;
}

async function parseExe(c) {
  const result = parsePe(c.head) || {};
  const rsrc = result._rsrc;
  delete result._rsrc;
  if (rsrc && rsrc.size && c.file) {
    try {
      const size = Math.min(rsrc.size, 4 * 1024 * 1024);
      const buf = new Uint8Array(await c.file.slice(rsrc.off, rsrc.off + size).arrayBuffer());
      // VS_FIXEDFILEINFO signature 0xFEEF04BD (little-endian: BD 04 EF FE)
      let sig = -1;
      for (let i = 0; i + 24 <= buf.length; i++) {
        if (buf[i] === 0xBD && buf[i + 1] === 0x04 && buf[i + 2] === 0xEF && buf[i + 3] === 0xFE) { sig = i; break; }
      }
      if (sig >= 0) {
        const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        const ver = (ms, ls) => (ms >>> 16) + '.' + (ms & 0xFFFF) + '.' + (ls >>> 16) + '.' + (ls & 0xFFFF);
        const fileMS = v.getUint32(sig + 8, true), fileLS = v.getUint32(sig + 12, true);
        const prodMS = v.getUint32(sig + 16, true), prodLS = v.getUint32(sig + 20, true);
        if (fileMS || fileLS) result['File version'] = ver(fileMS, fileLS);
        if (prodMS || prodLS) result['Product version'] = ver(prodMS, prodLS);
      }
      const fields = [
        ['ProductName', 'Product name'], ['FileDescription', 'Description'],
        ['CompanyName', 'Company'], ['LegalCopyright', 'Copyright'],
        ['OriginalFilename', 'Original filename'], ['InternalName', 'Internal name'],
      ];
      for (const [key, label] of fields) {
        const val = readUtf16Value(buf, key);
        if (val) result[label] = val;
      }
    } catch (_) {}
  }
  return result;
}

// ---------- PE icon extraction ----------
// Pull the application icon out of a Windows PE (.exe/.dll) and hand it back as a
// PNG File so it can be analysed in the photo section. Walks the resource tree to
// the first RT_GROUP_ICON (type 14), picks that group's largest/deepest member,
// wraps the referenced RT_ICON (type 3) image - a DIB or PNG - in a one-image
// .ico, and rasterises it through the browser's own ICO decoder (which handles
// the DIB AND-mask transparency we'd otherwise hand-roll). Returns null when
// there's no icon or anything is malformed - it never throws.
export async function extractPeIcon(file) {
  if (!file) return null;
  try {
    const head = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer());
    const pe = parsePe(head);
    const rsrc = pe && pe._rsrc;
    if (!rsrc || !rsrc.size || !rsrc.rva) return null;

    const size = Math.min(rsrc.size, 8 * 1024 * 1024);
    const buf = new Uint8Array(await file.slice(rsrc.off, rsrc.off + size).arrayBuffer());
    if (buf.length < 16) return null;
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

    // One IMAGE_RESOURCE_DIRECTORY at rsrc-relative `dirOff` → its entries.
    // Sub-offsets are rsrc-relative; the high bit marks a subdirectory.
    const readDir = (dirOff) => {
      if (dirOff < 0 || dirOff + 16 > buf.length) return [];
      const total = dv.getUint16(dirOff + 12, true) + dv.getUint16(dirOff + 14, true);
      const entries = [];
      let p = dirOff + 16;
      for (let i = 0; i < total && p + 8 <= buf.length; i++, p += 8) {
        const nameField = dv.getUint32(p, true);
        const offField = dv.getUint32(p + 4, true);
        entries.push({
          id: (nameField & 0x80000000) ? -1 : nameField,   // -1 = named entry
          isDir: !!(offField & 0x80000000),
          off: offField & 0x7FFFFFFF,
        });
      }
      return entries;
    };
    // IMAGE_RESOURCE_DATA_ENTRY at rsrc-relative `leafOff` → bytes in `buf`.
    // OffsetToData is an image RVA, so subtract the section's own RVA.
    const leafData = (leafOff) => {
      if (leafOff < 0 || leafOff + 16 > buf.length) return null;
      const start = dv.getUint32(leafOff, true) - rsrc.rva;
      const dataSize = dv.getUint32(leafOff + 4, true);
      if (start < 0 || dataSize <= 0 || start + dataSize > buf.length) return null;
      return { start, size: dataSize };
    };
    // Descend a name entry's language directory to its first real leaf.
    const firstLeaf = (dirOff) => {
      for (const e of readDir(dirOff)) {
        const d = e.isDir ? firstLeaf(e.off) : leafData(e.off);
        if (d) return d;
      }
      return null;
    };

    const root = readDir(0);
    const typeOff = (t) => { const e = root.find((x) => x.id === t && x.isDir); return e ? e.off : -1; };
    const groupTypeOff = typeOff(14), iconTypeOff = typeOff(3);
    if (groupTypeOff < 0 || iconTypeOff < 0) return null;

    const iconById = {};
    for (const e of readDir(iconTypeOff)) {
      if (!e.isDir) continue;
      const d = firstLeaf(e.off);
      if (d) iconById[e.id] = d;
    }
    const groups = readDir(groupTypeOff).filter((e) => e.isDir);
    if (!groups.length) return null;
    const grp = firstLeaf(groups[0].off);
    if (!grp || grp.start + 6 > buf.length) return null;

    // GRPICONDIR: reserved(2) type(2) count(2), then count GRPICONDIRENTRY(14):
    // width(1) height(1) colorCount(1) reserved(1) planes(2) bitCount(2)
    // bytesInRes(4) id(2). Pick the largest, then deepest-colour, member.
    const count = dv.getUint16(grp.start + 4, true);
    let best = null;
    for (let i = 0; i < count; i++) {
      const e = grp.start + 6 + i * 14;
      if (e + 14 > buf.length) break;
      const w = buf[e] || 256, h = buf[e + 1] || 256;
      const bitCount = dv.getUint16(e + 6, true);
      const score = w * h * 4096 + bitCount;
      if (!best || score > best.score) best = { w, h, planes: dv.getUint16(e + 4, true), bitCount, id: dv.getUint16(e + 12, true), score };
    }
    if (!best || !iconById[best.id]) return null;
    const icon = iconById[best.id];

    // Wrap the chosen image in a one-image .ico for the browser to decode.
    const imgBytes = buf.subarray(icon.start, icon.start + icon.size);
    const ico = new Uint8Array(22 + imgBytes.length);
    const idv = new DataView(ico.buffer);
    idv.setUint16(2, 1, true);                       // type: icon
    idv.setUint16(4, 1, true);                       // image count
    ico[6] = best.w >= 256 ? 0 : best.w;
    ico[7] = best.h >= 256 ? 0 : best.h;
    idv.setUint16(10, best.planes || 1, true);
    idv.setUint16(12, best.bitCount || 32, true);
    idv.setUint32(14, imgBytes.length, true);
    idv.setUint32(18, 22, true);                     // offset to image data
    ico.set(imgBytes, 22);

    const url = URL.createObjectURL(new Blob([ico], { type: 'image/x-icon' }));
    try {
      const png = await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const cv = document.createElement('canvas');
          cv.width = img.naturalWidth || best.w;
          cv.height = img.naturalHeight || best.h;
          cv.getContext('2d').drawImage(img, 0, 0);
          cv.toBlob(resolve, 'image/png');
        };
        img.onerror = () => resolve(null);
        img.src = url;
      });
      if (!png) return null;
      const base = (file.name || 'icon').replace(/\.[^.]+$/, '');
      return new File([png], base + '-icon.png', { type: 'image/png' });
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  } catch (_) {
    return null;
  }
}

// ---------- OLE compound doc (SolidWorks, old Office) ----------
function parseOle(buf) {
  if (buf.length < 512) return null;
  if (buf[0] !== 0xD0 || buf[1] !== 0xCF || buf[2] !== 0x11 || buf[3] !== 0xE0) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const minor = view.getUint16(24, true);
  const major = view.getUint16(26, true);
  return { 'OLE version': major + '.' + minor };
}

// ---------- Font (TTF / OTF) ----------
async function parseFont(file) {
  const size = Math.min(file.size, 65536);
  const buf = new Uint8Array(await file.slice(0, size).arrayBuffer());
  if (buf.length < 12) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const magic = view.getUint32(0);
  if (magic !== 0x00010000 && magic !== 0x4F54544F) return null;
  const numTables = view.getUint16(4);
  let nameOff = 0, fvarOff = 0;
  for (let i = 0; i < numTables && 12 + i * 16 + 16 <= buf.length; i++) {
    const tag = ascii(buf, 12 + i * 16, 4);
    if (tag === 'name') nameOff = view.getUint32(12 + i * 16 + 8);
    else if (tag === 'fvar') fvarOff = view.getUint32(12 + i * 16 + 8);
  }
  if (!nameOff || nameOff + 6 > buf.length) return null;
  const count = view.getUint16(nameOff + 2);
  const strOff = nameOff + view.getUint16(nameOff + 4);
  const wanted = { 1: 'Family', 2: 'Style', 4: 'Full name', 5: 'Version', 8: 'Manufacturer', 9: 'Designer' };
  const names = {};
  for (let i = 0; i < count && nameOff + 6 + i * 12 + 12 <= buf.length; i++) {
    const base = nameOff + 6 + i * 12;
    const pid = view.getUint16(base);
    const nid = view.getUint16(base + 6);
    const len = view.getUint16(base + 8);
    const off = view.getUint16(base + 10);
    const label = wanted[nid];
    if (!label || names[label]) continue;
    const s = strOff + off;
    if (s + len > buf.length) continue;
    let text;
    if (pid === 3 || pid === 0) {
      const codes = [];
      for (let j = 0; j < len - 1; j += 2) codes.push(view.getUint16(s + j));
      text = String.fromCharCode(...codes);
    } else {
      text = ascii(buf, s, len);
    }
    if (text.trim()) names[label] = text.trim();
  }
  // fvar: variable-font axes. Header: major(2) minor(2) axesArrayOffset(2)
  // reserved(2) axisCount(2) axisSize(2), then axisCount records of
  // {tag(4) min(16.16) default(16.16) max(16.16) flags(2) nameID(2)}.
  if (fvarOff && fvarOff + 16 <= buf.length) {
    const axesOff = fvarOff + view.getUint16(fvarOff + 4);
    const axisCount = view.getUint16(fvarOff + 8);
    const axisSize = view.getUint16(fvarOff + 10);
    const axes = [];
    let wght = null;
    for (let i = 0; i < axisCount; i++) {
      const a = axesOff + i * axisSize;
      if (a + 20 > buf.length) break;
      const tag = ascii(buf, a, 4);
      const min = view.getInt32(a + 4) / 65536;
      const def = view.getInt32(a + 8) / 65536;
      const max = view.getInt32(a + 12) / 65536;
      axes.push(tag);
      if (tag === 'wght') wght = { min, def, max };
    }
    names['Variable font'] = 'Yes - ' + axisCount + ' axis' + (axisCount === 1 ? '' : 'es') + ' (' + axes.join(', ') + ')';
    names._font = { variable: true, wght: wght || { min: 100, def: 400, max: 900 } };
  }
  return Object.keys(names).length ? names : null;
}

// ---------- FL Studio (.flp) ----------
// Decode an FLP text-event payload. Modern FL Studio (11.5+) stores strings as
// UTF-16LE; older versions use single-byte text. Sniff by the density of NUL
// bytes, then drop the trailing terminator.
function decodeFlpText(bytes) {
  if (!bytes.length) return '';
  let zeros = 0;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0) zeros++;
  let text;
  if (bytes.length >= 2 && zeros >= bytes.length / 3) {
    const codes = [];
    for (let i = 0; i + 1 < bytes.length; i += 2) codes.push(bytes[i] | (bytes[i + 1] << 8));
    text = String.fromCharCode(...codes);
  } else {
    text = new TextDecoder('utf-8').decode(bytes);
  }
  return text.replace(/\0+$/, '').trim();
}

async function parseFlp(file) {
  // FLPs are small; read up to 8 MB to cover the whole event stream.
  const buf = new Uint8Array(await file.slice(0, Math.min(file.size, 8 * 1024 * 1024)).arrayBuffer());
  if (buf.length < 10 || ascii(buf, 0, 4) !== 'FLhd') return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const headerLen = view.getUint32(4, true);
  const format = view.getUint16(8, true);
  const channelCount = view.getUint16(10, true);
  const ppq = view.getUint16(12, true);
  const fields = { 'Format': format === 0 ? 'Song' : 'Format ' + format };
  if (channelCount) fields['Channels'] = channelCount;
  if (ppq) fields['PPQ (ticks/beat)'] = ppq;

  // Locate the FLdt data chunk (right after the FLhd chunk).
  let pos = 8 + headerLen;
  if (pos + 8 > buf.length || ascii(buf, pos, 4) !== 'FLdt') return fields;
  const dataLen = view.getUint32(pos + 4, true);
  pos += 8;
  const end = Math.min(buf.length, pos + dataLen);

  const channelNames = [];
  const plugins = new Set();
  let title, comment, version, tempo, genre, author;

  while (pos < end) {
    const id = buf[pos++];
    if (id < 0x40) {                         // BYTE event
      pos += 1;
    } else if (id < 0x80) {                  // WORD event
      if (id === 0x42 && pos + 2 <= end) tempo = view.getUint16(pos, true); // legacy Tempo
      pos += 2;
    } else if (id < 0xC0) {                  // DWORD event
      if (id === 0x9C && pos + 4 <= end) tempo = view.getUint32(pos, true) / 1000; // FineTempo
      pos += 4;
    } else {                                 // TEXT / DATA event (varint length)
      let len = 0, shift = 0, b;
      do { b = buf[pos++]; len |= (b & 0x7F) << shift; shift += 7; } while (b & 0x80 && pos < end);
      const data = buf.subarray(pos, pos + len);
      pos += len;
      switch (id) {
        case 199: version = decodeFlpText(data); break;       // FLP_Version (ASCII)
        case 194: title = decodeFlpText(data); break;          // Title
        case 195: comment = decodeFlpText(data); break;        // Comment
        case 206: genre = decodeFlpText(data); break;          // Genre
        case 207: author = decodeFlpText(data); break;         // Author
        case 192: { const n = decodeFlpText(data); if (n) channelNames.push(n); break; } // ChanName
        case 201: case 203: {                                   // DefPluginName / PluginName
          const n = decodeFlpText(data); if (n && /[a-zA-Z]/.test(n)) plugins.add(n); break;
        }
      }
    }
  }

  if (version) fields['FL Studio version'] = version;
  if (tempo) fields['Tempo'] = (Math.round(tempo * 100) / 100) + ' BPM';
  if (title) fields['Title'] = title;
  if (author) fields['Author'] = author;
  if (genre) fields['Genre'] = genre;
  if (comment) fields['Comment'] = comment.slice(0, 300);
  if (channelNames.length) fields['Named channels'] = channelNames.slice(0, 30).join(', ');
  if (plugins.size) fields['Plugins'] = [...plugins].slice(0, 40).join(', ');
  return fields;
}

// ---------- RAR ----------
function parseRar(buf) {
  if (buf.length < 7) return null;
  const sig4 = ascii(buf, 0, 4);
  if (sig4 !== 'Rar!') return null;
  if (buf[4] === 0x1A && buf[5] === 0x07 && buf[6] === 0x01) return { 'RAR version': '5.x' };
  if (buf[4] === 0x1A && buf[5] === 0x07 && buf[6] === 0x00) return { 'RAR version': '4.x / earlier' };
  return { 'RAR version': 'unknown' };
}

// ---------- 7-Zip ----------
function parse7z(buf) {
  if (buf.length < 12) return null;
  if (buf[0] !== 0x37 || buf[1] !== 0x7A || buf[2] !== 0xBC || buf[3] !== 0xAF) return null;
  return { '7z version': buf[6] + '.' + buf[7] };
}

// ---------- SQLite ----------
async function parseSqlite(buf, file) {
  if (buf.length < 100) return null;
  const sig = ascii(buf, 0, 15);
  if (sig !== 'SQLite format 3') return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const pageSize = view.getUint16(16);
  const ps = pageSize === 1 ? 65536 : pageSize;
  const writeVer = buf[18];
  const readVer = buf[19];
  const journal = { 1: 'legacy (rollback)', 2: 'WAL' };
  const out = {
    'Page size': ps.toLocaleString() + ' bytes',
    'Journal mode': journal[writeVer] || String(writeVer),
    'SQLite version': view.getUint32(96) ? String(view.getUint32(96)) : undefined,
  };

  // Deep analysis with the vendored sql.js engine (lazy-loaded). Skipped for very
  // large files to avoid loading the whole DB into memory; any failure (engine
  // unavailable, encrypted/corrupt DB) cleanly falls back to the header facts above.
  if (file && file.size < 268435456) {
    try {
      const { sqliteAnalysis } = await import('../lib/sqlite.js');
      const a = await sqliteAnalysis(file);
      if (a) {
        const totalRows = a.tables.reduce((s, t) => s + (t.rows || 0), 0);
        if (a.pragma.encoding) out['Encoding'] = a.pragma.encoding;
        if (a.pragma.page_count) out['Pages'] = Number(a.pragma.page_count).toLocaleString();
        if (a.pragma.user_version) out['user_version'] = a.pragma.user_version;
        if (a.pragma.application_id) out['application_id'] = a.pragma.application_id;
        out['Tables'] = a.tables.length;
        if (a.views.length) out['Views'] = a.views.length;
        if (a.indexes.length) out['Indexes'] = a.indexes.length;
        if (a.triggers.length) out['Triggers'] = a.triggers.length;
        out['Total rows'] = totalRows.toLocaleString();

        const sections = [];
        if (a.tables.length) {
          const t = el('table', { class: 'anr-readout' });
          t.appendChild(el('tr', {}, [el('th', {}, 'Table'), el('th', {}, 'Rows'), el('th', {}, 'Cols')]));
          for (const tb of a.tables) {
            t.appendChild(el('tr', {}, [
              el('td', {}, tb.name),
              el('td', {}, tb.rows != null ? Number(tb.rows).toLocaleString() : '?'),
              el('td', {}, String(tb.cols.length)),
            ]));
          }
          sections.push({ title: 'Tables (' + a.tables.length + ')', node: t, open: true });

          const cols = el('div', {});
          for (const tb of a.tables) {
            cols.appendChild(el('div', { class: 'anr-readout-section' },
              tb.name + (tb.rows != null ? ' - ' + Number(tb.rows).toLocaleString() + ' rows' : '')));
            const ct = el('table', { class: 'anr-readout' });
            for (const c of tb.cols) ct.appendChild(row(c.name + (c.pk ? ' (PK)' : ''), c.type));
            cols.appendChild(ct);
          }
          sections.push({ title: 'Columns', node: cols });
        }
        if (a.ddl) {
          const pre = el('pre', { class: 'anr-code', style: 'max-height:400px;overflow:auto;font-size:12px;white-space:pre-wrap;' });
          pre.textContent = a.ddl;
          sections.push({ title: 'Schema (CREATE statements)', node: pre });
        }
        if (a.sample && a.sample.rows.length) {
          const wrap = el('div', { class: 'anr-table-wrap' });
          const st = el('table', { class: 'anr-readout anr-table-data' });
          const hr = el('tr', {});
          for (const c of a.sample.columns) hr.appendChild(el('th', {}, String(c)));
          st.appendChild(hr);
          for (const r of a.sample.rows) {
            const tr = el('tr', {});
            for (const cell of r) tr.appendChild(el('td', {}, cell == null ? 'NULL' : String(cell).slice(0, 160)));
            st.appendChild(tr);
          }
          wrap.appendChild(st);
          sections.push({ title: 'Sample data - ' + a.sample.table + ' (first 5 rows)', node: wrap });
        }
        if (sections.length) out._sections = sections;
      }
    } catch (_) { /* sql.js unavailable - header-only */ }
  }
  return out;
}

// ---------- SQLite WAL / SHM sidecars ----------
// Write-Ahead Log (-wal): a 32-byte big-endian header followed by frames, each a
// 24-byte frame header + one database page. Shared-memory index (-shm): two
// copies of a 48-byte WalIndexHdr plus a checkpoint-info block, in machine byte
// order. Both are the rollback/recovery sidecars beside a WAL-mode SQLite DB.
async function parseSqliteWal(head, file) {
  if (!head || head.length < 32) return null;
  const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const magic = dv.getUint32(0);
  if (magic !== 0x377f0682 && magic !== 0x377f0683) return null;
  const fmt = dv.getUint32(4);
  let pageSize = dv.getUint32(8);
  if (pageSize === 1) pageSize = 65536;
  const ckptSeq = dv.getUint32(12);
  const salt1 = dv.getUint32(16), salt2 = dv.getUint32(20);
  const cksum1 = dv.getUint32(24), cksum2 = dv.getUint32(28);
  const frameSize = 24 + pageSize;
  const size = file ? file.size : head.length;
  const maxFrames = pageSize > 0 ? Math.max(0, Math.floor((size - 32) / frameSize)) : 0;
  const hex = (n) => '0x' + (n >>> 0).toString(16).padStart(8, '0');

  const out = {
    'Format': 'SQLite Write-Ahead Log (-wal)',
    'Header magic': hex(magic) + (magic === 0x377f0683 ? ' (big-endian checksums)' : ' (little-endian checksums)'),
    'WAL format': fmt === 3007000 ? '3007000 (SQLite 3.7.0+)' : String(fmt),
    'Page size': pageSize.toLocaleString() + ' bytes',
    'Checkpoint sequence': ckptSeq.toLocaleString(),
    'Salt': hex(salt1) + ' ' + hex(salt2),
    'Header checksum': hex(cksum1) + ' ' + hex(cksum2),
    'Frames (by file size)': maxFrames.toLocaleString(),
  };

  // Walk the frame headers (24 bytes each, skipping the page bodies) to find the
  // committed transactions and the pages they changed. A frame belongs to this
  // log run only while its salts still match the header - the first mismatch is
  // where stale/overwritten frames from a previous run begin, so we stop there.
  if (file && maxFrames > 0) {
    try {
      const n = Math.min(maxFrames, 200000);
      const pages = new Set();
      let commits = 0, lastDbSize = 0, valid = 0;
      for (let i = 0; i < n; i++) {
        const off = 32 + i * frameSize;
        const fh = new Uint8Array(await file.slice(off, off + 24).arrayBuffer());
        if (fh.length < 24) break;
        const fv = new DataView(fh.buffer, fh.byteOffset, fh.byteLength);
        const pageNo = fv.getUint32(0), dbSize = fv.getUint32(4);
        if (fv.getUint32(8) !== salt1 || fv.getUint32(12) !== salt2) break;
        valid++;
        if (pageNo) pages.add(pageNo);
        if (dbSize !== 0) { commits++; lastDbSize = dbSize; }
      }
      out['Valid frames'] = valid.toLocaleString() + (valid < maxFrames ? '  (of ' + maxFrames.toLocaleString() + '; the rest are stale)' : '');
      out['Committed transactions'] = commits.toLocaleString();
      out['Distinct pages changed'] = pages.size.toLocaleString();
      if (lastDbSize) out['DB size after last commit'] = lastDbSize.toLocaleString() + ' pages  (' + fmtBytes(lastDbSize * pageSize) + ')';
      out['Pending checkpoint'] = commits > 0
        ? 'Yes - ' + commits + ' un-checkpointed transaction' + (commits === 1 ? '' : 's') + ' not yet merged into the database'
        : 'No complete transaction in the log';
      if (pages.size) {
        const list = Array.from(pages).sort((a, b) => a - b);
        const shown = list.slice(0, 500).join(', ') + (list.length > 500 ? ', …' : '');
        out._sections = [{ title: 'Changed page numbers (' + list.length + ')', node: preBlock(shown) }];
      }
    } catch (_) { /* header facts still returned */ }
  }
  return out;
}

function parseSqliteShm(head) {
  if (!head || head.length < 48) return null;
  // WalIndexHdr is written in machine byte order; detect it from iVersion, which
  // is 3007000 on every real file. Try little-endian first (the universal case).
  const dvv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  let le = true, iVersion = dvv.getUint32(0, true);
  if (iVersion !== 3007000 && dvv.getUint32(0, false) === 3007000) { le = false; iVersion = 3007000; }
  const u32 = (o) => dvv.getUint32(o, le);
  const u16 = (o) => dvv.getUint16(o, le);
  const readHdr = (b) => ({
    iChange: u32(b + 8), isInit: head[b + 12], bigEndCksum: head[b + 13],
    szPage: u16(b + 14), mxFrame: u32(b + 16), nPage: u32(b + 20),
    salt1: u32(b + 32), salt2: u32(b + 36),
  });
  const h0 = readHdr(0);
  const h1 = head.length >= 96 ? readHdr(48) : null;
  let ps = h0.szPage & 0xffff; if (ps === 0 || ps === 1) ps = 65536;
  const hex = (n) => '0x' + (n >>> 0).toString(16).padStart(8, '0');

  const out = {
    'Format': 'SQLite shared-memory WAL-index (-shm)',
    'Byte order': le ? 'little-endian' : 'big-endian',
    'Index version': iVersion === 3007000 ? '3007000 (SQLite 3.7.0+)' : String(iVersion),
    'Initialised': h0.isInit ? 'Yes' : 'No',
    'Page size': ps.toLocaleString() + ' bytes',
    'Valid WAL frames (mxFrame)': h0.mxFrame.toLocaleString(),
    'DB size (nPage)': h0.nPage.toLocaleString() + ' pages  (' + fmtBytes(h0.nPage * ps) + ')',
    'WAL salt': hex(h0.salt1) + ' ' + hex(h0.salt2),
    'Transaction counter': h0.iChange.toLocaleString(),
    'WAL checksums': h0.bigEndCksum ? 'big-endian' : 'little-endian',
  };
  if (h1) {
    out['Header copies'] = (h0.iChange === h1.iChange && h0.mxFrame === h1.mxFrame && h0.salt1 === h1.salt1 && h0.salt2 === h1.salt2)
      ? 'Both copies agree (consistent)'
      : 'Copies differ - index is mid-update or stale';
  }
  if (head.length >= 136) {
    const nBackfill = u32(96);
    out['Frames checkpointed (nBackfill)'] = nBackfill.toLocaleString();
    if (h0.mxFrame) out['Frames awaiting checkpoint'] = Math.max(0, h0.mxFrame - nBackfill).toLocaleString();
  }
  return out;
}

// ---------- GIMP XCF ----------
function parseXcf(buf) {
  const sig = ascii(buf, 0, 9);
  if (sig !== 'gimp xcf ') return null;
  const verStr = ascii(buf, 9, 5).replace(/\0/g, '');
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const width = buf.length >= 18 ? view.getUint32(14) : null;
  const height = buf.length >= 22 ? view.getUint32(18) : null;
  const colorMode = buf.length >= 26 ? view.getUint32(22) : null;
  const modes = { 0: 'RGB', 1: 'Grayscale', 2: 'Indexed' };
  const result = { 'XCF version': verStr || 'v0 (original)' };
  if (width && height) result['Dimensions'] = width + ' × ' + height;
  if (colorMode != null) result['Color mode'] = modes[colorMode] || 'Unknown';
  return result;
}

// ---------- ISO 9660 ----------
function parseIso(buf) {
  if (buf.length < 100) return null;
  const id = ascii(buf, 1, 5);
  if (id === 'CD001') {
    return {
      'Format': 'ISO 9660',
      'System': ascii(buf, 8, 32).trim() || undefined,
      'Volume': ascii(buf, 40, 32).trim() || undefined
    };
  }
  return null;
}

// ---------- Adobe InDesign ----------
// ---------- ZIP-based doc metadata (DOCX, XLSX, PPTX, EPUB, ODF) ----------
async function parseZipMeta(file, ext) {
  try {
    const zip = await openZip(file, 131072);
    const fields = {};
    if (zip.has('docProps/core.xml')) {
      const xml = await zip.text('docProps/core.xml');
      if (xml) {
        const grab = (tag) => { const m = xml.match(new RegExp('<(?:dc:|cp:)?' + tag + '[^>]*>([^<]+)<')); return m ? m[1].trim() : null; };
        const creator = grab('creator');
        const title = grab('title');
        const created = grab('created');
        const modified = grab('modified');
        const lastBy = grab('lastModifiedBy');
        const revision = grab('revision');
        if (creator) fields['Author'] = creator;
        if (title) fields['Title'] = title;
        if (lastBy) fields['Last modified by'] = lastBy;
        if (created) fields['Created'] = created;
        if (modified) fields['Modified'] = modified;
        if (revision) fields['Revision'] = revision;
      }
    }
    if (zip.has('docProps/app.xml')) {
      const xml = await zip.text('docProps/app.xml');
      if (xml) {
        const grab = (tag) => { const m = xml.match(new RegExp('<' + tag + '[^>]*>([^<]+)<')); return m ? m[1].trim() : null; };
        const app = grab('Application');
        const appVer = grab('AppVersion');
        const pages = grab('Pages');
        const words = grab('Words');
        const slides = grab('Slides');
        if (app) fields['Application'] = app + (appVer ? ' ' + appVer : '');
        if (pages) fields['Pages'] = pages;
        if (words) fields['Words'] = words;
        if (slides) fields['Slides'] = slides;
      }
    }
    // EPUB: content.opf carries Dublin Core metadata
    if (ext === 'epub') {
      const opfEntry = zip.match(/\.opf$/)[0];
      if (opfEntry) {
        const xml = await zip.text(opfEntry.name);
        if (xml) {
          const grab = (tag) => { const m = xml.match(new RegExp('<dc:' + tag + '[^>]*>([^<]+)<')); return m ? m[1].trim() : null; };
          const title = grab('title');
          const creator = grab('creator');
          const publisher = grab('publisher');
          const lang = grab('language');
          const date = grab('date');
          if (title) fields['Title'] = title;
          if (creator) fields['Author'] = creator;
          if (publisher) fields['Publisher'] = publisher;
          if (lang) fields['Language'] = lang;
          if (date) fields['Date'] = date;
        }
      }
    }
    // ODF (ODT/ODS/ODP): meta.xml
    if (zip.has('meta.xml')) {
      const xml = await zip.text('meta.xml');
      if (xml) {
        const grab = (tag) => { const m = xml.match(new RegExp('<meta:' + tag + '[^>]*>([^<]+)<')); return m ? m[1].trim() : null; };
        const gen = grab('generator');
        const created = grab('creation-date');
        if (gen) fields['Generator'] = gen;
        if (created && !fields['Created']) fields['Created'] = created;
        const dcGrab = (tag) => { const m = xml.match(new RegExp('<dc:' + tag + '[^>]*>([^<]+)<')); return m ? m[1].trim() : null; };
        const title = dcGrab('title');
        const creator = dcGrab('creator');
        if (title && !fields['Title']) fields['Title'] = title;
        if (creator && !fields['Author']) fields['Author'] = creator;
      }
    }
    return Object.keys(fields).length ? fields : null;
  } catch (_) {
    return null;
  }
}

// ---------- Android APK ----------
// Well-known android: attribute resource IDs, for the case where aapt2 stripped
// the attribute name strings (then only the resource-map entry identifies them).
const AXML_KNOWN_ATTRS = {
  0x01010003: 'name', 0x01010001: 'label', 0x01010002: 'icon',
  0x0101000b: 'sharedUserId', 0x0101000f: 'debuggable', 0x01010009: 'protectionLevel',
  0x0101020c: 'minSdkVersion', 0x01010270: 'targetSdkVersion', 0x01010271: 'maxSdkVersion',
  0x0101021b: 'versionCode', 0x0101021c: 'versionName',
  0x01010280: 'allowBackup', 0x010102b7: 'installLocation',
  0x01010281: 'glEsVersion', 0x0101028e: 'required',
  0x01010572: 'compileSdkVersion', 0x01010573: 'compileSdkVersionCodename',
  0x01010604: 'usesCleartextTraffic', 0x010104ea: 'extractNativeLibs',
};

// API level -> marketing Android version (major milestones).
const ANDROID_API = {
  1: '1.0', 2: '1.1', 3: '1.5', 4: '1.6', 5: '2.0', 6: '2.0.1', 7: '2.1', 8: '2.2',
  9: '2.3', 10: '2.3.3', 11: '3.0', 12: '3.1', 13: '3.2', 14: '4.0', 15: '4.0.3',
  16: '4.1', 17: '4.2', 18: '4.3', 19: '4.4', 20: '4.4W', 21: '5.0', 22: '5.1',
  23: '6.0', 24: '7.0', 25: '7.1', 26: '8.0', 27: '8.1', 28: '9', 29: '10', 30: '11',
  31: '12', 32: '12L', 33: '13', 34: '14', 35: '15', 36: '16',
};
function androidApiLabel(v) {
  const n = parseInt(v, 10);
  if (isNaN(n)) return String(v);
  return 'API ' + n + (ANDROID_API[n] ? ' (Android ' + ANDROID_API[n] + ')' : '');
}

// Parse a binary AndroidManifest.xml (Android binary XML / AXML) into an ordered
// list of element events: { type:'start', tag, attrs } / { type:'end', tag }.
function parseAxml(bytes) {
  if (!bytes || bytes.length < 8) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (p) => dv.getUint16(p, true);
  const u32 = (p) => dv.getUint32(p, true) >>> 0;
  if (u16(0) !== 0x0003) return null;                  // RES_XML_TYPE
  const total = Math.min(u32(4), bytes.length);

  let strings = null;
  let resIds = null;

  const readStr = (p, isUtf8) => {
    if (p < 0 || p >= bytes.length) return '';
    if (isUtf8) {
      let q = p;
      let n = bytes[q++]; if (n & 0x80) { n = ((n & 0x7f) << 8) | bytes[q++]; }
      let blen = bytes[q++]; if (blen & 0x80) { blen = ((blen & 0x7f) << 8) | bytes[q++]; }
      return utf8(bytes.subarray(q, q + blen));
    }
    let q = p;
    let n = u16(q); q += 2; if (n & 0x8000) { n = ((n & 0x7fff) << 16) | u16(q); q += 2; }
    return utf16(bytes.subarray(q, q + n * 2), true);
  };
  const readStringPool = (off) => {
    const stringCount = u32(off + 8);
    const flags = u32(off + 16);
    const stringsStart = u32(off + 20);
    const isUtf8 = (flags & 0x100) !== 0;
    const out = [];
    for (let i = 0; i < stringCount; i++) {
      out.push(readStr(off + stringsStart + u32(off + 28 + i * 4), isUtf8));
    }
    return out;
  };
  const str = (ref) => (ref === 0xffffffff || !strings || ref >= strings.length) ? '' : (strings[ref] || '');

  const events = [];
  let pos = u16(2) || 8;
  while (pos + 8 <= total) {
    const type = u16(pos);
    const size = u32(pos + 4);
    if (size < 8 || pos + size > total) break;
    if (type === 0x0001 && !strings) {
      strings = readStringPool(pos);
    } else if (type === 0x0180) {                      // XML resource map
      const n = (size - 8) >> 2;
      resIds = [];
      for (let i = 0; i < n; i++) resIds.push(u32(pos + 8 + i * 4));
    } else if (type === 0x0102) {                      // start element
      const attrStart = u16(pos + 24);
      const attrSize = u16(pos + 26) || 20;
      const attrCount = u16(pos + 28);
      const tag = str(u32(pos + 20));
      const attrs = {};
      let ap = pos + 16 + attrStart;
      for (let i = 0; i < attrCount && ap + 20 <= bytes.length; i++, ap += attrSize) {
        const aNameRef = u32(ap + 4);
        const aRawRef = u32(ap + 8);
        const dataType = bytes[ap + 15];
        const data = u32(ap + 16);
        let key = str(aNameRef);
        if (!key && resIds && aNameRef < resIds.length) key = AXML_KNOWN_ATTRS[resIds[aNameRef]] || '';
        if (!key) continue;
        let val;
        if (aRawRef !== 0xffffffff) val = str(aRawRef);
        else if (dataType === 0x03) val = str(data);
        else if (dataType === 0x12) val = data !== 0 ? 'true' : 'false';
        else if (dataType === 0x11) val = '0x' + data.toString(16);
        else if (dataType === 0x01 || dataType === 0x02) val = '@0x' + data.toString(16);
        else val = String(data | 0);
        attrs[key] = val;
      }
      events.push({ type: 'start', tag, attrs });
    } else if (type === 0x0103) {                      // end element
      events.push({ type: 'end', tag: str(u32(pos + 20)) });
    }
    pos += size;
  }
  return strings ? { events } : null;
}

// Read the ZIP central directory from the file tail for an authoritative entry
// list (the windowed openZip only sees front-placed entries). Returns
// { names, count, cdOff } or null (e.g. zip64).
async function apkArchiveInfo(file) {
  try {
    const tailLen = Math.min(file.size, 66000);
    const tail = new Uint8Array(await file.slice(file.size - tailLen).arrayBuffer());
    let eo = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) { eo = i; break; }
    }
    if (eo < 0) return null;
    const tv = new DataView(tail.buffer);
    const count = tv.getUint16(eo + 10, true);
    const cdSize = tv.getUint32(eo + 12, true);
    const cdOff = tv.getUint32(eo + 16, true);
    if (cdOff === 0xffffffff || cdSize === 0xffffffff) return null;   // zip64
    const cd = new Uint8Array(await file.slice(cdOff, cdOff + cdSize).arrayBuffer());
    const cv = new DataView(cd.buffer);
    const names = [];
    let p = 0;
    while (p + 46 <= cd.length && cv.getUint32(p, true) === 0x02014b50) {
      const nameLen = cv.getUint16(p + 28, true);
      const extraLen = cv.getUint16(p + 30, true);
      const commLen = cv.getUint16(p + 32, true);
      names.push(utf8(cd.subarray(p + 46, p + 46 + nameLen)));
      p += 46 + nameLen + extraLen + commLen;
    }
    return { names, count, cdOff };
  } catch (_) { return null; }
}

function apkDetailsBlock(title, items) {
  const det = el('details', { style: 'margin-top:12px;' });
  det.appendChild(el('summary', {}, title));
  const pre = el('pre', { class: 'anr-code', style: 'max-height:320px;overflow:auto;font-size:12px;' });
  pre.textContent = items.join('\n');
  det.appendChild(pre);
  return det;
}

async function parseApk(file) {
  let zip = null;
  try { zip = await openZip(file, 4 * 1024 * 1024); } catch (_) { /* fall through */ }

  const fields = {};
  fields['Format'] = 'Android Application Package (APK)';

  // --- AndroidManifest.xml (binary XML) ---
  let manifest = null;
  try {
    const mbytes = zip ? await zip.bytes('AndroidManifest.xml') : null;
    if (mbytes) manifest = parseAxml(mbytes);
  } catch (_) { /* ignore */ }

  const permissions = [];
  const features = [];
  let launcher = null;
  if (manifest) {
    let curActivity = null, inIntent = false, sawMain = false, sawLauncher = false;
    for (const ev of manifest.events) {
      if (ev.type === 'start') {
        const a = ev.attrs;
        if (ev.tag === 'manifest') {
          if (a.package) fields['Package'] = a.package;
          if (a.versionName) fields['Version name'] = a.versionName;
          if (a.versionCode) fields['Version code'] = a.versionCode;
          if (a.sharedUserId) fields['Shared user ID'] = a.sharedUserId;
          if (a.installLocation) fields['Install location'] = a.installLocation;
          if (a.compileSdkVersion) fields['Built with'] = androidApiLabel(a.compileSdkVersion);
          if (a.platformBuildVersionName && !fields['Built with']) fields['Built with'] = a.platformBuildVersionName;
        } else if (ev.tag === 'uses-sdk') {
          if (a.minSdkVersion) fields['Min Android'] = androidApiLabel(a.minSdkVersion);
          if (a.targetSdkVersion) fields['Target Android'] = androidApiLabel(a.targetSdkVersion);
          if (a.maxSdkVersion) fields['Max Android'] = androidApiLabel(a.maxSdkVersion);
        } else if (ev.tag === 'uses-permission' || ev.tag === 'uses-permission-sdk-23') {
          if (a.name) permissions.push(a.name);
        } else if (ev.tag === 'uses-feature') {
          if (a.name) features.push(a.name + (a.required === 'false' ? ' (optional)' : ''));
          else if (a.glEsVersion) {
            const n = parseInt(String(a.glEsVersion).replace(/^0x/, ''), 16);
            if (n) features.push('OpenGL ES ' + (n >> 16) + '.' + (n & 0xffff));
          }
        } else if (ev.tag === 'application') {
          if (a.label && a.label.charAt(0) !== '@') fields['App label'] = a.label;
          if (a.debuggable === 'true') fields['Debuggable'] = 'Yes';
          if (a.usesCleartextTraffic) fields['Cleartext traffic'] = a.usesCleartextTraffic === 'true' ? 'Allowed' : 'Blocked';
          if (a.allowBackup) fields['Allows backup'] = a.allowBackup === 'true' ? 'Yes' : 'No';
        } else if (ev.tag === 'activity' || ev.tag === 'activity-alias') {
          curActivity = a.name || a.targetActivity || null;
        } else if (ev.tag === 'intent-filter') {
          inIntent = true; sawMain = false; sawLauncher = false;
        } else if (ev.tag === 'action' && inIntent) {
          if (a.name === 'android.intent.action.MAIN') sawMain = true;
        } else if (ev.tag === 'category' && inIntent) {
          if (a.name === 'android.intent.category.LAUNCHER') sawLauncher = true;
        }
      } else if (ev.type === 'end') {
        if (ev.tag === 'intent-filter') {
          if (sawMain && sawLauncher && curActivity && !launcher) launcher = curActivity;
          inIntent = false;
        } else if (ev.tag === 'activity' || ev.tag === 'activity-alias') {
          curActivity = null;
        }
      }
    }
  } else {
    fields['Manifest'] = 'AndroidManifest.xml not found in the first 4 MB';
  }
  if (launcher) fields['Launcher activity'] = launcher;

  // --- Package contents (authoritative central-directory listing) ---
  const info = await apkArchiveInfo(file);
  const contentNames = info ? info.names : (zip ? zip.names() : null);
  if (contentNames) {
    const dex = contentNames.filter((n) => /^classes\d*\.dex$/.test(n));
    if (dex.length) fields['DEX files'] = String(dex.length);
    const abis = new Set();
    for (const n of contentNames) { const m = n.match(/^lib\/([^/]+)\//); if (m) abis.add(m[1]); }
    if (abis.size) fields['Native code'] = [...abis].join(', ');
    if (contentNames.includes('resources.arsc')) fields['Resource table'] = 'resources.arsc';
    if (info) fields['Total entries'] = String(info.count);
  }

  // --- Signing (APK Signature Scheme v2+ block sits before the central dir) ---
  const schemes = [];
  if (info && info.cdOff >= 16) {
    try {
      const winStart = Math.max(0, info.cdOff - 262144);
      const blk = new Uint8Array(await file.slice(winStart, info.cdOff).arrayBuffer());
      const MAGIC = [65, 80, 75, 32, 83, 105, 103, 32, 66, 108, 111, 99, 107, 32, 52, 50]; // "APK Sig Block 42"
      if (findBytes(blk, new Uint8Array(MAGIC)) >= 0) {
        const has = (b) => findBytes(blk, new Uint8Array(b)) >= 0;
        if (has([0x1a, 0x87, 0x09, 0x71])) schemes.push('v2');
        if (has([0xc0, 0x68, 0x53, 0xf0])) schemes.push('v3');
        if (has([0x61, 0xad, 0x93, 0x1b])) schemes.push('v3.1');
        if (!schemes.length) schemes.push('v2+');
      }
    } catch (_) { /* ignore */ }
  }
  if (contentNames && contentNames.some((n) => /^META-INF\/.+\.(RSA|DSA|EC)$/i.test(n))) schemes.unshift('v1 (JAR)');
  if (schemes.length) fields['Signature'] = 'APK Signature Scheme ' + schemes.join(', ');

  if (permissions.length) fields['Permissions'] = String(permissions.length);

  // --- Collapsible detail blocks (permissions, features, full contents) ---
  const parts = [];
  if (permissions.length) {
    const shown = permissions.map((p) => p.replace(/^android\.permission\./, ''));
    parts.push(apkDetailsBlock('Permissions (' + permissions.length + ')', shown));
  }
  if (features.length) parts.push(apkDetailsBlock('Features (' + features.length + ')', features));
  if (contentNames && contentNames.length) {
    parts.push(apkDetailsBlock('Package contents (' + contentNames.length + ' entries)', contentNames));
  }
  if (parts.length) fields['_previewNode'] = el('div', {}, parts);

  return fields;
}

// ---------- Generic text version detection ----------
async function parseTextVersion(file) {
  try {
    const text = await file.slice(0, 4096).text();
    const lines = text.split('\n').slice(0, 20);
    const fields = {};
    for (const line of lines) {
      const ver = line.match(/(?:version|ver)[:\s=]+([0-9][0-9.a-z-]*)/i);
      if (ver && !fields['Version']) fields['Version'] = ver[1];
      const gen = line.match(/(?:generator|creator|created.?(?:with|by)|application)[:\s=]+(.{2,60})/i);
      if (gen && !fields['Creator']) fields['Creator'] = gen[1].trim().replace(/[";]/g, '');
    }
    return Object.keys(fields).length ? fields : null;
  } catch (_) {
    return null;
  }
}

// ---------- Gzipped XML project (Ableton .als, Premiere .prproj) ----------
async function parseGzipXmlProject(file, ext) {
  try {
    const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
    if (head[0] !== 0x1F || head[1] !== 0x8B) return null;
    if (typeof DecompressionStream === 'undefined') return null;
    // Premiere projects can be large; read a generous decompressed window so the
    // sequence / media counts are representative. Ableton sets are small.
    const isPremiere = (ext === 'prproj' || ext === 'prel');
    const limit = isPremiere ? 6 * 1024 * 1024 : 8192;
    const chunk = file.slice(0, Math.min(file.size, isPremiere ? 16 * 1024 * 1024 : 65536));
    const ds = new DecompressionStream('gzip');
    const reader = chunk.stream().pipeThrough(ds).getReader();
    let xml = '';
    while (xml.length < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      xml += new TextDecoder().decode(value, { stream: true });
    }
    reader.cancel().catch(() => {});
    const fields = {};
    if (ext === 'als' || ext === 'alp') {
      const ver = xml.match(/Creator="([^"]+)"/);
      if (ver) fields['Creator'] = ver[1];
      const schema = xml.match(/SchemaChangeCount="(\d+)"/);
      if (schema) fields['Schema version'] = schema[1];
      return Object.keys(fields).length ? fields : null;
    }

    // Premiere Pro (.prproj) / Premiere Elements (.prel) - PremiereData XML model.
    fields['Application'] = ext === 'prel' ? 'Adobe Premiere Elements' : 'Adobe Premiere Pro';
    const ver = xml.match(/<Project[^>]*\bVersion="([^"]+)"/) || xml.match(/\bVersion="([^"]+)"/);
    if (ver) fields['Project version'] = ver[1];
    const app = xml.match(/<Application>([^<]+)</) || xml.match(/ApplicationBuildVersion>([^<]+)</);
    if (app) fields['Created with'] = app[1];
    const build = xml.match(/<Build>([^<]+)</) || xml.match(/AppVersion>([^<]+)</);
    if (build) fields['Build'] = build[1];

    // Sequences: each timeline is a <Sequence> object in the model.
    const seqCount = (xml.match(/<Sequence\b/g) || []).length;
    if (seqCount) fields['Sequences'] = seqCount;

    // Media items: <Media>, <VideoClip>, <AudioClip> reference clips on the
    // timeline; <MasterClip> / <ClipProjectItem> are project-bin media items.
    const masterClips = (xml.match(/<MasterClip\b/g) || []).length;
    const projItems = (xml.match(/<ProjectItem\b/g) || xml.match(/<ClipProjectItem\b/g) || []).length;
    const mediaItems = masterClips || projItems;
    if (mediaItems) fields['Media items'] = mediaItems;
    const clips = (xml.match(/<(?:Video|Audio)Clip\b/g) || []).length;
    if (clips) fields['Timeline clips'] = clips;

    // Frame rate (Premiere stores ticks/frame = TIcksPerSecond/fps; 254016000000
    // ticks per second). Surface FrameRate if present as plain text.
    const tsm = xml.match(/<FrameRate>(\d+)<\/FrameRate>/) || xml.match(/Timebase>(\d+)</);
    if (tsm) {
      const tb = parseInt(tsm[1], 10);
      const fps = 254016000000 / tb;
      if (isFinite(fps) && fps > 0 && fps < 1000) fields['Frame rate'] = (Math.round(fps * 1000) / 1000) + ' fps';
      else fields['Frame rate'] = tsm[1];
    }
    const wh = xml.match(/<Width>(\d+)<\/Width>[\s\S]{0,200}?<Height>(\d+)<\/Height>/) ||
               xml.match(/FrameWidth>(\d+)<[\s\S]{0,200}?FrameHeight>(\d+)</);
    if (wh) fields['Resolution'] = wh[1] + ' x ' + wh[2] + ' px';

    // Referenced media file paths (FilePath / ActualMediaFilePath / pathurls).
    const paths = [...new Set([
      ...[...xml.matchAll(/<(?:ActualMediaFilePath|FilePath|RelativePath)>([^<]+)</g)].map(m => m[1]),
      ...[...xml.matchAll(/<PathURL>([^<]+)</g)].map(m => m[1]),
    ])].map(p => p.replace(/&amp;/g, '&').replace(/^file:\/+/, '/'));
    if (paths.length) {
      fields['Referenced media'] = paths.length;
      fields._sections = [{ title: 'Referenced media (' + paths.length + ')',
        node: preBlock(paths.slice(0, 60).join('\n')) }];
    }
    return Object.keys(fields).length ? fields : null;
  } catch (_) {
    return null;
  }
}

// ---------- Torrent ----------
async function parseTorrent(file) {
  try {
    const raw = new Uint8Array(await file.arrayBuffer());
    let pos = 0;
    const td = new TextDecoder('latin1');
    function peek() { return td.decode(raw.subarray(pos, pos + 1)); }
    function decode() {
      if (pos >= raw.length) return null;
      const ch = peek();
      if (ch === 'i') {
        pos++;
        let end = pos;
        while (end < raw.length && raw[end] !== 0x65) end++;
        const val = parseInt(td.decode(raw.subarray(pos, end)), 10);
        pos = end + 1;
        return val;
      }
      if (ch === 'l') {
        pos++;
        const list = [];
        while (pos < raw.length && peek() !== 'e') list.push(decode());
        pos++;
        return list;
      }
      if (ch === 'd') {
        pos++;
        const dict = {};
        while (pos < raw.length && peek() !== 'e') {
          const key = decode();
          dict[key] = decode();
        }
        pos++;
        return dict;
      }
      let colonIdx = pos;
      while (colonIdx < raw.length && raw[colonIdx] !== 0x3A) colonIdx++;
      const len = parseInt(td.decode(raw.subarray(pos, colonIdx)), 10);
      pos = colonIdx + 1;
      const data = raw.subarray(pos, pos + len);
      pos += len;
      return td.decode(data);
    }
    const torrent = decode();
    if (!torrent || typeof torrent !== 'object') return null;
    const fields = {};
    if (torrent.announce) fields['Tracker'] = torrent.announce;
    const info = torrent.info;
    if (info) {
      if (info.name) fields['Name'] = info.name.slice(0, 200);
      if (info['piece length']) fields['Piece size'] = fmtBytes(info['piece length']);
      if (info.pieces) fields['Pieces'] = Math.floor(info.pieces.length / 20);
      if (info.length) {
        fields['Total size'] = fmtBytes(info.length);
      } else if (info.files) {
        const total = info.files.reduce((s, f) => s + (f.length || 0), 0);
        fields['Total size'] = fmtBytes(total);
        fields['Files'] = info.files.length;
        const fileList = info.files.slice(0, 20).map(f => {
          const path = Array.isArray(f.path) ? f.path.join('/') : f.path;
          return path + '  (' + fmtBytes(f.length) + ')';
        });
        if (info.files.length > 20) fileList.push('… and ' + (info.files.length - 20) + ' more');
        fields['_fileList'] = fileList;
      }
    }
    if (torrent['created by']) fields['Created by'] = torrent['created by'];
    if (torrent['creation date']) {
      fields['Created'] = new Date(torrent['creation date'] * 1000).toISOString().slice(0, 19).replace('T', ' ');
    }
    if (torrent.comment) fields['Comment'] = torrent.comment.slice(0, 300);
    if (torrent['announce-list'] && Array.isArray(torrent['announce-list'])) {
      const trackers = torrent['announce-list'].flat().filter(Boolean);
      if (trackers.length > 1) fields['Trackers'] = trackers.length;
    }
    if (torrent.nodes) fields['DHT'] = 'Yes (' + torrent.nodes.length + ' nodes)';
    return Object.keys(fields).length ? fields : null;
  } catch (_) {
    return null;
  }
}

// ---------- GCode ----------
async function parseGcode(file) {
  try {
    // Read a generous window so machining stats (tools, bounding box) are
    // representative, plus the tail (slicers/CAM often summarise at the end).
    const scanSize = Math.min(file.size, 2 * 1024 * 1024);
    const mainText = await file.slice(0, scanSize).text();
    const tailText = file.size > scanSize
      ? await file.slice(file.size - 8192).text() : '';
    const text = mainText + '\n' + tailText;
    const truncated = file.size > scanSize;

    // --- 3D-printing vs CNC discrimination ---
    const hasExtrusion = /(?:^|\s)G[01]\b[^;\n]*\bE-?\d/m.test(mainText);
    const hasTemp = /\bM(?:104|109|140|190)\b/.test(mainText);
    const slicerHit = /(PrusaSlicer|OrcaSlicer|BambuStudio|SuperSlicer|Simplify3D|Cura_SteamEngine|Slic3r|KISSlicer|IdeaMaker)/i.test(text);
    const isPrinting = hasExtrusion || hasTemp || slicerHit;

    if (isPrinting) return parseGcodePrinting(text);
    return parseGcodeCnc(text, truncated);
  } catch (_) {
    return null;
  }
}

// 3D-printing G-code (slicer, nozzle/bed temps, filament, dimensions).
function parseGcodePrinting(text) {
  const fields = { 'G-code type': '3D printing (FFF/FDM)' };
  const slicerPatterns = [
    /generated by (PrusaSlicer[^\n]*)/i, /generated by (OrcaSlicer[^\n]*)/i,
    /generated by (BambuStudio[^\n]*)/i, /generated by (SuperSlicer[^\n]*)/i,
    /generated by (Simplify3D[^\n]*)/i, /Generated with (Cura_SteamEngine[^\n]*)/i,
    /generated by (Slic3r[^\n]*)/i, /(KISSlicer[^\n]*)/i, /(IdeaMaker[^\n]*)/i,
  ];
  for (const re of slicerPatterns) {
    const m = text.match(re);
    if (m) { fields['Slicer'] = m[1].trim(); break; }
  }
  const kvPat = [
    [/;\s*printer_model\s*=\s*(.+)/i, 'Printer'],
    [/;\s*nozzle_diameter\s*=\s*([0-9.]+)/i, 'Nozzle'],
    [/;\s*layer_height\s*=\s*([0-9.]+)/i, 'Layer height'],
    [/;\s*fill_density\s*=\s*(.+)/i, 'Infill'],
    [/;\s*filament_type\s*=\s*(.+)/i, 'Filament'],
    [/;\s*(?:bed_temperature|first_layer_bed_temperature)\s*=\s*(\d+)/i, 'Bed temp'],
    [/;\s*(?:temperature|first_layer_temperature)\s*=\s*(\d+)/i, 'Nozzle temp'],
    [/;\s*estimated\s+printing\s+time[^=]*=\s*(.+)/i, 'Print time'],
    [/;\s*filament\s+used\s*\[mm\]\s*=\s*([0-9.]+)/i, 'Filament (mm)'],
    [/;\s*filament\s+used\s*\[g\]\s*=\s*([0-9.]+)/i, 'Filament (g)'],
    [/;\s*filament\s+used\s*\[cm3\]\s*=\s*([0-9.]+)/i, 'Filament (cm³)'],
    [/;\s*(?:total\s+)?layer(?:s|\s+count)?\s*[:=]\s*(\d+)/i, 'Layers'],
    [/;LAYER_COUNT:(\d+)/i, 'Layers'],
    [/;\s*perimeters\s*=\s*(\d+)/i, 'Perimeters'],
  ];
  for (const [re, label] of kvPat) {
    const m = text.match(re);
    if (m && !fields[label]) fields[label] = m[1].trim();
  }
  const g = (re) => { const m = text.match(re); return m ? parseFloat(m[1]) : null; };
  const minx = g(/;\s*MINX:([0-9.-]+)/i), maxx = g(/;\s*MAXX:([0-9.-]+)/i);
  const miny = g(/;\s*MINY:([0-9.-]+)/i), maxy = g(/;\s*MAXY:([0-9.-]+)/i);
  const maxz = g(/;\s*MAXZ:([0-9.-]+)/i);
  if (minx != null && maxx != null && miny != null && maxy != null) {
    let dims = (maxx - minx).toFixed(1) + ' × ' + (maxy - miny).toFixed(1);
    if (maxz != null) dims += ' × ' + maxz.toFixed(1);
    fields['Print size'] = dims + ' mm';
  }
  if (fields['Nozzle']) fields['Nozzle'] += ' mm';
  if (fields['Layer height']) fields['Layer height'] += ' mm';
  if (fields['Bed temp']) fields['Bed temp'] += ' °C';
  if (fields['Nozzle temp']) fields['Nozzle temp'] += ' °C';
  return fields;
}

// CNC / machining G-code: identify the CAM post, controller, machine type, and
// pull machining statistics (units, tools, spindle, feeds, work offsets, extent).
function parseGcodeCnc(text, truncated) {
  const fields = {};

  // --- CAM software / post-processor (from header comments) ---
  const camPatterns = [
    [/\(T\d+\s+D=[\d.]+\s+CR=/i, 'Autodesk Fusion 360 / HSM'],
    [/Autodesk\s+(?:Fusion|HSM|Inventor\s+CAM)/i, 'Autodesk Fusion 360 / HSM'],
    [/MASTERCAM|\(MCX FILE/i, 'Mastercam'],
    [/Exported by FreeCAD|FreeCAD\s+Path/i, 'FreeCAD Path'],
    [/Vectric|VCarve|Aspire|PhotoVCarve/i, 'Vectric (VCarve / Aspire)'],
    [/Carbide Create/i, 'Carbide Create'],
    [/Estlcam/i, 'Estlcam'],
    [/SheetCam/i, 'SheetCam'],
    [/LightBurn/i, 'LightBurn'],
    [/Generated by Easel|;\s*Easel/i, 'Easel (Inventables)'],
    [/PowerMILL|Delcam/i, 'Autodesk PowerMill'],
    [/SolidCAM/i, 'SolidCAM'],
    [/(?:^|\n)\s*\(?\s*SprutCAM/i, 'SprutCAM'],
    [/Bantam|Othermill/i, 'Bantam Tools'],
    [/bCNC/i, 'bCNC'],
  ];
  for (const [re, name] of camPatterns) {
    if (re.test(text)) { fields['CAM software'] = name; break; }
  }

  // --- Controller / dialect ---
  const hasOprog = /(?:^|\n)\s*O\d{1,5}\b/.test(text) || /^%\s*$/m.test(text);
  const hasGrblCfg = /\$[0-9]+\s*=|\$\$|\$H\b|\$G\b/.test(text);
  if (hasGrblCfg) fields['Controller'] = 'GRBL';
  else if (hasOprog) fields['Controller'] = 'Fanuc / Haas style (O-numbered, %-wrapped)';

  // --- Units ---
  const inch = /\bG20\b/.test(text), mm = /\bG21\b/.test(text);
  const unit = inch && !mm ? 'in' : 'mm';
  fields['Units'] = inch && !mm ? 'Inch (G20)' : mm ? 'Millimetre (G21)' : 'Unspecified';

  // --- Motion / feature flags ---
  const hasArcs = /\bG0?[23]\b/.test(text);
  const cannedCycle = /\bG8[1-9]\b/.test(text);
  const hasSpindle = /\bM0?[34]\b/.test(text);
  const hasCoolant = /\bM0?[78]\b/.test(text);
  const hasY = /(?:^|\s)Y-?\d/m.test(text);
  const hasZ = /(?:^|\s)Z-?\d/m.test(text);
  const hasX = /(?:^|\s)X-?\d/m.test(text);
  const isLaserPlasma = /LightBurn|laser|plasma|SheetCam/i.test(text) ||
    (hasSpindle && !hasZ && /\bM0?[34]\b[^;\n]*S/i.test(text));

  // --- Machine type inference ---
  let machine;
  if (/LightBurn|\blaser\b/i.test(text)) machine = 'Laser cutter / engraver';
  else if (/plasma|SheetCam/i.test(text)) machine = 'Plasma / oxy-fuel cutter';
  else if (hasX && hasZ && !hasY) machine = 'CNC lathe / turning';
  else if (cannedCycle && !hasArcs) machine = 'CNC drilling';
  else if (hasZ && (hasArcs || hasSpindle)) machine = 'CNC mill / router (3-axis)';
  else if (isLaserPlasma) machine = 'Laser / plasma (2-axis)';
  else machine = 'CNC machining (generic)';
  fields['G-code type'] = 'CNC machining';
  fields['Likely machine'] = machine;

  // --- Stats over motion lines ---
  const lines = text.split('\n');
  let maxS = 0, maxF = 0, absolute = true, relativeSeen = false;
  const tools = new Set(), offsets = new Set();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const numAfter = (line, letter) => {
    const m = line.match(new RegExp(letter + '\\s*(-?\\d+\\.?\\d*)'));
    return m ? parseFloat(m[1]) : null;
  };
  for (let raw of lines) {
    const line = raw.replace(/\(.*?\)/g, '').replace(/;.*$/, '').trim();
    if (!line) continue;
    if (/\bG90\b/.test(line)) absolute = true;
    if (/\bG91\b/.test(line)) { absolute = false; relativeSeen = true; }
    const sM = line.match(/\bS(\d+\.?\d*)/); if (sM) maxS = Math.max(maxS, parseFloat(sM[1]));
    const fM = line.match(/\bF(\d+\.?\d*)/); if (fM) maxF = Math.max(maxF, parseFloat(fM[1]));
    const tM = line.match(/\bT(\d+)/); if (tM && /\bM0?6\b/.test(line) || (tM && /^T\d+$/.test(line))) tools.add(parseInt(tM[1], 10));
    const wM = line.match(/\bG5[4-9]\b/); if (wM) offsets.add(wM[0]);
    if (absolute && /\bG0?[0-3]\b/.test(line)) {
      const x = numAfter(line, 'X'), y = numAfter(line, 'Y'), z = numAfter(line, 'Z');
      if (x != null) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
      if (y != null) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      if (z != null) { minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    }
  }

  if (tools.size) fields['Tools used'] = tools.size + ' (T' + [...tools].sort((a, b) => a - b).join(', T') + ')';
  if (offsets.size) fields['Work offsets'] = [...offsets].sort().join(', ');
  if (maxS) fields['Max spindle / power'] = maxS + (isLaserPlasma ? ' (S)' : ' RPM');
  if (maxF) fields['Max feed rate'] = maxF + ' ' + unit + '/min';
  if (hasCoolant) fields['Coolant'] = 'Yes (M7/M8)';
  fields['Arc moves'] = hasArcs ? 'Yes (G2/G3)' : 'No';
  if (cannedCycle) fields['Canned cycles'] = 'Yes (drilling/boring)';

  if (!relativeSeen && minX !== Infinity && minY !== Infinity) {
    let ext = (maxX - minX).toFixed(2) + ' × ' + (maxY - minY).toFixed(2);
    if (minZ !== Infinity) ext += ' × ' + (maxZ - minZ).toFixed(2);
    fields['Extent (X×Y×Z)'] = ext + ' ' + unit;
    if (minZ !== Infinity) fields['Z range'] = minZ.toFixed(2) + ' to ' + maxZ.toFixed(2) + ' ' + unit;
  }
  fields['Lines scanned'] = lines.length.toLocaleString() + (truncated ? ' (file truncated for analysis)' : '');
  return fields;
}

// ---------- Log file origin ----------
async function parseLogOrigin(file) {
  try {
    const text = await file.slice(0, 8192).text();
    const lines = text.split('\n').filter(l => l.trim()).slice(0, 30);
    if (!lines.length) return null;
    const fields = {};
    const patterns = [
      { name: 'Apache / Nginx access log',
        re: /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\s.*\[\d{2}\/[A-Z][a-z]{2}\/\d{4}:\d{2}:\d{2}:\d{2}/ },
      { name: 'Nginx error log',
        re: /^\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2}\s+\[(emerg|alert|crit|error|warn|notice|info|debug)\]/ },
      { name: 'Apache error log',
        re: /^\[[A-Z][a-z]{2}\s[A-Z][a-z]{2}\s\d{2}\s\d{2}:\d{2}:\d{2}/ },
      { name: 'Syslog',
        re: /^[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\S+\s+\S+/ },
      { name: 'Python logging',
        re: /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[,.]\d{3}\s+(DEBUG|INFO|WARNING|ERROR|CRITICAL)\s/ },
      { name: 'Java / Log4j',
        re: /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[,.]\d{3}\s+(TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\s+\[/ },
      { name: 'IIS W3C log',
        re: /^#Software:\s*Microsoft|^#Fields:\s*date\s+time\s+s-/i },
      { name: 'Android logcat',
        re: /^\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3}\s+\d+\s+\d+\s+[VDIWEF]\s/ },
      { name: 'JSON structured log',
        re: /^\s*\{.*"(timestamp|time|@timestamp|ts|level|severity|msg|message)":/ },
      { name: 'AWS CloudWatch / Lambda',
        re: /^(START|END|REPORT)\s+RequestId:|^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\s+[a-f0-9-]+\s/ },
      { name: 'Docker container log',
        re: /^\{"log":".*","stream":"(stdout|stderr)","time":"/ },
    ];
    let matched = null, matchCount = 0;
    for (const pat of patterns) {
      let hits = 0;
      for (const line of lines) if (pat.re.test(line)) hits++;
      if (hits > matchCount) { matchCount = hits; matched = pat; }
    }
    if (matched && matchCount >= Math.min(2, lines.length)) {
      fields['Log format'] = matched.name;
      fields['Confidence'] = Math.round((matchCount / lines.length) * 100) + '%';
    }
    const levelCounts = {};
    const levelRe = /\b(TRACE|DEBUG|INFO|NOTICE|WARNING|WARN|ERROR|CRITICAL|FATAL|EMERG|ALERT|CRIT)\b/gi;
    for (const line of lines) {
      const m = line.match(levelRe);
      if (m) { const lvl = m[0].toUpperCase(); levelCounts[lvl] = (levelCounts[lvl] || 0) + 1; }
    }
    if (Object.keys(levelCounts).length)
      fields['Log levels (sample)'] = Object.entries(levelCounts)
        .sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ': ' + v).join(', ');
    const ips = new Set();
    for (const line of lines) {
      const ipMatch = line.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g);
      if (ipMatch) for (const ip of ipMatch) ips.add(ip);
    }
    if (ips.size) fields['IPs (sample)'] = ips.size + ' unique';
    fields['Lines (sample)'] = lines.length + (file.size > 8192 ? '+' : '');
    return Object.keys(fields).length > 1 ? fields : null;
  } catch (_) { return null; }
}

// ---------- STEP / IGES text peek ----------

// Split a STEP entity's argument list into top-level args, respecting nested
// parentheses and quoted strings ('' is an escaped quote inside a STEP string).
function splitStepArgs(s) {
  const args = [];
  let depth = 0, inStr = false, cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      cur += c;
      if (c === "'") { if (s[i + 1] === "'") { cur += "'"; i++; } else inStr = false; }
    } else if (c === "'") { inStr = true; cur += c; }
    else if (c === '(') { depth++; cur += c; }
    else if (c === ')') { depth--; cur += c; }
    else if (c === ',' && depth === 0) { args.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  if (cur.trim()) args.push(cur.trim());
  return args;
}

// Strip ISO 10303-21 comments (/* ... */) that sit outside string literals.
// STEP permits them anywhere, including between an entity's arguments, e.g.
// FILE_NAME(/* name */ 'part.step', /* originating_system */ 'Fusion', ...).
// Left in place they get captured as part of each argument value, so remove
// them up front - taking care to honour string literals (with the doubled-''
// escape) so a /* sequence inside a quoted string is preserved.
function stripStepComments(text) {
  let out = '', i = 0, inStr = false;
  while (i < text.length) {
    const c = text[i];
    if (inStr) {
      out += c; i++;
      if (c === "'") {
        if (text[i] === "'") { out += "'"; i++; } // escaped doubled quote
        else inStr = false;
      }
    } else if (c === "'") {
      inStr = true; out += c; i++;
    } else if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2; // skip the closing */
    } else {
      out += c; i++;
    }
  }
  return out;
}

// Pull the (...) body of a STEP header entity by name, e.g. FILE_NAME(...).
function stepEntityBody(text, name) {
  const m = new RegExp(name + '\\s*\\(', 'i').exec(text);
  if (!m) return null;
  let i = text.indexOf('(', m.index);
  const start = i + 1;
  let depth = 0, inStr = false;
  for (; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (c === "'") { if (text[i + 1] === "'") i++; else inStr = false; } }
    else if (c === "'") inStr = true;
    else if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return text.slice(start, i); }
  }
  return null;
}

// Decode a STEP string literal: strip quotes, unescape '' and the \X2\..\X0\ /
// \X\ unicode forms. '$' and '*' are the "unset" markers, treated as empty.
function stepStr(tok) {
  if (!tok) return '';
  tok = tok.trim();
  if (tok === '$' || tok === '*') return '';
  const m = tok.match(/^'([\s\S]*)'$/);
  if (!m) return tok;
  return m[1].replace(/''/g, "'")
    .replace(/\\X2\\([0-9A-Fa-f]+)\\X0\\/g, (_, h) => { let o = ''; for (let k = 0; k < h.length; k += 4) o += String.fromCharCode(parseInt(h.substr(k, 4), 16)); return o; })
    .replace(/\\X\\([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .trim();
}

// A STEP arg that is a list of strings, e.g. ('Alice','Bob') -> ['Alice','Bob'].
function stepStrList(tok) {
  if (!tok) return [];
  const inner = tok.trim().replace(/^\(/, '').replace(/\)$/, '');
  return splitStepArgs(inner).map(stepStr).filter(Boolean);
}

// Normalise an originating-system / preprocessor string to a known CAD product.
function detectCadApp(s) {
  const u = (s || '').toUpperCase();
  const map = [
    [/SOLIDWORKS/, 'SolidWorks'],
    [/CATIA/, 'CATIA'],
    [/UNIGRAPHICS|\bNX\b|SIEMENS\s*NX/, 'Siemens NX'],
    [/SOLID\s*EDGE/, 'Solid Edge'],
    [/CREO|PRO\/?ENGINEER|PRO-ENGINEER|PRO\/E/, 'PTC Creo / Pro-ENGINEER'],
    [/INVENTOR/, 'Autodesk Inventor'],
    [/FUSION/, 'Autodesk Fusion'],
    [/AUTOCAD/, 'AutoCAD'],
    [/SPACECLAIM/, 'ANSYS SpaceClaim'],
    [/ONSHAPE/, 'Onshape'],
    [/FREECAD/, 'FreeCAD'],
    [/RHINOCEROS|RHINO3D|\bRHINO\b/, 'Rhino'],
    [/KOMPAS/, 'KOMPAS-3D'],
    [/BRICSCAD/, 'BricsCAD'],
    [/SKETCHUP/, 'SketchUp'],
    [/TINKERCAD/, 'Tinkercad'],
    [/OPEN\s*CASCADE|OPENCASCADE|OCCT/, 'Open CASCADE'],
    [/ST-DEVELOPER|STEP\s*TOOLS/, 'ST-Developer (STEP Tools)'],
    [/DASSAULT/, 'Dassault Systèmes'],
    [/AUTODESK/, 'Autodesk'],
  ];
  for (const [re, label] of map) if (re.test(u)) return label;
  return null;
}

// Map a FILE_SCHEMA name (or its embedded ISO 10303 part number) to its friendly
// STEP application protocol.
function stepProtocol(schema) {
  const u = (schema || '').toUpperCase();
  if (/MANAGED_MODEL_BASED_3D_ENGINEERING/.test(u) || /10303\s+242/.test(u)) return 'AP242 - Managed model-based 3D engineering';
  if (/AUTOMOTIVE_DESIGN/.test(u) || /10303\s+214/.test(u)) return 'AP214 - Automotive mechanical design';
  if (/CONFIG_CONTROL_DESIGN/.test(u) || /10303\s+203/.test(u)) return 'AP203 - Configuration-controlled 3D design';
  if (/STRUCTURAL_ANALYSIS_DESIGN/.test(u) || /10303\s+209/.test(u)) return 'AP209 - Multidisciplinary analysis & design';
  if (/ELECTRONIC_ASSEMBLY_INTERCONNECT|10303\s+210/.test(u)) return 'AP210 - Electronic assembly & interconnect';
  if (/SHIP_/.test(u) || /10303\s+21[567]/.test(u)) return 'AP215/216/217 - Ship structures';
  return null;
}

// Parse the ISO-10303-21 HEADER (FILE_DESCRIPTION / FILE_NAME / FILE_SCHEMA),
// surfacing the originating CAD system + version, preprocessor, author, schema
// and application protocol.
export function parseStepHeader(text) {
  text = stripStepComments(text);
  const fdBody = stepEntityBody(text, 'FILE_DESCRIPTION');
  const fnBody = stepEntityBody(text, 'FILE_NAME');
  const fsBody = stepEntityBody(text, 'FILE_SCHEMA');

  let descList = [], impl = '';
  if (fdBody) { const a = splitStepArgs(fdBody); descList = stepStrList(a[0]); impl = stepStr(a[1]); }

  // FILE_NAME(name, time_stamp, (authors), (orgs), preprocessor, originating_system, authorization)
  let name = '', ts = '', authors = [], orgs = [], preproc = '', origSys = '', auth = '';
  if (fnBody) {
    const a = splitStepArgs(fnBody);
    name = stepStr(a[0]); ts = stepStr(a[1]);
    authors = stepStrList(a[2]); orgs = stepStrList(a[3]);
    preproc = stepStr(a[4]); origSys = stepStr(a[5]); auth = stepStr(a[6]);
  }

  let schema = '', proto = '';
  if (fsBody) { schema = stepStrList(fsBody).join(', '); proto = stepProtocol(schema); }

  const app = detectCadApp(origSys + ' ' + preproc);

  const fields = {};
  if (app) fields['CAD software'] = app;
  if (origSys) fields['Originating system'] = origSys;
  if (preproc) fields['Preprocessor'] = preproc;
  if (proto) fields['Application protocol'] = proto;
  if (schema) fields['Schema'] = schema;
  if (name) fields['Model name'] = name;
  if (authors.length) fields['Author'] = authors.join(', ');
  if (orgs.length) fields['Organisation'] = orgs.join(', ');
  if (ts) fields['Exported'] = ts;
  if (auth && auth.toLowerCase() !== 'none') fields['Authorization'] = auth;
  if (descList.length) fields['Description'] = descList.join('; ');
  if (impl) fields['Implementation level'] = impl;
  return Object.keys(fields).length ? fields : null;
}

async function parseTextCad(file, format) {
  try {
    // The HEADER sits at the very start; read generously so a long
    // FILE_DESCRIPTION / author list still fits before the DATA section.
    const text = await file.slice(0, format === 'STEP' ? 32768 : 4096).text();
    if (format === 'STEP') return parseStepHeader(text);
    if (format === 'IGES') {
      const fields = {};
      const lines = text.split('\n');
      if (lines.length > 0) {
        const start = lines[0];
        if (start.length >= 72) {
          fields['Sending system'] = start.slice(24, 48).trim() || undefined;
        }
      }
      return Object.keys(fields).length ? fields : null;
    }
    return null;
  } catch (_) {
    return null;
  }
}

// ---------- MSI (Windows Installer, OLE compound) ----------
function parseMsi(head) {
  if (head.length < 8 || head[0] !== 0xD0 || head[1] !== 0xCF || head[2] !== 0x11 || head[3] !== 0xE0) {
    return { 'Type': 'Windows Installer (MSI)' };
  }
  const fields = { 'Type': 'Windows Installer database (OLE)' };
  const ole = parseOle(head);
  if (ole) Object.assign(fields, ole);
  // The SummaryInformation property set stores a Template like "Intel;1033" or
  // "x64;1033" (platform;language) - scan the header bytes for it.
  try {
    const txt = new TextDecoder('latin1').decode(head);
    const tmpl = txt.match(/(Intel64|Intel|x64|Arm64|Arm);(\d{3,5})/);
    if (tmpl) {
      fields['Platform'] = tmpl[1] === 'Intel' ? 'x86 (32-bit)' : tmpl[1];
      fields['Language'] = tmpl[2];
    }
  } catch (_) {}
  return fields;
}

// ---------- X.509 certificate (PEM / DER) ----------
function parseCert(file) {
  return file.arrayBuffer().then((ab) => {
    let der = new Uint8Array(ab);
    const fields = {};
    // PEM? (ASCII armour). Decode the base64 body of the first block.
    const headStr = new TextDecoder('latin1').decode(der.subarray(0, 64));
    if (headStr.indexOf('-----BEGIN') !== -1) {
      const full = new TextDecoder('latin1').decode(der);
      const m = full.match(/-----BEGIN ([^-]+)-----([\s\S]*?)-----END/);
      if (m) {
        fields['Encoding'] = 'PEM';
        fields['Block'] = m[1].trim();
        if (/PRIVATE KEY/.test(m[1])) {
          fields['Contains'] = 'Private key';
          return fields; // don't try to ASN.1-parse a key as a cert
        }
        try { der = Uint8Array.from(atob(m[2].replace(/\s+/g, '')), (ch) => ch.charCodeAt(0)); }
        catch (_) { return fields; }
      }
    } else {
      fields['Encoding'] = 'DER (binary)';
    }
    try {
      const info = parseX509(der);
      if (info) Object.assign(fields, info);
    } catch (_) {}
    return Object.keys(fields).length ? fields : null;
  }).catch(() => null);
}

// Minimal ASN.1 DER walker, just enough to pull the interesting fields out of an
// X.509 certificate (serial, validity, issuer/subject CN, algorithms, key size).
function parseX509(der) {
  let p = 0;
  function readLen() {
    let len = der[p++];
    if (len & 0x80) {
      const n = len & 0x7F;
      len = 0;
      for (let i = 0; i < n; i++) len = (len << 8) | der[p++];
    }
    return len;
  }
  function readTLV() {
    const tag = der[p++];
    const len = readLen();
    const start = p;
    p += len;
    return { tag, len, start, end: start + len };
  }
  function oidToStr(start, end) {
    const bytes = der.subarray(start, end);
    const parts = [Math.floor(bytes[0] / 40), bytes[0] % 40];
    let val = 0;
    for (let i = 1; i < bytes.length; i++) {
      val = (val << 7) | (bytes[i] & 0x7F);
      if (!(bytes[i] & 0x80)) { parts.push(val); val = 0; }
    }
    return parts.join('.');
  }
  const OIDS = {
    '1.2.840.113549.1.1.1': 'RSA', '1.2.840.113549.1.1.11': 'SHA-256 with RSA',
    '1.2.840.113549.1.1.5': 'SHA-1 with RSA', '1.2.840.113549.1.1.12': 'SHA-384 with RSA',
    '1.2.840.113549.1.1.13': 'SHA-512 with RSA', '1.2.840.10045.2.1': 'EC',
    '1.2.840.10045.4.3.2': 'ECDSA with SHA-256', '1.2.840.10045.4.3.3': 'ECDSA with SHA-384',
    '2.5.4.3': 'CN', '2.5.4.10': 'O', '2.5.4.11': 'OU', '2.5.4.6': 'C',
  };
  function readName(end) {
    // SEQUENCE of RDNs; pull out CN/O if present.
    const parts = [];
    while (p < end) {
      const set = readTLV();             // SET
      const setEnd = set.end;
      while (p < setEnd) {
        const seq = readTLV();           // SEQUENCE { OID, value }
        const oid = readTLV();
        const oidStr = oidToStr(oid.start, oid.end);
        const val = readTLV();
        const text = new TextDecoder().decode(der.subarray(val.start, val.end));
        const key = OIDS[oidStr];
        if (key === 'CN') parts.unshift(text);
        else if (key === 'O') parts.push(text);
        p = seq.end;
      }
    }
    return parts.join(', ');
  }
  function readTime(tlv) {
    const s = new TextDecoder().decode(der.subarray(tlv.start, tlv.end));
    // UTCTime YYMMDDHHMMSSZ or GeneralizedTime YYYYMMDD...
    let yr, rest;
    if (tlv.tag === 0x17) { yr = parseInt(s.slice(0, 2), 10); yr += yr < 50 ? 2000 : 1900; rest = s.slice(2); }
    else { yr = parseInt(s.slice(0, 4), 10); rest = s.slice(4); }
    const mo = rest.slice(0, 2), da = rest.slice(2, 4), hh = rest.slice(4, 6), mm = rest.slice(6, 8);
    return yr + '-' + mo + '-' + da + ' ' + hh + ':' + mm;
  }

  const fields = {};
  const cert = readTLV();              // Certificate SEQUENCE
  const tbs = readTLV();               // TBSCertificate SEQUENCE
  const tbsEnd = tbs.end;
  // [0] version (optional, EXPLICIT)
  if (der[p] === 0xA0) { const v = readTLV(); const vi = readTLV(); fields['Version'] = 'v' + (der[vi.start] + 1); }
  const serial = readTLV();            // INTEGER serial
  const serialHex = Array.from(der.subarray(serial.start, serial.end)).map(b => b.toString(16).padStart(2, '0')).join(':');
  if (serialHex) fields['Serial'] = serialHex.length > 48 ? serialHex.slice(0, 48) + '…' : serialHex;
  const sigAlg = readTLV();            // SEQUENCE { OID }
  const sigOid = readTLV();
  fields['Signature'] = OIDS[oidToStr(sigOid.start, sigOid.end)] || oidToStr(sigOid.start, sigOid.end);
  p = sigAlg.end;
  const issuer = readTLV();            // issuer Name
  const issuerStr = readName(issuer.end);
  if (issuerStr) fields['Issuer'] = issuerStr;
  p = issuer.end;
  const validity = readTLV();          // SEQUENCE { notBefore, notAfter }
  const nb = readTLV(); fields['Valid from'] = readTime(nb); p = nb.end;
  const na = readTLV(); fields['Valid to'] = readTime(na); p = validity.end;
  const subject = readTLV();           // subject Name
  const subjStr = readName(subject.end);
  if (subjStr) fields['Subject'] = subjStr;
  p = subject.end;
  const spki = readTLV();              // SubjectPublicKeyInfo SEQUENCE
  const algSeq = readTLV();
  const algOid = readTLV();
  const algName = OIDS[oidToStr(algOid.start, algOid.end)] || 'key';
  fields['Key type'] = algName;
  p = algSeq.end;
  const keyBits = readTLV();           // BIT STRING
  if (algName === 'RSA') {
    // BIT STRING -> SEQUENCE { modulus INTEGER, exponent }
    let kp = keyBits.start + 1;        // skip unused-bits byte
    if (der[kp] === 0x30) {
      const save = p; p = kp; readTLV(); const mod = readTLV(); p = save;
      let bytes = mod.len;
      if (der[mod.start] === 0x00) bytes -= 1; // leading zero
      fields['Key size'] = (bytes * 8) + ' bit';
    }
  }
  return fields;
}

// ---------- After Effects XML project (.aepx) ----------
async function parseAepx(file) {
  try {
    const text = await file.text();
    const fields = { 'Format': 'After Effects XML project (AEPX)' };
    const unesc = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");

    // After Effects build / version string (e.g. <string>13.8x274</string> near
    // the head, or a Build attribute). AEPX carries a "BuildNumber" / version.
    const ver = text.match(/aebx_version="([^"]+)"/i) ||
                text.match(/BuildNumber="([^"]+)"/i) ||
                text.match(/<ProjectVersion>([^<]+)</i);
    if (ver) fields['After Effects version'] = ver[1];

    // Footage / asset references (fullpath="..." inside file references).
    const assets = [...text.matchAll(/fullpath="([^"]+)"/g)].map(m => unesc(m[1]));
    const uniqAssets = [...new Set(assets)];
    if (uniqAssets.length) {
      fields['Referenced assets'] = uniqAssets.length;
    }

    // Effect / plugin match-names (ADBE ...) used across comps.
    const effects = [...new Set([...text.matchAll(/<string>(ADBE [^<]+)<\/string>/g)].map(m => m[1]))];
    if (effects.length) fields['Effects / plugins'] = effects.length;

    // Composition metadata lives in <comp> ... blocks with <cdta>. Surface counts
    // and the first frame-rate / dimensions we can recover. AEPX exposes these as
    // human-readable hex blobs, but it also often carries explicit attributes.
    const compCount = (text.match(/<comp\b/g) || []).length || (text.match(/<idta/g) || []).length;
    if (compCount) fields['Compositions'] = compCount;
    const layerCount = (text.match(/<Layr\b/g) || text.match(/<layr\b/gi) || []).length;
    if (layerCount) fields['Layers'] = layerCount;

    // Frame rate (fps) and dimensions sometimes appear as plain attributes.
    const fps = text.match(/frameRate="([\d.]+)"/i) || text.match(/<fps>([\d.]+)</i);
    if (fps) fields['Frame rate'] = parseFloat(fps[1]) + ' fps';
    const dim = text.match(/width="(\d+)"[^>]*height="(\d+)"/i);
    if (dim) fields['Dimensions'] = dim[1] + ' x ' + dim[2] + ' px';
    const dur = text.match(/duration="([\d.]+)"/i);
    if (dur) fields['Duration'] = parseFloat(dur[1]).toFixed(2) + ' s';

    // Expressions (ExtendScript / JS) live in <string> blocks; heuristically count
    // ones that look like code.
    const exprs = [...text.matchAll(/<string>([^<]{8,})<\/string>/g)]
      .map(m => m[1]).filter(s => /[;={}()]/.test(s) && /(thisComp|time|wiggle|linear|value|thisLayer)/.test(s));
    if (exprs.length) fields['Expressions'] = exprs.length;

    // Named items (comp / layer / folder names) - filtered.
    const names = [...new Set([...text.matchAll(/<string>([^<]{1,60})<\/string>/g)]
      .map(m => m[1]).filter(s => !s.startsWith('ADBE ') && /[a-zA-Z]/.test(s) && !/[;={}]/.test(s)))];
    if (names.length) fields['Named items'] = names.length;

    const sections = [];
    if (uniqAssets.length) {
      sections.push({ title: 'Referenced assets (' + uniqAssets.length + ')',
        node: preBlock(uniqAssets.slice(0, 60).join('\n')) });
    }
    if (effects.length) {
      sections.push({ title: 'Effects / plugins (' + effects.length + ')',
        node: preBlock(effects.slice(0, 80).join('\n')) });
    }
    if (names.length) {
      sections.push({ title: 'Named items (' + names.length + ')',
        node: preBlock(names.slice(0, 80).join('\n')) });
    }
    if (exprs.length) {
      sections.push({ title: 'Expressions (' + exprs.length + ')',
        node: preBlock(exprs.slice(0, 20).map(unesc).join('\n\n')) });
    }
    if (sections.length) fields._sections = sections;
    return fields;
  } catch (_) {
    return null;
  }
}

// ---------- After Effects binary project (.aep / .aet) ----------
// .aep is a RIFX container: big-endian RIFF. Magic 'RIFX', a 4-byte BE size, then
// the form type 'Egg!'. The body is a tree of chunks (4-char FourCC + 4-byte BE
// length, padded to even). We walk the tree and harvest cheap signals; the bulk
// of the body (binary property blobs) stays opaque, which we note honestly.
async function parseAep(file) {
  try {
    // RIFX files can be large; a few MB is plenty to harvest match-names, paths
    // and structure counts without pulling the whole project into memory.
    const cap = Math.min(file.size, 8 * 1024 * 1024);
    const buf = new Uint8Array(await file.slice(0, cap).arrayBuffer());
    if (ascii(buf, 0, 4) !== 'RIFX') return null;
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const form = ascii(buf, 8, 4);
    const fields = { 'Container': 'RIFX (big-endian RIFF)' };
    fields['Form type'] = form + (form === 'Egg!' ? '  (After Effects project)' : '');

    // Walk top-level + nested chunks (bounded) counting structural FourCCs and
    // collecting tdmn match-names. We do a flat scan over the captured window for
    // robustness against AE's deep nesting.
    let comps = 0, layers = 0, items = 0, folders = 0, footage = 0;
    const matchNames = new Set();
    let aeVersion = null;

    let p = 12; // past RIFX + size + form
    const end = buf.length;
    while (p + 8 <= end) {
      const fourcc = ascii(buf, p, 4);
      const len = dv.getUint32(p + 4, false); // big-endian
      const dataStart = p + 8;
      if (len < 0 || dataStart + len > end + 8) break;
      const dataEnd = Math.min(dataStart + len, end);

      if (fourcc === 'LIST') {
        // LIST has a 4-char list-type then nested chunks; recurse by stepping in.
        const listType = ascii(buf, dataStart, 4);
        if (listType === 'Item' || listType === 'idta') items++;
        // Step into the list body so nested chunks are walked.
        p = dataStart + 4;
        continue;
      }

      if (fourcc === 'cdta') comps++;        // composition data
      else if (fourcc === 'ldta') layers++;  // layer data
      else if (fourcc === 'idta') items++;   // item data (comp/folder/footage)
      else if (fourcc === 'fdta') folders++; // folder data
      else if (fourcc === 'sspc' || fourcc === 'pin ' || fourcc === 'Pin ') footage++;
      else if (fourcc === 'tdmn') {
        // Effect / property match-name: a NUL-terminated ASCII string.
        const s = ascii(buf, dataStart, Math.min(len, 128)).replace(/ .*$/, '').trim();
        if (s && s !== 'ADBE Group End' && /[A-Za-z]/.test(s)) matchNames.add(s);
      }

      // advance, chunks are word (2-byte) aligned
      let next = dataStart + len;
      if (next & 1) next++;
      if (next <= p) break; // safety
      p = next;
    }

    // Effect match-names that start with "ADBE " are the user-facing effects.
    const effectNames = [...matchNames].filter(m => m.startsWith('ADBE ') &&
      !/Group End|Vector|Marker|Time Remap|Transform Group|Root Vectors/.test(m));

    // Harvest referenced footage paths: AE stores them as UTF-8 strings in 'Utf8'
    // chunks and platform paths; a string sweep catches drive/UNC/posix paths.
    const fullText = utf16Safe(buf);
    const paths = harvestPaths(buf);

    // Version string: AE writes something like "After Effects 24.0" or a numeric
    // build in the head region; sweep the ASCII for a recognisable token.
    const headAscii = asciiRun(buf, 0, Math.min(buf.length, 8192));
    const vm = headAscii.match(/After Effects[^\d]{0,8}(\d{1,2}(?:\.\d+)*)/i) ||
               headAscii.match(/\bAE\b[^\d]{0,4}(\d{2}\.\d)/);
    if (vm) aeVersion = vm[1];

    if (aeVersion) fields['After Effects version'] = aeVersion;
    if (items) fields['Items (comps / folders / footage)'] = items;
    if (comps) fields['Compositions'] = comps;
    if (layers) fields['Layers'] = layers;
    if (folders) fields['Folders'] = folders;
    if (effectNames.length) fields['Effects / plugins'] = effectNames.length;
    else if (matchNames.size) fields['Property match-names'] = matchNames.size;
    if (paths.length) fields['Referenced asset paths'] = paths.length;
    if (cap < file.size) fields['Scanned'] = fmtBytes(cap) + ' of ' + fmtBytes(file.size);

    const sections = [];
    if (effectNames.length) {
      sections.push({ title: 'Effects / plugins (' + effectNames.length + ')',
        node: preBlock(effectNames.slice(0, 80).join('\n')) });
    }
    const otherNames = [...matchNames].filter(m => !m.startsWith('ADBE '));
    if (otherNames.length) {
      sections.push({ title: 'Other match-names (' + otherNames.length + ')',
        node: preBlock(otherNames.slice(0, 60).join('\n')) });
    }
    if (paths.length) {
      sections.push({ title: 'Referenced asset paths (' + paths.length + ')',
        node: preBlock(paths.slice(0, 60).join('\n')) });
    }
    if (sections.length) fields._sections = sections;

    fields['Note'] = 'RIFX structure walked - match-names, paths and item/comp/layer ' +
      'counts are decoded. The binary property blobs (keyframes, transforms) are ' +
      'only partially decoded.';
    return fields;
  } catch (_) {
    return null;
  }
}

// Printable ASCII run (preserves position, used for windowed text sweeps).
function asciiRun(buf, start, end) {
  let s = '';
  for (let i = start; i < end && i < buf.length; i++) {
    const c = buf[i];
    s += (c >= 32 && c < 127) ? String.fromCharCode(c) : ' ';
  }
  return s;
}

// Best-effort UTF-16 decode of a binary buffer (tolerant), for path/string sweeps.
function utf16Safe(buf) {
  try { return utf16(buf, true) + '\n' + utf16(buf, false); } catch (_) { return ''; }
}

// Harvest plausible filesystem paths (Windows drive, UNC, or POSIX) from a binary
// buffer by scanning both ASCII and UTF-16 string runs.
function harvestPaths(buf) {
  const out = new Set();
  const re = /(?:[A-Za-z]:\\|\\\\[^\s"<>|*?]+\\|\/(?:Users|Volumes|home|Applications|Movies)\/)[^ "<>|*?\n\r]{2,200}/g;
  // ASCII pass
  const aRun = asciiRun(buf, 0, buf.length);
  for (const m of aRun.matchAll(re)) {
    const s = m[0].trim().replace(/\s+$/, '');
    if (s.length > 4 && /\.[A-Za-z0-9]{2,5}\b/.test(s)) out.add(s);
  }
  // UTF-16 pass
  const u = utf16Safe(buf);
  for (const m of u.matchAll(re)) {
    const s = m[0].trim().replace(/\s+$/, '');
    if (s.length > 4 && /\.[A-Za-z0-9]{2,5}\b/.test(s)) out.add(s);
  }
  return [...out].slice(0, 200);
}

// ---------- VEGAS Pro project (.veg / .vf) ----------
// Sony / MAGIX VEGAS Pro project. The body is a proprietary RIFF-like / structured
// binary. We confirm the signature and harvest any embedded version/build string
// and referenced media paths via a string sweep. Deep parse is infeasible.
async function parseVeg(file) {
  try {
    const cap = Math.min(file.size, 4 * 1024 * 1024);
    const buf = new Uint8Array(await file.slice(0, cap).arrayBuffer());
    const fields = { 'Application': 'VEGAS Pro (Sony / MAGIX)' };

    // VEG files commonly begin with RIFF/RIFX or a 'Vegas'/'VEG' marker; surface
    // whatever signature is present.
    if (ascii(buf, 0, 4) === 'RIFF') fields['Container'] = 'RIFF (little-endian)';
    else if (ascii(buf, 0, 4) === 'RIFX') fields['Container'] = 'RIFX (big-endian)';
    else if (buf[0] === 0xD0 && buf[1] === 0xCF) fields['Container'] = 'OLE compound document';

    const headAscii = asciiRun(buf, 0, Math.min(buf.length, 16384));
    const u = utf16Safe(buf);
    const verm = (u + ' ' + headAscii).match(/VEGAS\s*(?:Pro)?\s*(\d{1,2}(?:\.\d+)*)/i) ||
                 (u + ' ' + headAscii).match(/Vegas[^\d]{0,12}(\d{2}\.\d)/i);
    if (verm) fields['Version / build'] = verm[1];

    const paths = harvestPaths(buf);
    // Media references in VEG often sit in the second half of the file.
    if (file.size > cap) {
      const tail = new Uint8Array(await file.slice(file.size - Math.min(file.size, 2 * 1024 * 1024)).arrayBuffer());
      for (const p of harvestPaths(tail)) paths.push(p);
    }
    const uniqPaths = [...new Set(paths)];
    if (uniqPaths.length) {
      fields['Referenced media'] = uniqPaths.length;
      fields._sections = [{ title: 'Referenced media (' + uniqPaths.length + ')',
        node: preBlock(uniqPaths.slice(0, 60).join('\n')) }];
    }
    if (cap < file.size) fields['Scanned'] = fmtBytes(cap) + ' (head) of ' + fmtBytes(file.size);
    fields['Note'] = 'VEGAS projects are a proprietary binary - signature, version ' +
      'and media paths are surfaced; the timeline structure stays opaque.';
    return fields;
  } catch (_) {
    return null;
  }
}

// ---------- DaVinci Resolve project / timeline (.drp / .drt) ----------
// A .drp may begin with a SQLite database ('SQLite format 3\0') or be a custom
// binary (often a gzip/zstd blob or a DRP XML). We detect the container and
// surface cheap signals: Resolve version, project/timeline name, media paths.
async function parseDrp(file, ext) {
  try {
    const cap = Math.min(file.size, 4 * 1024 * 1024);
    const buf = new Uint8Array(await file.slice(0, cap).arrayBuffer());
    const isTimeline = ext === 'drt';
    const fields = { 'Application': 'DaVinci Resolve (Blackmagic Design)' };
    fields['Kind'] = isTimeline ? 'Timeline (.drt)' : 'Project (.drp)';

    if (ascii(buf, 0, 15) === 'SQLite format 3') {
      fields['Container'] = 'SQLite database';
    } else if (buf[0] === 0x1F && buf[1] === 0x8B) {
      fields['Container'] = 'GZIP-compressed';
    } else if (buf[0] === 0x50 && buf[1] === 0x4B) {
      fields['Container'] = 'ZIP archive';
    } else if (ascii(buf, 0, 5) === '<?xml' || ascii(buf, 0, 1) === '<') {
      fields['Container'] = 'XML';
    } else if (ascii(buf, 0, 1) === '{') {
      fields['Container'] = 'JSON';
    }

    const headAscii = asciiRun(buf, 0, Math.min(buf.length, 32768));
    const u = utf16Safe(buf);
    const blob = headAscii + ' ' + u;
    const verm = blob.match(/Resolve[^\d]{0,16}(\d{1,2}(?:\.\d+)*)/i) ||
                 blob.match(/DaVinci[^\d]{0,16}(\d{2}\.\d)/i);
    if (verm) fields['Resolve version'] = verm[1];
    const namem = blob.match(/(?:ProjectName|TimelineName|"name")\s*[=:]\s*["']?([^"'<>\n\r]{1,80})/i);
    if (namem) fields[isTimeline ? 'Timeline name' : 'Project name'] = namem[1].trim();

    const paths = harvestPaths(buf);
    const uniqPaths = [...new Set(paths)];
    if (uniqPaths.length) {
      fields['Referenced media'] = uniqPaths.length;
      fields._sections = [{ title: 'Referenced media (' + uniqPaths.length + ')',
        node: preBlock(uniqPaths.slice(0, 60).join('\n')) }];
    }
    if (cap < file.size) fields['Scanned'] = fmtBytes(cap) + ' of ' + fmtBytes(file.size);
    fields['Note'] = 'Container detected and cheap strings (version, name, media ' +
      'paths) harvested. The database / binary body is not fully decoded.';
    return fields;
  } catch (_) {
    return null;
  }
}

// ---------- Wondershare Filmora project (.wfp / .wsp) ----------
// Newer Filmora projects are JSON (or wrap a JSON project model); older .wfp are
// binary. Detect JSON vs binary and extract version/resolution/duration/tracks
// for JSON; for binary, ID + any embedded version.
async function parseFilmora(file, ext) {
  try {
    const cap = Math.min(file.size, 6 * 1024 * 1024);
    const buf = new Uint8Array(await file.slice(0, cap).arrayBuffer());
    const fields = { 'Application': 'Wondershare Filmora' };
    fields['Kind'] = ext === 'wsp' ? 'Sub-project (.wsp)' : 'Project (.wfp)';

    // Is there a JSON document (whole-file or embedded)? Find the first '{' that
    // begins a plausible Filmora model.
    let jsonText = null;
    const headStr = asciiRun(buf, 0, buf.length);
    const braceIdx = headStr.indexOf('{');
    if (braceIdx >= 0) {
      const candidate = headStr.slice(braceIdx);
      // Try to parse the largest balanced JSON object we can cheaply find.
      jsonText = extractJsonObject(candidate);
    }

    let model = null;
    if (jsonText) { try { model = JSON.parse(jsonText); } catch (_) { model = null; } }

    if (model && typeof model === 'object') {
      fields['Format'] = 'JSON project model';
      const root = model.project || model;
      const ver = root.version || root.appVersion || model.version || root.editVersion;
      if (ver) fields['Filmora version'] = String(ver);
      const platform = root.platform || model.platform || root.os;
      if (platform) fields['Platform'] = String(platform);
      const w = root.width || (root.canvas && root.canvas.width) || root.projectWidth;
      const h = root.height || (root.canvas && root.canvas.height) || root.projectHeight;
      if (w && h) fields['Resolution'] = w + ' x ' + h + ' px';
      const fpsv = root.fps || root.frameRate || (root.canvas && root.canvas.fps);
      if (fpsv) fields['Frame rate'] = parseFloat(fpsv) + ' fps';
      const durv = root.duration || root.totalDuration;
      if (durv) {
        const secs = durv > 1e6 ? durv / 1e6 : durv; // microseconds -> seconds heuristic
        fields['Duration'] = secs.toFixed(2) + ' s';
      }
      const tracks = root.tracks || (root.timeline && root.timeline.tracks) || model.tracks;
      if (Array.isArray(tracks)) {
        fields['Tracks'] = tracks.length;
        let clips = 0;
        for (const t of tracks) {
          const items = t.clips || t.items || t.segments;
          if (Array.isArray(items)) clips += items.length;
        }
        if (clips) fields['Clips'] = clips;
      }
      const clipsArr = root.clips || model.clips;
      if (Array.isArray(clipsArr) && !fields['Clips']) fields['Clips'] = clipsArr.length;
    } else {
      // Binary .wfp - older format. Confirm + harvest version/paths.
      fields['Format'] = 'Binary project';
      if (buf[0] === 0x50 && buf[1] === 0x4B) fields['Container'] = 'ZIP archive';
      else if (buf[0] === 0xD0 && buf[1] === 0xCF) fields['Container'] = 'OLE compound document';
      const blob = asciiRun(buf, 0, Math.min(buf.length, 32768)) + ' ' + utf16Safe(buf);
      const verm = blob.match(/Filmora[^\d]{0,12}(\d{1,2}(?:\.\d+)*)/i);
      if (verm) fields['Filmora version'] = verm[1];
    }

    const paths = harvestPaths(buf);
    const uniqPaths = [...new Set(paths)];
    if (uniqPaths.length) {
      fields['Referenced media'] = uniqPaths.length;
      fields._sections = [{ title: 'Referenced media (' + uniqPaths.length + ')',
        node: preBlock(uniqPaths.slice(0, 60).join('\n')) }];
    }
    if (cap < file.size) fields['Scanned'] = fmtBytes(cap) + ' of ' + fmtBytes(file.size);
    return fields;
  } catch (_) {
    return null;
  }
}

// Extract the first balanced top-level JSON object from a string (best effort).
function extractJsonObject(s) {
  if (s[0] !== '{') return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = 0; i < s.length && i < 6 * 1024 * 1024; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else {
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) return s.slice(0, i + 1); }
    }
  }
  return null;
}

// ---------- CapCut draft (draft_content.json) ----------
// CapCut desktop drafts are a folder with draft_content.json. We are handed it as
// a .json file. The model has keys like materials, tracks, canvas_config, duration
// (microseconds), draft_id, last_modified_platform / app version.
function isCapcutModel(obj) {
  if (!obj || typeof obj !== 'object') return false;
  // Require a couple of distinctive CapCut keys to avoid hijacking normal JSON.
  const hasMaterials = obj.materials && typeof obj.materials === 'object';
  const hasTracks = Array.isArray(obj.tracks);
  const hasCanvas = obj.canvas_config && typeof obj.canvas_config === 'object';
  const hasDraftId = typeof obj.draft_id === 'string' || typeof obj.id === 'string';
  return (hasMaterials && hasTracks) || (hasCanvas && hasTracks) ||
         (hasTracks && hasDraftId && (obj.duration !== undefined));
}

function buildCapcutFields(obj) {
  const fields = { 'Application': 'CapCut (ByteDance)' };
  fields['Format'] = 'CapCut draft (draft_content.json)';

  const platform = obj.last_modified_platform || obj.platform;
  if (platform && typeof platform === 'object') {
    const appv = platform.app_version || platform.appVersion;
    if (appv) fields['CapCut version'] = String(appv);
    if (platform.os) fields['Platform'] = String(platform.os) +
      (platform.os_version ? ' ' + platform.os_version : '');
  } else if (typeof platform === 'string') {
    fields['Platform'] = platform;
  }
  if (obj.draft_id) fields['Draft ID'] = String(obj.draft_id);

  const cc = obj.canvas_config;
  if (cc && (cc.width || cc.height)) {
    fields['Canvas resolution'] = (cc.width || '?') + ' x ' + (cc.height || '?') + ' px';
    if (cc.ratio) fields['Aspect ratio'] = String(cc.ratio);
  }
  if (typeof obj.fps === 'number') fields['Frame rate'] = obj.fps + ' fps';

  if (typeof obj.duration === 'number') {
    // CapCut durations are in microseconds.
    const secs = obj.duration / 1e6;
    fields['Duration'] = secs.toFixed(2) + ' s';
  }

  if (Array.isArray(obj.tracks)) {
    fields['Tracks'] = obj.tracks.length;
    let segs = 0;
    const byType = {};
    for (const t of obj.tracks) {
      if (Array.isArray(t.segments)) segs += t.segments.length;
      if (t.type) byType[t.type] = (byType[t.type] || 0) + 1;
    }
    if (segs) fields['Segments (clips)'] = segs;
    const tt = Object.keys(byType);
    if (tt.length) fields['Track types'] = tt.map(k => k + ' x' + byType[k]).join(', ');
  }

  // Materials by type: CapCut groups them under named arrays in `materials`.
  const m = obj.materials;
  if (m && typeof m === 'object') {
    const counts = [];
    const pick = (key, label) => {
      if (Array.isArray(m[key]) && m[key].length) counts.push(label + ': ' + m[key].length);
    };
    pick('videos', 'Videos');
    pick('audios', 'Audios');
    pick('texts', 'Texts');
    pick('stickers', 'Stickers');
    pick('video_effects', 'Effects');
    pick('effects', 'Effects');
    pick('transitions', 'Transitions');
    pick('images', 'Images');
    if (counts.length) fields['Materials'] = counts.join(', ');
    // Total material count across all arrays.
    let total = 0;
    for (const k in m) if (Array.isArray(m[k])) total += m[k].length;
    if (total) fields['Total materials'] = total;
  }
  return fields;
}

// Given a .json file, return a CapCut readout if it is a CapCut draft, else null
// (so normal JSON rendering proceeds untouched).
async function parseCapcut(file) {
  try {
    // CapCut drafts can be large; cap the read but they are usually a few MB.
    if (file.size > 64 * 1024 * 1024) return null;
    const text = await file.text();
    // Fast pre-check before the (potentially big) JSON.parse: must mention the
    // distinctive keys. Avoids parsing every ordinary JSON file fully.
    const isNamed = /draft_content\.json$/i.test(file.name || '');
    if (!isNamed && !/"canvas_config"|"draft_id"|"last_modified_platform"/.test(text.slice(0, 4096) + text.slice(-2048))) {
      // Cheap probe failed and filename isn't the canonical one - not CapCut.
      if (!/"materials"[\s\S]{0,200}"tracks"|"tracks"[\s\S]{0,200}"segments"/.test(text.slice(0, 8192))) return null;
    }
    let obj;
    try { obj = JSON.parse(text); } catch (_) { return null; }
    if (!isCapcutModel(obj)) return null;
    return buildCapcutFields(obj);
  } catch (_) {
    return null;
  }
}

// ---------- Partial download (.part / .crdownload) ----------
async function parsePart(file, head) {
  const fields = { 'Status': 'Incomplete download' };
  fields['Bytes present'] = fmtBytes(file.size);
  const sig = guessFromMagic(head);
  if (sig) fields['Detected original format'] = sig;
  else fields['Detected original format'] = 'Unrecognised (' +
    Array.from(head.subarray(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' ') + ')';
  return fields;
}

// Small magic-byte sniffer for the partial-download detector.
function guessFromMagic(b) {
  const a = (s, l) => Array.from(b.subarray(s, s + l)).map(c => String.fromCharCode(c)).join('');
  if (a(0, 4) === '%PDF') return 'PDF document';
  if (b[0] === 0x50 && b[1] === 0x4B) return 'ZIP / Office / archive';
  if (b[0] === 0x4D && b[1] === 0x5A) return 'Windows executable (PE)';
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'JPEG image';
  if (a(0, 8) === '\x89PNG\r\n\x1a\n') return 'PNG image';
  if (a(0, 6) === 'GIF89a' || a(0, 6) === 'GIF87a') return 'GIF image';
  if (a(0, 4) === 'RIFF') return 'RIFF (WAV / AVI / WebP)';
  if (a(0, 4) === 'OggS') return 'Ogg media';
  if (a(0, 4) === 'fLaC') return 'FLAC audio';
  if (b[0] === 0x1F && b[1] === 0x8B) return 'GZIP archive';
  if (a(0, 4) === '7z\xBC\xAF') return '7-Zip archive';
  if (a(0, 4) === 'Rar!') return 'RAR archive';
  if (a(4, 4) === 'ftyp') return 'MP4 / MOV / HEIF';
  if (a(0, 5) === '<?xml') return 'XML document';
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return 'MP3 (ID3) audio';
  if (b[0] === 0xD0 && b[1] === 0xCF) return 'OLE compound (legacy Office / MSI)';
  return null;
}

// ---------- Dolby Digital Plus / E-AC-3 (.ec3) ----------
function parseEac3(head) {
  // Find the 0x0B77 sync word, then read the bitstream header for acmod + lfe.
  let off = -1;
  for (let i = 0; i + 1 < Math.min(head.length, 4096); i++) {
    if (head[i] === 0x0B && head[i + 1] === 0x77) { off = i + 2; break; }
  }
  const fields = { 'Codec': 'Dolby Digital Plus (E-AC-3)' };
  if (off < 0 || off + 4 > head.length) return fields;
  // Bit reader starting at the byte after the sync word.
  let bitPos = off * 8;
  const bits = (n) => {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const byte = head[bitPos >> 3];
      const bit = (byte >> (7 - (bitPos & 7))) & 1;
      v = (v << 1) | bit;
      bitPos++;
    }
    return v;
  };
  bits(2);                    // strmtyp
  bits(3);                    // substreamid
  bits(11);                   // frmsiz
  const fscod = bits(2);
  if (fscod === 3) bits(2); else bits(2); // fscod2 / numblkscod
  const acmod = bits(3);
  const lfeon = bits(1);
  const chans = [2, 1, 2, 3, 3, 4, 4, 5][acmod] + (lfeon ? 1 : 0);
  const layout = { 1: 'Mono', 2: 'Stereo', 3: '3.0', 4: '3.0 (surround)', 6: '5.1', 5: '4.0' };
  fields['Channels'] = lfeon ? (chans - 1) + '.1' : String(chans);
  if (acmod === 7) fields['Layout'] = lfeon ? '5.1 surround' : '5.0 surround';
  const rates = { 0: '48 kHz', 1: '44.1 kHz', 2: '32 kHz' };
  if (rates[fscod]) fields['Sample rate'] = rates[fscod];
  return fields;
}

// ---------- Dolby TrueHD / MLP (.thd / .mlp) ----------
function parseTrueHd(head) {
  // MLP major sync: format_sync at offset 4 is 0xF8726FBA (TrueHD) or 0xF8726FBB (MLP).
  for (let i = 0; i + 8 < Math.min(head.length, 4096); i++) {
    if (head[i + 4] === 0xF8 && head[i + 5] === 0x72 && head[i + 6] === 0x6F &&
        (head[i + 7] === 0xBA || head[i + 7] === 0xBB)) {
      const isTrueHd = head[i + 7] === 0xBA;
      return { 'Codec': isTrueHd ? 'Dolby TrueHD' : 'MLP (Meridian Lossless Packing)', 'Container': 'MLP major sync found' };
    }
  }
  return { 'Codec': 'Dolby TrueHD / MLP' };
}

// ---------- CDP4 (COMET Data Platform) ----------
// .cdp is shared by two unrelated tools. Criterium DecisionPlus (InfoHarvest's
// decision-analysis app) writes a binary file starting 0x80 0x00 then the ASCII
// string "Hierarchy <version>" padded to 128 bytes; CDP4 / COMET (the ESA
// concurrent-design platform) writes a SQLite / ZIP / JSON / XML container.
// Detect the Criterium signature first, otherwise fall back to the COMET sniff.
async function parseCdp(file, head) {
  const hierarchy = head[0] === 0x80 && head[1] === 0x00 &&
    String.fromCharCode(...head.subarray(2, 11)) === 'Hierarchy';
  if (hierarchy) return parseCriterium(file, head);

  const fields = { _app: 'CDP4 (COMET Data Platform)' };
  const a = (s, l) => Array.from(head.subarray(s, s + l)).map(c => String.fromCharCode(c)).join('');
  if (a(0, 15) === 'SQLite format 3') {
    fields['Container'] = 'SQLite database';
  } else if (head[0] === 0x50 && head[1] === 0x4B) {
    fields['Container'] = 'ZIP archive (annotated model)';
    const meta = await parseZipMeta(file, 'zip').catch(() => null);
    if (meta) Object.assign(fields, meta);
  } else {
    const txt = a(0, Math.min(head.length, 256)).trimStart();
    if (txt[0] === '{' || txt[0] === '[') fields['Container'] = 'JSON';
    else if (txt.startsWith('<?xml') || txt[0] === '<') fields['Container'] = 'XML';
    else fields['Container'] = 'Binary';
  }
  return fields;
}

// Criterium DecisionPlus model. The 128-byte header gives the format version;
// the body is binary but stores the decision model's node names and <Note> text
// as readable strings, so we surface the goal, the named elements (criteria /
// alternatives) and any description. The interleaved pairwise-comparison cells
// (runs of '!'/'0') and the built-in rating scales (padded, double-spaced) are
// filtered out so only model-specific labels remain.
async function parseCriterium(file, head) {
  const fields = { _app: 'Criterium DecisionPlus' };
  const ver = String.fromCharCode(...head.subarray(2, 17)).replace(/[^\x20-\x7e]/g, '').trim();
  const m = ver.match(/^(\w+)\s+([\d.]+)$/);
  if (m) { fields['Model type'] = m[1]; fields['Format version'] = m[2]; }
  else if (ver) fields['Format'] = ver;

  const cap = Math.min(file.size, 512 * 1024);
  const body = new TextDecoder('latin1').decode(new Uint8Array(await file.slice(128, cap).arrayBuffer()));
  const runs = body.match(/[\x20-\x7e]{4,}/g) || [];

  const STRUCT = new Set(['goal', 'goal level', 'alternatives', 'criteria', 'subcriteria',
    'design alternatives', 'main criteria', 'sub criteria']);
  const isStruct = (s) => STRUCT.has(s.toLowerCase()) || /^level\s*\d+$/i.test(s);

  const labels = [];
  const seen = new Set();
  for (let s of runs) {
    s = s.replace(/<[^>]*>/g, '').trim();        // drop <Note>/<Question>/<XID> tags
    if (!/[A-Za-z]{3}/.test(s)) continue;        // needs real words
    if (s.length > 48) continue;                 // skip prose and the padded rating scales
    if (/\s{2,}/.test(s)) continue;              // double spaces = padded scale block
    if (/^hierarchy\b/i.test(s)) continue;       // the header version string
    if (s.includes('?')) continue;               // binary artefacts (e.g. "fff?")
    if (/^default alternative/i.test(s)) continue; // system-added placeholder
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(s);
  }

  const goal = labels.find((s) => !isStruct(s));
  if (goal) fields['Goal'] = goal;
  const elements = labels.filter((s) => !isStruct(s) && s !== goal);
  if (elements.length) {
    const sample = elements.slice(0, 12).join(', ');
    fields['Model elements'] = elements.length +
      (elements.length > 12 ? ' (e.g. ' + sample + ' ...)' : ' (' + sample + ')');
  }

  const notes = [...body.matchAll(/<Note>([\s\S]*?)<\/Note>/g)]
    .map((x) => x[1].trim())
    .filter((n) => n && !/^Default Alternative/i.test(n));
  if (notes.length) {
    let n = notes[0].replace(/\s+/g, ' ').trim();
    if (n.length > 240) n = n.slice(0, 237) + '...';
    fields['Description'] = n;
  }
  return fields;
}

// ---------- ULTRAKILL save (.bepis) ----------
// .bepis files are .NET BinaryFormatter (NRBF) streams holding ULTRAKILL's save
// classes from Assembly-CSharp. We decode the object graph (see lib/nrbf.js),
// then turn the known save classes - GameProgressMoneyAndGear, GameProgressData,
// RankData and CyberRankData - into a readable gameplay summary, and dump the
// full decoded data underneath. Unknown classes still get the generic dump.
const UK_DIFFICULTIES = ['Harmless', 'Lenient', 'Standard', 'Violent', 'Brutal', 'UMD'];
const UK_WEAPONS = { rev: 'Revolver', sho: 'Shotgun', nai: 'Nailgun', rai: 'Railcannon', rock: 'Rocket Launcher', arm: 'Arm' };

const isArr = (v) => Array.isArray(v);
const countTruthy = (a) => isArr(a) ? a.filter((x) => x && x !== 0 && x !== -1).length : 0;
const sumArr = (a) => isArr(a) ? a.reduce((s, x) => s + (Number(x) || 0), 0) : 0;
function maxWithIndex(a) {
  if (!isArr(a) || !a.length) return null;
  let bi = -1, bv = -Infinity;
  a.forEach((x, i) => { const n = Number(x); if (n > bv) { bv = n; bi = i; } });
  return bv > 0 ? { value: bv, index: bi } : null;
}
const fmtTime = (s) => { const t = Number(s) || 0; const m = Math.floor(t / 60); return `${m}:${String(Math.floor(t % 60)).padStart(2, '0')}.${String(Math.round((t % 1) * 100)).padStart(2, '0')}`; };
const diffName = (i) => UK_DIFFICULTIES[i] !== undefined ? `${UK_DIFFICULTIES[i]} (${i})` : String(i);

function summariseBepis(cls, o, fields) {
  if (cls === 'GameProgressMoneyAndGear') {
    fields['Save type'] = 'General progress (money & gear)';
    if (typeof o.money === 'number') fields['Money'] = o.money.toLocaleString();
    // Weapon variant unlock flags (rev0..rev3/revalt, sho*, nai*, rai*, rock*, arm*).
    const byFam = {};
    for (const k in o) {
      const m = k.match(/^(rev|sho|nai|rai|rock|arm)/);
      if (m && typeof o[k] === 'number') { const f = m[1]; (byFam[f] = byFam[f] || { n: 0, t: 0 }); byFam[f].t++; if (o[k] > 0) byFam[f].n++; }
    }
    const fam = Object.keys(byFam).filter((f) => UK_WEAPONS[f]);
    if (fam.length) fields['Weapon variants unlocked'] = fam.map((f) => `${UK_WEAPONS[f]} ${byFam[f].n}/${byFam[f].t}`).join(', ');
    const flags = [];
    if (o.clashModeUnlocked) flags.push('Clash mode');
    if (o.ghostDroneModeUnlocked) flags.push('Ghost drone');
    if (o.tutorialBeat) flags.push('Tutorial beaten');
    if (flags.length) fields['Unlocked'] = flags.join(', ');
    if (isArr(o.newEnemiesFound)) fields['Enemies in bestiary'] = `${countTruthy(o.newEnemiesFound)} / ${o.newEnemiesFound.length}`;
    if (isArr(o.secretMissions)) fields['Secret missions found'] = `${countTruthy(o.secretMissions)} / ${o.secretMissions.length}`;
  } else if (cls === 'GameProgressData') {
    fields['Save type'] = 'Difficulty progress';
    if (typeof o.difficulty === 'number') fields['Difficulty'] = diffName(o.difficulty);
    if (typeof o.levelNum === 'number') fields['Furthest level reached'] = String(o.levelNum);
    if (isArr(o.primeLevels)) fields['Prime sanctums cleared'] = `${countTruthy(o.primeLevels)} / ${o.primeLevels.length}`;
    if (typeof o.encores === 'number') fields['Encores'] = String(o.encores);
  } else if (cls === 'RankData') {
    fields['Save type'] = 'Per-level rank data';
    if (typeof o.levelNumber === 'number') fields['Level number'] = String(o.levelNumber);
    if (isArr(o.ranks)) { const played = o.ranks.filter((x) => x !== -1).length; fields['Completions (per difficulty)'] = `${played} / ${o.ranks.length}`; }
    if (isArr(o.secretsFound)) fields['Secrets found'] = `${countTruthy(o.secretsFound)} / ${o.secretsAmount != null ? o.secretsAmount : o.secretsFound.length}`;
    if (o.challenge) fields['Challenge'] = 'Completed';
    if (isArr(o.majorAssists)) { const used = countTruthy(o.majorAssists); if (used) fields['Major assists used'] = `${used} difficulties`; }
    // Best stats from the populated RankScoreData entries.
    if (isArr(o.stats)) {
      const best = o.stats.filter((s) => s && typeof s === 'object');
      if (best.length) {
        const k = Math.max(...best.map((s) => Number(s.kills) || 0));
        const st = Math.max(...best.map((s) => Number(s.style) || 0));
        const times = best.map((s) => Number(s.time) || 0).filter((t) => t > 0);
        if (k) fields['Best kills'] = String(k);
        if (st) fields['Best style'] = st.toLocaleString();
        if (times.length) fields['Best time'] = fmtTime(Math.min(...times));
      }
    }
  } else if (cls === 'CyberRankData') {
    fields['Save type'] = 'Cyber Grind high score';
    const wave = maxWithIndex(o.preciseWavesByDifficulty);
    if (wave) { fields['Best wave'] = (Math.floor(wave.value * 100) / 100).toString(); fields['On difficulty'] = diffName(wave.index); }
    else if (typeof o.wave === 'number') fields['Best wave'] = String(o.wave);
    if (isArr(o.kills)) { const m = maxWithIndex(o.kills); if (m) fields['Kills'] = String(m.value); }
    if (isArr(o.style)) { const m = maxWithIndex(o.style); if (m) fields['Style points'] = m.value.toLocaleString(); }
    if (isArr(o.time)) { const m = maxWithIndex(o.time); if (m) fields['Time survived'] = fmtTime(m.value); }
  }
}

async function parseBepis(file, head) {
  const fields = { 'Game': 'ULTRAKILL', 'File type': 'Save data' };
  const buf = new Uint8Array(await file.slice(0, Math.min(file.size, 4 * 1024 * 1024)).arrayBuffer());

  // Modern .bepis: a .NET BinaryFormatter (NRBF) stream (magic 00 01 00 00 00).
  if (buf[0] === 0x00 && buf[1] === 0x01 && buf[2] === 0x00 && buf[3] === 0x00) {
    const res = parseNrbf(buf);
    if (res.ok && res.root) {
      fields['Container'] = '.NET BinaryFormatter';
      if (res.rootClass) fields['Save class'] = res.rootClass;
      summariseBepis(res.rootClass, res.root, fields);
      const dump = prettyKV(typeof res.root === 'object' && !Array.isArray(res.root) ? res.root : { value: res.root });
      if (dump) fields['_readableText'] = dump.slice(0, 20000);
      return fields;
    }
  }

  // JSON variant (e.g. MapVars .vars.json companions, or older saves).
  const headStr = new TextDecoder('latin1').decode(buf.subarray(0, 256)).trimStart();
  if (headStr[0] === '{' || headStr[0] === '[') {
    fields['Container'] = 'JSON';
    try {
      const obj = JSON.parse(new TextDecoder('utf-8').decode(buf));
      const keys = Object.keys(obj);
      if (keys.length) fields['Fields'] = keys.slice(0, 20).join(', ');
      fields['_readableText'] = prettyKV(obj).slice(0, 20000);
    } catch (_) { /* truncated / not pure JSON */ }
    return fields;
  }

  // Fallback - pull printable ASCII runs (≥4 chars) as a hint at contents.
  fields['Container'] = 'Binary';
  const strings = [];
  let cur = '';
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (c >= 0x20 && c < 0x7F) {
      cur += String.fromCharCode(c);
    } else {
      if (cur.length >= 4 && /[a-zA-Z]/.test(cur)) strings.push(cur);
      cur = '';
    }
  }
  if (cur.length >= 4) strings.push(cur);
  const uniq = [...new Set(strings)];
  const known = uniq.filter(s => /(level|prelude|layer|secret|rank|difficulty|brutal|violent|standard|harmless|cybergrind|weapon|revolver|shotgun|nailgun|railcannon|fist|whiplash|coin|time|kills|style)/i.test(s));
  if (known.length) fields['Recognised tokens'] = known.slice(0, 25).join(', ');
  if (uniq.length) fields['_readableText'] = uniq.slice(0, 300).join('\n');
  return fields;
}

// ---------- Canon camera catalog (.CTG) ----------
// A CTG is the index a Canon camera keeps under DCIM/CANONMSC so it knows what's
// on the card without rescanning. There's no public spec; these offsets were
// reverse-engineered from IXUS/PowerShot cards and are read defensively (every
// field is bounds- and sanity-checked, so a different model's CTG still at least
// identifies). It carries NO image data. Two variants:
//   • per-folder (e.g. 107.CTG) - starts with the folder path "X:\DCIM\nnnCANON"
//   • master    (D.CTG)         - starts with a uint32 folder count
async function parseCtg(file) {
  const buf = new Uint8Array(await file.slice(0, Math.min(file.size, 65536)).arrayBuffer());
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const fields = { 'Vendor': 'Canon', 'File type': 'Camera catalog (DCIM index)' };

  // Per-folder catalog begins with a drive path like "D:\DCIM\107CANON".
  const isPath = buf.length > 8 &&
    buf[0] >= 0x41 && buf[0] <= 0x5A &&        // drive letter A-Z
    buf[1] === 0x3A &&                          // ':'
    (buf[2] === 0x5C || buf[2] === 0x2F);       // '\' or '/'

  if (isPath) {
    fields['Catalog type'] = 'Per-folder index';
    let end = 0;
    while (end < buf.length && end < 260 && buf[end] !== 0) end++;
    fields['Catalogues folder'] = new TextDecoder('latin1').decode(buf.subarray(0, end));

    // Folder number + recorded-shot count (uint16 LE) at observed offsets.
    if (buf.length > 0x84) {
      const folderNo = dv.getUint16(0x80, true);
      const shots = dv.getUint16(0x82, true);
      if (folderNo >= 100 && folderNo <= 999) fields['Folder number'] = String(folderNo);
      if (shots > 0 && shots <= 5000) fields['Shots recorded'] = String(shots);
    }
    // Presence bitmap (uint32 LE): one set bit per occupied frame slot.
    if (buf.length > 0xec) {
      const bmp = dv.getUint32(0xe8, true);
      let bits = 0;
      for (let i = 0; i < 32; i++) if ((bmp >>> i) & 1) bits++;
      if (bits > 0 && bits <= 1000) fields['Frames in use (bitmap)'] = String(bits);
    }
    // Entry-prefix table near the end: IMG_ (photos), MVI_ (movies), SND_ (the
    // voice-memo slot Canon pairs with each photo). Count by scanning the bytes.
    const txt = ascii(buf, 0, buf.length);
    const n = (re) => (txt.match(re) || []).length;
    const nImg = n(/IMG_/g), nMvi = n(/MVI_/g), nSnd = n(/SND_/g);
    if (nImg) fields['Photo entries (IMG_)'] = String(nImg);
    if (nMvi) fields['Movie entries (MVI_)'] = String(nMvi);
    if (nSnd) fields['Voice-memo slots (SND_)'] = String(nSnd);
  } else {
    fields['Catalog type'] = 'Master index (D.CTG)';
    if (buf.length >= 4) {
      const folders = dv.getUint32(0, true);
      if (folders > 0 && folders < 100000) fields['Folders catalogued'] = String(folders);
    }
  }

  fields['Contains'] = 'Index only - no image data';
  return fields;
}

// ---------- Windows shortcut (.LNK) ----------
// MS-SHLLINK shell link: a binary pointer to a file/folder. We read the header
// (flags, target timestamps, size, window/hotkey), skip the LinkTargetIDList,
// pull the real target path out of LinkInfo's LocalBasePath, then read the
// StringData blocks (name / relative-path / working-dir / arguments / icon) that
// the LinkFlags say are present. StringData is UTF-16 when the Unicode flag is set.
const LNK_CLSID = [0x01,0x14,0x02,0x00,0x00,0x00,0x00,0x00,0xC0,0x00,0x00,0x00,0x00,0x00,0x00,0x46];
function lnkFiletime(dv, off) {
  const lo = dv.getUint32(off, true), hi = dv.getUint32(off + 4, true);
  const ft = hi * 4294967296 + lo;            // 100-ns ticks since 1601-01-01
  if (!ft) return null;
  const d = new Date(ft / 10000 - 11644473600000);
  return isNaN(d.getTime()) ? null : d.toLocaleString();
}
function lnkCStr(buf, start) {                  // null-terminated ANSI string
  if (start < 0 || start >= buf.length) return '';
  let end = start;
  while (end < buf.length && buf[end] !== 0) end++;
  return new TextDecoder('latin1').decode(buf.subarray(start, end));
}
function lnkHotkey(raw) {
  const key = raw & 0xFF, mod = (raw >> 8) & 0xFF;
  if (!key) return null;
  const parts = [];
  if (mod & 0x02) parts.push('Ctrl');
  if (mod & 0x04) parts.push('Alt');
  if (mod & 0x01) parts.push('Shift');
  if (key >= 0x30 && key <= 0x5A) parts.push(String.fromCharCode(key));
  else if (key >= 0x70 && key <= 0x87) parts.push('F' + (key - 0x6F));
  else parts.push('0x' + key.toString(16));
  return parts.join(' + ');
}
async function parseLnk(file) {
  const buf = new Uint8Array(await file.slice(0, Math.min(file.size, 262144)).arrayBuffer());
  if (buf.length < 0x4C) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== 0x4C) return null;            // HeaderSize
  for (let i = 0; i < 16; i++) if (buf[4 + i] !== LNK_CLSID[i]) return null;

  const flags = dv.getUint32(0x14, true);
  const attrs = dv.getUint32(0x18, true);
  const targetSize = dv.getUint32(0x34, true);
  const showCmd = dv.getUint32(0x3C, true);
  const hotkey = dv.getUint16(0x40, true);
  const isUni = !!(flags & 0x80);

  let off = 0x4C;
  if (flags & 0x01) {                          // HasLinkTargetIDList → skip it
    if (off + 2 > buf.length) return null;
    off += 2 + dv.getUint16(off, true);
  }

  let localPath = null;
  if ((flags & 0x02) && off + 28 <= buf.length) {            // HasLinkInfo
    const li = off;
    const liSize = dv.getUint32(li, true);
    const liFlags = dv.getUint32(li + 8, true);
    const localBaseOff = dv.getUint32(li + 16, true);
    const suffixOff = dv.getUint32(li + 24, true);
    if ((liFlags & 0x01) && localBaseOff) {                  // VolumeIDAndLocalBasePath
      localPath = lnkCStr(buf, li + localBaseOff);
      if (suffixOff) localPath += lnkCStr(buf, li + suffixOff);
    }
    if (liSize > 0 && li + liSize <= buf.length) off = li + liSize;
  }

  const readStr = () => {                       // a StringData block
    if (off + 2 > buf.length) return null;
    const n = dv.getUint16(off, true); off += 2;
    let s = '';
    if (isUni) { for (let i = 0; i < n && off + 1 < buf.length; i++) { s += String.fromCharCode(dv.getUint16(off, true)); off += 2; } }
    else       { for (let i = 0; i < n && off < buf.length; i++)     { s += String.fromCharCode(buf[off]); off += 1; } }
    return s;
  };
  let name = null, rel = null, work = null, args = null, icon = null;
  if (flags & 0x04) name = readStr();           // HasName (description)
  if (flags & 0x08) rel  = readStr();           // HasRelativePath
  if (flags & 0x10) work = readStr();           // HasWorkingDir
  if (flags & 0x20) args = readStr();           // HasArguments
  if (flags & 0x40) icon = readStr();           // HasIconLocation

  const isDir = !!(attrs & 0x10);
  const fields = { 'Type': 'Windows shortcut (.LNK)' };
  const target = localPath || rel;
  if (target) fields['Target'] = target;
  if (isDir) fields['Target type'] = 'Folder';
  if (rel && rel !== target) fields['Relative path'] = rel;
  if (args) fields['Arguments'] = args;
  if (work) fields['Working directory'] = work;
  if (name) fields['Description'] = name;
  if (icon) fields['Icon location'] = icon;
  if (!isDir && targetSize) fields['Target size'] = fmtBytes(targetSize);
  const showMap = { 1: 'Normal window', 3: 'Maximized', 7: 'Minimized' };
  if (showMap[showCmd]) fields['Window'] = showMap[showCmd];
  const hk = lnkHotkey(hotkey);
  if (hk) fields['Hotkey'] = hk;
  const wt = lnkFiletime(dv, 0x2C);
  if (wt) fields['Target modified'] = wt;
  return fields;
}

// ---------- Internet shortcut (.URL) ----------
async function parseUrlShortcut(file) {
  const text = await file.text();
  const fields = { 'Type': 'Internet shortcut (.URL)' };
  const grab = (re) => { const m = text.match(re); return m ? m[1].trim() : null; };
  const url  = grab(/^\s*URL\s*=\s*(.+)$/im);
  const icon = grab(/^\s*IconFile\s*=\s*(.+)$/im);
  const idx  = grab(/^\s*IconIndex\s*=\s*(.+)$/im);
  if (url)  fields['URL'] = url;
  if (icon) fields['Icon file'] = icon;
  if (idx)  fields['Icon index'] = idx;
  return fields;
}

// ---------- macOS web shortcut (.webloc) ----------
async function parseWebloc(file) {
  const buf = new Uint8Array(await file.slice(0, Math.min(file.size, 65536)).arrayBuffer());
  const text = new TextDecoder('latin1').decode(buf);
  const fields = { 'Type': 'macOS web shortcut (.webloc)' };
  fields['Format'] = text.startsWith('bplist') ? 'Binary plist' : 'XML plist';
  const m = text.match(/<key>\s*URL\s*<\/key>\s*<string>([^<]+)<\/string>/i)
        || text.match(/<string>([^<]+)<\/string>/i)
        || text.match(/https?:\/\/[^\x00-\x1f"'<>\\]+/);
  if (m) fields['URL'] = (m[1] || m[0]).trim();
  return fields;
}

// ---------- Disk image (.IMG and other raw images) ----------
// Decodes the partition scheme (MBR / GPT / none) and the first volume's
// filesystem (FAT12/16/32, NTFS, exFAT) straight from the boot records, so a raw
// card/USB/floppy image reports its real layout instead of just "disk image".
const MBR_PART_TYPES = {
  0x01: 'FAT12', 0x04: 'FAT16 (<32M)', 0x05: 'Extended', 0x06: 'FAT16',
  0x07: 'NTFS / exFAT', 0x0b: 'FAT32 (CHS)', 0x0c: 'FAT32 (LBA)',
  0x0e: 'FAT16 (LBA)', 0x0f: 'Extended (LBA)', 0x82: 'Linux swap',
  0x83: 'Linux', 0xa5: 'FreeBSD', 0xaf: 'HFS / HFS+', 0xee: 'GPT protective',
  0xef: 'EFI System',
};
function fmtGuid(b, o) {
  const h = (i) => b[o + i].toString(16).padStart(2, '0');
  return (h(3) + h(2) + h(1) + h(0) + '-' + h(5) + h(4) + '-' + h(7) + h(6) + '-' +
          h(8) + h(9) + '-' + h(10) + h(11) + h(12) + h(13) + h(14) + h(15)).toUpperCase();
}
// Parse a FAT boot sector (BPB) at offset `off` in buf. Returns a fields object.
function parseFatVbr(buf, off) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out = {};
  const oem = ascii(buf, off + 3, 8).trim();
  const bps = dv.getUint16(off + 0x0b, true);
  const spc = buf[off + 0x0d];
  const totalSec = dv.getUint16(off + 0x13, true) || dv.getUint32(off + 0x20, true);
  const fs36 = ascii(buf, off + 0x36, 8).trim();
  const fs52 = ascii(buf, off + 0x52, 8).trim();
  let fsType, label, serial;
  if (fs52.startsWith('FAT32')) {
    fsType = 'FAT32'; label = ascii(buf, off + 0x47, 11).trim(); serial = dv.getUint32(off + 0x43, true);
  } else {
    fsType = fs36.startsWith('FAT') ? fs36 : (ascii(buf, off + 3, 5) === 'NTFS' ? 'NTFS' : (ascii(buf, off + 3, 5) === 'EXFAT' ? 'exFAT' : null));
    label = ascii(buf, off + 0x2b, 11).trim(); serial = dv.getUint32(off + 0x27, true);
  }
  if (fsType) out['Filesystem'] = fsType;
  if (label && label !== 'NO NAME') out['Volume label'] = label;
  if (oem) out['Formatted by'] = oem;
  if (bps && spc) out['Cluster size'] = (bps * spc / 1024) + ' KB (' + spc + ' sectors)';
  if (bps) out['Bytes/sector'] = String(bps);
  if (totalSec && bps) out['Volume size'] = fmtBytes(totalSec * bps);
  if (serial) out['Volume serial'] = (serial >>> 0).toString(16).toUpperCase().padStart(8, '0').replace(/(.{4})(.{4})/, '$1-$2');
  return out;
}
async function parseDiskImage(file) {
  const fields = { 'Type': 'Disk image' };
  try {
    const sec0 = new Uint8Array(await file.slice(0, 512).arrayBuffer());
    const dv = new DataView(sec0.buffer, sec0.byteOffset, sec0.byteLength);
    const has55aa = sec0[510] === 0x55 && sec0[511] === 0xaa;

    // Sector 0 is itself a volume boot record (superfloppy - no partition table)?
    const fsAt36 = ascii(sec0, 0x36, 5), fsAt52 = ascii(sec0, 0x52, 5), at3 = ascii(sec0, 3, 5);
    const vbrLike = (sec0[0] === 0xeb || sec0[0] === 0xe9) &&
      (fsAt36.startsWith('FAT') || fsAt52.startsWith('FAT') || at3 === 'NTFS' || at3 === 'EXFAT');

    if (vbrLike) {
      fields['Partitioning'] = 'None (single volume / superfloppy)';
      Object.assign(fields, parseFatVbr(sec0, 0));
    } else if (has55aa) {
      const parts = [];
      for (let p = 0; p < 4; p++) {
        const o = 0x1be + p * 16;
        const type = sec0[o + 4];
        if (type === 0) continue;
        parts.push({ active: sec0[o] === 0x80, type, lba: dv.getUint32(o + 8, true), count: dv.getUint32(o + 12, true) });
      }
      // GPT (protective MBR = single type-0xEE entry)
      if (parts.length === 1 && parts[0].type === 0xee) {
        const gpt = new Uint8Array(await file.slice(512, 512 + 92).arrayBuffer());
        if (ascii(gpt, 0, 8) === 'EFI PART') {
          const gdv = new DataView(gpt.buffer, gpt.byteOffset, gpt.byteLength);
          fields['Partitioning'] = 'GPT';
          fields['Disk GUID'] = fmtGuid(gpt, 0x38);
          const entLba = Number(gdv.getBigUint64(0x48, true));
          const numEnt = gdv.getUint32(0x50, true);
          const entSz = gdv.getUint32(0x54, true);
          const arr = new Uint8Array(await file.slice(entLba * 512, entLba * 512 + Math.min(numEnt * entSz, 32768)).arrayBuffer());
          const list = [];
          for (let i = 0; i + entSz <= arr.length && i / entSz < numEnt; i += entSz) {
            let empty = true;
            for (let j = 0; j < 16; j++) if (arr[i + j] !== 0) { empty = false; break; }
            if (empty) continue;
            const edv = new DataView(arr.buffer, arr.byteOffset + i, entSz);
            const first = Number(edv.getBigUint64(0x20, true)), last = Number(edv.getBigUint64(0x28, true));
            let nm = '';
            for (let c = 0; c < 36; c++) { const ch = arr[i + 0x38 + c * 2] | (arr[i + 0x38 + c * 2 + 1] << 8); if (!ch) break; nm += String.fromCharCode(ch); }
            list.push((nm || 'Partition') + ' - ' + fmtBytes((last - first + 1) * 512));
          }
          fields['Partitions'] = String(list.length);
          list.slice(0, 8).forEach((p, i) => { fields['Partition ' + (i + 1)] = p; });
        } else {
          fields['Partitioning'] = 'GPT (header unreadable)';
        }
      } else if (parts.length) {
        fields['Partitioning'] = 'MBR';
        fields['Partitions'] = String(parts.length);
        parts.forEach((pt, i) => {
          fields['Partition ' + (i + 1)] = (MBR_PART_TYPES[pt.type] || ('type 0x' + pt.type.toString(16))) +
            ' - ' + fmtBytes(pt.count * 512) + (pt.active ? ' (active)' : '');
        });
        // Decode the first partition's filesystem from its boot sector.
        const first = parts[0];
        const off = first.lba * 512;
        if (off + 512 <= file.size) {
          const vbr = new Uint8Array(await file.slice(off, off + 512).arrayBuffer());
          Object.assign(fields, parseFatVbr(vbr, 0));
        }
      } else {
        fields['Partitioning'] = 'None (boot signature only)';
      }
    } else {
      fields['Note'] = 'No MBR/VBR signature - raw or unrecognised image';
    }
  } catch (_) { /* best-effort; show whatever we gathered */ }
  fields['Image size'] = fmtBytes(file.size);
  return fields;
}

// ---------- REC: PVR/DVR recording OR data-recovery session ----------
// .rec is overloaded: many DVRs/PVRs save video as .rec, but recovery tools
// (GetDataBack, ReclaiMe) also save .rec session files. Sniff the bytes to tell
// them apart. We pull only structural fields from session XML - never the embedded
// license key.
async function parseRec(file) {
  const head = new Uint8Array(await file.slice(0, Math.min(file.size, 8192)).arrayBuffer());
  const text = new TextDecoder('latin1').decode(head);
  const trimmed = text.replace(/^﻿/, '').trimStart();
  const fields = {};

  if (trimmed.startsWith('<?xml') || trimmed[0] === '<') {
    const g = (re) => { const m = text.match(re); return m ? m[1].trim() : null; };
    if (/getdatabackrecovery/i.test(text)) {
      fields['Type'] = 'GetDataBack recovery session';
      const tool = g(/<recfilecreator>([^<]+)/i), ver = g(/<recfilecreatorversion>([^<]+)/i);
      if (tool) fields['Tool'] = tool + (ver ? ' ' + ver : '');
      const t = g(/<recfiletime>([^<]+)/i); if (t) fields['Saved'] = t;
      const name = g(/<name>([^<]+)/i), kind = g(/<kind>([^<]+)/i);
      if (name || kind) fields['Source'] = [name, kind].filter(Boolean).join(' - ');
      const from = g(/<fromsector>(\d+)/i), to = g(/<tosector>(\d+)/i);
      if (to) { const sec = (+to) - (+(from || 0)) + 1; fields['Imaged range'] = (+(from || 0)) + '–' + to + ' sectors (' + fmtBytes(sec * 512) + ')'; }
      const id = g(/<recoveryid>([^<]+)/i); if (id) fields['Recovery ID'] = id;
      return fields;
    }
    if (/reclaime/i.test(text)) { fields['Type'] = 'ReclaiMe recovery session'; return fields; }
    fields['Type'] = 'XML session / recovery file';
    return fields;
  }

  // Binary - most likely a PVR/DVR video recording.
  if (head[0] === 0x47 && head[188] === 0x47 && head[376] === 0x47) {
    fields['Type'] = 'Video recording (MPEG-TS)';
    fields['Note'] = 'PVR/DVR transport-stream recording (188-byte packets)';
  } else if (head[0] === 0x00 && head[1] === 0x00 && head[2] === 0x01 && head[3] === 0xba) {
    fields['Type'] = 'Video recording (MPEG program stream)';
  } else {
    fields['Type'] = 'REC recording (unrecognised container)';
    fields['Note'] = 'Commonly a PVR/DVR or camera video recording';
  }
  return fields;
}

// ---------- Rich Text Format (.rtf) ----------
async function parseRtf(file) {
  try {
    const text = await file.text();
    if (!text.startsWith('{\\rtf')) return { 'Type': 'Rich Text (header not found)' };
    const fields = {};
    const ver = text.match(/\{\\rtf(\d+)/);
    if (ver) fields['RTF version'] = ver[1];
    const cs = text.match(/\\ansicpg(\d+)/);
    if (cs) fields['Code page'] = cs[1];
    const gen = text.match(/\{\\\*\\generator ([^;}]+)[;}]/);
    if (gen) fields['Generator'] = gen[1].trim();
    // Info group: title / author
    const title = text.match(/\{\\title ([^}]*)\}/);
    if (title) fields['Title'] = title[1].trim();
    const author = text.match(/\{\\author ([^}]*)\}/);
    if (author) fields['Author'] = author[1].trim();
    fields['_readableText'] = stripRtf(text).slice(0, 20000);
    return fields;
  } catch (_) {
    return null;
  }
}

// Strip RTF control words and groups down to readable plain text.
function stripRtf(rtf) {
  let out = '';
  let i = 0;
  const n = rtf.length;
  let skipUntilDepth = -1;
  let depth = 0;
  while (i < n) {
    const ch = rtf[i];
    if (ch === '{') { depth++; i++; continue; }
    if (ch === '}') { if (depth === skipUntilDepth) skipUntilDepth = -1; depth--; i++; continue; }
    if (skipUntilDepth !== -1) { i++; continue; }
    if (ch === '\\') {
      // Escaped literal char?
      const next = rtf[i + 1];
      if (next === '\\' || next === '{' || next === '}') { out += next; i += 2; continue; }
      if (next === "'") { // hex byte
        i += 4; continue;
      }
      if (next === '*') { i += 2; continue; } // \* ignorable-destination marker
      // Control word
      const m = rtf.slice(i).match(/^\\([a-zA-Z]+)(-?\d+)? ?/);
      if (m) {
        const word = m[1];
        // Groups whose entire content should be dropped (metadata / fonts / etc).
        if (/^(fonttbl|colortbl|stylesheet|info|pict|object|themedata|colorschememapping|datastore|generator|\*)$/.test(word)) {
          skipUntilDepth = depth;
        }
        if (word === 'par' || word === 'line' || word === 'pard') out += '\n';
        if (word === 'tab') out += '\t';
        i += m[0].length;
        continue;
      }
      i++;
      continue;
    }
    if (ch === '\n' || ch === '\r') { i++; continue; }
    out += ch;
    i++;
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

// ---------- Font preview (live rendering via FontFace) ----------
let fontPreviewSeq = 0;
async function renderFontPreview(file, card, fontInfo) {
  let face;
  const family = 'anr-font-' + (++fontPreviewSeq);
  try {
    const buf = await file.arrayBuffer();
    face = new FontFace(family, buf);
    await face.load();
    document.fonts.add(face);
  } catch (_) {
    return; // browser couldn't load the font (e.g. unsupported flavour)
  }

  const previewCard = el('div', { class: 'anr-card' });
  previewCard.appendChild(el('h3', {}, 'Font preview'));
  const pangram = 'The quick brown fox jumps over the lazy dog';

  // Sizes
  const sizes = [48, 36, 28, 22, 18, 14];
  for (const sz of sizes) {
    previewCard.appendChild(el('p', {
      style: `font-family:'${family}';font-size:${sz}px;line-height:1.25;margin:6px 0;`
    }, pangram));
  }

  // Alphabet + numerals
  previewCard.appendChild(el('p', {
    style: `font-family:'${family}';font-size:24px;margin:14px 0 2px;`
  }, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'));
  previewCard.appendChild(el('p', {
    style: `font-family:'${family}';font-size:24px;margin:2px 0;`
  }, 'abcdefghijklmnopqrstuvwxyz 0123456789 & ? !'));

  // Varying weights
  const wRow = el('div', { style: 'margin-top:14px;border-top:1px solid var(--rule);padding-top:12px;' });
  wRow.appendChild(el('div', { class: 'anr-readout-section' }, 'Weights'));
  for (const w of [100, 300, 400, 500, 700, 900]) {
    wRow.appendChild(el('p', {
      style: `font-family:'${family}';font-weight:${w};font-size:22px;margin:3px 0;`
    }, w + ' - ' + pangram));
  }
  previewCard.appendChild(wRow);

  // Variable font: animate a big "A" pulsing weight from lightest to boldest,
  // ease-in-out, looping. Driven by requestAnimationFrame so it works everywhere.
  if (fontInfo && fontInfo.variable && fontInfo.wght) {
    const { min, max } = fontInfo.wght;
    const varRow = el('div', { style: 'margin-top:14px;border-top:1px solid var(--rule);padding-top:12px;text-align:center;' });
    varRow.appendChild(el('div', { class: 'anr-readout-section', style: 'text-align:left;' },
      'Variable axis - weight ' + Math.round(min) + ' to ' + Math.round(max)));
    const bigA = el('div', {
      style: `font-family:'${family}';font-size:140px;line-height:1.1;font-variation-settings:"wght" ${min};`
    }, 'A');
    varRow.appendChild(bigA);
    previewCard.appendChild(varRow);
    const period = 3000; // ms for a full lightest→boldest sweep
    let t0 = null;
    const tick = (ts) => {
      if (!bigA.isConnected) return; // stop when removed (new file analysed)
      if (t0 === null) t0 = ts;
      // Triangle wave 0→1→0 with ease-in-out shaping.
      const phase = ((ts - t0) % (period * 2)) / period;
      const tri = phase <= 1 ? phase : 2 - phase;
      const eased = tri < 0.5 ? 2 * tri * tri : 1 - Math.pow(-2 * tri + 2, 2) / 2;
      bigA.style.fontVariationSettings = '"wght" ' + Math.round(min + (max - min) * eased);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  card.appendChild(previewCard);
}

// ---------- Valve KeyValues (.vdf / .acf) ----------
// Steam/Source text format: nested "key" "value" pairs with { } blocks. Used by
// appmanifest, libraryfolders, loginusers, config, etc.
function prettyKV(obj, indent) {
  indent = indent || 0;
  const pad = '  '.repeat(indent);
  let s = '';
  for (const k in obj) {
    const v = obj[k];
    if (v && typeof v === 'object') {
      s += pad + k + '\n' + pad + '{\n' + prettyKV(v, indent + 1) + pad + '}\n';
    } else {
      s += pad + k + '  =  ' + v + '\n';
    }
  }
  return s;
}

async function parseVdf(file) {
  let text;
  try { text = await file.text(); } catch (_) { return null; }
  if (!text) return null;

  // Tokenise: quoted strings (with escapes), braces, or bare tokens. Line // and
  // block comments are stripped first.
  text = text.replace(/\/\/[^\n]*/g, '');
  const tokens = [];
  const re = /"((?:[^"\\]|\\.)*)"|(\{)|(\})|([^\s"{}]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[2]) tokens.push({ t: '{' });
    else if (m[3]) tokens.push({ t: '}' });
    else if (m[1] !== undefined) tokens.push({ t: 's', v: m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\') });
    else tokens.push({ t: 's', v: m[4] });
  }
  if (!tokens.length) return null;

  let i = 0;
  function parseObj() {
    const obj = {};
    while (i < tokens.length) {
      const tk = tokens[i];
      if (tk.t === '}') { i++; break; }
      if (tk.t !== 's') { i++; continue; }
      const key = tk.v; i++;
      const next = tokens[i];
      if (next && next.t === '{') { i++; obj[key] = parseObj(); }
      else if (next && next.t === 's') { obj[key] = next.v; i++; }
      else { obj[key] = ''; }
    }
    return obj;
  }

  let rootKey = null, root = null;
  if (tokens[0].t === 's' && tokens[1] && tokens[1].t === '{') {
    rootKey = tokens[0].v; i = 2; root = parseObj();
  } else {
    i = 0; root = parseObj();
  }
  if (!root || !Object.keys(root).length) return null;

  // Count leaves + surface notable fields found anywhere in the tree.
  let leaves = 0;
  const notable = {};
  const NOTE = { appid: 'App ID', name: 'Name', installdir: 'Install dir',
    buildid: 'Build ID', SizeOnDisk: 'Size on disk', LastUpdated: 'Last updated',
    LastOwner: 'Last owner', universe: 'Universe', PersonaName: 'Persona name',
    AccountName: 'Account name', language: 'Language', version: 'Version' };
  (function walk(o) {
    for (const k in o) {
      const v = o[k];
      if (v && typeof v === 'object') walk(v);
      else { leaves++; if (NOTE[k] && notable[k] === undefined) notable[k] = v; }
    }
  })(root);

  const res = { 'Format': 'Valve KeyValues (VDF)' };
  if (rootKey) res['Root key'] = rootKey;
  res['Total entries'] = leaves.toLocaleString();
  for (const k in notable) {
    let v = notable[k];
    if (k === 'SizeOnDisk' && /^\d+$/.test(v)) v = fmtBytes(Number(v));
    if ((k === 'LastUpdated' || k === 'LastOwner') && /^\d{9,}$/.test(v)) {
      const d = new Date(Number(v) * 1000);
      if (!isNaN(d)) v = v + '  (' + d.toLocaleString() + ')';
    }
    res[NOTE[k]] = v;
  }
  res._readableText = prettyKV(rootKey ? { [rootKey]: root } : root);
  return res;
}

// ---------- per-extension parser dispatch ----------
// Maps an extension to a metadata parser. Functions receive { head, file, ext }
// and may be sync or async (the caller awaits the result). To add a format,
// drop a line here rather than extending a branch chain.
const PARSERS = {
  vdf:   c => parseVdf(c.file),
  acf:   c => parseVdf(c.file),
  psd:   c => parsePsd(c.head),
  psb:   c => parsePsd(c.head),
  dwg:   c => parseDwg(c.head),
  dwt:   c => parseDwg(c.head),
  blend: c => parseBlender(c.head),
  fbx:   c => parseFbx(c.head),
  glb:   c => parseGlb(c.head),
  stl:   c => parseStl(c.head),
  swf:   c => parseSwf(c.head),
  exe:   c => parseExe(c),
  dll:   c => parseExe(c),
  ttf:   c => parseFont(c.file),
  otf:   c => parseFont(c.file),
  flp:   c => parseFlp(c.file),
  rar:   c => parseRar(c.head),
  '7z':  c => parse7z(c.head),
  sqlite: c => parseSqlite(c.head, c.file),
  sqlite3: c => parseSqlite(c.head, c.file),
  db3:   c => parseSqlite(c.head, c.file),
  db:    c => parseSqlite(c.head, c.file),
  lrcat: c => parseSqlite(c.head, c.file),   // Lightroom catalog is a SQLite database
  'sqlite-wal':  c => parseSqliteWal(c.head, c.file),
  'sqlite3-wal': c => parseSqliteWal(c.head, c.file),
  'db-wal':      c => parseSqliteWal(c.head, c.file),
  'db3-wal':     c => parseSqliteWal(c.head, c.file),
  'sqlite-shm':  c => parseSqliteShm(c.head),
  'sqlite3-shm': c => parseSqliteShm(c.head),
  'db-shm':      c => parseSqliteShm(c.head),
  'db3-shm':     c => parseSqliteShm(c.head),
  xcf:   c => parseXcf(c.head),
  torrent: c => parseTorrent(c.file),
  als:   c => parseGzipXmlProject(c.file, c.ext),
  alp:   c => parseGzipXmlProject(c.file, c.ext),
  prproj: c => parseGzipXmlProject(c.file, c.ext),
  prel:  c => parseGzipXmlProject(c.file, c.ext),
  aep:   c => parseAep(c.file),
  aet:   c => parseAep(c.file),
  veg:   c => parseVeg(c.file),
  vf:    c => parseVeg(c.file),
  drp:   c => parseDrp(c.file, c.ext),
  drt:   c => parseDrp(c.file, c.ext),
  wfp:   c => parseFilmora(c.file, c.ext),
  wsp:   c => parseFilmora(c.file, c.ext),
  json:  c => parseCapcut(c.file),
  gcode: c => parseGcode(c.file),
  gco:   c => parseGcode(c.file),
  nc:    c => parseGcode(c.file),
  ngc:   c => parseGcode(c.file),
  tap:   c => parseGcode(c.file),
  cnc:   c => parseGcode(c.file),
  log:   c => parseLogOrigin(c.file),
  msi:   c => parseMsi(c.head),
  apk:   c => parseApk(c.file),
  crt:   c => parseCert(c.file),
  cer:   c => parseCert(c.file),
  pem:   c => parseCert(c.file),
  der:   c => parseCert(c.file),
  aepx:  c => parseAepx(c.file),
  part:  c => parsePart(c.file, c.head),
  crdownload: c => parsePart(c.file, c.head),
  ec3:   c => parseEac3(c.head),
  eac3:  c => parseEac3(c.head),
  thd:   c => parseTrueHd(c.head),
  mlp:   c => parseTrueHd(c.head),
  cdp:   c => parseCdp(c.file, c.head),
  rtf:   c => parseRtf(c.file),
  bepis: c => parseBepis(c.file, c.head),
  ctg:   c => parseCtg(c.file),
  lnk:   c => parseLnk(c.file),
  url:   c => parseUrlShortcut(c.file),
  webloc: c => parseWebloc(c.file),
  img:   c => parseDiskImage(c.file),
  rec:   c => parseRec(c.file),
};

// ---------- main render ----------
export async function renderProprietary(file, container, extOverride) {
  const ext = extOverride || extFromName(file.name);
  const fmt = FORMATS[ext];
  if (!fmt) return false;

  container.hidden = false;
  const card = el('div', { class: 'anr-card' });
  // Title + Application default to the catalog name, but a parser may resolve a
  // more specific one via extra._app (e.g. a .cdp is either Criterium
  // DecisionPlus or CDP4/COMET - we show whichever the bytes prove, not both).
  const h3El = el('h3', {}, fmt.app);
  card.appendChild(h3El);

  const tbl = el('table', { class: 'anr-readout' });
  const appRow = row('Application', fmt.app);
  tbl.appendChild(appRow);
  tbl.appendChild(row('File', file.name));
  tbl.appendChild(row('Size', fmtBytes(file.size)));

  // Read header bytes for magic-based parsing (more for PE/EXE to walk import tables)
  const headSize = (ext === 'exe' || ext === 'dll' || ext === 'msi') ? Math.min(file.size, 65536) : 4096;
  const head = new Uint8Array(await file.slice(0, headSize).arrayBuffer());
  let extra = null;

  // Per-extension metadata parsers. Each receives { head, file, ext } and may be
  // sync or async; the result is awaited. Aliases (e.g. psd/psb) share an entry.
  const fn = PARSERS[ext];
  if (fn) extra = await fn({ head, file, ext });

  // Lazily-loaded parser chunks. New formats register a `chunk` in FORMATS and
  // ship their parser in parsers-<chunk>.js, so the boot bundle stays flat as the
  // format count grows (the chunk is fetched only when such a file is opened).
  // Each chunk exports a PARSERS map: ext -> ({head,file,ext}) => rows object,
  // using the same return shape as the built-in parsers (plain key/value pairs,
  // plus optional `_`-prefixed payloads handled below).
  if (!extra && !fn && fmt.chunk) {
    try {
      const mod = await import('../parsers/parsers-' + fmt.chunk + '.js');
      const lazyFn = mod.PARSERS && mod.PARSERS[ext];
      if (lazyFn) extra = await lazyFn({ head, file, ext });
    } catch (e) { /* chunk unavailable - fall through to generic handling */ }
  }

  // ISO: primary volume descriptor at sector 16 (32768 bytes)
  if (!extra && ext === 'iso' && file.size > 32868) {
    const isoBuf = new Uint8Array(await file.slice(32768, 32868).arrayBuffer());
    extra = parseIso(isoBuf);
  }

  // OLE-based formats (SolidWorks, old Office)
  if (!extra && (head[0] === 0xD0 && head[1] === 0xCF)) {
    extra = parseOle(head);
  }

  // Text-based CAD exchange
  if (!extra && (ext === 'step' || ext === 'stp')) extra = await parseTextCad(file, 'STEP');
  if (!extra && (ext === 'iges' || ext === 'igs')) extra = await parseTextCad(file, 'IGES');

  // ZIP-based document formats
  if (!extra && fmt.zip) extra = await parseZipMeta(file, ext);

  // Generic text/XML version detection for formats without a dedicated parser
  if (!extra && (fmt.parse === 'text' || fmt.parse === 'xml')) extra = await parseTextVersion(file);

  let extraFileList = null;
  if (extra) {
    // A parser can pin down the exact application once the bytes identify it.
    if (extra._app) { h3El.textContent = extra._app; appRow.lastChild.textContent = extra._app; }
    // Optional per-field tooltips (e.g. the PE/EXE readout sets extra._help).
    const help = extra._help || null;
    for (const [k, v] of Object.entries(extra)) {
      if (k === '_fileList') { extraFileList = v; continue; }
      if (k.startsWith('_')) continue;   // internal payloads (e.g. _font, _readableText)
      if (v !== undefined) tbl.appendChild(help && help[k] ? rowHelp(k, String(v), help[k]) : row(k, String(v)));
    }
  }

  // XMP sidecar - full metadata parse
  let xmpData = null;
  if (ext === 'xmp') {
    xmpData = await parseXmp(file);
    if (xmpData) {
      for (const [k, v] of Object.entries(xmpData.fields)) {
        tbl.appendChild(row(k, v));
      }
    }
  }

  // MIME type if available
  if (file.type) tbl.appendChild(rowHelp('MIME type', file.type, "The MIME type is the standard label for the file's format (for example image/jpeg or audio/mpeg). The browser reads it from the extension or the operating system, so it's a hint rather than proof of the real format."));

  // Last modified
  if (file.lastModified) {
    tbl.appendChild(row('Last modified', new Date(file.lastModified).toLocaleString()));
  }

  card.appendChild(tbl);

  // Optional decoded preview supplied by a parser (e.g. a <canvas>/<img> from an
  // image-format chunk, or a small chart). Rendered right under the readout.
  if (extra && extra._previewNode instanceof Node) {
    card.appendChild(extra._previewNode);
  }

  // Font preview (TTF/OTF/WOFF/WOFF2/TTC) - render sample text live with the font.
  if (ext === 'ttf' || ext === 'otf' || ext === 'woff' || ext === 'woff2' || ext === 'ttc') {
    await renderFontPreview(file, card, extra && extra._font);
  }

  // Torrent file list (rendered as its own block beneath the readout)
  if (extraFileList && extraFileList.length) {
    const det = el('details', { style: 'margin-top: 14px;' });
    det.appendChild(el('summary', {}, 'Contents (' + extraFileList.length + ' entries)'));
    const pre = el('pre', { class: 'anr-code', style: 'max-height:400px; overflow:auto; font-size:12px;' });
    pre.textContent = extraFileList.join('\n');
    det.appendChild(pre);
    card.appendChild(det);
  }

  const hashRow = sha256Row(file);
  tbl.appendChild(hashRow);

  // Readable text block (e.g. RTF stripped of control words)
  if (extra && extra._readableText) {
    const det = el('details', { style: 'margin-top: 14px;', open: '' });
    det.appendChild(el('summary', {}, 'Readable text'));
    const pre = el('pre', { class: 'anr-ocr-text', style: 'max-height:400px; overflow:auto; white-space:pre-wrap;' });
    pre.textContent = extra._readableText;
    det.appendChild(pre);
    card.appendChild(det);
  }

  // Text / code preview for web files
  if (fmt.parse === 'text' || fmt.parse === 'html') {
    try {
      const fullText = await file.text();
      const lines = fullText.split('\n');
      tbl.insertBefore(row('Lines', lines.length.toLocaleString()), hashRow);

      // HTML: sandboxed rendered preview
      if (fmt.parse === 'html') {
        const previewDet = el('details', { style: 'margin-top: 14px;', open: '' });
        previewDet.appendChild(el('summary', {}, 'Rendered preview'));
        const blob = new Blob([fullText], { type: 'text/html;charset=utf-8' });
        const iframe = el('iframe', {
          src: URL.createObjectURL(blob),
          sandbox: 'allow-same-origin',
          style: 'width:100%;height:400px;border:1px solid var(--rule);background:#fff;margin-top:8px'
        });
        previewDet.appendChild(iframe);
        card.appendChild(previewDet);
      }

      const det = el('details', { style: 'margin-top: 14px;' });
      const summary = el('summary', { style: 'display:flex;align-items:center;gap:10px' });
      summary.appendChild(document.createTextNode('Source (first 200 lines)'));
      const openBtn = el('button', {
        type: 'button',
        class: 'anr-open-tab',
        style: 'font-family:var(--font-mono);font-size:10px;letter-spacing:0.1em;text-transform:uppercase;' +
               'background:transparent;border:1px solid var(--hairline);color:var(--muted);padding:2px 8px;cursor:pointer'
      }, 'Open full');
      openBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Reuse the "Supported formats" overlay styling: the header (file name +
        // close) lives OUTSIDE the scrolling body, so the close button stays put
        // instead of scrolling away with the text. No search bar.
        const closeBtn = el('button', { type: 'button', class: 'fmt-overlay-close' }, '×');
        const header = el('div', { class: 'fmt-overlay-header' }, [el('h3', {}, file.name), closeBtn]);
        const fullPre = el('pre', { class: 'anr-code', style: 'font-size:12px;white-space:pre-wrap;word-break:break-all;margin:0;' });
        fullPre.textContent = fullText;
        const body = el('div', { class: 'fmt-overlay-body' }, [fullPre]);
        const inner = el('div', { class: 'fmt-overlay-inner' }, [header, body]);
        const overlay = el('div', { class: 'fmt-overlay anr-text-overlay' }, [inner]);
        document.body.appendChild(overlay);
        document.body.style.overflow = 'hidden';
        const onKey = (ev) => { if (ev.key === 'Escape') close(); };
        function close() { overlay.remove(); document.body.style.overflow = ''; document.removeEventListener('keydown', onKey); }
        closeBtn.addEventListener('click', close);
        overlay.addEventListener('click', (ev) => { if (ev.target === overlay) close(); });
        document.addEventListener('keydown', onKey);
      });
      summary.appendChild(openBtn);
      det.appendChild(summary);
      const pre = el('pre', { class: 'anr-code', style: 'max-height:400px; overflow:auto; font-size:12px;' });
      pre.textContent = lines.slice(0, 200).join('\n');
      det.appendChild(pre);
      card.appendChild(det);
    } catch (_) {}
  }

  // XMP raw XML preview
  if (xmpData && xmpData.raw) {
    const det = el('details', { style: 'margin-top: 14px;' });
    det.appendChild(el('summary', {}, 'Raw XMP'));
    const pre = el('pre', { class: 'anr-code', style: 'max-height:400px; overflow:auto; font-size:12px;' });
    pre.textContent = xmpData.raw;
    det.appendChild(pre);
    card.appendChild(det);
  }

  // Optional extra collapsible sections supplied by a parser as `_sections`:
  // an array of { title, node, open? } - used for file lists, hex blocks,
  // per-track tables, decoded sub-structures, etc.
  if (extra && Array.isArray(extra._sections)) {
    for (const sec of extra._sections) {
      if (!sec || !(sec.node instanceof Node)) continue;
      const det = el('details', sec.open ? { style: 'margin-top:14px;', open: '' } : { style: 'margin-top:14px;' });
      det.appendChild(el('summary', {}, sec.title || 'Details'));
      det.appendChild(sec.node);
      card.appendChild(det);
    }
  }

  container.appendChild(card);
  return true;
}

// Check if a file extension is a known proprietary format
export function isProprietaryExt(ext) {
  return ext in FORMATS;
}
