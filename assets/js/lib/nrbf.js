/* Analyser - .NET Binary Formatter (NRBF) decoder.

   Decodes the [MS-NRBF] ".NET Remoting Binary Format" record stream that the
   classic System.Runtime.Serialization.Formatters.Binary.BinaryFormatter writes -
   the same stream ULTRAKILL's .bepis save files use. It reconstructs the object
   graph: class instances become plain objects keyed by their .NET member names,
   arrays become JS arrays, object references are resolved, and primitives are
   decoded to native values (Int64/UInt64 to Number when exact else string,
   DateTime/TimeSpan to readable strings).

   Returns { ok, root, rootClass, classes, objectCount } or { ok:false, error }.
   Everything is bounds-checked and capped so a malformed or hostile stream fails
   to null rather than hanging or exhausting memory. Pure - no DOM, no globals. */

// RecordTypeEnum
const REC = {
  Header: 0, ClassWithId: 1, SystemClassWithMembers: 2, ClassWithMembers: 3,
  SystemClassWithMembersAndTypes: 4, ClassWithMembersAndTypes: 5, BinaryObjectString: 6,
  BinaryArray: 7, MemberPrimitiveTyped: 8, MemberReference: 9, ObjectNull: 10,
  MessageEnd: 11, BinaryLibrary: 12, ObjectNullMultiple256: 13, ObjectNullMultiple: 14,
  ArraySinglePrimitive: 15, ArraySingleObject: 16, ArraySingleString: 17,
};

const MAX_OBJECTS = 200000;     // graph-size guard
const MAX_ARRAY = 5000000;      // per-array element guard

