// Analyser - stats Worker.
//
// This is the ONLY server-side code in an otherwise zero-backend tool. It exists
// purely to keep two anonymous aggregate counts that a static site cannot:
//   - how many files have been analysed (with a per-extension tally), and
//   - how many people have visited.
//
// It never sees your files. The browser sends only a lowercase extension string
// ("jpg") and an increment - never the file's name, bytes or contents. Visits
// are deduplicated by a SALTED HASH of the IP, so the raw IP is never stored or
// derivable. See /privacy for the plain-language version.
//
// Bindings (configured in wrangler.jsonc):
//   DB             - D1 database (schema in worker/schema.sql)
//   ASSETS         - the static site; used for every non-/api request
//   ANALYSED_LIMIT - rate-limit binding: 15 writes / 60s, keyed by hashed IP
//   IP_SALT        - secret salt for the IP hash (set with `wrangler secret put`)
//
// Routing: with a Worker + static assets, requests that match a static file are
// served directly by Cloudflare and never reach this Worker. Only paths with no
// matching asset invoke it - so this handler only ever sees /api/* and unknown
// (SPA) paths, the latter handed straight back to the assets system.

const VISIT_WINDOW = 3 * 24 * 60 * 60; // seconds - one counted visit per IP / 3 days

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

// SHA-256 of "salt:ip" as hex. Salting means the stored value can't be reversed
// to an IP even if the table leaked, and can't be precomputed without the secret.
async function hashIp(ip, salt) {
  const data = new TextEncoder().encode(salt + ':' + ip);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function clientIpHash(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  return hashIp(ip, env.IP_SALT || 'analyser-dev-salt');
}

// Keep the ext table clean and bounded: lowercase a-z0-9 only, <= 16 chars.
// A file with no extension counts as '(none)'; anything longer/odd collapses to
// '(other)' so a hostile client can't flood the table with junk primary keys.
function cleanExt(raw) {
  const e = String(raw || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!e) return '(none)';
  return e.length <= 16 ? e : '(other)';
}

// --- Asteroids leaderboard ---
const SCORE_MAX = 100000000;   // sanity cap so a tampered client can't post nonsense

// Leet-fold digits/symbols to letters so "5h1t" still reads as "shit" for the
// profanity check. Names are A-Z0-9 only, so this just maps the digit lookalikes.
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b' };
// Clearly offensive terms / slurs. Kept to ones unlikely to be a substring of an
// innocent 5-letter name (so "ass"/"hell"/"damn" are deliberately NOT here).
const BLOCKLIST = [
  'fuck', 'shit', 'cunt', 'cock', 'dick', 'pussy', 'slut', 'whore', 'bitch',
  'nigg', 'niga', 'nigr', 'fagg', 'spic', 'kike', 'gook', 'chink', 'coon',
  'dyke', 'twat', 'wank', 'rape', 'retar',
];

// Normalise to exactly five [A-Z0-9] (uppercased), or null if it can't be. Only
// English Latin letters and digits survive; anything else is stripped, then the
// result must be exactly 5 characters.
function cleanName(raw) {
  const up = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return up.length === 5 ? up : null;
}
function isProfane(name) {
  const norm = name.toLowerCase().replace(/[0-9]/g, (c) => LEET[c] || c);
  return BLOCKLIST.some((w) => norm.includes(w));
}

async function topScores(env, limit = 5) {
  try {
    const rows = await env.DB.prepare(
      'SELECT name, score FROM scores ORDER BY score DESC, ts ASC LIMIT ?',
    ).bind(limit).all();
    return (rows.results || []).map((r) => ({ name: r.name, score: r.score }));
  } catch (_) {
    return [];   // table may not exist yet (pre-migration) - don't break /api/stats
  }
}

async function readTotals(env) {
  const rows = await env.DB.prepare('SELECT key, val FROM totals').all();
  const out = { files: 0, visitors: 0 };
  for (const r of rows.results || []) {
    if (r.key === 'files_total') out.files = r.val;
    else if (r.key === 'visitors_total') out.visitors = r.val;
  }
  return out;
}

const BUMP_FILES = "INSERT INTO totals (key, val) VALUES ('files_total', 1) "
  + 'ON CONFLICT(key) DO UPDATE SET val = val + 1';
const BUMP_VISITORS = "INSERT INTO totals (key, val) VALUES ('visitors_total', 1) "
  + 'ON CONFLICT(key) DO UPDATE SET val = val + 1';

// POST /api/visit - count this visitor at most once per IP / 3 days, then return
// the live totals so the homepage badge can paint. Body is ignored.
async function handleVisit(request, env) {
  const ipHash = await clientIpHash(request, env);
  const now = Math.floor(Date.now() / 1000);

  const seen = await env.DB.prepare('SELECT last FROM visitor_seen WHERE ip_hash = ?')
    .bind(ipHash).first();

  let counted = false;
  if (!seen || (now - seen.last) >= VISIT_WINDOW) {
    counted = true;
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO visitor_seen (ip_hash, last) VALUES (?, ?) '
        + 'ON CONFLICT(ip_hash) DO UPDATE SET last = excluded.last',
      ).bind(ipHash, now),
      env.DB.prepare(BUMP_VISITORS),
    ]);
  }

  return json({ ...(await readTotals(env)), counted });
}

