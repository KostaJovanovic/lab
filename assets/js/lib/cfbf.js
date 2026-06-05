/* Analyser - shared OLE2 / Compound File Binary Format (CFBF) reader.

   CFBF (aka CFB / "OLE storage") is the on-disk container behind a whole family
   of legacy Microsoft formats: Outlook .msg, the pre-2007 Office documents
   (.doc/.xls/.ppt), Windows Installer .msi, Thumbs.db, and many proprietary
   tool files that wrapped their data in an OLE structured-storage. The container
   is a little FAT filesystem inside a single file:

     - a 512-byte header (magic D0 CF 11 E0 A1 B1 1A E1) names the sector size,
       mini-sector size, and the first sectors of the FAT, the directory and the
       mini-FAT, plus the DIFAT (the table that lists the FAT sectors);
     - the FAT is a singly-linked sector-allocation table — follow next-sector
       pointers from a stream's start sector to assemble it;
     - the directory is a stream of 128-byte entries arranged as a red-black tree
       (storages = directories, streams = files); the Root Entry also owns the
       "mini-stream" which holds every stream smaller than 4096 bytes, allocated
       in 64-byte mini-sectors via a parallel mini-FAT.

   This module is dependency-free and side-effect-free: it only reads. Everything
   is bounds-checked and returns null / empty on malformed input so a corrupt file
   can never throw out of `openCfbf`. */

// Special FAT sector values.
const MAXREGSECT = 0xFFFFFFFA;   // last regular sector id
const DIFSECT    = 0xFFFFFFFC;   // FAT sector used by the DIFAT itself
const FATSECT    = 0xFFFFFFFD;   // FAT sector
const ENDOFCHAIN = 0xFFFFFFFE;   // end of a sector chain
const FREESECT   = 0xFFFFFFFF;   // unallocated sector
const NOSTREAM   = 0xFFFFFFFF;   // "no child/sibling" directory pointer

const MINI_CUTOFF = 4096;        // streams smaller than this live in the mini-stream

// Directory entry object types.
const T_UNKNOWN = 0, T_STORAGE = 1, T_STREAM = 2, T_ROOT = 5;

// Coerce the input into a Uint8Array. Accepts a Blob/File, ArrayBuffer or
// Uint8Array. Returns null if it can't.
async function toBytes(input) {
  try {
    if (input == null) return null;
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (typeof input.arrayBuffer === 'function') return new Uint8Array(await input.arrayBuffer());
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  } catch (_) {}
  return null;
}

/* Open a Compound File. Resolves to a reader object, or null when the bytes are
   not a valid CFBF or are too corrupt to navigate.

   Returned shape:
     {
       entries: [{ name, type, size, path }],     // every directory entry
       names(): string[],                          // entry names (leaf)
       readStream(nameOrPredicate): Uint8Array|null
     }
   readStream accepts an exact stream name, or a predicate (entry) => boolean for
   matching by path / suffix. It assembles the stream by walking the FAT (or the
   mini-FAT for streams below the 4096-byte cutoff). */
