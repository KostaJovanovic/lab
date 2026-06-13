/* Analyser - Asteroids easter egg
   Hidden behind the Konami code (see the boot._once block in app.js). A vector
   Asteroids clone played inside a circular "scope": the rim is the edge of the
   world, so anything that crosses it re-enters at the diametrically opposite
   point (true circular wrap). Thematic twist - every asteroid is a supported file
   type. The big ones are archive/container formats (ZIP, RAR, 3MF, PPTX...) and
   when you shoot one it shatters into the file types it might contain.

   Self-contained: one exported launcher, its own full-screen overlay, canvas,
   input and teardown. No build step, no dependencies beyond the format catalog.
   Lazy-imported, so none of this loads until the code is entered. */

import { PHOTO_EXTS, AUDIO_EXTS, VIDEO_EXTS, CSV_EXTS, SVG_EXTS, DOC_EXTS, ARCHIVE_EXTS } from '../core/formats.js';

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

// Big asteroids = things that contain other files. ARCHIVE_EXTS plus the
// zip-based document/container formats, which fits the "shatters into its
// contents" conceit nicely.
const ARCHIVE_POOL = [...new Set([
  ...ARCHIVE_EXTS,
  '3mf', 'pptx', 'docx', 'xlsx', 'epub', 'cbz', 'cbr', 'jar', 'apk',
  'odt', 'ods', 'odp', 'vsix', 'nupkg', 'crx', 'iso'
])].map((s) => '.' + s);

// Smaller asteroids = the contained files: any supported leaf format that isn't
// itself an archive.
const FILE_POOL = [...new Set([
  ...PHOTO_EXTS, ...AUDIO_EXTS, ...VIDEO_EXTS, ...CSV_EXTS, ...SVG_EXTS, ...DOC_EXTS
])].filter((e) => !ARCHIVE_EXTS.has(e) && !/^(zip|tgz|gz|tar|rar|7z|xz|bz2|zst)$/.test(e))
  .map((s) => '.' + s);

let active = false;   // singleton guard - the Konami code can't stack instances