class Reader {
  constructor(bytes) { this.b = bytes; this.p = 0; this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  get eof() { return this.p >= this.b.length; }
  need(n) { if (this.p + n > this.b.length) throw new Error('unexpected end of NRBF stream'); }
  u8() { this.need(1); return this.b[this.p++]; }
  i8() { this.need(1); return (this.b[this.p++] << 24) >> 24; }
  bool() { return this.u8() !== 0; }
  i16() { this.need(2); const v = this.dv.getInt16(this.p, true); this.p += 2; return v; }
  u16() { this.need(2); const v = this.dv.getUint16(this.p, true); this.p += 2; return v; }
  i32() { this.need(4); const v = this.dv.getInt32(this.p, true); this.p += 4; return v; }
  u32() { this.need(4); const v = this.dv.getUint32(this.p, true); this.p += 4; return v; }
  f32() { this.need(4); const v = this.dv.getFloat32(this.p, true); this.p += 4; return v; }
  f64() { this.need(8); const v = this.dv.getFloat64(this.p, true); this.p += 8; return v; }
  i64() { this.need(8); const v = this.dv.getBigInt64(this.p, true); this.p += 8; return bigToNum(v); }
  u64() { this.need(8); const v = this.dv.getBigUint64(this.p, true); this.p += 8; return bigToNum(v); }
  // .NET 7-bit-encoded length prefix.
  len() {
    let v = 0, shift = 0;
    for (let i = 0; i < 5; i++) {
      const x = this.u8();
      v |= (x & 0x7F) << shift;
      if ((x & 0x80) === 0) return v >>> 0;
      shift += 7;
    }
    throw new Error('bad length prefix');
  }
  str() {
    const n = this.len();
    this.need(n);
    const s = utf8(this.b.subarray(this.p, this.p + n));
    this.p += n;
    return s;
  }
}

function bigToNum(v) {
  // Keep exact when within safe integer range, else fall back to a string.
  if (v >= -9007199254740991n && v <= 9007199254740991n) return Number(v);
  return v.toString();
}

let _dec = null;
function utf8(bytes) {
  try { (_dec = _dec || new TextDecoder('utf-8')); return _dec.decode(bytes); }
  catch (_) { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return s; }
}

// .NET DateTime: 62-bit tick count (100 ns since 0001-01-01) + 2-bit kind.
function decodeDateTime(dv, p) {
  const raw = dv.getBigUint64(p, true);
  const ticks = raw & 0x3FFFFFFFFFFFFFFFn;
  // Ticks from 0001-01-01 to Unix epoch (1970-01-01).
  const EPOCH = 621355968000000000n;
  const ms = Number((ticks - EPOCH) / 10000n);
  const d = new Date(ms);
  return isNaN(d.getTime()) ? ticks.toString() + ' ticks' : d.toISOString();
}

export function parseNrbf(bytes) {
  try {
    const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const r = new Reader(input);

    if (r.u8() !== REC.Header) return { ok: false, error: 'not a .NET BinaryFormatter stream' };
    const rootId = r.i32();
    r.i32();                          // headerId (-1)
    const major = r.i32(), minor = r.i32();

    const objects = new Map();        // objectId -> value (object/array/string)
    const classMeta = new Map();      // objectId -> { name, members:[{name,bt,ai}] }
    const libraries = new Map();      // libraryId -> name
    const pendingRefs = [];           // {set(val)} closures to resolve after the pass
    const classNames = [];
    let count = 0;

    const register = (id, val) => { if (id) { objects.set(id, val); if (++count > MAX_OBJECTS) throw new Error('object graph too large'); } return val; };

    // Read the AdditionalInfo that follows a member's BinaryTypeEnum.
    function readAdditional(bt) {
      if (bt === 0 || bt === 7) return r.u8();            // Primitive / PrimitiveArray -> PrimitiveTypeEnum
      if (bt === 3) return r.str();                        // SystemClass -> class name
      if (bt === 4) { const name = r.str(); const lib = r.i32(); return { name, lib }; } // Class -> name + libraryId
      return null;                                         // String(1)/Object(2)/ObjectArray(5)/StringArray(6)
    }

    // Read MemberTypeInfo for `n` members: the type-enum array, then their infos.
    function readMemberTypeInfo(n) {
      const bts = [];
      for (let i = 0; i < n; i++) bts.push(r.u8());
      const ais = [];
      for (let i = 0; i < n; i++) ais.push(readAdditional(bts[i]));
      return bts.map((bt, i) => ({ bt, ai: ais[i] }));
    }

    function readPrimitive(pt) {
      switch (pt) {
        case 1: return r.bool();
        case 2: return r.u8();
        case 3: { // Char: a single UTF-8 codepoint
          const start = r.p; const b0 = r.u8();
          const extra = b0 >= 0xF0 ? 3 : b0 >= 0xE0 ? 2 : b0 >= 0xC0 ? 1 : 0;
          for (let i = 0; i < extra; i++) r.u8();
          return utf8(input.subarray(start, r.p));
        }
        case 5: return r.str();                  // Decimal (as string)
        case 6: return r.f64();
        case 7: return r.i16();
        case 8: return r.i32();
        case 9: return r.i64();
        case 10: return r.i8();
        case 11: return r.f32();
        case 12: { const t = r.i64(); return typeof t === 'number' ? (t / 1e7) + ' s' : t + ' ticks'; }  // TimeSpan
        case 13: { r.need(8); const v = decodeDateTime(r.dv, r.p); r.p += 8; return v; }                  // DateTime
        case 14: return r.u16();
        case 15: return r.u32();
        case 16: return r.u64();
        case 18: return r.str();
        default: throw new Error('unknown primitive type ' + pt);
      }
    }

    // A member typed as String/Object/Class/array reads a full record here.
    function readMemberValue(m) {
      if (m.bt === 0) return readPrimitive(m.ai);   // Primitive: inline, no record tag
      return readRecord();                           // everything else is a record (or ref/null)
    }

    // Read the member values for a class given its layout, into an object.
    function readClassValues(meta, id) {
      const obj = {};
      register(id, obj);
      for (const m of meta.members) {
        const v = readMemberValue(m);
        if (v && typeof v === 'object' && v.__ref) {
          const name = m.name;
          pendingRefs.push({ id: v.__ref, set: (val) => { obj[name] = val; } });
          obj[name] = v;                  // placeholder, replaced in resolve pass
        } else {
          obj[m.name] = v;
        }
      }
      return obj;
    }

    function readClassWithMembersAndTypes(system) {
      const id = r.i32();
      const name = r.str();
      const n = r.i32();
      if (n < 0 || n > 4096) throw new Error('absurd member count');
      const memberNames = [];
      for (let i = 0; i < n; i++) memberNames.push(r.str());
      const typed = readMemberTypeInfo(n);
      if (!system) r.i32();               // libraryId
      const members = memberNames.map((mn, i) => ({ name: mn, bt: typed[i].bt, ai: typed[i].ai }));
      const meta = { name, members };
      classMeta.set(id, meta);
      if (classNames.indexOf(name) < 0) classNames.push(name);
      return readClassValues(meta, id);
    }

    // Fill an already-registered array in place (so reference placeholders are
    // patched on the real array, and an array can even reference itself).
    function fillArray(arr, length, readEl) {
      let i = 0;
      while (i < length) {
        // Object/String arrays may encode runs of nulls compactly.
        const peek = r.b[r.p];
        if (peek === REC.ObjectNull) { r.u8(); arr.push(null); i++; continue; }
        if (peek === REC.ObjectNullMultiple256) { r.u8(); const c = r.u8(); for (let k = 0; k < c && i < length; k++, i++) arr.push(null); continue; }
        if (peek === REC.ObjectNullMultiple) { r.u8(); const c = r.i32(); for (let k = 0; k < c && i < length; k++, i++) arr.push(null); continue; }
        const idx = arr.length;
        const v = readEl();
        if (v && typeof v === 'object' && v.__ref) { const ref = v.__ref; pendingRefs.push({ id: ref, set: (val) => { arr[idx] = val; } }); }
        arr.push(v);
        i++;
      }
      return arr;
    }

    function readRecord() {
      const t = r.u8();
      switch (t) {
        case REC.ClassWithMembersAndTypes: return readClassWithMembersAndTypes(false);
        case REC.SystemClassWithMembersAndTypes: return readClassWithMembersAndTypes(true);
        case REC.ClassWithId: {
          const id = r.i32();
          const metaId = r.i32();
          const meta = classMeta.get(metaId);
          if (!meta) throw new Error('ClassWithId references unknown metadata ' + metaId);
          return readClassValues(meta, id);
        }
        case REC.BinaryObjectString: {
          const id = r.i32();
          const s = r.str();
          return register(id, s);
        }
        case REC.MemberPrimitiveTyped: {
          const pt = r.u8();
          return readPrimitive(pt);
        }
        case REC.MemberReference: {
          const ref = r.i32();
          return { __ref: ref };
        }
        case REC.ObjectNull: return null;
        case REC.ObjectNullMultiple256: { r.u8(); return null; }
        case REC.ObjectNullMultiple: { r.i32(); return null; }
        case REC.BinaryLibrary: {
          const libId = r.i32();
          libraries.set(libId, r.str());
          return readRecord();            // a library record always precedes a real one
        }
        case REC.ArraySinglePrimitive: {
          const id = r.i32();
          const length = r.i32();
          const pt = r.u8();
          if (length < 0 || length > MAX_ARRAY) throw new Error('absurd array length');
          const arr = [];
          for (let i = 0; i < length; i++) arr.push(readPrimitive(pt));
          return register(id, arr);
        }
        case REC.ArraySingleObject: {
          const id = r.i32();
          const length = r.i32();
          if (length < 0 || length > MAX_ARRAY) throw new Error('absurd array length');
          return fillArray(register(id, []), length, () => readRecord());
        }
        case REC.ArraySingleString: {
          const id = r.i32();
          const length = r.i32();
          if (length < 0 || length > MAX_ARRAY) throw new Error('absurd array length');
          return fillArray(register(id, []), length, () => readRecord());
        }
        case REC.BinaryArray: {
          const id = r.i32();
          const arrayType = r.u8();        // 0 Single,1 Jagged,2 Rectangular,3..5 +offset
          const rank = r.i32();
          if (rank < 1 || rank > 32) throw new Error('absurd array rank');
          const lengths = [];
          for (let i = 0; i < rank; i++) lengths.push(r.i32());
          if (arrayType >= 3) for (let i = 0; i < rank; i++) r.i32();  // lower bounds
          const bt = r.u8();
          const ai = readAdditional(bt);
          let total = 1;
          for (const l of lengths) total *= l;
          if (total < 0 || total > MAX_ARRAY) throw new Error('absurd array size');
          return fillArray(register(id, []), total, () => (bt === 0 ? readPrimitive(ai) : readRecord()));
        }
        case REC.MessageEnd: return undefined;
        default: throw new Error('unsupported NRBF record type ' + t);
      }
    }

    // Top level: a sequence of records until MessageEnd.
    const topRoot = readRecord();
    // Drain any trailing records (referenced objects defined after the root).
    let guard = 0;
    while (!r.eof && r.b[r.p] !== REC.MessageEnd && guard++ < MAX_OBJECTS) {
      const before = r.p;
      readRecord();
      if (r.p === before) break;
    }

    // Resolve object references now that every id is known (guard against cycles).
    for (const ref of pendingRefs) {
      const target = objects.get(ref.id);
      if (target !== undefined) ref.set(target);
    }
    // Replace any remaining inline {__ref} placeholders on the root tree.
    const root = objects.get(rootId) !== undefined ? objects.get(rootId) : topRoot;

    const rootMeta = classMeta.get(rootId);
    return {
      ok: true,
      version: major + '.' + minor,
      root,
      rootClass: rootMeta ? rootMeta.name : null,
      classes: classNames,
      libraries: [...libraries.values()],
      objectCount: objects.size,
    };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'NRBF parse error' };
  }
}
