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
  const UFO_REWARD_COLOR = '#ff4dd2';    // magenta - the destructible reward saucer
  const UFO_AMBIENT_COLOR = '#56d4dd';   // teal - the indestructible roaming escort
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
    '.anr-game-btn:active{background:' + ACCENT + ';color:' + ACCENT_FG + ';border-color:' + ACCENT + ';}' +
    // End-of-game leaderboard panel: name entry, then the top 5 + play again.
    '.anr-score-panel{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:4;' +
    'display:flex;flex-direction:column;align-items:center;gap:9px;width:min(320px,86vw);' +
    'padding:20px 22px;background:' + MEDIA_BG + ';border:1px solid ' + BORDER + ';' +
    'font-family:' + MONO + ';color:' + ON_DARK + ';text-align:center;}' +
    '.anr-score-title{font-size:13px;letter-spacing:.18em;color:' + MUTED + ';}' +
    '.anr-score-go{font-size:24px;color:' + ACCENT + ';letter-spacing:.04em;}' +
    '.anr-score-sub{font-size:13px;color:' + ON_DARK + ';}' +
    '.anr-score-msg{font-size:12px;color:' + MUTED + ';min-height:14px;}' +
    '.anr-score-msg.err{color:' + ACCENT + ';}' +
    '.anr-score-input{font-family:' + MONO + ';font-size:24px;letter-spacing:.45em;text-align:center;' +
    'text-transform:uppercase;width:170px;padding:9px 4px 9px 16px;background:' + SURFACE + ';color:' + ON_DARK +
    ';border:1px solid ' + BORDER + ';border-radius:0;outline:none;caret-color:' + ACCENT + ';}' +
    '.anr-score-input:focus{border-color:' + ON_DARK + ';}' +
    '.anr-score-row{display:flex;gap:8px;}' +
    '.anr-score-list{list-style:none;margin:2px 0 4px;padding:0;width:100%;font-size:13px;}' +
    '.anr-score-list li{display:flex;align-items:center;padding:4px 2px;border-bottom:1px solid ' + BORDER + ';}' +
    '.anr-score-list li:last-child{border-bottom:0;}' +
    '.anr-score-list li .r{color:' + MUTED + ';width:1.6em;text-align:right;}' +
    '.anr-score-list li .n{flex:1;text-align:left;padding-left:12px;letter-spacing:.18em;}' +
    '.anr-score-list li .s{color:' + ACCENT + ';font-weight:600;}' +
    '.anr-score-list li.me .n{color:' + ACCENT + ';}' +
    '.anr-game-btn.on{background:' + ACCENT + ';color:' + ACCENT_FG + ';border-color:' + ACCENT + ';}';
  overlay.appendChild(style);

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; display:block;';
  overlay.appendChild(canvas);

  // Nuclear flash as a DOM layer (not a canvas fill) so it sits above EVERYTHING in
  // the overlay - controls, close button, end panel. Its opacity is driven per frame
  // by nukeFlash(); pointer-events:none so it never traps input.
  const nukeEl = document.createElement('div');
  nukeEl.style.cssText = 'position:absolute; inset:0; background:#fff; opacity:0; pointer-events:none; z-index:2147483647;';
  overlay.appendChild(nukeEl);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'anr-game-btn';
  closeBtn.textContent = '✕';
  closeBtn.setAttribute('aria-label', 'Close game');
  closeBtn.style.cssText = 'position:absolute; top:14px; right:16px; z-index:2; width:36px; height:36px; font-size:15px;';
  closeBtn.addEventListener('click', teardown);
  overlay.appendChild(closeBtn);

  // Dev-only hard reload: clears the cache so code edits actually show up. Hidden in
  // production - only on localhost, a private LAN IP (phone testing), or the :3000
  // dev server.
  const isDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1' ||
    /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname) || location.port === '3000';
  if (isDev) {
    const reloadBtn = document.createElement('button');
    reloadBtn.type = 'button';
    reloadBtn.className = 'anr-game-btn';
    reloadBtn.textContent = '⟳';
    reloadBtn.title = 'Clear cache and reload (dev)';
    reloadBtn.setAttribute('aria-label', 'Clear cache and reload');
    reloadBtn.style.cssText = 'position:absolute; top:14px; right:60px; z-index:2; width:36px; height:36px; font-size:16px;';
    reloadBtn.addEventListener('click', async () => {
      reloadBtn.disabled = true;
      // Mirror a manual "clear cache + hard reload": unregister the PWA service worker
      // and delete every Cache Storage bucket, then reload so all modules refetch from
      // the dev server. (A plain re-import only refreshed asteroids.js, not its
      // dependencies or the page, and couldn't shake a cached service worker.)
      try {
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.unregister()));
        }
        if (window.caches) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
      } catch (_) {}
      location.reload();
    });
    overlay.appendChild(reloadBtn);
  }

  document.body.appendChild(overlay);

  const ctx = canvas.getContext('2d');
  // The play field is a rectangle centred on (cx, cy) with half-extents HW (half
  // width) and HH (half height). Its aspect ratio follows the viewport but is
  // clamped between 9:16 (portrait) and 16:9 (landscape). R is kept as the scope
  // "size" scalar (the smaller half-extent) that drives the element scale and
  // spawn distances.
  let W = 0, H = 0, cx = 0, cy = 0, R = 0, HW = 0, HH = 0, dpr = 1, stars = [], S = 1;
  let mobileControls = [];   // joystick / arrows / fire - hidden on the game-over screen

  function layout() {
    // Remember the previous geometry so a zoom/resize can rescale the live scene to
    // the new scope (radii/speeds with S, positions into the resized rectangle).
    const oldS = S, oldCx = cx, oldCy = cy, oldHW = HW, oldHH = HH;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    const coarse = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    // On mobile the scope nearly fills the width and sits higher up (leaving the
    // lower third for the controls); on desktop it's centred.
    cx = W / 2; cy = coarse ? H * 0.40 : H / 2;
    // Space the field may occupy: leave room for the HUD (top score line, bottom
    // lives/controls) and, on desktop, the high-score column down the left margin.
    const padX = coarse ? 14 : 220;
    const padTop = 64;
    const padBottom = coarse ? 120 : 70;
    const maxHW = Math.max(60, W / 2 - padX);
    const maxHH = Math.max(60, Math.min(cy - padTop, H - padBottom - cy));
    // Largest rectangle, centred and aspect-clamped to [9:16, 16:9], that fits the
    // available box. The aspect tracks the viewport, so it's portrait on phones and
    // landscape on desktop, but never narrower than 9:16 or wider than 16:9.
    const AR_MIN = 9 / 16, AR_MAX = 16 / 9;
    const availW = 2 * maxHW, availH = 2 * maxHH;
    const ar = Math.max(AR_MIN, Math.min(AR_MAX, availW / availH));
    let fw = availW, fh = fw / ar;
    if (fh > availH) { fh = availH; fw = fh * ar; }
    HW = fw / 2; HH = fh / 2;
    R = Math.min(HW, HH);
    // Element scale: the contents (ships, asteroids, speeds...) scale strictly
    // linearly with the scope, so their size *relative to the field* is constant at
    // any zoom / window size - the whole scene just grows and shrinks as one. (The
    // old min(1, ...) cap broke this: past the cap the field kept growing while the
    // elements didn't, so they appeared to shrink as you zoomed out.)
    S = R / 470;
    // On a real resize/zoom (not the first layout), rescale everything already on the
    // field so it keeps the same size and place relative to the scope - matching the
    // ship/UFOs, which draw at the live S every frame.
    if (oldHW > 0 && oldHH > 0 && (oldHW !== HW || oldHH !== HH || oldS !== S)) {
      rescaleScene(oldS, oldCx, oldCy, oldHW, oldHH);
    }
    // Starfield in field-normalised coords ([-1,1] on each axis), so it survives a
    // resize and stretches with the rectangle.
    if (!stars.length) {
      for (let i = 0; i < 90; i++) {
        stars.push({ x: rand(-1, 1), y: rand(-1, 1), b: rand(0.15, 0.6) });
      }
    }
  }

  // Rescale every live object to the new scope after a resize/zoom: radii, speeds and
  // line lengths scale with S (so sizes stay constant relative to the field, like the
  // ship), and positions remap into the resized rectangle (so nothing jumps out of
  // bounds or shifts off its relative spot). UFO path positions are recomputed each
  // frame anyway, but their collision radius still needs the rescale.
  function rescaleScene(oldS, oldCx, oldCy, oldHW, oldHH) {
    const sr = S / oldS;                       // size / speed ratio
    const fx = HW / oldHW, fy = HH / oldHH;    // per-axis position ratio
    const mapX = (x) => cx + (x - oldCx) * fx;
    const mapY = (y) => cy + (y - oldCy) * fy;
    const remap = (o) => {
      o.x = mapX(o.x); o.y = mapY(o.y);
      if (o.vx !== undefined) { o.vx *= sr; o.vy *= sr; }
      if (o.radius !== undefined) o.radius *= sr;
    };
    for (const a of asteroids) { remap(a); a.font = fitFont(a.label, a.radius); }
    for (const u of ufos) { remap(u); if (u.leaving) { u.lvx *= sr; u.lvy *= sr; } }
    for (const b of bullets) remap(b);
    for (const p of powerups) remap(p);
    for (const p of particles) { remap(p); if (p.len) p.len *= sr; }
    for (const f of flyers) remap(f);
    if (wreck) remap(wreck);
    ship.x = mapX(ship.x); ship.y = mapY(ship.y); ship.vx *= sr; ship.vy *= sr;
    for (const lz of lasers) { lz.x1 = mapX(lz.x1); lz.y1 = mapY(lz.y1); lz.x2 = mapX(lz.x2); lz.y2 = mapY(lz.y2); }
    if (lightningMid) { lightningMid.ox *= sr; lightningMid.oy *= sr; }
  }
  layout();

  // ---- Game state ----
  const SPAWN_INVULN = 3;     // seconds of immunity after a (re)spawn
  const WAVE_GRACE = 3;       // seconds a fresh wave's asteroids have no hitbox
  const MAX_LIVES = 3;
  const MAX_BULLETS = 20;
  const POWERUP_LIFE = 14;    // seconds a dropped power-up lingers before expiring
  const MAX_POWERUPS = 3;     // never spawn a new power-up while this many are on screen
  const LIGHTNING_HALF = 17.5 * Math.PI / 180;   // half of the 35° auto-aim cone
  const LIGHTNING_RANGE = 0.7 * 540 * 0.9 * S;   // 70% of a normal bullet's reach
  const SHIELD_DUR = 7;       // health pickup at full HP grants a 7s shield instead
  const LASER_WIDTH = 34 * S; // full beam width; the hitbox is drawn to match it
  const ULTRASOUND_RADIUS = 0.25 * 540 * 0.9 * 1.1 * S;   // a quarter of a normal bullet's reach, +10%
  const ULTRASOUND_TICK = 0.35;                 // AoE damage / ripple cadence
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
    ultrasound: { color: '#7fd3ff', letter: 'U', label: 'SHOCKWAVE', dur: 8 },
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
  // Roaming UFOs (from wave 3): a teal reward saucer (destructible, drops a power-up)
  // and a magenta ambient escort (indestructible, leaves once the wave is cleared).
  // Both fly predictable closed paths and are lethal on contact.
  let ufos = [];
  let wave = 0, score = 0, lives = 3, gameOver = false;
  // What dealt the final blow, for the leaderboard: an asteroid's file label
  // (e.g. '.pdf') or 'nuke'. Overwritten on each life lost, so at game over it
  // holds the last (fatal) one.
  let cause = null;
  let weapon = 'normal', weaponTimer = 0, lightningTarget = null, shield = 0;
  // Lightning's mid kink is stored in the ship's rotating frame (so it tracks the
  // player's heading and survives a target redirect) and re-rolled ~10x a second.
  let lightningMid = null, lightningMidTimer = 0;
  // The bolt's current far end - a target's position, or an "air" point at the end of
  // range when firing with nothing locked. null when no bolt should draw. lightningAirAngle
  // is the in-cone offset (re-rolled with the kink) that scatters that air point along
  // the range arc.
  let lightningEnd = null, lightningAirAngle = null;
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
  // Mobile analogue joystick: while active, the ship's heading is taken straight
  // from the stick angle (it points where you point), and pushing past a small
  // deadzone thrusts. Desktop keeps the arrow-key rotate/thrust.
  const joy = { active: false, angle: 0, mag: 0 };

  // End-of-game leaderboard panel: scoreDone once this run was submitted or skipped,
  // endPanel is the DOM node (name entry -> top 5), nameEntry true while the name
  // input owns the keyboard (so the game's global keys don't steal the typing).
  let scoreDone = false, endPanel = null, nameEntry = false;
  // Sandbox (dev test mode): freeze scoring, mark the run leaderboard-ineligible, and
  // open a spawn menu. cheatInvuln makes the ship immortal while sandbox is on.
  let sandbox = false, cheatInvuln = false, sandboxUsed = false;
  // Sandbox power-up modifiers: infinite freezes the active weapon/shield countdown;
  // instant applies a power-up straight to the player instead of dropping a pickup.
  let sbInfinite = false, sbInstant = false;
  const immortal = () => sandbox && cheatInvuln;
  // Top 5 from the server, drawn in the left margin (and refreshed after a submit).
  let leaderboard = [];

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
    const radius = (size === 3 ? 46 : size === 2 ? 30 : 19) * S;
    const n = 7 + size * 2 + ((Math.random() * 3) | 0);
    const verts = [];
    for (let i = 0; i < n; i++) verts.push({ a: (i / n) * TAU, r: rand(0.72, 1.12) });
    const base = size === 3 ? [26, 70] : size === 2 ? [48, 104] : [72, 150];
    const spd = rand(base[0], base[1]) * S;
    const dir = rand(0, TAU);
    return {
      x, y, size, label, radius, verts,
      angleR: rand(0, TAU), spin: rand(-1.3, 1.3),
      vx: Math.cos(dir) * spd, vy: Math.sin(dir) * spd,
      font: fitFont(label, radius), grace: 0
    };
  }

  function spawnWave() {
    dismissAmbientUfos();   // last wave's ambient escort flies off now the board is clear
    wave++;
    const count = Math.min(8, 2 + wave);
    // Keep a clear ring around the ship so a new big asteroid can never spawn on
    // top of the player; retry the random position until it's outside that ring.
    const safe = 150 * S;
    for (let i = 0; i < count; i++) {
      let x, y, tries = 0;
      do {
        x = cx + rand(-HW, HW) * 0.92; y = cy + rand(-HH, HH) * 0.92;
      } while (Math.hypot(x - ship.x, y - ship.y) < safe && ++tries < 30);
      const ast = makeAsteroid(x, y, 3, pick(ARCHIVE_POOL));
      ast.grace = WAVE_GRACE;   // no hitbox (stripey border) so a fresh wave can't ambush you
      asteroids.push(ast);
    }
    // One power-up per new wave, away from the ship - but none on the opening wave
    // (wave 1), and never while the screen is already at the cap.
    if (wave > 1 && powerups.length < MAX_POWERUPS) {
      let x, y, tries = 0;
      do {
        x = cx + rand(-HW, HW) * 0.85; y = cy + rand(-HH, HH) * 0.85;
      } while (Math.hypot(x - ship.x, y - ship.y) < 120 * S && ++tries < 20);
      powerups.push(makePowerup(x, y));
    }
    // Roaming UFOs, from wave 3. Wave 3 guarantees one reward saucer; later waves
    // roll 30% for one, then min(50%, wave*5%) for a second. Each reward spawn also
    // rolls a 25% chance to bring an indestructible ambient escort.
    if (wave >= 3) {
      let rewards = 0;
      if (wave === 3) rewards = 1;
      else if (Math.random() < 0.30) {
        rewards = 1;
        if (Math.random() < Math.min(0.5, wave * 0.05)) rewards = 2;
      }
      for (let k = 0; k < rewards; k++) {
        if (ufos.filter((u) => u.kind === 'reward').length >= 2) break;   // cap on-screen reward saucers
        ufos.push(makeUfo('reward'));
        if (Math.random() < 0.25) ufos.push(makeUfo('ambient'));
      }
    }
  }

  function makePowerup(x, y, forcedType) {
    const type = forcedType || pick(POWERUP_PICK);
    const dir = rand(0, TAU), spd = rand(8, 22) * S;
    return {
      x, y, type, color: POWERUP_DEF[type].color, letter: POWERUP_DEF[type].letter,
      radius: 12 * S, life: POWERUP_LIFE, vx: Math.cos(dir) * spd, vy: Math.sin(dir) * spd
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
    if (!immortal()) lives--;   // sandbox invulnerability spares the bomb's life cost
    cause = 'nuke';   // if this was the last life, the bomb is the final blow
    asteroids = []; bullets = []; lasers = []; ufos = [];
    // End any power-up the player was carrying - they come out of the blast clean.
    weapon = 'normal'; weaponTimer = 0; shield = 0;
    lightningTarget = null; lightningEnd = null; lightningMid = null; lightningMidTimer = 0;
    ripples = []; rippleTimer = 0;
    nuke = NUKE_TOTAL;
    overlay.style.cursor = 'none';   // hidden for the cinematic, restored on respawn
    // Spawn a wreck where the ship was, on a slow constant drift (no drag) in a
    // random direction with a lazy tumble. It lives on its own past the cinematic.
    const a = rand(0, TAU), s = rand(22, 40) * S;
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
    asteroids = []; bullets = []; particles = []; powerups = []; lasers = []; ufos = [];
    weapon = 'normal'; weaponTimer = 0; lightningTarget = null; shield = 0;
    lightningMid = null; lightningMidTimer = 0; ripples = []; rippleTimer = 0;
    nuke = 0; wreck = null; overlay.style.cursor = '';
    clearEndPanel(); scoreDone = false;
    mobileControls.forEach((elm) => { elm.style.display = ''; });   // controls back for play
    wave = 0; score = 0; lives = 3; gameOver = false; newHigh = false; cause = null;
    sandboxUsed = sandbox;   // a fresh run is leaderboard-ineligible only if still in sandbox
    resetShip(SPAWN_INVULN);
    spawnWave();
  }
  restart();
  loadLeaderboard();   // fetch the top 5 for the left-margin board (fire and forget)

  // A short-lived burst of debris - line shards (lines:true) or dot sparks - used
  // for both asteroid and ship explosions.
  function burst(x, y, color, opts) {
    const o = opts || {};
    const count = o.count || 12, speed = (o.speed || 140) * S, life = o.life || 0.45, lines = !!o.lines;
    for (let i = 0; i < count; i++) {
      const ang = rand(0, TAU), sp = rand(speed * 0.25, speed);
      particles.push({
        x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        life: rand(life * 0.6, life), max: life, color,
        ang: rand(0, TAU), spin: rand(-9, 9), len: lines ? rand(5, 13) * S : 0
      });
    }
  }

  // Toroidal wrap: each axis wraps independently, so once an object's centre
  // crosses an edge of the field rectangle it reappears at the opposite edge,
  // keeping its velocity (classic Asteroids "the screen is a torus"). The matching
  // render ghost (withWrap) draws the part poking out one edge peeking back in the
  // other, so the hand-off is seamless.
  function wrap(o) {
    if (o.x < cx - HW) o.x += 2 * HW; else if (o.x > cx + HW) o.x -= 2 * HW;
    if (o.y < cy - HH) o.y += 2 * HH; else if (o.y > cy + HH) o.y -= 2 * HH;
  }

  function spawnBullet(angle, speed, life, sniper, pierce) {
    if (bullets.length >= MAX_BULLETS) return;
    const c = Math.cos(angle), s = Math.sin(angle);
    bullets.push({
      x: ship.x + c * 14 * S, y: ship.y + s * 14 * S,
      vx: c * speed + ship.vx, vy: s * speed + ship.vy, life, sniper: !!sniper,
      pierce: pierce | 0   // extra asteroids this round punches through before dying
    });
  }

  // Distance from the field rectangle's border along a ray from (px,py) in unit dir
  // (dx,dy); the ship is always inside, so the first edge the ray reaches (the
  // smaller positive slab intersection on each axis) is the border hit.
  function rayToRim(px, py, dx, dy) {
    let t = Infinity;
    if (dx > 1e-9) t = Math.min(t, (cx + HW - px) / dx);
    else if (dx < -1e-9) t = Math.min(t, (cx - HW - px) / dx);
    if (dy > 1e-9) t = Math.min(t, (cy + HH - py) / dy);
    else if (dy < -1e-9) t = Math.min(t, (cy - HH - py) / dy);
    return isFinite(t) ? t : 0;
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
    // The beam also rakes reward UFOs along its length (2 damage - it's the heavy gun).
    for (let ui = ufos.length - 1; ui >= 0; ui--) {
      const u = ufos[ui];
      if (u.kind !== 'reward' || u.appear < 1) continue;
      if (distToSeg(u.x, u.y, ship.x, ship.y, ex, ey) < u.radius + LASER_WIDTH / 2) damageUfo(ui, 2);
    }
  }

  // Lightning auto-aim: the nearest solid asteroid within the 35° front cone and
  // range, or null. Normalises the angle to the ship's heading for the cone test.
  function findLightningTarget() {
    let best = null, bestD = Infinity;
    const consider = (o) => {
      const dx = o.x - ship.x, dy = o.y - ship.y;
      const dist = Math.hypot(dx, dy);
      if (dist > LIGHTNING_RANGE || dist >= bestD) return;
      let d = Math.atan2(dy, dx) - ship.angle;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      if (Math.abs(d) > LIGHTNING_HALF) return;
      best = o; bestD = dist;
    };
    for (const a of asteroids) { if (a.grace > 0) continue; consider(a); }
    for (const u of ufos) { if (u.kind === 'reward' && u.appear >= 1) consider(u); }
    return best;
  }

  // Fire the current weapon and set the cooldown to its cadence.
  function fireWeapon() {
    if (weapon === 'laser') { fireLaser(); fireCd = 0.18 / 0.25; return; }      // 25% of normal rate
    if (weapon === 'machine') {
      // Spray: each round is jittered by up to ±3° for worse accuracy.
      spawnBullet(ship.angle + rand(-3, 3) * Math.PI / 180, 1080 * S, 0.9, false);
      fireCd = 0.08; return;
    }
    if (weapon === 'triple') {
      const spread = 20 * Math.PI / 180;
      spawnBullet(ship.angle - spread, 540 * S, 0.9, false);
      spawnBullet(ship.angle, 540 * S, 0.9, false);
      spawnBullet(ship.angle + spread, 540 * S, 0.9, false);
      fireCd = 0.18; return;
    }
    if (weapon === 'sniper') { spawnBullet(ship.angle, 1080 * S, Infinity, true, 1); fireCd = 0.4; return; }   // half rate, but each round punches through one asteroid into a second
    spawnBullet(ship.angle, 540 * S, 0.9, false); fireCd = 0.18;                 // normal
  }

  function destroyAsteroid(ai) {
    const a = asteroids[ai];
    if (!sandbox) {
      score += a.size === 3 ? 20 : a.size === 2 ? 50 : 100;
      if (score > highScore) { highScore = score; newHigh = true; saveHi(); }
    }
    burst(a.x, a.y, a.size === 3 ? ACCENT : LINE,
      { count: 5 + a.size * 3, speed: 60 + a.size * 38, life: 0.4 + a.size * 0.06 });
    // Power-up drop: 5% from a red (archive) asteroid, 1% from a white one - but
    // never past the on-screen cap.
    if (powerups.length < MAX_POWERUPS && Math.random() < (a.size === 3 ? 0.05 : 0.01)) powerups.push(makePowerup(a.x, a.y));
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
    const speed = rand(240, 430) * S;
    const gap = rand(22, 34) * S;
    // Lateral offset of the flight path, and a start point fully outside the field
    // (BR is the rectangle's circumscribed radius, so a squadron entering from any
    // angle clears the corner before it appears).
    const BR = Math.hypot(HW, HH);
    const off = rand(-1, 1) * Math.min(HW, HH) * 0.7;
    const startDist = BR + 70;
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
      if (Math.hypot(f.x - cx, f.y - cy) > Math.hypot(HW, HH) + 120) flyers.splice(i, 1);
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

  // ---- Roaming UFOs ----
  // Both kinds fly a predictable closed path mapped into the field rectangle, so the
  // shape adapts to the arena (and any resize) instead of being baked at spawn.
  const UFO_PATTERNS = ['circle', 'triangle', 'square', 'figure8'];
  function ufoPathPos(u) {
    const kx = HW * 0.78, ky = HH * 0.78;   // path fills most of the rectangle
    let nx, ny;
    if (u.pattern === 'circle') {
      const a = u.rot + u.t * TAU;
      nx = Math.cos(a); ny = Math.sin(a);
    } else if (u.pattern === 'figure8') {
      const a = u.rot + u.t * TAU;
      nx = Math.sin(a); ny = Math.sin(2 * a) * 0.7;
    } else {
      // Equilateral triangle (3) or square (4): walk the perimeter between vertices
      // placed on the unit circle, rotated by u.rot.
      const n = u.pattern === 'triangle' ? 3 : 4;
      const f = (((u.t % 1) + 1) % 1) * n, i = Math.floor(f) % n, fr = f - Math.floor(f);
      const va = u.rot + (i / n) * TAU, vb = u.rot + (((i + 1) % n) / n) * TAU;
      const ax = Math.cos(va), ay = Math.sin(va), bx = Math.cos(vb), by = Math.sin(vb);
      nx = ax + (bx - ax) * fr; ny = ay + (by - ay) * fr;
    }
    return [cx + nx * kx, cy + ny * ky];
  }

  function makeUfo(kind) {
    const u = {
      kind, pattern: pick(UFO_PATTERNS), rot: rand(0, TAU), t: Math.random(),
      period: rand(20, 34), radius: 16 * S, hp: kind === 'reward' ? 2 : Infinity,
      color: kind === 'reward' ? UFO_REWARD_COLOR : UFO_AMBIENT_COLOR,
      appear: 0, leaving: false, lvx: 0, lvy: 0, x: cx, y: cy
    };
    const [px, py] = ufoPathPos(u); u.x = px; u.y = py;   // start on the path, not the centre
    return u;
  }

  // The ambient escort "goes away after everything else was cleared": when a fresh
  // wave begins, send any lingering ambient UFO out of the arena along the outward
  // radial (it flies off and despawns rather than popping).
  function dismissAmbientUfos() {
    for (const u of ufos) {
      if (u.kind === 'ambient' && !u.leaving) {
        u.leaving = true;
        const a = Math.atan2(u.y - cy, u.x - cx) || rand(0, TAU);
        const sp = 170 * S;
        u.lvx = Math.cos(a) * sp; u.lvy = Math.sin(a) * sp;
      }
    }
  }

  // Damage a reward saucer (ambient ones are indestructible and ignore this). On
  // death it pays out points and a guaranteed power-up drop.
  function damageUfo(ui, dmg) {
    const u = ufos[ui];
    if (!u || u.kind !== 'reward') return;
    u.hp -= dmg;
    burst(u.x, u.y, u.color, { count: 4, speed: 70, life: 0.3 });
    if (u.hp <= 0) {
      if (!sandbox) {
        score += 200;
        if (score > highScore) { highScore = score; newHigh = true; saveHi(); }
      }
      burst(u.x, u.y, u.color, { count: 16, speed: 150, life: 0.7, lines: true });
      burst(u.x, u.y, ACCENT, { count: 10, speed: 110, life: 0.5 });
      powerups.push(makePowerup(u.x, u.y));   // guaranteed reward drop
      ufos.splice(ui, 1);
    }
  }

  // Move every UFO (path-follow, or the outward exit run once leaving), fade it in,
  // and check the lethal contact with the ship. No firing - UFOs never attack.
  function updateUfos(dt) {
    for (let i = ufos.length - 1; i >= 0; i--) {
      const u = ufos[i];
      if (u.appear < 1) u.appear = Math.min(1, u.appear + dt / 0.5);
      if (u.leaving) {
        u.x += u.lvx * dt; u.y += u.lvy * dt;
        if (u.x < cx - HW - 50 * S || u.x > cx + HW + 50 * S ||
            u.y < cy - HH - 50 * S || u.y > cy + HH + 50 * S) { ufos.splice(i, 1); continue; }
      } else {
        u.t += dt / u.period; if (u.t > 1) u.t -= 1;
        const [px, py] = ufoPathPos(u); u.x = px; u.y = py;
      }
      // Solid hazard: ramming a UFO (either kind) costs a life.
      if (!ship.dead && ship.invuln <= 0 && shield <= 0 && !gameOver && !immortal() && u.appear >= 1) {
        const dx = u.x - ship.x, dy = u.y - ship.y, rr = u.radius + 11 * S;
        if (dx * dx + dy * dy < rr * rr) { cause = 'ufo'; loseLife(); }
      }
    }
  }

  // Keep the asteroids drifting (and spinning/wrapping) on the game-over screen,
  // without any of the collision/firing logic that the full update() runs. The UFOs
  // keep flying their paths too (updateUfos no-ops the ship hit once gameOver is set).
  function driftAsteroids(dt) {
    for (const a of asteroids) {
      a.x += a.vx * dt; a.y += a.vy * dt; a.angleR += a.spin * dt; wrap(a);
    }
    updateUfos(dt);
  }

  // ---- Update ----
  function update(dt) {
    // Nuclear cinematic: freeze play, keep the scope empty, then at the end either
    // respawn the player into a fresh wave or - if the bomb cost the last life - end.
    if (nuke > 0) {
      nuke -= dt;
      asteroids = []; bullets = []; lasers = []; powerups = []; particles = []; ufos = [];
      lightningTarget = null;
      if (nuke <= 0) {
        nuke = 0;
        overlay.style.cursor = '';   // cursor back once the cinematic ends
        if (lives <= 0) endGame();
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
    if (weaponTimer > 0 && !sbInfinite) { weaponTimer -= dt; if (weaponTimer <= 0) { weapon = 'normal'; weaponTimer = 0; } }
    if (shield > 0 && !sbInfinite) shield -= dt;

    // Power-ups drift, wrap, expire, and are collected by flying over them.
    for (let i = powerups.length - 1; i >= 0; i--) {
      const p = powerups[i];
      p.x += p.vx * dt; p.y += p.vy * dt; wrap(p); p.life -= dt;
      if (p.life <= 0) { powerups.splice(i, 1); continue; }
      if (!ship.dead && !gameOver) {
        const dx = p.x - ship.x, dy = p.y - ship.y, rr = p.radius + 11 * S;
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
      if (deathTimer <= 0) { if (lives <= 0) endGame(); else resetShip(SPAWN_INVULN); }
    } else {
      if (joy.active) {
        // Turn toward the stick, but no faster than the keyboard's rotate rate.
        let d = joy.angle - ship.angle;
        d = Math.atan2(Math.sin(d), Math.cos(d));   // shortest signed delta
        const max = 4.6 * dt;
        ship.angle += Math.max(-max, Math.min(max, d));
      } else {
        if (input.left) ship.angle -= 4.6 * dt;
        if (input.right) ship.angle += 4.6 * dt;
      }
      if (input.thrust) { ship.vx += Math.cos(ship.angle) * 270 * S * dt; ship.vy += Math.sin(ship.angle) * 270 * S * dt; }
      const drag = Math.exp(-0.55 * dt);
      ship.vx *= drag; ship.vy *= drag;
      const sp = Math.hypot(ship.vx, ship.vy), MAX = 430 * S;
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
        // The mid kink and (when firing into air) the strike angle re-roll together on
        // a fast cadence, for a lively searching arc.
        lightningMidTimer -= dt;
        const reroll = lightningMidTimer <= 0;
        if (reroll || lightningAirAngle === null) lightningAirAngle = rand(-LIGHTNING_HALF, LIGHTNING_HALF);
        // The bolt's far end: a locked target, or - when firing into empty space - a
        // random point on the range arc within the aim cone (clamped to the rim).
        if (lightningTarget) {
          lightningEnd = { x: lightningTarget.x, y: lightningTarget.y };
        } else if (input.fire) {
          const ang = ship.angle + lightningAirAngle;
          const c = Math.cos(ang), s = Math.sin(ang);
          const reach = Math.min(LIGHTNING_RANGE, rayToRim(ship.x, ship.y, c, s));
          lightningEnd = { x: ship.x + c * reach, y: ship.y + s * reach };
        } else {
          lightningEnd = null;
        }
        // Re-roll the mid kink (a point ~30-70% of the way to the end with a
        // perpendicular kick), stored in the ship's rotating frame so it tracks the
        // player's heading rather than sticking in world space.
        if (lightningEnd && (reroll || !lightningMid)) {
          const dx = lightningEnd.x - ship.x, dy = lightningEnd.y - ship.y;
          const len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
          const t = rand(0.3, 0.7), j = rand(-1, 1) * len * 0.18;
          const mox = dx * t + nx * j, moy = dy * t + ny * j;   // world-space offset from the ship
          const ca = Math.cos(ship.angle), sa = Math.sin(ship.angle);
          lightningMid = { lx: mox * ca + moy * sa, ly: -mox * sa + moy * ca };   // -> ship-local frame
        }
        if (reroll) lightningMidTimer = 0.1;
        if (lightningTarget && fireCd <= 0) {
          const ai = asteroids.indexOf(lightningTarget);
          if (ai >= 0) destroyAsteroid(ai);
          else { const ui = ufos.indexOf(lightningTarget); if (ui >= 0) damageUfo(ui, 1); }
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
          for (let ui = ufos.length - 1; ui >= 0; ui--) {
            const u = ufos[ui];
            if (u.kind !== 'reward' || u.appear < 1) continue;
            const dx = u.x - ship.x, dy = u.y - ship.y, rr = ULTRASOUND_RADIUS + u.radius;
            if (dx * dx + dy * dy < rr * rr) damageUfo(ui, 1);
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
        if (dx * dx + dy * dy < a.radius * a.radius) {
          destroyAsteroid(ai);
          if (b.pierce > 0) { b.pierce--; break; }   // survive the hit, one less pierce left
          bullets.splice(bi, 1); break;
        }
      }
    }

    // Bullet -> reward UFO (ambient escorts are indestructible, so bullets pass them).
    for (let bi = bullets.length - 1; bi >= 0; bi--) {
      const b = bullets[bi];
      for (let ui = ufos.length - 1; ui >= 0; ui--) {
        const u = ufos[ui];
        if (u.kind !== 'reward' || u.appear < 1) continue;
        const dx = u.x - b.x, dy = u.y - b.y;
        if (dx * dx + dy * dy < u.radius * u.radius) {
          damageUfo(ui, 1);
          if (b.pierce > 0) { b.pierce--; break; }
          bullets.splice(bi, 1); break;
        }
      }
    }

    updateUfos(dt);   // move/fade the roaming UFOs and check their lethal contact

    // Asteroid -> ship (skipped while dead, immune, shielded, or asteroid in grace).
    if (!ship.dead && ship.invuln <= 0 && shield <= 0 && !gameOver) {
      for (const a of asteroids) {
        if (a.grace > 0) continue;
        const dx = a.x - ship.x, dy = a.y - ship.y, rr = a.radius + 11 * S;
        if (dx * dx + dy * dy < rr * rr) { if (!immortal()) { cause = a.label; loseLife(); } break; }
      }
    }
  }

  // ---- Render ----
  // Toroidal wrap is drawn, not popped: while an object (radius `extent`) straddles
  // an edge of the field we also draw a ghost copy shifted by the full field width
  // and/or height, so the part poking out one edge peeks back in the opposite edge.
  // Up to three ghosts (the opposite edge on each axis, plus the diagonal for a
  // corner). The rectangular clip hides whatever is past the border, leaving one
  // seamless crossing.
  function withWrap(x, y, extent, paint) {
    paint(x, y);
    const ox = (x - extent < cx - HW) ? 2 * HW : (x + extent > cx + HW) ? -2 * HW : 0;
    const oy = (y - extent < cy - HH) ? 2 * HH : (y + extent > cy + HH) ? -2 * HH : 0;
    if (ox) paint(x + ox, y);
    if (oy) paint(x, y + oy);
    if (ox && oy) paint(x + ox, y + oy);
  }

  // A background flyer: the same hull as the player, dimmed and slightly smaller,
  // pointing where it travels. No wrap or ghost - it just slides across the scope.
  function drawFlyer(f) {
    ctx.save();
    ctx.globalAlpha = f.alpha;
    ctx.translate(f.x, f.y);
    ctx.rotate(f.angle);
    ctx.scale(0.85 * S, 0.85 * S);
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

  // A roaming UFO: a vector saucer (flattened hull + dome + blinking under-lights) in
  // its kind's colour. No rotation - it stays level as it tracks its path.
  function drawUfo(u) {
    const r = 16;   // base half-width; the whole saucer is scaled by S below
    ctx.save();
    ctx.globalAlpha = u.appear;
    ctx.translate(u.x, u.y);
    ctx.scale(S, S);
    ctx.strokeStyle = u.color; ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
    ctx.shadowColor = u.color; ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(-r, 0);
    ctx.lineTo(-r * 0.55, -r * 0.34);
    ctx.lineTo(r * 0.55, -r * 0.34);
    ctx.lineTo(r, 0);
    ctx.lineTo(r * 0.55, r * 0.30);
    ctx.lineTo(-r * 0.55, r * 0.30);
    ctx.closePath(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-r * 0.5, -r * 0.34);
    ctx.quadraticCurveTo(0, -r * 0.95, r * 0.5, -r * 0.34);
    ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = u.color;
    for (let i = -1; i <= 1; i++) {
      if ((Math.floor(clock * 4) + i) & 1) {
        ctx.beginPath(); ctx.arc(i * r * 0.42, r * 0.30, r * 0.1, 0, TAU); ctx.fill();
      }
    }
    // The ambient escort is indestructible - ring it with a pulsing shield bubble so
    // it reads as "can't be killed".
    if (u.kind === 'ambient') {
      ctx.globalAlpha = u.appear * (0.5 + 0.3 * Math.abs(Math.sin(clock * 3)));
      ctx.strokeStyle = u.color; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(0, 0, r * 1.5, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }

  function drawShipAt(x, y) {
    // Fade the ship in over the first 0.6s after a (re)spawn - invuln starts at
    // SPAWN_INVULN and ticks down, so elapsed = SPAWN_INVULN - invuln.
    const fade = Math.min(1, (SPAWN_INVULN - ship.invuln) / 0.6);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(S, S);   // scale the whole ship (hull, rings, glow) with the scope
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
    withWrap(wreck.x, wreck.y, 21 * S, (x, y) => {
      ctx.save();
      ctx.globalAlpha = 0.7 * fade;
      ctx.translate(x, y);
      ctx.scale(S, S);
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
    withWrap(ship.x, ship.y, 21 * S, drawShipAt);
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

  // Three anchors: the ship, a player-relative mid kink, and the bolt's end (a target
  // or an air point) - linked by the jagged effect (player -> mid, mid -> end).
  function drawLightning() {
    if (weapon !== 'lightning' || !lightningEnd || !lightningMid || ship.dead || gameOver || nuke > 0) return;
    const sx = ship.x + Math.cos(ship.angle) * 14, sy = ship.y + Math.sin(ship.angle) * 14;
    const ca = Math.cos(ship.angle), sa = Math.sin(ship.angle);
    const mx = ship.x + lightningMid.lx * ca - lightningMid.ly * sa;
    const my = ship.y + lightningMid.lx * sa + lightningMid.ly * ca;
    ctx.save();
    ctx.strokeStyle = POWERUP_DEF.lightning.color;
    ctx.shadowColor = POWERUP_DEF.lightning.color; ctx.shadowBlur = 10;
    ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath();
    jaggedSeg(sx, sy, mx, my);
    jaggedSeg(mx, my, lightningEnd.x, lightningEnd.y);
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
      ctx.beginPath(); ctx.arc(0, 0, 6 * S + (ULTRASOUND_RADIUS - 6 * S) * rp.p, 0, TAU); ctx.stroke();
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

  // Laser sight: while the laser is equipped, a thin dashed line from the ship's nose
  // to the rim along its heading, with a marker at the hit point - it traces exactly
  // where firing would rake (rayToRim is what fireLaser uses for the real beam).
  function drawLaserSight() {
    if (weapon !== 'laser' || ship.dead || gameOver || nuke > 0) return;
    const c = Math.cos(ship.angle), s = Math.sin(ship.angle);
    const t = rayToRim(ship.x, ship.y, c, s);
    const ex = ship.x + c * t, ey = ship.y + s * t;
    ctx.save();
    ctx.strokeStyle = POWERUP_DEF.laser.color; ctx.fillStyle = POWERUP_DEF.laser.color;
    ctx.globalAlpha = 0.45; ctx.lineWidth = 1;
    ctx.setLineDash([4, 5]); ctx.lineDashOffset = -clock * 30;
    ctx.beginPath();
    ctx.moveTo(ship.x + c * 14 * S, ship.y + s * 14 * S);
    ctx.lineTo(ex, ey); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.8;
    ctx.beginPath(); ctx.arc(ex, ey, 3 * S, 0, TAU); ctx.fill();
    ctx.restore();
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
    const top = cy - HH - 14;   // baseline of the big figures, hugging the top edge
    // Score - top-left of the field, with the persistent high score under it.
    ctx.textAlign = 'left';
    ctx.font = '12px ' + MONO; ctx.fillStyle = MUTED; ctx.fillText('SCORE', cx - HW, top - 17);
    ctx.font = '18px ' + MONO; ctx.fillStyle = ACCENT; ctx.fillText(String(score).padStart(5, '0'), cx - HW, top);
    ctx.font = '11px ' + MONO; ctx.fillStyle = MUTED; ctx.fillText('HIGH ' + String(highScore).padStart(5, '0'), cx - HW, top + 15);
    // Wave - top-right of the field.
    ctx.textAlign = 'right';
    ctx.font = '12px ' + MONO; ctx.fillStyle = MUTED; ctx.fillText('WAVE', cx + HW, top - 17);
    ctx.font = '18px ' + MONO; ctx.fillStyle = ON_DARK; ctx.fillText(String(wave), cx + HW, top);
    // Lives + controls below the field.
    ctx.textAlign = 'center';
    ctx.font = '15px ' + MONO; ctx.fillStyle = LINE;
    ctx.fillText(lives > 0 ? '▲ '.repeat(lives).trim() : '—', cx, cy + HH + 24);
    ctx.font = '12px ' + MONO; ctx.fillStyle = MUTED;
    ctx.fillText('← → rotate · ↑ thrust · space fire · r reset · esc exit', cx, cy + HH + 44);
    // Title centred at the top of the screen.
    ctx.font = '11px ' + MONO; ctx.fillStyle = MUTED;
    ctx.fillText('ASTEROIDS · SUPPORTED FORMATS', cx, 24);
    if (sandbox) {
      ctx.fillStyle = ACCENT; ctx.font = '10px ' + MONO;
      ctx.fillText('SANDBOX' + (cheatInvuln ? ' · INVULN' : '') + ' · SCORE OFF', cx, 38);
    }
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
    ctx.fillText(def.label + ' · ' + (sbInfinite ? '∞' : weaponTimer.toFixed(1) + 's'), ship.x, ship.y + 26);
    ctx.restore();
  }

  // Nuclear flash: drives the top-most DOM layer's opacity. Holds opaque for
  // NUKE_WHITE, fades out over NUKE_FADE, then nothing for the NUKE_GAP beat.
  function nukeFlash() {
    let a = 0;
    if (nuke > 0) {
      const elapsed = NUKE_TOTAL - nuke;
      if (elapsed < NUKE_WHITE) a = 1;
      else if (elapsed < NUKE_WHITE + NUKE_FADE) a = 1 - (elapsed - NUKE_WHITE) / NUKE_FADE;
    }
    const v = String(Math.max(0, a));
    if (nukeEl.style.opacity !== v) nukeEl.style.opacity = v;
  }

  // ---- End-of-game leaderboard panel (DOM, overlaid on the canvas) ----
  function clearEndPanel() {
    if (endPanel) { endPanel.remove(); endPanel = null; }
    nameEntry = false;
  }

  // Local memory for the leaderboard, kept under non-anr keys so app.js's anrSweep
  // (which refreshes anr-* timestamps and would defeat a TTL) doesn't touch them.
  // The remembered name is kept forever; submissions are rate-limited to one per
  // minute and 15 per device per day. Both are best-effort client-side only.
  const DAY_MS = 24 * 60 * 60 * 1000;
  const MIN_MS = 60 * 1000;   // minimum gap between submissions: one per minute
  const MAX_PER_DAY = 15;     // submissions allowed per device per day
  const NAME_KEY = 'asteroids-name';
  const SUBMIT_KEY = 'asteroids-submits';
  function rememberedName() {
    try {
      const raw = JSON.parse(localStorage.getItem(NAME_KEY) || 'null');
      if (raw && raw.name) return String(raw.name);   // never expires
    } catch (_) {}
    return '';
  }
  function rememberName(name) {
    try { localStorage.setItem(NAME_KEY, JSON.stringify({ name, ts: Date.now() })); } catch (_) {}
  }
  const dayBucket = () => Math.floor(Date.now() / DAY_MS);
  function submitRecord() {
    try { return JSON.parse(localStorage.getItem(SUBMIT_KEY) || 'null'); } catch (_) { return null; }
  }
  function submitsToday() {
    const raw = submitRecord();
    return (raw && raw.day === dayBucket()) ? (raw.count || 0) : 0;
  }
  function lastSubmit() {
    const raw = submitRecord();
    return (raw && typeof raw.ts === 'number') ? raw.ts : 0;
  }
  // Two gates: at least a minute since the last submission, and under the daily cap.
  function canSubmitToday() { return Date.now() - lastSubmit() >= MIN_MS && submitsToday() < MAX_PER_DAY; }
  function markSubmitted() {
    try { localStorage.setItem(SUBMIT_KEY, JSON.stringify({ day: dayBucket(), count: submitsToday() + 1, ts: Date.now() })); } catch (_) {}
  }


  // Game-over headline shown at the top of the end card: GAME OVER + score + high.
  function endHeaderNodes() {
    const go = document.createElement('div');
    go.className = 'anr-score-go'; go.textContent = 'GAME OVER';
    const sub = document.createElement('div');
    sub.className = 'anr-score-sub'; sub.textContent = 'score ' + score + ' · wave ' + wave;
    const hi = document.createElement('div');
    hi.className = 'anr-score-sub';
    if (newHigh) { hi.textContent = '★ NEW HIGH SCORE'; hi.style.color = POWERUP_DEF.health.color; }
    else { hi.textContent = 'high ' + highScore; hi.style.color = MUTED; }
    return [go, sub, hi];
  }

  // Build a <ol> of the top 5, highlighting the player's own freshly-posted row.
  function leaderboardList(top, mineIdx) {
    const ol = document.createElement('ol');
    ol.className = 'anr-score-list';
    if (!top || !top.length) {
      const li = document.createElement('li');
      li.textContent = 'No scores yet'; li.style.justifyContent = 'center'; li.style.color = MUTED;
      ol.appendChild(li); return ol;
    }
    top.forEach((s, i) => {
      const li = document.createElement('li');
      if (i === mineIdx) li.className = 'me';
      const r = document.createElement('span'); r.className = 'r'; r.textContent = (i + 1) + '.';
      const n = document.createElement('span'); n.className = 'n'; n.textContent = s.name;
      const sc = document.createElement('span'); sc.className = 's'; sc.textContent = Number(s.score).toLocaleString();
      li.append(r, n, sc); ol.appendChild(li);
    });
    return ol;
  }

  // After submit or skip: show the board plus play-again / exit.
  function showLeaderboardView(top, mineName) {
    if (!endPanel) return;
    nameEntry = false;
    endPanel.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'anr-score-title'; title.textContent = 'HIGH SCORES';
    const mineIdx = mineName && top ? top.findIndex((s) => s.name === mineName) : -1;
    const row = document.createElement('div'); row.className = 'anr-score-row';
    const again = document.createElement('button');
    again.type = 'button'; again.className = 'anr-game-btn'; again.textContent = 'Play again';
    again.style.cssText = 'padding:7px 12px;font-size:13px;';
    again.addEventListener('click', restart);
    const exit = document.createElement('button');
    exit.type = 'button'; exit.className = 'anr-game-btn'; exit.textContent = 'Exit';
    exit.style.cssText = 'padding:7px 12px;font-size:13px;';
    exit.addEventListener('click', teardown);
    row.append(again, exit);
    endPanel.append(...endHeaderNodes(), title, leaderboardList(top, mineIdx), row);
  }

  // Fetch the current top 5 into `leaderboard` (drawn in the left margin).
  async function loadLeaderboard() {
    try {
      const resp = await fetch('/api/leaderboard', { headers: { accept: 'application/json' } });
      const data = await resp.json().catch(() => ({}));
      if (data && Array.isArray(data.top)) leaderboard = data.top;
    } catch (_) {}
  }

  // Skip submitting: just fetch and show the current board.
  async function skipToLeaderboard() {
    await loadLeaderboard();
    if (endPanel) showLeaderboardView(leaderboard, null);
  }

  // POST this run's score under `name`, then show the returned board.
  async function submitScore(name, msgEl, submitBtn) {
    if (submitBtn) submitBtn.disabled = true;
    if (msgEl) { msgEl.className = 'anr-score-msg'; msgEl.textContent = 'Sending...'; }
    try {
      const resp = await fetch('/api/score', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, score, wave, cause })
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) {
        if (msgEl) { msgEl.className = 'anr-score-msg err'; msgEl.textContent = data.error || 'Could not send score.'; }
        if (submitBtn) submitBtn.disabled = false;
        return;
      }
      scoreDone = true;
      rememberName(name);   // prefill next time (kept forever)
      markSubmitted();      // rate limit: one per minute, 15 per day
      leaderboard = data.top || leaderboard;
      showLeaderboardView(data.top, name);
    } catch (_) {
      if (msgEl) { msgEl.className = 'anr-score-msg err'; msgEl.textContent = 'Offline - score not sent.'; }
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  // Name-entry view: a 5-char [A-Z0-9] field, Submit and Skip.
  function showSubmitView() {
    clearEndPanel();
    nameEntry = true;
    endPanel = document.createElement('div');
    endPanel.className = 'anr-score-panel';
    const title = document.createElement('div');
    title.className = 'anr-score-title'; title.textContent = 'ENTER NAME';
    const hint = document.createElement('div');
    hint.className = 'anr-score-msg'; hint.textContent = '5 letters or numbers';
    const input = document.createElement('input');
    input.type = 'text'; input.className = 'anr-score-input';
    input.maxLength = 5; input.autocomplete = 'off'; input.spellcheck = false;
    input.setAttribute('aria-label', 'Leaderboard name, 5 letters or numbers');
    input.value = rememberedName();   // prefill with the name used in the last day
    input.addEventListener('input', () => {
      input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    });
    const msg = document.createElement('div');
    msg.className = 'anr-score-msg';
    const row = document.createElement('div'); row.className = 'anr-score-row';
    const submit = document.createElement('button');
    submit.type = 'button'; submit.className = 'anr-game-btn'; submit.textContent = 'Submit';
    submit.style.cssText = 'padding:7px 12px;font-size:13px;';
    const skip = document.createElement('button');
    skip.type = 'button'; skip.className = 'anr-game-btn'; skip.textContent = 'Skip';
    skip.style.cssText = 'padding:7px 12px;font-size:13px;';
    const doSubmit = () => {
      const name = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (name.length !== 5) { msg.className = 'anr-score-msg err'; msg.textContent = 'Need 5 letters or numbers.'; input.focus(); return; }
      submitScore(name, msg, submit);
    };
    submit.addEventListener('click', doSubmit);
    skip.addEventListener('click', () => { scoreDone = true; skipToLeaderboard(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSubmit(); } });
    row.append(submit, skip);
    endPanel.append(...endHeaderNodes(), title, hint, input, msg, row);
    overlay.appendChild(endPanel);
    setTimeout(() => input.focus(), 30);   // focus once it's in the DOM (helps on mobile)
  }

  // End the run. Prompt to post the score only if this run beat the player's
  // personal best (a new high score), and unless it's already been sent this run
  // or this device has hit the daily cap. Otherwise just show the board.
  function endGame() {
    if (gameOver) return;
    gameOver = true;
    // Hide the touch controls (the DOM end panel handles play again / name entry)
    // and drop any held input so nothing sticks across the game-over screen.
    mobileControls.forEach((elm) => { elm.style.display = 'none'; });
    input.left = input.right = input.thrust = input.fire = false;
    joy.active = false; joy.mag = 0;
    if (newHigh && !scoreDone && !sandboxUsed && canSubmitToday()) showSubmitView();
    else { endPanel = document.createElement('div'); endPanel.className = 'anr-score-panel'; overlay.appendChild(endPanel); skipToLeaderboard(); }
  }

  function gameOverScreen() {
    ctx.textAlign = 'center';
    ctx.fillStyle = ACCENT; ctx.font = '34px ' + MONO; ctx.fillText('GAME OVER', cx, cy - 16);
    ctx.fillStyle = ON_DARK; ctx.font = '15px ' + MONO;
    ctx.fillText('score ' + score + ' · wave ' + wave, cx, cy + 14);
    if (newHigh) { ctx.fillStyle = POWERUP_DEF.health.color; ctx.font = '14px ' + MONO; ctx.fillText('★ NEW HIGH SCORE', cx, cy + 36); }
    else { ctx.fillStyle = MUTED; ctx.font = '13px ' + MONO; ctx.fillText('high ' + highScore, cx, cy + 36); }
    // The play-again / exit controls live in the DOM end panel below (buttons + the
    // optional name entry), so the canvas no longer draws a "tap to play again" line.
  }

  // The global top 5, drawn down the left margin in the game's vector style. Only
  // shown when there's clear space beside the scope (hidden on narrow / mobile
  // layouts where the circle fills the width).
  function drawLeaderboard() {
    if (!leaderboard.length) return;
    const margin = 24, colW = 150;
    if (cx - HW < colW + margin + 20) return;
    const x = margin;
    let y = cy - 58;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.font = '12px ' + MONO; ctx.fillStyle = MUTED; ctx.fillText('HIGH SCORES', x, y);
    y += 22;
    ctx.font = '13px ' + MONO;
    for (let i = 0; i < leaderboard.length; i++) {
      const s = leaderboard[i];
      ctx.textAlign = 'left';
      ctx.fillStyle = MUTED; ctx.fillText((i + 1) + '.', x, y);
      ctx.fillStyle = LINE; ctx.fillText(String(s.name), x + 22, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = ACCENT; ctx.fillText(Number(s.score).toLocaleString(), x + colW, y);
      y += 20;
    }
    ctx.textAlign = 'left';
  }

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    ctx.save();
    ctx.beginPath(); ctx.rect(cx - HW, cy - HH, 2 * HW, 2 * HH); ctx.clip();
    // faint scope fill + starfield
    ctx.fillStyle = 'rgba(255,255,255,0.015)'; ctx.fillRect(cx - HW, cy - HH, 2 * HW, 2 * HH);
    for (const s of stars) {
      ctx.globalAlpha = s.b;
      ctx.fillStyle = '#bbb';
      ctx.fillRect(cx + s.x * HW, cy + s.y * HH, 1.4, 1.4);
    }
    ctx.globalAlpha = 1;
    for (const f of flyers) drawFlyer(f);   // background squadrons, behind the action
    for (const u of ufos) drawUfo(u);
    for (const a of asteroids) drawAsteroid(a);
    for (const p of powerups) drawPowerup(p);
    // Bullets: sniper rounds are a touch larger and accent-tinted; others are dots.
    for (const b of bullets) {
      ctx.fillStyle = b.sniper ? ACCENT : LINE;
      const r = (b.sniper ? 2.8 : 2.2) * S;
      withWrap(b.x, b.y, r, (x, y) => { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); });
    }
    drawUltrasound();
    drawLaserSight();
    drawLasers();
    drawLightning();
    drawParticles();
    drawWreck();
    if (!gameOver) drawShip();
    ctx.restore();

    // scope frame with a soft accent glow
    ctx.save();
    ctx.shadowColor = ACCENT; ctx.shadowBlur = 18;
    ctx.strokeStyle = ACCENT; ctx.lineWidth = 2;
    ctx.strokeRect(cx - HW, cy - HH, 2 * HW, 2 * HH);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
    ctx.strokeRect(cx - HW + 5, cy - HH + 5, 2 * HW - 10, 2 * HH - 10);

    if (!gameOver) {
      const graceLeft = asteroids.reduce((m, a) => Math.max(m, a.grace), 0);
      if (graceLeft > 0) waveBanner(graceLeft);
    }
    drawWeaponTimer();
    hud();
    drawLeaderboard();
    nukeFlash();
    // The end-of-game DOM card carries the headline + board now; the canvas version
    // is only a fallback if the card somehow isn't up.
    if (gameOver && !endPanel) gameOverScreen();
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
    // While the name input owns the keyboard, let every other key reach it (so the
    // global controls - r to reset, space, arrows - don't hijack the typing).
    if (nameEntry) return;
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

  // ---- Controls ----
  // The analogue joystick works everywhere (mouse on desktop, touch on mobile): the
  // ship turns toward where the stick points (capped to the keyboard rotate rate)
  // and pushing past a deadzone thrusts. The fire button and rotate arrows are
  // touch-only - desktop already has the keyboard for those.
  const coarseInput = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  {
    const JOY_R = 46;        // base radius (px); thumb travel is clamped to this
    const DEADZONE = 0.28;   // fraction of full travel before thrust kicks in

    const base = document.createElement('div');
    // On touch the joystick rides higher so the arrows can sit beneath it; on
    // desktop (no arrows) it sits at the bottom.
    base.style.cssText = 'position:absolute; bottom:' + (coarseInput ? 100 : 26) + 'px; left:24px; width:' + (JOY_R * 2) +
      'px; height:' + (JOY_R * 2) + 'px; border-radius:50%; border:1px solid ' + BORDER +
      '; background:rgba(26,26,26,0.55); z-index:2; touch-action:none;';
    const thumb = document.createElement('div');
    thumb.style.cssText = 'position:absolute; left:50%; top:50%; width:42px; height:42px; margin:-21px 0 0 -21px;' +
      'border-radius:50%; background:' + SURFACE + '; border:1px solid ' + BORDER + '; pointer-events:none;' +
      'transition:transform .05s linear;';
    base.appendChild(thumb);
    overlay.appendChild(base);
    mobileControls.push(base);

    let joyId = null;
    const setThumb = (dx, dy) => { thumb.style.transform = 'translate(' + dx + 'px,' + dy + 'px)'; };
    const onMove = (e) => {
      const r = base.getBoundingClientRect();
      const dx = e.clientX - (r.left + JOY_R), dy = e.clientY - (r.top + JOY_R);
      const ang = Math.atan2(dy, dx), cl = Math.min(Math.hypot(dx, dy), JOY_R);
      setThumb(Math.cos(ang) * cl, Math.sin(ang) * cl);
      joy.active = true; joy.angle = ang; joy.mag = cl / JOY_R;
      input.thrust = joy.mag > DEADZONE;
    };
    const onUp = () => { joyId = null; joy.active = false; joy.mag = 0; input.thrust = false; setThumb(0, 0); };
    base.addEventListener('pointerdown', (e) => { e.preventDefault(); joyId = e.pointerId; try { base.setPointerCapture(e.pointerId); } catch (_) {} onMove(e); });
    base.addEventListener('pointermove', (e) => { if (e.pointerId === joyId) { e.preventDefault(); onMove(e); } });
    base.addEventListener('pointerup', (e) => { if (e.pointerId === joyId) { e.preventDefault(); onUp(); } });
    base.addEventListener('pointercancel', onUp);

    if (coarseInput) {
      const fire = document.createElement('button');
      fire.type = 'button'; fire.className = 'anr-game-btn'; fire.textContent = '●';
      fire.style.cssText = 'position:absolute; bottom:26px; right:24px; width:64px; height:64px; font-size:21px; z-index:2; touch-action:none;';
      const setFire = (v) => (e) => { e.preventDefault(); if (gameOver && !nameEntry && v) { restart(); return; } input.fire = v; };
      fire.addEventListener('pointerdown', setFire(true));
      fire.addEventListener('pointerup', setFire(false));
      fire.addEventListener('pointercancel', setFire(false));
      fire.addEventListener('pointerleave', setFire(false));
      overlay.appendChild(fire);
      mobileControls.push(fire);

      // Left/right rotate arrows in a row under the joystick - fine aiming when the
      // stick is idle (the joystick's heading overrides them whenever it's held).
      const arrows = document.createElement('div');
      arrows.style.cssText = 'position:absolute; bottom:26px; left:24px; width:' + (JOY_R * 2) + 'px; display:flex; gap:6px; z-index:2;';
      const mkArrow = (label, prop) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'anr-game-btn'; b.textContent = label;
        b.style.cssText = 'flex:1; height:42px; font-size:18px; touch-action:none;';
        const set = (v) => (e) => { e.preventDefault(); input[prop] = v; };
        b.addEventListener('pointerdown', set(true));
        b.addEventListener('pointerup', set(false));
        b.addEventListener('pointercancel', set(false));
        b.addEventListener('pointerleave', set(false));
        arrows.appendChild(b);
      };
      mkArrow('◀', 'left'); mkArrow('▶', 'right');
      overlay.appendChild(arrows);
      mobileControls.push(arrows);
    }
  }

  // ---- Sandbox (dev test mode) ----
  // A dev-gated panel to spawn anything in the game and toggle invulnerability, with
  // scoring frozen while it's on. Built here (not with the top buttons) so the catalog
  // and the spawners it calls already exist.
  if (isDev) {
    const sbSpawnPowerup = (type) => {
      let x, y, tries = 0;
      do { x = cx + rand(-HW, HW) * 0.8; y = cy + rand(-HH, HH) * 0.8; }
      while (Math.hypot(x - ship.x, y - ship.y) < 80 * S && ++tries < 20);
      powerups.push(makePowerup(x, y, type));
    };
    const sbSpawnAsteroid = () => {
      const size = 1 + ((Math.random() * 3) | 0);   // 1..3
      const label = size === 3 ? pick(ARCHIVE_POOL) : pick(FILE_POOL);
      let x, y, tries = 0;
      do { x = cx + rand(-HW, HW) * 0.9; y = cy + rand(-HH, HH) * 0.9; }
      while (Math.hypot(x - ship.x, y - ship.y) < 120 * S && ++tries < 20);
      const a = makeAsteroid(x, y, size, label);
      a.grace = WAVE_GRACE;
      asteroids.push(a);
    };

    const panel = document.createElement('div');
    panel.style.cssText = 'position:absolute; top:60px; right:16px; z-index:3; width:188px; display:none; ' +
      'flex-direction:column; gap:7px; padding:12px; background:rgba(10,10,10,0.92); border:1px solid ' + BORDER +
      '; font-family:' + MONO + '; color:' + ON_DARK + '; max-height:calc(100vh - 84px); overflow:auto;';
    const head = (t) => {
      const h = document.createElement('div');
      h.textContent = t;
      h.style.cssText = 'font-size:10px; letter-spacing:.18em; color:' + MUTED + '; margin-top:4px;';
      return h;
    };
    const mkBtn = (label, onClick) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'anr-game-btn';
      b.textContent = label;
      b.style.cssText = 'padding:6px 4px; font-size:11px;';
      b.addEventListener('click', (e) => { e.preventDefault(); onClick(b); b.blur(); });
      return b;
    };
    const gridOf = (btns) => {
      const g = document.createElement('div');
      g.style.cssText = 'display:grid; grid-template-columns:1fr 1fr; gap:6px;';
      btns.forEach((b) => g.appendChild(b));
      return g;
    };

    const invBtn = mkBtn('INVULN: OFF', () => {
      cheatInvuln = !cheatInvuln;
      invBtn.textContent = 'INVULN: ' + (cheatInvuln ? 'ON' : 'OFF');
      invBtn.classList.toggle('on', cheatInvuln);
    });
    invBtn.style.cssText = 'padding:8px 4px; font-size:11px;';

    const infBtn = mkBtn('INFINITE: OFF', () => {
      sbInfinite = !sbInfinite;
      infBtn.textContent = 'INFINITE: ' + (sbInfinite ? 'ON' : 'OFF');
      infBtn.classList.toggle('on', sbInfinite);
    });
    const instBtn = mkBtn('INSTANT: OFF', () => {
      sbInstant = !sbInstant;
      instBtn.textContent = 'INSTANT: ' + (sbInstant ? 'ON' : 'OFF');
      instBtn.classList.toggle('on', sbInstant);
    });

    panel.appendChild(head('SANDBOX'));
    panel.appendChild(invBtn);
    panel.appendChild(head('POWER-UPS'));
    panel.appendChild(gridOf([infBtn, instBtn]));
    panel.appendChild(gridOf(POWERUP_TYPES.map((t) =>
      mkBtn(POWERUP_DEF[t].label, () => { if (sbInstant) applyPowerup(t); else sbSpawnPowerup(t); }))));
    panel.appendChild(head('ENEMIES'));
    panel.appendChild(gridOf([
      mkBtn('Reward UFO', () => ufos.push(makeUfo('reward'))),
      mkBtn('Ambient UFO', () => ufos.push(makeUfo('ambient')))
    ]));
    panel.appendChild(head('FIELD'));
    panel.appendChild(gridOf([
      mkBtn('Asteroid', () => sbSpawnAsteroid()),
      mkBtn('Clear', () => { asteroids = []; bullets = []; ufos = []; powerups = []; particles = []; lasers = []; })
    ]));

    panel.appendChild(head('WAVE'));
    const waveInput = document.createElement('input');
    waveInput.type = 'number'; waveInput.min = '1'; waveInput.value = '5';
    waveInput.setAttribute('aria-label', 'Wave number');
    waveInput.style.cssText = 'width:100%; padding:6px 8px; font-family:' + MONO + '; font-size:12px; box-sizing:border-box; ' +
      'background:' + SURFACE + '; color:' + ON_DARK + '; border:1px solid ' + BORDER + '; border-radius:0; outline:none;';
    panel.appendChild(waveInput);
    panel.appendChild(mkBtn('Go to wave', () => {
      const n = Math.max(1, parseInt(waveInput.value, 10) || 1);
      asteroids = []; bullets = []; ufos = []; powerups = []; particles = []; lasers = [];
      wave = n - 1; spawnWave();   // spawnWave bumps to n and spawns that wave's content
    }));
    overlay.appendChild(panel);

    const sbToggle = document.createElement('button');
    sbToggle.type = 'button'; sbToggle.className = 'anr-game-btn';
    sbToggle.textContent = 'SB'; sbToggle.title = 'Sandbox mode (dev)';
    sbToggle.setAttribute('aria-label', 'Toggle sandbox mode');
    sbToggle.style.cssText = 'position:absolute; top:14px; right:104px; z-index:2; height:36px; padding:0 11px; font-size:13px;';
    sbToggle.addEventListener('click', () => {
      sandbox = !sandbox;
      if (sandbox) sandboxUsed = true;
      sbToggle.classList.toggle('on', sandbox);
      panel.style.display = sandbox ? 'flex' : 'none';
    });
    overlay.appendChild(sbToggle);
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
    clearEndPanel();
    overlay.remove();
    document.body.style.overflow = prevOverflow;
  }
}