export function launchAsteroids() {
  if (active) return;
  active = true;

  // Theme: pull the site's own tokens so the easter egg matches Analyser - the
  // dark-control palette the fullscreen spectrogram uses (#1a1a1a surfaces, #fff
  // text, #444 hairlines), sharp corners (--radius is 0 site-wide), and --accent
  // for the vectors/highlights.
  const root = getComputedStyle(document.documentElement);
  const cssVar = (name, fallback) => (root.getPropertyValue(name) || fallback).trim();
  const ACCENT = cssVar('--accent', '#e60023');
  const ACCENT_FG = cssVar('--accent-fg', '#ffffff');
  const MEDIA_BG = cssVar('--media-bg', '#0a0a0a');
  const SURFACE = cssVar('--surface-on-dark', '#1a1a1a');
  const ON_DARK = cssVar('--on-dark', '#ffffff');
  const BORDER = cssVar('--border-on-dark-ctl', '#444');
  const MUTED = cssVar('--muted-on-dark', '#999');
  const LINE = '#f2f2f2';   // vector stroke - a touch softer than pure white
  const MONO = '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

  // ---- DOM scaffold ----
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  const overlay = document.createElement('div');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Asteroids');
  overlay.style.cssText = 'position:fixed; inset:0; z-index:2147483600; background:' + MEDIA_BG + '; ' +
    'touch-action:none; user-select:none; -webkit-user-select:none;';

  // Buttons mirror .anr-btn (dark/fullscreen variant): square corners, hairline
  // border, invert on hover, accent on press. Scoped to the overlay and torn down
  // with it. Done as real CSS (not inline) so :hover/:active work like the site.
  const style = document.createElement('style');
  style.textContent =
    '.anr-game-btn{font-family:' + MONO + ';font-weight:500;letter-spacing:.01em;background:' + SURFACE +
    ';color:' + ON_DARK + ';border:1px solid ' + BORDER + ';border-radius:0;cursor:pointer;' +
    'transition:background .12s ease,color .12s ease,border-color .12s ease;}' +
    '.anr-game-btn:hover{background:' + ON_DARK + ';color:' + MEDIA_BG + ';}' +
    '.anr-game-btn:active{background:' + ACCENT + ';color:' + ACCENT_FG + ';border-color:' + ACCENT + ';}';
  overlay.appendChild(style);

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; display:block;';
  overlay.appendChild(canvas);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'anr-game-btn';
  closeBtn.textContent = '✕';
  closeBtn.setAttribute('aria-label', 'Close game');
  closeBtn.style.cssText = 'position:absolute; top:14px; right:16px; z-index:2; width:36px; height:36px; font-size:15px;';
  closeBtn.addEventListener('click', teardown);
  overlay.appendChild(closeBtn);

  document.body.appendChild(overlay);

  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, cx = 0, cy = 0, R = 0, dpr = 1, stars = [];

  function layout() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    cx = W / 2; cy = H / 2;
    R = Math.max(150, Math.min(W, H) * 0.42);
    // Starfield in normalised disc coords, so it survives a resize.
    if (!stars.length) {
      for (let i = 0; i < 70; i++) {
        const a = rand(0, TAU), r = Math.sqrt(Math.random());
        stars.push({ a, r, b: rand(0.15, 0.6) });
      }
    }
  }
  layout();

  // ---- Game state ----
  const SPAWN_INVULN = 3;     // seconds of immunity after a (re)spawn
  const WAVE_GRACE = 3;       // seconds a fresh wave's asteroids have no hitbox
  const MAX_LIVES = 3;
  const MAX_BULLETS = 20;
  const POWERUP_LIFE = 14;    // seconds a dropped power-up lingers before expiring
  const WAVE_POWERUPS = 2;    // power-ups scattered in at the start of each wave
  const LIGHTNING_HALF = 17.5 * Math.PI / 180;   // half of the 35° auto-aim cone
  const LIGHTNING_RANGE = 0.7 * 540 * 0.9;       // 70% of a normal bullet's reach
  const SHIELD_DUR = 7;       // health pickup at full HP grants a 7s shield instead
  const LASER_WIDTH = 34;     // full beam width; the hitbox is drawn to match it
  const ULTRASOUND_RADIUS = 0.25 * 540 * 0.9;   // a quarter of a normal bullet's reach
  const ULTRASOUND_TICK = 0.7;                  // AoE damage cadence
  const RIPPLE_DUR = 1.4;                        // seconds a ripple takes to reach the rim
  // Nuclear bomb cinematic phases: instant full-white, hold, fade, then a beat of
  // empty scope before the player respawns into the next wave.
  const NUKE_WHITE = 3;                          // full-white hold
  const NUKE_FADE = 3;                           // white fades back to normal over this
  const NUKE_GAP = 1;                            // empty-scope beat before respawn
  const NUKE_TOTAL = NUKE_WHITE + NUKE_FADE + NUKE_GAP;
  const WRECK_FADE = 3;                          // wreck fade duration, once it begins (on respawn)

  // Power-up catalogue. Each is colour-coded; picked up by flying over it. Weapon
  // power-ups are timed and mutually exclusive (a new one replaces the current);
  // health is instant. Letters keep them readable at small size.
  const POWERUP_DEF = {
    health: { color: '#3fb950', letter: '+', label: 'HEALTH' },
    machine: { color: '#e3b341', letter: 'M', label: 'MACHINE GUN', dur: 10 },
    triple: { color: '#ff7b72', letter: 'T', label: 'TRIPLE SHOT', dur: 12 },
    sniper: { color: '#bc8cff', letter: 'S', label: 'SNIPER', dur: 12 },
    laser: { color: '#58a6ff', letter: 'L', label: 'LASER', dur: 10 },
    lightning: { color: '#3b5bdb', letter: 'Z', label: 'LIGHTNING', dur: 10 },
    ultrasound: { color: '#7fd3ff', letter: 'U', label: 'SHOCKWAVE', dur: 10 },
    // Nuclear bomb: instant, double-edged. Wipes the board and advances a wave but
    // costs a life. No `dur` - it fires once on pickup (see applyPowerup/triggerNuke).
    nuke: { color: '#ffd60a', letter: '☢', label: 'NUCLEAR' }
  };
  const POWERUP_TYPES = Object.keys(POWERUP_DEF);
  // Weighted draw pool: the nuclear bomb is a double-edged jackpot, so it shows up
  // a third as often as every other power-up (weight 1 vs 3).
  const POWERUP_PICK = POWERUP_TYPES.flatMap((t) => Array(t === 'nuke' ? 1 : 3).fill(t));

  // Persistent high score (survives the footer "Clear storage", which preserves
  // this key - see the clear handler in app.js).
  const HI_KEY = 'anr-asteroids-hi';
  let highScore = 0;
  try { highScore = parseInt(localStorage.getItem(HI_KEY) || '0', 10) || 0; } catch (_) {}
  let newHigh = false;
  const saveHi = () => { try { localStorage.setItem(HI_KEY, String(highScore)); } catch (_) {} };

  let asteroids = [], bullets = [], particles = [], powerups = [], lasers = [];
  let wave = 0, score = 0, lives = 3, gameOver = false;
  let weapon = 'normal', weaponTimer = 0, lightningTarget = null, shield = 0;
  // Lightning's mid kink is stored as an offset from the ship (so it tracks the
  // player and survives a target redirect) and re-rolled every 0.5s.
  let lightningMid = null, lightningMidTimer = 0;
  // Ultrasound's expanding sonar ripples (each a 0..1 progress to the rim).
  let ripples = [], rippleTimer = 0;
  // Nuclear bomb cinematic timer: counts down from NUKE_TOTAL while play is frozen.
  let nuke = 0;
  // The drifting wreck left by a nuke: an independent body that outlives the
  // cinematic (drifting on into the next wave) and slowly fades. null when none.
  let wreck = null;
  const ship = { x: cx, y: cy, vx: 0, vy: 0, angle: -Math.PI / 2, invuln: 0, dead: false };
  let fireCd = 0, deathTimer = 0, clock = 0;
  const input = { left: false, right: false, thrust: false, fire: false };

  // Background flyers: decorative squadrons of player-shaped ships that drift
  // across the scope in a straight line, behind everything else. Pure eye-candy -
  // no hitbox, no wrap; they enter from one rim and exit the far side (the clip
  // hides them past the edge). Sometimes a lone scout, sometimes a 2-5 ship wedge.
  let flyers = [], flyerTimer = rand(1.5, 4);

  const fitFont = (label, radius) => {
    let f = Math.max(9, radius * 0.6);
    ctx.font = f + 'px ' + MONO;
    const w = ctx.measureText(label).width;
    const max = radius * 1.5;
    if (w > max) f = Math.max(7, f * max / w);
    return f;
  };

  function makeAsteroid(x, y, size, label) {
    const radius = size === 3 ? 46 : size === 2 ? 30 : 19;
    const n = 7 + size * 2 + ((Math.random() * 3) | 0);
    const verts = [];
    for (let i = 0; i < n; i++) verts.push({ a: (i / n) * TAU, r: rand(0.72, 1.12) });
    const base = size === 3 ? [26, 70] : size === 2 ? [48, 104] : [72, 150];
    const spd = rand(base[0], base[1]);
    const dir = rand(0, TAU);
    return {
      x, y, size, label, radius, verts,
      angleR: rand(0, TAU), spin: rand(-1.3, 1.3),
      vx: Math.cos(dir) * spd, vy: Math.sin(dir) * spd,
      font: fitFont(label, radius), grace: 0
    };
  }

  function spawnWave() {
    wave++;
    const count = Math.min(8, 2 + wave);
    // Keep a clear ring around the ship so a new big asteroid can never spawn on
    // top of the player; retry the random position until it's outside that ring.
    const safe = 150;
    for (let i = 0; i < count; i++) {
      let x, y, tries = 0;
      do {
        const a = rand(0, TAU), dist = rand(R * 0.5, R * 0.92);
        x = cx + Math.cos(a) * dist; y = cy + Math.sin(a) * dist;
      } while (Math.hypot(x - ship.x, y - ship.y) < safe && ++tries < 30);
      const ast = makeAsteroid(x, y, 3, pick(ARCHIVE_POOL));
      ast.grace = WAVE_GRACE;   // no hitbox (stripey border) so a fresh wave can't ambush you
      asteroids.push(ast);
    }
    // Scatter a power-up or two into the new wave, away from the ship.
    for (let i = 0; i < WAVE_POWERUPS; i++) {
      let x, y, tries = 0;
      do {
        const a = rand(0, TAU), dist = rand(R * 0.3, R * 0.85);
        x = cx + Math.cos(a) * dist; y = cy + Math.sin(a) * dist;
      } while (Math.hypot(x - ship.x, y - ship.y) < 120 && ++tries < 20);
      powerups.push(makePowerup(x, y));
    }
  }

  function makePowerup(x, y) {
    const type = pick(POWERUP_PICK);
    const dir = rand(0, TAU), spd = rand(8, 22);
    return {
      x, y, type, color: POWERUP_DEF[type].color, letter: POWERUP_DEF[type].letter,
      radius: 12, life: POWERUP_LIFE, vx: Math.cos(dir) * spd, vy: Math.sin(dir) * spd
    };
  }

  function applyPowerup(type) {
    if (type === 'health') {
      // Heal, or - if already at full HP - grant a temporary shield instead.
      if (lives < MAX_LIVES) lives++;
      else shield = SHIELD_DUR;
    } else if (type === 'nuke') {
      triggerNuke();
    } else { weapon = type; weaponTimer = POWERUP_DEF[type].dur; }
  }

  // Detonate: wipe every asteroid (and any combat residue), advance a wave at a
  // cost of one life, and start the white-flash cinematic. Asteroids are cleared
  // here so nothing can hit the ship on the trigger frame; the remaining transient
  // arrays are kept empty each frame by the nuke branch in update(). The ship isn't
  // marked dead (that would fire the death timer) - it's just hidden while nuke > 0.
  function triggerNuke() {
    lives--;
    asteroids = []; bullets = []; lasers = [];
    // End any power-up the player was carrying - they come out of the blast clean.
    weapon = 'normal'; weaponTimer = 0; shield = 0;
    lightningTarget = null; lightningMid = null; lightningMidTimer = 0;
    ripples = []; rippleTimer = 0;
    nuke = NUKE_TOTAL;
    overlay.style.cursor = 'none';   // hidden for the cinematic, restored on respawn
    // Spawn a wreck where the ship was, on a slow constant drift (no drag) in a
    // random direction with a lazy tumble. It lives on its own past the cinematic.
    const a = rand(0, TAU), s = rand(22, 40);
    wreck = {
      x: ship.x, y: ship.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      angle: ship.angle, spin: (Math.random() < 0.5 ? -1 : 1) * rand(0.35, 0.7), fade: 0
    };
  }

  function resetShip(invuln) {
    ship.x = cx; ship.y = cy; ship.vx = 0; ship.vy = 0; ship.angle = -Math.PI / 2;
    ship.invuln = invuln; ship.dead = false;
  }

  function restart() {
    asteroids = []; bullets = []; particles = []; powerups = []; lasers = [];
    weapon = 'normal'; weaponTimer = 0; lightningTarget = null; shield = 0;
    lightningMid = null; lightningMidTimer = 0; ripples = []; rippleTimer = 0;
    nuke = 0; wreck = null; overlay.style.cursor = '';
    wave = 0; score = 0; lives = 3; gameOver = false; newHigh = false;
    resetShip(SPAWN_INVULN);
    spawnWave();
  }
  restart();

  // A short-lived burst of debris - line shards (lines:true) or dot sparks - used
  // for both asteroid and ship explosions.
  function burst(x, y, color, opts) {
    const o = opts || {};
    const count = o.count || 12, speed = o.speed || 140, life = o.life || 0.45, lines = !!o.lines;
    for (let i = 0; i < count; i++) {
      const ang = rand(0, TAU), sp = rand(speed * 0.25, speed);
      particles.push({
        x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        life: rand(life * 0.6, life), max: life, color,
        ang: rand(0, TAU), spin: rand(-9, 9), len: lines ? rand(5, 13) : 0
      });
    }
  }

  // True circular wrap: once an object's centre crosses the rim it reappears at
  // the antipode, keeping its velocity (which now points back into the disc), so it
  // "flies across the scope". It lands just INSIDE the antipodal rim - at distance
  // (2R - d), exactly where its render-ghost already is - rather than at distance d
  // outside it. Landing inside matters: a shallow/tangential crossing left outside
  // wouldn't be pulled back in within a frame and would teleport again next frame,
  // flip-flopping across the centre (the "random bounce"). Landing inside can't
  // re-exit, and matching the ghost keeps the hand-off seamless.
  function wrap(o) {
    const dx = o.x - cx, dy = o.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 > R * R) {
      const k = (2 * R - Math.sqrt(d2)) / Math.sqrt(d2);
      o.x = cx - dx * k; o.y = cy - dy * k;
    }
  }

  function spawnBullet(angle, speed, life, sniper) {
    if (bullets.length >= MAX_BULLETS) return;
    const c = Math.cos(angle), s = Math.sin(angle);
    bullets.push({
      x: ship.x + c * 14, y: ship.y + s * 14,
      vx: c * speed + ship.vx, vy: s * speed + ship.vy, life, sniper: !!sniper
    });
  }

  // Distance from the circle border along a ray from (px,py) in unit dir (dx,dy);
  // the ship is always inside, so there is exactly one positive intersection.
  function rayToRim(px, py, dx, dy) {
    const fx = px - cx, fy = py - cy;
    const b = fx * dx + fy * dy;
    const c = fx * fx + fy * fy - R * R;
    return -b + Math.sqrt(b * b - c);
  }
  // Shortest distance from point P to segment AB.
  function distToSeg(px, py, ax, ay, bx, by) {
    const vx = bx - ax, vy = by - ay, wx = px - ax, wy = py - ay;
    const len2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
    return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
  }

  function fireLaser() {
    const c = Math.cos(ship.angle), s = Math.sin(ship.angle);
    const t = rayToRim(ship.x, ship.y, c, s);
    const ex = ship.x + c * t, ey = ship.y + s * t;
    lasers.push({ x1: ship.x, y1: ship.y, x2: ex, y2: ey, life: 0.14, max: 0.14 });
    // Piercing: destroy every solid asteroid whose centre lies on the beam.
    for (let ai = asteroids.length - 1; ai >= 0; ai--) {
      const a = asteroids[ai];
      if (a.grace > 0) continue;
      // Hit if the asteroid overlaps the drawn beam band (its own radius + half-width).
      if (distToSeg(a.x, a.y, ship.x, ship.y, ex, ey) < a.radius + LASER_WIDTH / 2) destroyAsteroid(ai);
    }
  }

  // Lightning auto-aim: the nearest solid asteroid within the 35° front cone and
  // range, or null. Normalises the angle to the ship's heading for the cone test.
  function findLightningTarget() {
    let best = null, bestD = Infinity;
    for (const a of asteroids) {
      if (a.grace > 0) continue;
      const dx = a.x - ship.x, dy = a.y - ship.y;
      const dist = Math.hypot(dx, dy);
      if (dist > LIGHTNING_RANGE || dist >= bestD) continue;
      let d = Math.atan2(dy, dx) - ship.angle;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      if (Math.abs(d) > LIGHTNING_HALF) continue;
      best = a; bestD = dist;
    }
    return best;
  }

  // Fire the current weapon and set the cooldown to its cadence.
  function fireWeapon() {
    if (weapon === 'laser') { fireLaser(); fireCd = 0.18 / 0.25; return; }      // 25% of normal rate
    if (weapon === 'machine') {
      // Spray: each round is jittered by up to ±3° for worse accuracy.
      spawnBullet(ship.angle + rand(-3, 3) * Math.PI / 180, 1080, 0.9, false);
      fireCd = 0.08; return;
    }
    if (weapon === 'triple') {
      const spread = 20 * Math.PI / 180;
      spawnBullet(ship.angle - spread, 540, 0.9, false);
      spawnBullet(ship.angle, 540, 0.9, false);
      spawnBullet(ship.angle + spread, 540, 0.9, false);
      fireCd = 0.18; return;
    }
    if (weapon === 'sniper') { spawnBullet(ship.angle, 1080, Infinity, true); fireCd = 0.2; return; }
    spawnBullet(ship.angle, 540, 0.9, false); fireCd = 0.18;                    // normal
  }

  function destroyAsteroid(ai) {
    const a = asteroids[ai];
    score += a.size === 3 ? 20 : a.size === 2 ? 50 : 100;
    if (score > highScore) { highScore = score; newHigh = true; saveHi(); }
    burst(a.x, a.y, a.size === 3 ? ACCENT : LINE,
      { count: 5 + a.size * 3, speed: 60 + a.size * 38, life: 0.4 + a.size * 0.06 });
    // Power-up drop: 5% from a red (archive) asteroid, 1% from a white one.
    if (Math.random() < (a.size === 3 ? 0.05 : 0.01)) powerups.push(makePowerup(a.x, a.y));
    asteroids.splice(ai, 1);
    if (a.size > 1) {
      for (let k = 0; k < 2; k++) asteroids.push(makeAsteroid(a.x, a.y, a.size - 1, pick(FILE_POOL)));
    }
    if (!asteroids.length) spawnWave();
  }

  function loseLife() {
    lives--;
    // Ship explosion: white line shards (the broken hull) plus accent sparks.
    burst(ship.x, ship.y, LINE, { count: 16, speed: 185, life: 0.85, lines: true });
    burst(ship.x, ship.y, ACCENT, { count: 12, speed: 130, life: 0.6 });
    ship.dead = true; deathTimer = 0.9;   // animate the wreck before respawning / game over
  }

  // Launch a squadron: pick a travel direction, a lateral offset for the chord it
  // flies along, and 1-5 ships arranged in a trailing wedge behind the leader. The
  // whole group spawns just outside the near rim and flies straight across.
  function spawnFlyers() {
    const dir = rand(0, TAU);
    const c = Math.cos(dir), s = Math.sin(dir);
    const nx = -s, ny = c;                       // unit perpendicular to travel
    const n = 1 + ((Math.random() * 5) | 0);     // 1..5 ships
    const speed = rand(240, 430);
    const gap = rand(22, 34);
    const off = rand(-R * 0.55, R * 0.55);       // lateral offset of the flight path
    const startDist = R + 70;
    const baseX = cx - c * startDist + nx * off;
    const baseY = cy - s * startDist + ny * off;
    const alpha = rand(0.1, 0.2);                // dim - clearly background
    for (let i = 0; i < n; i++) {
      // Wedge offsets: leader at front (i=0), the rest paired off behind and to
      // alternating sides (rank 0,1,1,2,2 / side 0,+,-,+,-).
      const rank = (i + 1) >> 1;
      const sideSign = i === 0 ? 0 : (i % 2 ? 1 : -1);
      const fwd = -rank * gap, lat = sideSign * rank * gap * 0.8;
      flyers.push({
        x: baseX + c * fwd + nx * lat, y: baseY + s * fwd + ny * lat,
        vx: c * speed, vy: s * speed, angle: dir, alpha
      });
    }
  }

  // Drift the squadron across and retire it once it has cleared the far rim. One
  // formation at a time, with a few seconds of empty sky between sightings.
  function updateFlyers(dt) {
    flyerTimer -= dt;
    if (flyerTimer <= 0 && flyers.length === 0) { spawnFlyers(); flyerTimer = rand(5, 12); }
    for (let i = flyers.length - 1; i >= 0; i--) {
      const f = flyers[i];
      f.x += f.vx * dt; f.y += f.vy * dt;
      if (Math.hypot(f.x - cx, f.y - cy) > R + 120) flyers.splice(i, 1);
    }
  }

  // Drift the nuke wreck at constant velocity (no drag), tumbling, until it has
  // fully faded. Runs every frame so it carries on through the cinematic and into
  // the next wave, independent of play (and survives a game over).
  function updateWreck(dt) {
    if (!wreck) return;
    wreck.x += wreck.vx * dt; wreck.y += wreck.vy * dt; wrap(wreck);
    wreck.angle += wreck.spin * dt;
    // Stay fully visible through the cinematic; only start fading once the player
    // has respawned (the nuke timer has elapsed).
    if (nuke <= 0) {
      wreck.fade += dt;
      if (wreck.fade >= WRECK_FADE) wreck = null;
    }
  }

  // Keep the asteroids drifting (and spinning/wrapping) on the game-over screen,
  // without any of the collision/firing logic that the full update() runs.
  function driftAsteroids(dt) {
    for (const a of asteroids) {
      a.x += a.vx * dt; a.y += a.vy * dt; a.angleR += a.spin * dt; wrap(a);
    }
  }

  // ---- Update ----
  function update(dt) {
    // Nuclear cinematic: freeze play, keep the scope empty, then at the end either
    // respawn the player into a fresh wave or - if the bomb cost the last life - end.
    if (nuke > 0) {
      nuke -= dt;
      asteroids = []; bullets = []; lasers = []; powerups = []; particles = [];
      lightningTarget = null;
      if (nuke <= 0) {
        nuke = 0;
        overlay.style.cursor = '';   // cursor back once the cinematic ends
        if (lives <= 0) gameOver = true;
        else { resetShip(SPAWN_INVULN); spawnWave(); }
      }
      return;
    }
    clock += dt;

    // Debris particles (asteroid + ship explosions): drift, slow, spin, fade.
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt; p.y += p.vy * dt;
      const f = Math.exp(-1.6 * dt); p.vx *= f; p.vy *= f;
      p.ang += p.spin * dt; p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }

    // Laser beam flashes fade out fast.
    for (let i = lasers.length - 1; i >= 0; i--) { lasers[i].life -= dt; if (lasers[i].life <= 0) lasers.splice(i, 1); }

    // Ultrasound ripples expand outward to the rim, then vanish.
    for (let i = ripples.length - 1; i >= 0; i--) { ripples[i].p += dt / RIPPLE_DUR; if (ripples[i].p >= 1) ripples.splice(i, 1); }

    // Timed weapon power-ups revert to the normal cannon when they run out.
    if (weaponTimer > 0) { weaponTimer -= dt; if (weaponTimer <= 0) { weapon = 'normal'; weaponTimer = 0; } }
    if (shield > 0) shield -= dt;

    // Power-ups drift, wrap, expire, and are collected by flying over them.
    for (let i = powerups.length - 1; i >= 0; i--) {
      const p = powerups[i];
      p.x += p.vx * dt; p.y += p.vy * dt; wrap(p); p.life -= dt;
      if (p.life <= 0) { powerups.splice(i, 1); continue; }
      if (!ship.dead && !gameOver) {
        const dx = p.x - ship.x, dy = p.y - ship.y, rr = p.radius + 11;
        if (dx * dx + dy * dy < rr * rr) {
          applyPowerup(p.type);
          burst(p.x, p.y, p.color, { count: 10, speed: 95, life: 0.4 });
          powerups.splice(i, 1);
        }
      }
    }

    if (ship.dead) {
      // Hold on the wreck, then respawn (with immunity) or end the game.
      lightningTarget = null;
      deathTimer -= dt;
      if (deathTimer <= 0) { if (lives <= 0) gameOver = true; else resetShip(SPAWN_INVULN); }
    } else {
      if (input.left) ship.angle -= 4.6 * dt;
      if (input.right) ship.angle += 4.6 * dt;
      if (input.thrust) { ship.vx += Math.cos(ship.angle) * 270 * dt; ship.vy += Math.sin(ship.angle) * 270 * dt; }
      const drag = Math.exp(-0.55 * dt);
      ship.vx *= drag; ship.vy *= drag;
      const sp = Math.hypot(ship.vx, ship.vy), MAX = 430;
      if (sp > MAX) { ship.vx = ship.vx / sp * MAX; ship.vy = ship.vy / sp * MAX; }
      ship.x += ship.vx * dt; ship.y += ship.vy * dt; wrap(ship);
      if (ship.invuln > 0) ship.invuln -= dt;
      fireCd -= dt;
      if (weapon === 'lightning') {
        // Auto-target: lock the closest asteroid in the cone and tick it at the
        // normal gun's cadence (one-hit kills since asteroids have no HP). The lock
        // is recomputed every frame, so the bolt stays drawn continuously - we keep
        // the (just-destroyed) target this frame so the strike shows on the kill.
        lightningTarget = findLightningTarget();
        // Re-roll the mid kink every 0.5s: a point ~30-70% of the way to the target
        // with a perpendicular kick, stored as an offset from the ship.
        lightningMidTimer -= dt;
        if (lightningTarget && (lightningMidTimer <= 0 || !lightningMid)) {
          const dx = lightningTarget.x - ship.x, dy = lightningTarget.y - ship.y;
          const len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
          const t = rand(0.3, 0.7), j = rand(-1, 1) * len * 0.18;
          lightningMid = { ox: dx * t + nx * j, oy: dy * t + ny * j };
          lightningMidTimer = 0.5;
        }
        if (lightningTarget && fireCd <= 0) {
          destroyAsteroid(asteroids.indexOf(lightningTarget));
          fireCd = 0.18;
        }
      } else if (weapon === 'ultrasound') {
        // Auto AoE: a sonar pulse that destroys everything within the radius every
        // ULTRASOUND_TICK, plus continuous expanding ripples for feedback.
        lightningTarget = null;
        rippleTimer -= dt;
        if (rippleTimer <= 0) { ripples.push({ p: 0 }); rippleTimer = ULTRASOUND_TICK; }
        if (fireCd <= 0) {
          for (let ai = asteroids.length - 1; ai >= 0; ai--) {
            const a = asteroids[ai];
            if (a.grace > 0) continue;
            const dx = a.x - ship.x, dy = a.y - ship.y, rr = ULTRASOUND_RADIUS + a.radius;
            if (dx * dx + dy * dy < rr * rr) destroyAsteroid(ai);
          }
          fireCd = ULTRASOUND_TICK;
        }
      } else {
        lightningTarget = null;
        if (input.fire && fireCd <= 0) fireWeapon();
      }
    }

    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt; wrap(b);
      if (b.life <= 0) bullets.splice(i, 1);
    }

    for (const a of asteroids) {
      a.x += a.vx * dt; a.y += a.vy * dt; a.angleR += a.spin * dt; wrap(a);
      if (a.grace > 0) a.grace -= dt;   // count down the spawn-grace (no hitbox)
    }

    // Bullet -> asteroid. Asteroids still in spawn-grace have no hitbox.
    for (let bi = bullets.length - 1; bi >= 0; bi--) {
      const b = bullets[bi];
      for (let ai = asteroids.length - 1; ai >= 0; ai--) {
        const a = asteroids[ai];
        if (a.grace > 0) continue;
        const dx = a.x - b.x, dy = a.y - b.y;
        if (dx * dx + dy * dy < a.radius * a.radius) { bullets.splice(bi, 1); destroyAsteroid(ai); break; }
      }
    }

    // Asteroid -> ship (skipped while dead, immune, shielded, or asteroid in grace).
    if (!ship.dead && ship.invuln <= 0 && shield <= 0 && !gameOver) {
      for (const a of asteroids) {
        if (a.grace > 0) continue;
        const dx = a.x - ship.x, dy = a.y - ship.y, rr = a.radius + 11;
        if (dx * dx + dy * dy < rr * rr) { loseLife(); break; }
      }
    }
  }

  // ---- Render ----
  // Circular wrap is drawn, not popped: while an object straddles the rim we draw
  // a second "ghost" copy at the antipode so the bit poking out one side peeks
  // back in by the SAME amount on the opposite side. The clip to the scope hides
  // whatever is past the rim, leaving one seamless crossing.
  //
  // The ghost can't be a plain reflection through the centre - that keeps the same
  // distance d, so a near-rim asteroid would show a whole duplicate near the
  // opposite rim (a "bounce"). The complementary copy sits along the antipodal
  // direction at distance (2R - d): at d = R it coincides with the centre
  // reflection (the seamless hand-off point), at d = R - radius it's fully outside
  // (invisible), and once the real centre crosses the rim the swap is hidden
  // because the ghost is already there. `extent` is the object's radius.
  function withWrap(x, y, extent, paint) {
    paint(x, y);
    const dx = x - cx, dy = y - cy;
    const d = Math.hypot(dx, dy);
    if (d > 0 && d + extent > R) {
      const k = (2 * R - d) / d;
      paint(cx - dx * k, cy - dy * k);
    }
  }

  // A background flyer: the same hull as the player, dimmed and slightly smaller,
  // pointing where it travels. No wrap or ghost - it just slides across the scope.
  function drawFlyer(f) {
    ctx.save();
    ctx.globalAlpha = f.alpha;
    ctx.translate(f.x, f.y);
    ctx.rotate(f.angle);
    ctx.scale(0.85, 0.85);
    ctx.strokeStyle = LINE; ctx.lineWidth = 1.3; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(14, 0); ctx.lineTo(-10, -9); ctx.lineTo(-6, 0); ctx.lineTo(-10, 9);
    ctx.closePath(); ctx.stroke();
    // Always under thrust (they're tearing across); flicker the flame like the
    // player's, but in a lighter tint so it stays subtle at this distance.
    if (Math.random() > 0.35) {
      ctx.strokeStyle = '#ffb3bd';
      ctx.beginPath(); ctx.moveTo(-6, -4); ctx.lineTo(-16, 0); ctx.lineTo(-6, 4); ctx.stroke();
    }
    ctx.restore();
  }

  function drawShipAt(x, y) {
    // Fade the ship in over the first 0.6s after a (re)spawn - invuln starts at
    // SPAWN_INVULN and ticks down, so elapsed = SPAWN_INVULN - invuln.
    const fade = Math.min(1, (SPAWN_INVULN - ship.invuln) / 0.6);
    ctx.save();
    ctx.translate(x, y);
    // Blue charge glow under the ship while firing with lightning equipped.
    if (weapon === 'lightning' && input.fire) {
      ctx.save();
      ctx.globalAlpha = fade * (0.4 + 0.2 * Math.abs(Math.sin(clock * 8)));
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 38);
      g.addColorStop(0, 'rgba(59,91,219,0.8)');   // #3b5bdb, the lightning colour
      g.addColorStop(1, 'rgba(59,91,219,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, 38, 0, TAU); ctx.fill();
      ctx.restore();
    }
    // Immunity is signalled by a pulsing circle around the ship.
    if (ship.invuln > 0) {
      ctx.globalAlpha = fade * (0.45 + 0.45 * Math.abs(Math.sin(clock * 6)));
      ctx.strokeStyle = LINE; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(0, 0, 21, 0, TAU); ctx.stroke();
    }
    // Health-at-full shield: a steadier green bubble in the health colour, blinking
    // out in its final second.
    if (shield > 0 && !(shield < 1 && (Math.floor(shield * 8) & 1))) {
      ctx.globalAlpha = fade * (0.55 + 0.25 * Math.abs(Math.sin(clock * 3)));
      ctx.strokeStyle = POWERUP_DEF.health.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 24, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = fade;
    ctx.rotate(ship.angle);
    ctx.strokeStyle = LINE; ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(14, 0); ctx.lineTo(-10, -9); ctx.lineTo(-6, 0); ctx.lineTo(-10, 9);
    ctx.closePath(); ctx.stroke();
    if (input.thrust && (Math.random() > 0.35)) {
      ctx.strokeStyle = ACCENT;
      ctx.beginPath(); ctx.moveTo(-6, -4); ctx.lineTo(-16, 0); ctx.lineTo(-6, 4); ctx.stroke();
    }
    ctx.restore();
  }
  // The drifting wreck left by a nuke: a dimmed, tumbling hull (no flame or rings).
  // Stays fully visible through the cinematic, then fades over WRECK_FADE once the
  // player has respawned.
  function drawWreck() {
    if (!wreck) return;
    const fade = nuke > 0 ? 1 : Math.max(0, 1 - wreck.fade / WRECK_FADE);
    if (fade <= 0) return;
    withWrap(wreck.x, wreck.y, 21, (x, y) => {
      ctx.save();
      ctx.globalAlpha = 0.7 * fade;
      ctx.translate(x, y);
      ctx.rotate(wreck.angle);
      ctx.strokeStyle = MUTED; ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(14, 0); ctx.lineTo(-10, -9); ctx.lineTo(-6, 0); ctx.lineTo(-10, 9);
      ctx.closePath(); ctx.stroke();
      ctx.restore();
    });
  }
  function drawShip() {
    if (ship.dead || nuke > 0) return;
    withWrap(ship.x, ship.y, 21, drawShipAt);
  }

  function drawAsteroidAt(a, x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
    ctx.strokeStyle = a.size === 3 ? ACCENT : LINE;
    // While in spawn-grace (no hitbox) the outline is stripey and dimmed, with the
    // dashes marching so it reads as "not solid yet".
    const grace = a.grace > 0;
    if (grace) { ctx.setLineDash([6, 5]); ctx.lineDashOffset = -clock * 36; ctx.globalAlpha = 0.5; }
    ctx.beginPath();
    for (let i = 0; i < a.verts.length; i++) {
      const v = a.verts[i], ang = a.angleR + v.a, r = a.radius * v.r;
      const px = Math.cos(ang) * r, py = Math.sin(ang) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.stroke();
    ctx.setLineDash([]);
    // Label only once the asteroid is solid (has a hitbox); hidden during grace.
    if (!grace) {
      ctx.fillStyle = a.size === 3 ? ACCENT : '#e6e6e6';
      ctx.font = a.font + 'px ' + MONO;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(a.label, 0, 0);
    }
    ctx.restore();
  }
  function drawAsteroid(a) {
    withWrap(a.x, a.y, a.radius, (x, y) => drawAsteroidAt(a, x, y));
  }

  // Radiation trefoil as vector paths - three 60° blades (gaps point up, the iconic
  // orientation) around a central dot - so the nuke icon doesn't depend on the ☢
  // font glyph. Drawn in the current fillStyle, sized to a powerup box half-size s.
  function drawTrefoil(s) {
    const rOut = s * 0.92, rIn = s * 0.34, dot = s * 0.17, h = Math.PI / 6;
    for (let k = 0; k < 3; k++) {
      const c = Math.PI / 2 + k * (TAU / 3);
      ctx.beginPath();
      ctx.arc(0, 0, rOut, c - h, c + h);
      ctx.arc(0, 0, rIn, c + h, c - h, true);
      ctx.closePath(); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(0, 0, dot, 0, TAU); ctx.fill();
  }

  function drawPowerupAt(p, x, y) {
    if (p.life < 3 && (Math.floor(p.life * 8) & 1)) return;   // blink as it nears expiry
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1 + 0.08 * Math.sin(clock * 5), 1 + 0.08 * Math.sin(clock * 5));   // gentle pulse
    const s = p.radius;
    ctx.strokeStyle = p.color; ctx.lineWidth = 1.6;
    ctx.strokeRect(-s, -s, s * 2, s * 2);
    ctx.fillStyle = p.color;
    if (p.type === 'nuke') {
      drawTrefoil(s);
    } else {
      ctx.font = '600 14px ' + MONO;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(p.letter, 0, 1);
    }
    ctx.restore();
  }
  function drawPowerup(p) { withWrap(p.x, p.y, p.radius, (x, y) => drawPowerupAt(p, x, y)); }

  // A jagged electric polyline from (ax,ay) to (bx,by), re-jittered each frame.
  function jaggedSeg(ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const segs = Math.max(2, Math.round(len / 22));
    ctx.moveTo(ax, ay);
    for (let i = 1; i < segs; i++) {
      const t = i / segs, j = (Math.random() - 0.5) * 12;
      ctx.lineTo(ax + dx * t + nx * j, ay + dy * t + ny * j);
    }
    ctx.lineTo(bx, by);
  }

  // Three anchors: the ship, a player-relative mid kink, and the target - linked by
  // the jagged effect (player -> mid, mid -> target).
  function drawLightning() {
    if (weapon !== 'lightning' || !lightningTarget || !lightningMid || ship.dead || gameOver || nuke > 0) return;
    const sx = ship.x + Math.cos(ship.angle) * 14, sy = ship.y + Math.sin(ship.angle) * 14;
    const mx = ship.x + lightningMid.ox, my = ship.y + lightningMid.oy;
    ctx.save();
    ctx.strokeStyle = POWERUP_DEF.lightning.color;
    ctx.shadowColor = POWERUP_DEF.lightning.color; ctx.shadowBlur = 10;
    ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath();
    jaggedSeg(sx, sy, mx, my);
    jaggedSeg(mx, my, lightningTarget.x, lightningTarget.y);
    ctx.stroke();
    ctx.restore();
  }

  // Ultrasound aura: a white border circle at the kill radius, plus light-blue
  // ripples spawning under the ship and expanding out to that border.
  function drawUltrasound() {
    if (weapon !== 'ultrasound' || ship.dead || gameOver || nuke > 0) return;
    ctx.save();
    ctx.translate(ship.x, ship.y);
    for (const rp of ripples) {
      ctx.globalAlpha = (1 - rp.p) * 0.6;
      ctx.strokeStyle = POWERUP_DEF.ultrasound.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 6 + (ULTRASOUND_RADIUS - 6) * rp.p, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = LINE; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, ULTRASOUND_RADIUS, 0, TAU); ctx.stroke();
    ctx.restore();
  }

  function drawLasers() {
    for (const lz of lasers) {
      const a = Math.max(0, lz.life / lz.max);
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = POWERUP_DEF.laser.color;
      // Wide translucent band the size of the (now 70%-bigger) kill zone, plus a
      // bright core. LASER_WIDTH is the full beam width drawn to match the hitbox.
      ctx.globalAlpha = a * 0.22;
      ctx.lineWidth = LASER_WIDTH;
      ctx.beginPath(); ctx.moveTo(lz.x1, lz.y1); ctx.lineTo(lz.x2, lz.y2); ctx.stroke();
      ctx.globalAlpha = a;
      ctx.shadowColor = ACCENT; ctx.shadowBlur = 14;
      ctx.lineWidth = 2 + 3 * a;
      ctx.beginPath(); ctx.moveTo(lz.x1, lz.y1); ctx.lineTo(lz.x2, lz.y2); ctx.stroke();
      ctx.restore();
    }
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      if (p.len) {
        ctx.strokeStyle = p.color; ctx.lineWidth = 1.4;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.ang);
        ctx.beginPath(); ctx.moveTo(-p.len / 2, 0); ctx.lineTo(p.len / 2, 0); ctx.stroke();
        ctx.restore();
      } else {
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - 1.3, p.y - 1.3, 2.6, 2.6);
      }
    }
    ctx.globalAlpha = 1;
  }

  function hud() {
    ctx.textBaseline = 'alphabetic';
    const top = cy - R - 14;   // baseline of the big figures, hugging the rim
    // Score - top-left of the circle, with the persistent high score under it.
    ctx.textAlign = 'left';
    ctx.font = '12px ' + MONO; ctx.fillStyle = MUTED; ctx.fillText('SCORE', cx - R, top - 17);
    ctx.font = '18px ' + MONO; ctx.fillStyle = ACCENT; ctx.fillText(String(score).padStart(5, '0'), cx - R, top);
    ctx.font = '11px ' + MONO; ctx.fillStyle = MUTED; ctx.fillText('HIGH ' + String(highScore).padStart(5, '0'), cx - R, top + 15);
    // Wave - top-right of the circle.
    ctx.textAlign = 'right';
    ctx.font = '12px ' + MONO; ctx.fillStyle = MUTED; ctx.fillText('WAVE', cx + R, top - 17);
    ctx.font = '18px ' + MONO; ctx.fillStyle = ON_DARK; ctx.fillText(String(wave), cx + R, top);
    // Lives + controls below the circle.
    ctx.textAlign = 'center';
    ctx.font = '15px ' + MONO; ctx.fillStyle = LINE;
    ctx.fillText(lives > 0 ? '▲ '.repeat(lives).trim() : '—', cx, cy + R + 24);
    ctx.font = '12px ' + MONO; ctx.fillStyle = MUTED;
    ctx.fillText('← → rotate · ↑ thrust · space fire · r reset · esc exit', cx, cy + R + 44);
    // Title centred at the top of the screen.
    ctx.font = '11px ' + MONO; ctx.fillStyle = MUTED;
    ctx.fillText('ASTEROIDS · SUPPORTED FORMATS', cx, 24);
  }

  // Massive wave numeral centred on screen, shown while the new wave's asteroids
  // are still in grace, pulsing between 40% and 60% alpha. It fades in as the wave
  // arrives and fades out as the grace ends (envelope ramps over FADE seconds at
  // each end, scaling the pulse). `graceLeft` is the grace remaining on the wave.
  function waveBanner(graceLeft) {
    const FADE = 0.6;
    const elapsed = WAVE_GRACE - graceLeft;
    const env = Math.max(0, Math.min(1, elapsed / FADE, graceLeft / FADE));
    const alpha = env * (0.5 + 0.1 * Math.sin(clock * 4));
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = LINE;
    ctx.font = '700 ' + Math.round(Math.min(W, H) * 0.5) + 'px ' + MONO;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(wave), cx, cy);
    ctx.restore();
  }

  // Active weapon power-up + countdown, colour-coded, tracking just under the ship.
  function drawWeaponTimer() {
    if (weapon === 'normal' || ship.dead || gameOver || nuke > 0) return;
    const def = POWERUP_DEF[weapon];
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = def.color;
    ctx.font = '12px ' + MONO;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(def.label + ' · ' + weaponTimer.toFixed(1) + 's', ship.x, ship.y + 26);
    ctx.restore();
  }

  // Nuclear flash: full-screen white over everything (HUD included). Holds opaque
  // for NUKE_WHITE, fades out over NUKE_FADE, then nothing for the NUKE_GAP beat.
  function nukeFlash() {
    if (nuke <= 0) return;
    const elapsed = NUKE_TOTAL - nuke;
    let a;
    if (elapsed < NUKE_WHITE) a = 1;
    else if (elapsed < NUKE_WHITE + NUKE_FADE) a = 1 - (elapsed - NUKE_WHITE) / NUKE_FADE;
    else a = 0;
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  function gameOverScreen() {
    ctx.textAlign = 'center';
    ctx.fillStyle = ACCENT; ctx.font = '34px ' + MONO; ctx.fillText('GAME OVER', cx, cy - 16);
    ctx.fillStyle = ON_DARK; ctx.font = '15px ' + MONO;
    ctx.fillText('score ' + score + ' · wave ' + wave, cx, cy + 14);
    if (newHigh) { ctx.fillStyle = POWERUP_DEF.health.color; ctx.font = '14px ' + MONO; ctx.fillText('★ NEW HIGH SCORE', cx, cy + 36); }
    else { ctx.fillStyle = MUTED; ctx.font = '13px ' + MONO; ctx.fillText('high ' + highScore, cx, cy + 36); }
    ctx.fillStyle = MUTED; ctx.font = '13px ' + MONO;
    ctx.fillText('space / tap to play again · esc to exit', cx, cy + 60);
  }

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.clip();
    // faint scope fill + starfield
    ctx.fillStyle = 'rgba(255,255,255,0.015)'; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    for (const s of stars) {
      ctx.globalAlpha = s.b;
      ctx.fillStyle = '#bbb';
      ctx.fillRect(cx + Math.cos(s.a) * s.r * R, cy + Math.sin(s.a) * s.r * R, 1.4, 1.4);
    }
    ctx.globalAlpha = 1;
    for (const f of flyers) drawFlyer(f);   // background squadrons, behind the action
    for (const a of asteroids) drawAsteroid(a);
    for (const p of powerups) drawPowerup(p);
    // Bullets: sniper rounds are a touch larger and accent-tinted; others are dots.
    for (const b of bullets) {
      ctx.fillStyle = b.sniper ? ACCENT : LINE;
      const r = b.sniper ? 2.8 : 2.2;
      withWrap(b.x, b.y, r, (x, y) => { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); });
    }
    drawUltrasound();
    drawLasers();
    drawLightning();
    drawParticles();
    drawWreck();
    if (!gameOver) drawShip();
    ctx.restore();

    // scope ring with a soft accent glow
    ctx.save();
    ctx.shadowColor = ACCENT; ctx.shadowBlur = 18;
    ctx.strokeStyle = ACCENT; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R - 5, 0, TAU); ctx.stroke();

    if (!gameOver) {
      const graceLeft = asteroids.reduce((m, a) => Math.max(m, a.grace), 0);
      if (graceLeft > 0) waveBanner(graceLeft);
    }
    drawWeaponTimer();
    hud();
    nukeFlash();
    if (gameOver) gameOverScreen();
  }

  // ---- Loop ----
  let raf = 0, last = performance.now(), paused = false;
  function frame(t) {
    if (!active) return;
    raf = requestAnimationFrame(frame);
    if (paused) { last = t; return; }
    let dt = (t - last) / 1000; last = t;
    if (dt > 0.05) dt = 0.05;
    updateFlyers(dt);               // ambient background - keeps drifting even on game over
    updateWreck(dt);                // nuke wreck - drifts on past the cinematic, then fades
    if (!gameOver) update(dt);
    else driftAsteroids(dt);        // keep the field drifting under the game-over screen
    render();
  }
  raf = requestAnimationFrame(frame);

  // ---- Input ----
  const KEY = {
    ArrowLeft: 'left', a: 'left', A: 'left',
    ArrowRight: 'right', d: 'right', D: 'right',
    ArrowUp: 'up', w: 'up', W: 'up'
  };
  function onKeyDown(e) {
    const k = e.key;
    if (k === 'Escape') { teardown(); return; }
    if (k === 'r' || k === 'R') { e.preventDefault(); restart(); return; }   // restart the run anytime
    if (gameOver && (k === ' ' || k === 'Enter')) { e.preventDefault(); restart(); return; }
    const m = KEY[k];
    if (m === 'left') input.left = true;
    else if (m === 'right') input.right = true;
    else if (m === 'up') input.thrust = true;
    else if (k === ' ') input.fire = true;
    else return;
    e.preventDefault();
  }
  function onKeyUp(e) {
    const m = KEY[e.key];
    if (m === 'left') input.left = false;
    else if (m === 'right') input.right = false;
    else if (m === 'up') input.thrust = false;
    else if (e.key === ' ') input.fire = false;
  }
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);

  function onResize() { layout(); }
  window.addEventListener('resize', onResize);

  function onVis() { paused = document.hidden; if (!paused) last = performance.now(); }
  document.addEventListener('visibilitychange', onVis);

  // ---- Touch controls (shown on touch devices) ----
  let touchEls = [];
  if (window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) {
    const mkPad = (side) => {
      const p = document.createElement('div');
      p.style.cssText = 'position:absolute; bottom:22px; ' + side + ':18px; display:flex; gap:12px; z-index:2;';
      overlay.appendChild(p); touchEls.push(p); return p;
    };
    const mkBtn = (parent, label, prop) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'anr-game-btn'; b.textContent = label;
      b.style.cssText = 'width:60px; height:60px; font-size:21px; touch-action:none;';
      const set = (v) => (e) => { e.preventDefault(); if (gameOver && v && prop === 'fire') { restart(); return; } input[prop] = v; };
      b.addEventListener('pointerdown', set(true));
      b.addEventListener('pointerup', set(false));
      b.addEventListener('pointercancel', set(false));
      b.addEventListener('pointerleave', set(false));
      parent.appendChild(b);
    };
    const L = mkPad('left'); mkBtn(L, '◀', 'left'); mkBtn(L, '▶', 'right');
    const Rp = mkPad('right'); mkBtn(Rp, '▲', 'thrust'); mkBtn(Rp, '●', 'fire');
  }

  // ---- Teardown ----
  function teardown() {
    if (!active) return;
    active = false;
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVis);
    overlay.remove();
    document.body.style.overflow = prevOverflow;
  }
}
