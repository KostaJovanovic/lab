/* Analyser - Apple Property List parser (shared).

   Handles both encodings:
   - XML plists (<?xml ... <!DOCTYPE plist ...) via DOMParser
   - Binary plists ("bplist00") via a compact object-table walker

   Returns a plain JS value tree (objects/arrays/strings/numbers/booleans/Date/
   Uint8Array) plus a `format` tag. Used by webloc, mobileconfig, provisioning
   profiles, iOS sprite atlases, game saves, and other Apple-ecosystem formats. */

import { Reader } from '../core/binutil.js';

// ---------- XML plist ----------
function parseXmlPlist(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) return null;
  const root = doc.querySelector('plist > *') || doc.querySelector('plist');
  if (!root) return null;
  const node = (el) => {
    switch (el.tagName) {
      case 'dict': {
        const o = {};
        const kids = Array.from(el.children);
        for (let i = 0; i < kids.length; i += 2) {
          if (kids[i] && kids[i].tagName === 'key') o[kids[i].textContent] = node(kids[i + 1]);
        }
        return o;
      }
      case 'array': return Array.from(el.children).map(node);
      case 'string': return el.textContent;
      case 'integer': return parseInt(el.textContent, 10);
      case 'real': return parseFloat(el.textContent);
      case 'true': return true;
      case 'false': return false;
      case 'date': return new Date(el.textContent);
      case 'data': return el.textContent.trim();   // base64, left as-is
      default: return el.textContent;
    }
  };
  return node(root.tagName === 'plist' ? root.children[0] : root);
}

// ---------- binary plist (bplist00) ----------
function parseBinaryPlist(bytes) {
  if (bytes.length < 40) return null;
  const r = new Reader(bytes);          // big-endian
  // trailer: last 32 bytes
  const tStart = bytes.length - 32;
  const offsetSize = bytes[tStart + 6];
  const objRefSize = bytes[tStart + 7];
  const readBE = (off, size) => { let v = 0; for (let i = 0; i < size; i++) v = v * 256 + bytes[off + i]; return v; };
  const numObjects = readBE(tStart + 8, 8);
  const topObject = readBE(tStart + 16, 8);
  const offTableOff = readBE(tStart + 24, 8);
  if (numObjects > 5_000_000) return null;   // sanity guard
  const offsets = [];
  for (let i = 0; i < numObjects; i++) offsets.push(readBE(offTableOff + i * offsetSize, offsetSize));

  const seen = new Set();
  function obj(index) {
    if (index >= offsets.length || seen.has(index)) return null;
    let p = offsets[index];
    const marker = bytes[p++];
    const type = marker >> 4, info = marker & 0x0f;
    const count = () => {
      if (info !== 0x0f) return info;
      const szMarker = bytes[p++];
      const n = 1 << (szMarker & 0x0f);
      const v = readBE(p, n); p += n; return v;
    };
    switch (type) {
      case 0x0:
        return info === 0 ? null : info === 8 ? false : info === 9 ? true : null;
      case 0x1: { const n = 1 << info; const v = readBE(p, n); return v; }      // int
      case 0x2: { const n = 1 << info; const dv = new DataView(bytes.buffer, bytes.byteOffset + p, n); return n === 4 ? dv.getFloat32(0) : dv.getFloat64(0); }
      case 0x3: { const dv = new DataView(bytes.buffer, bytes.byteOffset + p, 8); return new Date(978307200000 + dv.getFloat64(0) * 1000); } // Apple epoch 2001
      case 0x4: { const n = count(); return bytes.subarray(p, p + n); }         // data
      case 0x5: { const n = count(); return new TextDecoder('ascii').decode(bytes.subarray(p, p + n)); } // ASCII
      case 0x6: { const n = count(); return new TextDecoder('utf-16be').decode(bytes.subarray(p, p + n * 2)); } // UTF-16
      case 0xa: case 0xc: {                                                     // array / set
        const n = count(); const arr = [];
        for (let i = 0; i < n; i++) arr.push(obj(readBE(p + i * objRefSize, objRefSize)));
        return arr;
      }
      case 0xd: {                                                              // dict
        const n = count(); const o = {};
        for (let i = 0; i < n; i++) {
          const k = obj(readBE(p + i * objRefSize, objRefSize));
          const v = obj(readBE(p + (n + i) * objRefSize, objRefSize));
          o[String(k)] = v;
        }
        return o;
      }
      default: return null;
    }
  }
  return obj(topObject);
}

// Parse a File (or Uint8Array) into a plist value tree. Returns
// { format: 'xml' | 'binary', value } or null.
export async function parsePlist(input) {
  let bytes;
  if (input instanceof Uint8Array) bytes = input;
  else bytes = new Uint8Array(await input.arrayBuffer());
  // bplist00 magic
  if (bytes.length >= 8 && bytes[0] === 0x62 && bytes[1] === 0x70 && bytes[2] === 0x6c && bytes[3] === 0x69 &&
      bytes[4] === 0x73 && bytes[5] === 0x74) {
    const value = parseBinaryPlist(bytes);
    return value == null ? null : { format: 'binary', value };
  }
  const text = new TextDecoder('utf-8').decode(bytes);
  const value = parseXmlPlist(text);
  return value == null ? null : { format: 'xml', value };
}
