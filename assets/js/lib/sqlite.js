/* Analyser - lazy sql.js loader.

   Wraps the vendored sql.js (SQLite compiled to WebAssembly) so parser chunks can
   open SQLite-backed formats (GeoPackage, MBTiles, Audacity .aup3, …) and read
   their tables. The library and its .wasm are loaded on demand the first time a
   SQLite file is opened; everything is wrapped in try/catch so a load or parse
   failure resolves cleanly (null) rather than throwing into the caller. */

import { loadScript } from '../core/util.js';

let _sqlPromise = null;

// Resolve (and cache) the initialised SQL module. Returns the sql.js `SQL`
// object, or null if the library couldn't be loaded/initialised.
export async function getSQL() {
  if (_sqlPromise) return _sqlPromise;
  _sqlPromise = (async () => {
    try {
      if (!window.initSqlJs) await loadScript('assets/vendor/sqljs/sql-wasm.js');
      if (!window.initSqlJs) return null;
      const SQL = await window.initSqlJs({
        locateFile: () => 'assets/vendor/sqljs/sql-wasm.wasm',
      });
      return SQL || null;
    } catch (_) {
      return null;
    }
  })();
  return _sqlPromise;
}

// Open a File as a SQLite database. Returns the opened db (caller must call
// db.close() when done) or null on any failure.
export async function sqliteQuery(file) {
  try {
    const SQL = await getSQL();
    if (!SQL) return null;
    const bytes = new Uint8Array(await file.arrayBuffer());
    return new SQL.Database(bytes);
  } catch (_) {
    return null;
  }
}

// Open a File and summarise it: the list of user tables and a per-table row
// count. Returns { db, tables, rowCounts } (caller closes db) or null on failure.
export async function sqliteSummary(file) {
  try {
    const db = await sqliteQuery(file);
    if (!db) return null;
    const tables = [];
    try {
      const res = db.exec(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      );
      if (res && res[0] && res[0].values) {
        for (const row of res[0].values) tables.push(String(row[0]));
      }
    } catch (_) { /* leave tables empty */ }
    const rowCounts = {};
    for (const name of tables) {
      try {
        const r = db.exec('SELECT COUNT(*) FROM "' + name.replace(/"/g, '""') + '"');
        if (r && r[0] && r[0].values && r[0].values[0]) {
          rowCounts[name] = Number(r[0].values[0][0]);
        }
      } catch (_) { /* unreadable table - skip its count */ }
    }
    return { db, tables, rowCounts };
  } catch (_) {
    return null;
  }
}

// Full analysis of a SQLite database File: PRAGMA facts, every table with its
// columns + row count, views/indexes/triggers, the full DDL (CREATE statements),
// and a small sample of the largest table. Returns a plain data object (no DOM)
// or null on failure. The caller builds the UI from it.
export async function sqliteAnalysis(file) {
  let db = null;
  try {
    db = await sqliteQuery(file);
    if (!db) return null;
    const exec = (sql) => { try { const r = db.exec(sql); return (r && r[0]) || null; } catch (_) { return null; } };
    const scalar = (sql) => { const r = exec(sql); return (r && r.values[0]) ? r.values[0][0] : null; };

    const pragma = {
      page_size: scalar('PRAGMA page_size'),
      page_count: scalar('PRAGMA page_count'),
      encoding: scalar('PRAGMA encoding'),
      user_version: scalar('PRAGMA user_version'),
      application_id: scalar('PRAGMA application_id'),
      auto_vacuum: scalar('PRAGMA auto_vacuum'),
    };

    const master = exec(
      "SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY type,name"
    );
    const objs = master ? master.values.map((v) => ({ type: v[0], name: v[1], sql: v[2] })) : [];
    const q = (n) => '"' + String(n).replace(/"/g, '""') + '"';

    const tables = [];
    for (const o of objs.filter((o) => o.type === 'table')) {
      let rows = null;
      const c = exec('SELECT COUNT(*) FROM ' + q(o.name));
      if (c && c.values[0]) rows = Number(c.values[0][0]);
      const ti = exec('PRAGMA table_info(' + q(o.name) + ')');
      const cols = ti ? ti.values.map((r) => ({ name: r[1], type: r[2] || 'BLOB', notnull: !!r[3], pk: !!r[5] })) : [];
      tables.push({ name: o.name, rows, cols });
    }
    const views = objs.filter((o) => o.type === 'view').map((o) => o.name);
    const indexes = objs.filter((o) => o.type === 'index').map((o) => o.name);
    const triggers = objs.filter((o) => o.type === 'trigger').map((o) => o.name);
    const ddl = objs.filter((o) => o.sql).map((o) => o.sql.trim().replace(/;?\s*$/, ';')).join('\n\n');

    // Sample rows from the largest table.
    let sample = null;
    const biggest = tables.filter((t) => t.rows).sort((a, b) => b.rows - a.rows)[0];
    if (biggest) {
      const s = exec('SELECT * FROM ' + q(biggest.name) + ' LIMIT 5');
      if (s) sample = { table: biggest.name, columns: s.columns, rows: s.values };
    }

    return { pragma, tables, views, indexes, triggers, ddl, sample };
  } catch (_) {
    return null;
  } finally {
    if (db) { try { db.close(); } catch (_) {} }
  }
}
