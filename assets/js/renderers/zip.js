/* Analyser - shared ZIP reader
   Minimal reader for ZIP-based formats (xlsx, epub, pptx). Walks local file
   headers sequentially and inflates entries on demand with DecompressionStream.
   Used by xlsx.js, epub.js, and pptx.js. */

// Read the local-file-header table. Returns { entries, buf } where each entry is
// { name, method, compSize, uncompSize, dataStart }. Reads up to maxBytes.
export async function readZipEntries(file, maxBytes = 32 * 1024 * 1024) {
  const maxRead = Math.min(file.size, maxBytes);
  const buf = new Uint8Array(await file.slice(0, maxRead).arrayBuffer());
  const view = new DataView(buf.buffer);
  const entries = [];
  let pos = 0;
  while (pos + 30 < buf.length) {
    if (buf[pos] !== 0x50 || buf[pos + 1] !== 0x4B ||
        buf[pos + 2] !== 0x03 || buf[pos + 3] !== 0x04) break;
    const flags = view.getUint16(pos + 6, true);
    const method = view.getUint16(pos + 8, true);
    let compSize = view.getUint32(pos + 18, true);
    const uncompSize = view.getUint32(pos + 22, true);
    const nameLen = view.getUint16(pos + 26, true);
    const extraLen = view.getUint16(pos + 28, true);
    let name = '';
    for (let i = 0; i < nameLen; i++) name += String.fromCharCode(buf[pos + 30 + i]);
    const dataStart = pos + 30 + nameLen + extraLen;
    // Bit 3 set means sizes live in a trailing data descriptor; we can't trust
    // compSize, so bail out of sequential walking for that entry.
    if ((flags & 0x08) && compSize === 0) break;
    entries.push({ name, method, compSize, uncompSize, dataStart });
    pos = dataStart + compSize;
  }
  return { entries, buf };
}

export async function inflateToBytes(buf, entry) {
  const raw = buf.slice(entry.dataStart, entry.dataStart + entry.compSize);
  if (entry.method === 0) return raw;
  if (entry.method === 8 && typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    writer.write(raw);
    writer.close();
    const reader = ds.readable.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  }
  return null;
}

export async function inflateToText(buf, entry) {
  const bytes = await inflateToBytes(buf, entry);
  return bytes ? new TextDecoder().decode(bytes) : null;
}

// Convenience: read the whole archive into a Map name -> entry, plus the buffer.
export async function openZip(file, maxBytes) {
  const { entries, buf } = await readZipEntries(file, maxBytes);
  const map = new Map();
  for (const e of entries) map.set(e.name, e);
  return {
    buf,
    entries,
    has: (name) => map.has(name),
    names: () => [...map.keys()],
    text: (name) => { const e = map.get(name); return e ? inflateToText(buf, e) : Promise.resolve(null); },
    bytes: (name) => { const e = map.get(name); return e ? inflateToBytes(buf, e) : Promise.resolve(null); },
    // All entries whose name matches a predicate, in archive order.
    match: (re) => entries.filter((e) => re.test(e.name)),
  };
}
