-- Analyser stats - D1 schema.
-- Apply once after creating the database (see the SETUP block in wrangler.jsonc):
--   wrangler d1 execute analyser-stats --remote --file=worker/schema.sql
-- Re-running it is safe (every statement is IF NOT EXISTS / OR IGNORE).

-- Two scalar counters: total files analysed and total (deduplicated) visitors.
CREATE TABLE IF NOT EXISTS totals (
  key TEXT PRIMARY KEY,
  val INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO totals (key, val) VALUES ('files_total', 0), ('visitors_total', 0);

-- One row per extension ever dropped. `supported` = Analyser recognises the type
-- (0 = landed in the "unknown" bucket). Increment is atomic per row.
CREATE TABLE IF NOT EXISTS ext_stats (
  ext       TEXT PRIMARY KEY,
  supported INTEGER NOT NULL DEFAULT 0,
  count     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ext_count ON ext_stats(count DESC);

-- Visit dedup only: salted IP hash -> last counted (unix seconds). No raw IPs.
CREATE TABLE IF NOT EXISTS visitor_seen (
  ip_hash TEXT PRIMARY KEY,
  last    INTEGER NOT NULL
);

-- Asteroids easter-egg leaderboard: one row per submitted run. `name` is 5 chars
-- of [A-Z0-9], validated + profanity-checked server-side before insert. The /stats
-- page and the game's end screen show the top 5 by score.
-- `wave` is how far the run got; `cause` is the final blow (a file extension like
-- '.pdf', or 'nuke'). Both are shown on the /stats board alongside the date (ts).
CREATE TABLE IF NOT EXISTS scores (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  name   TEXT NOT NULL,
  score  INTEGER NOT NULL,
  ts     INTEGER NOT NULL,
  iphash TEXT,
  wave   INTEGER,
  cause  TEXT
);
CREATE INDEX IF NOT EXISTS idx_scores_score ON scores(score DESC);
CREATE INDEX IF NOT EXISTS idx_scores_iphash ON scores(iphash);
-- If the table predates a column, add it once (ignore "duplicate column"). The
-- worker also self-migrates wave/cause on the next score submit, so these are
-- only needed if you want them present before any new score is posted:
--   ALTER TABLE scores ADD COLUMN iphash TEXT;
--   ALTER TABLE scores ADD COLUMN wave INTEGER;
--   ALTER TABLE scores ADD COLUMN cause TEXT;