export async function openCfbf(input) {
  try {
    const bytes = await toBytes(input);
    if (!bytes || bytes.length < 512) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // ---- header ----
    const MAGIC = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
    for (let i = 0; i < 8; i++) if (bytes[i] !== MAGIC[i]) return null;

    const u32 = (off) => (off + 4 <= bytes.length ? view.getUint32(off, true) >>> 0 : FREESECT);
    const u16 = (off) => (off + 2 <= bytes.length ? view.getUint16(off, true) : 0);

    const minorVersion  = u16(0x18);
    const majorVersion  = u16(0x1A);
    const byteOrder     = u16(0x1C);          // expect 0xFFFE (little-endian)
    const sectorShift   = u16(0x1E);
    const miniSectorShift = u16(0x20);
    const numDirSectors = u32(0x28);          // 0 for the 512-byte sector version
    const numFatSectors = u32(0x2C);
    const dirStart      = u32(0x30);
    const miniCutoff    = u32(0x38);          // mini-stream cutoff (always 4096)
    const miniFatStart  = u32(0x3C);
    const numMiniFat    = u32(0x40);
    const difatStart    = u32(0x44);
    const numDifat      = u32(0x48);

    if (byteOrder !== 0xFFFE) return null;
    if (sectorShift !== 9 && sectorShift !== 12) return null;       // 512 or 4096
    if (miniSectorShift !== 6) return null;                          // 64-byte mini-sectors

    const sectorSize = 1 << sectorShift;        // 512 or 4096
    const miniSize   = 1 << miniSectorShift;    // 64
    const cutoff     = miniCutoff || MINI_CUTOFF;
    const numSectors = Math.floor((bytes.length - 512) / sectorSize);

    // Byte offset of regular sector `id` (sectors are numbered from after the
    // 512-byte header). Returns -1 if out of range.
    const sectorOffset = (id) => {
      if (id > MAXREGSECT) return -1;
      const off = 512 + id * sectorSize;
      if (off < 0 || off + sectorSize > bytes.length + 1) return -1;
      return off;
    };

    // ---- DIFAT: list of FAT sector ids ----
    // The first 109 FAT-sector pointers live in the header (offset 0x4C..0x200).
    const fatSectorIds = [];
    for (let i = 0; i < 109; i++) {
      const id = u32(0x4C + i * 4);
      if (id === FREESECT || id > MAXREGSECT) continue;
      fatSectorIds.push(id);
    }
    // Remaining DIFAT (if any) is itself a chain of sectors; each holds
    // (sectorSize/4 - 1) FAT-sector pointers plus a pointer to the next DIFAT sector.
    {
      let sect = difatStart;
      const perSector = (sectorSize >> 2) - 1;
      let guard = 0;
      while (sect !== ENDOFCHAIN && sect !== FREESECT && sect <= MAXREGSECT && guard++ < numSectors + 1) {
        const base = sectorOffset(sect);
        if (base < 0) break;
        for (let i = 0; i < perSector; i++) {
          const id = u32(base + i * 4);
          if (id !== FREESECT && id <= MAXREGSECT) fatSectorIds.push(id);
        }
        sect = u32(base + perSector * 4);
      }
    }

    // ---- FAT: concatenate all FAT sectors into one big next-sector array ----
    const entriesPerFat = sectorSize >> 2;
    const fat = new Uint32Array(fatSectorIds.length * entriesPerFat);
    {
      let w = 0;
      for (const id of fatSectorIds) {
        const base = sectorOffset(id);
        if (base < 0) { w += entriesPerFat; continue; }
        for (let i = 0; i < entriesPerFat; i++) fat[w++] = u32(base + i * 4);
      }
    }
    const fatLen = fat.length;

    // Walk a FAT chain from `start`, returning the ordered list of sector ids.
    // Guarded against loops and runaway lengths.
    const fatChain = (start, maxSectors) => {
      const out = [];
      let s = start >>> 0;
      const seen = new Set();
      const cap = Math.min(maxSectors == null ? fatLen : maxSectors, fatLen + 1);
      while (s !== ENDOFCHAIN && s <= MAXREGSECT && out.length <= cap) {
        if (seen.has(s)) break;               // cycle guard
        seen.add(s);
        out.push(s);
        if (s >= fatLen) break;
        s = fat[s];
      }
      return out;
    };

    // Read a whole FAT-allocated stream (start sector + byte size) into bytes.
    const readFatStream = (start, size) => {
      if (size <= 0) return new Uint8Array(0);
      const need = Math.ceil(size / sectorSize);
      const chain = fatChain(start, need + 1);
      const out = new Uint8Array(size);
      let written = 0;
      for (const sid of chain) {
        if (written >= size) break;
        const base = sectorOffset(sid);
        if (base < 0) break;
        const n = Math.min(sectorSize, size - written, bytes.length - base);
        if (n <= 0) break;
        out.set(bytes.subarray(base, base + n), written);
        written += n;
      }
      return written === size ? out : out.subarray(0, written);
    };

    // ---- directory stream ----
    // For the 512-byte version numDirSectors is 0, so follow the FAT chain from
    // dirStart until ENDOFCHAIN.
    const dirChain = fatChain(dirStart, numSectors + 1);
    if (!dirChain.length) return null;
    const dirBytesLen = dirChain.length * sectorSize;
    const dirBytes = new Uint8Array(dirBytesLen);
    {
      let w = 0;
      for (const sid of dirChain) {
        const base = sectorOffset(sid);
        if (base < 0) { w += sectorSize; continue; }
        dirBytes.set(bytes.subarray(base, base + sectorSize), w);
        w += sectorSize;
      }
    }
    const dirView = new DataView(dirBytes.buffer, dirBytes.byteOffset, dirBytes.byteLength);

    // Parse 128-byte directory entries.
    const rawEntries = [];
    const entryCount = Math.floor(dirBytes.length / 128);
    for (let i = 0; i < entryCount; i++) {
      const o = i * 128;
      const nameLen = dirView.getUint16(o + 64, true);   // bytes incl. terminating NUL
      const type    = dirBytes[o + 66];
      const color   = dirBytes[o + 67];
      const left    = dirView.getUint32(o + 68, true) >>> 0;
      const right   = dirView.getUint32(o + 72, true) >>> 0;
      const child   = dirView.getUint32(o + 76, true) >>> 0;
      const startSect = dirView.getUint32(o + 116, true) >>> 0;
      // 8-byte stream size (low dword good enough; CFBF streams are well under 4 GB here).
      const sizeLo  = dirView.getUint32(o + 120, true) >>> 0;
      const sizeHi  = dirView.getUint32(o + 124, true) >>> 0;
      const size    = sizeHi ? (sizeHi * 0x100000000 + sizeLo) : sizeLo;

      let name = '';
      if (type !== T_UNKNOWN && nameLen >= 2 && nameLen <= 64) {
        const chars = (nameLen >> 1) - 1;                // drop terminating NUL
        for (let c = 0; c < chars; c++) {
          const code = dirView.getUint16(o + c * 2, true);
          if (code === 0) break;
          name += String.fromCharCode(code);
        }
      }
      rawEntries.push({ index: i, name, type, color, left, right, child, startSect, size });
    }

    if (!rawEntries.length || rawEntries[0].type !== T_ROOT) {
      // Root Entry must be the first directory entry.
      if (!rawEntries.length) return null;
    }
    const root = rawEntries[0];

    // ---- mini-stream + mini-FAT (for streams below the cutoff) ----
    // The mini-FAT is a FAT-allocated stream of 4-byte next-sector ids over the
    // 64-byte mini-stream; the mini-stream itself is the Root Entry's content.
    let miniFat = new Uint32Array(0);
    if (miniFatStart !== ENDOFCHAIN && miniFatStart !== FREESECT && miniFatStart <= MAXREGSECT) {
      const mfChain = fatChain(miniFatStart, (numMiniFat || numSectors) + 1);
      miniFat = new Uint32Array(mfChain.length * entriesPerFat);
      let w = 0;
      for (const sid of mfChain) {
        const base = sectorOffset(sid);
        if (base < 0) { w += entriesPerFat; continue; }
        for (let i = 0; i < entriesPerFat; i++) miniFat[w++] = u32(base + i * 4);
      }
    }
    const miniFatLen = miniFat.length;

    // The mini-stream lives in the Root Entry (FAT-allocated).
    let miniStream = new Uint8Array(0);
    if (root && root.type === T_ROOT && root.size > 0) {
      miniStream = readFatStream(root.startSect, root.size);
    }

    // Read a mini-FAT-allocated stream (start mini-sector + size) from the mini-stream.
    const readMiniStream = (start, size) => {
      if (size <= 0) return new Uint8Array(0);
      const out = new Uint8Array(size);
      let written = 0;
      let s = start >>> 0;
      const seen = new Set();
      let guard = 0;
      const cap = miniFatLen + 1;
      while (s !== ENDOFCHAIN && s <= MAXREGSECT && written < size && guard++ < cap) {
        if (seen.has(s)) break;
        seen.add(s);
        const base = s * miniSize;
        if (base < 0 || base >= miniStream.length) break;
        const n = Math.min(miniSize, size - written, miniStream.length - base);
        if (n <= 0) break;
        out.set(miniStream.subarray(base, base + n), written);
        written += n;
        s = s < miniFatLen ? miniFat[s] : ENDOFCHAIN;
      }
      return written === size ? out : out.subarray(0, written);
    };

    // Read any stream entry's bytes, choosing FAT vs mini-FAT by the cutoff.
    const readEntry = (e) => {
      if (!e || e.type !== T_STREAM) return null;
      if (e.size < cutoff) return readMiniStream(e.startSect, e.size);
      return readFatStream(e.startSect, e.size);
    };

    // ---- build paths via the red-black sibling/child tree ----
    // Each storage's `child` points at the root of a red-black tree of its
    // immediate children (linked by left/right). Walk it to assign full paths.
    const assignPaths = (nodeIndex, prefix, depth) => {
      if (nodeIndex === NOSTREAM || nodeIndex >= rawEntries.length) return;
      if (depth > rawEntries.length) return;          // safety
      const visit = (idx, seen) => {
        if (idx === NOSTREAM || idx >= rawEntries.length || seen.has(idx)) return;
        seen.add(idx);
        const e = rawEntries[idx];
        visit(e.left, seen);
        e.path = prefix + e.name;
        if (e.type === T_STORAGE && e.child !== NOSTREAM) {
          assignPaths(e.child, e.path + '/', depth + 1);
        }
        visit(e.right, seen);
      };
      visit(nodeIndex, new Set());
    };
    root.path = root.name || 'Root Entry';
    if (root.child !== NOSTREAM) assignPaths(root.child, root.path + '/', 0);
    // Any entry the tree walk missed still gets at least its bare name as a path.
    for (const e of rawEntries) if (e.path == null && e.type !== T_UNKNOWN) e.path = e.name;

    const entries = rawEntries
      .filter((e) => e.type !== T_UNKNOWN && e.name)
      .map((e) => ({ name: e.name, type: e.type, size: e.size, path: e.path || e.name }));

    // Map from name/path -> raw entry for readStream lookups.
    const byName = new Map();
    const byPath = new Map();
    for (const e of rawEntries) {
      if (e.type !== T_STREAM || !e.name) continue;
      if (!byName.has(e.name)) byName.set(e.name, e);
      if (e.path) byPath.set(e.path, e);
    }

    const readStream = (nameOrPredicate) => {
      try {
        if (typeof nameOrPredicate === 'function') {
          for (const e of rawEntries) {
            if (e.type !== T_STREAM || !e.name) continue;
            if (nameOrPredicate({ name: e.name, type: e.type, size: e.size, path: e.path || e.name })) {
              return readEntry(e);
            }
          }
          return null;
        }
        const key = String(nameOrPredicate);
        const e = byPath.get(key) || byName.get(key);
        return e ? readEntry(e) : null;
      } catch (_) {
        return null;
      }
    };

    return {
      version: majorVersion + '.' + minorVersion,
      sectorSize,
      entries,
      rawEntries,        // exposed for tree-walking consumers (e.g. attachment storages)
      names() { return entries.map((e) => e.name); },
      readStream,
    };
  } catch (_) {
    return null;
  }
}