// POST /api/analysed {ext, supported} - record one analysed file. Rate-limited to
// 15/min per IP so a script loop can't inflate the counter; over the limit the
// request is accepted (200) but not recorded.
async function handleAnalysed(request, env) {
  if (env.ANALYSED_LIMIT) {
    const ipHash = await clientIpHash(request, env);
    const { success } = await env.ANALYSED_LIMIT.limit({ key: ipHash });
    if (!success) return json({ throttled: true });
  }

  let body = {};
  try { body = await request.json(); } catch (_) {}
  const ext = cleanExt(body.ext);
  const supported = body.supported ? 1 : 0;

  // `supported` is MONOTONIC: once any client has classified a type as supported
  // it stays supported (MAX, never back to 0). Two reasons:
  //   - When you add support for a type that was previously counted as unsupported,
  //     the first analysis of it afterwards flips the existing row's flag to 1, so
  //     its whole accumulated count leaves the "(unsupported)" dogpile and starts
  //     listing individually - and stays there.
  //   - Without MAX, a visitor still running an OLD cached build (sw.js) would
  //     classify that same type as unknown and flip it straight back into the
  //     dogpile. MAX makes the upgrade stick regardless of stale clients.
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO ext_stats (ext, supported, count) VALUES (?, ?, 1) '
      + 'ON CONFLICT(ext) DO UPDATE SET count = count + 1, '
      + 'supported = MAX(ext_stats.supported, excluded.supported)',
    ).bind(ext, supported),
    env.DB.prepare(BUMP_FILES),
  ]);

  return json({ ok: true });
}

// GET /api/stats - totals plus the per-extension tally (highest first).
// Supported extensions are listed individually (top 500 by count). Every
// UNSUPPORTED extension is collapsed into a single "(unsupported)" bucket and
// only its aggregate count is returned: an unsupported ext is the raw,
// user-supplied file extension, so a hostile client could drop a file named
// ".<slur>" purely to get that string onto the public stats page. Folding them
// here means those raw names never leave the server. They are still recorded
// individually in ext_stats, so the operator can inspect the wish-list privately
// (e.g. `wrangler d1 execute DB --command
//   "SELECT ext, count FROM ext_stats WHERE supported = 0 ORDER BY count DESC"`).
async function handleStats(env) {
  const rows = await env.DB.prepare(
    'SELECT ext, count FROM ext_stats WHERE supported = 1 ORDER BY count DESC, ext ASC LIMIT 500',
  ).all();
  const extensions = (rows.results || []).map((r) => ({
    ext: r.ext, supported: true, count: r.count,
  }));
  const un = await env.DB.prepare(
    'SELECT COALESCE(SUM(count), 0) AS total FROM ext_stats WHERE supported = 0',
  ).first();
  const unsupported = (un && un.total) || 0;
  if (unsupported > 0) extensions.push({ ext: '(unsupported)', supported: false, count: unsupported });
  extensions.sort((a, b) => (b.count - a.count) || (a.ext < b.ext ? -1 : 1));
  return json({ ...(await readTotals(env)), extensions, scores: await topScores(env, 100) });
}

// POST /api/score {name, score} - submit one Asteroids run to the leaderboard.
// Validates the name (5x [A-Z0-9], not profane) and the score (positive, capped),
// inserts it, and returns the new top 5. Rate-limited like /api/analysed so a
// script can't flood the board.
async function handleScore(request, env) {
  const ipHash = await clientIpHash(request, env);
  if (env.ANALYSED_LIMIT) {
    const { success } = await env.ANALYSED_LIMIT.limit({ key: ipHash });
    if (!success) return json({ ok: false, error: 'Too many submissions, try again shortly.' }, 429);
  }
  let body = {};
  try { body = await request.json(); } catch (_) {}
  const name = cleanName(body.name);
  const score = Math.floor(Number(body.score));
  if (!name) return json({ ok: false, error: 'Name must be 5 letters or numbers.' }, 400);
  if (isProfane(name)) return json({ ok: false, error: 'Please choose a different name.' }, 400);
  if (!Number.isFinite(score) || score <= 0 || score > SCORE_MAX) {
    return json({ ok: false, error: 'Invalid score.' }, 400);
  }
  // One entry per device (keyed by hashed IP): a new submission replaces the
  // device's previous one, so repeated submits don't pile up rows on the board.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM scores WHERE iphash = ?').bind(ipHash),
    env.DB.prepare('INSERT INTO scores (name, score, ts, iphash) VALUES (?, ?, ?, ?)')
      .bind(name, score, Math.floor(Date.now() / 1000), ipHash),
  ]);
  return json({ ok: true, top: await topScores(env) });
}

// GET /api/leaderboard - the current top 5 Asteroids scores.
async function handleLeaderboard(env) {
  return json({ top: await topScores(env) });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Everything that isn't an API call is a page/asset (or an SPA deep link) -
    // hand it straight back to the assets system, which applies the same
    // clean-URL + single-page-application fallback as a Worker-less deploy.
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);

    try {
      if (path === '/api/visit' && request.method === 'POST') return await handleVisit(request, env);
      if (path === '/api/analysed' && request.method === 'POST') return await handleAnalysed(request, env);
      if (path === '/api/stats' && request.method === 'GET') return await handleStats(env);
      if (path === '/api/score' && request.method === 'POST') return await handleScore(request, env);
      if (path === '/api/leaderboard' && request.method === 'GET') return await handleLeaderboard(env);
    } catch (_) {
      // Never leak internals; the client treats any non-OK as "stats unavailable".
      return json({ error: 'stats unavailable' }, 500);
    }
    return json({ error: 'not found' }, 404);
  },
};
