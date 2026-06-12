/* Analyser - secondary UI cluster split out of app.js.
   Cloudflare Turnstile loader/challenge, the "suggest this format" popup, the
   footer contact modal, the Share modal + post-analysis share nudge, and the
   online/offline status probe. These reference each other (network -> turnstile
   -> suggest/contact; suggest <-> share), so they live together. app.js calls
   the exported entry points from boot()/handleFile(); the rest stays internal. */

import { el } from './util.js';

// The "suggest this format" popup and the contact modal gate a mailto reveal
// behind a Cloudflare Turnstile human-check. This site key is PUBLIC by design
// (it ships in the page source); the matching SECRET key is never used here - we
// gate the mailto reveal client-side rather than verifying the token on a server.
const TURNSTILE_SITEKEY = '0x4AAAAAADhXFizpfxR6y0hL';

// Lazily inject the Turnstile script the first time the visitor asks to email -
// nothing loads otherwise, so the offline PWA stays self-contained. Resolves with
// window.turnstile, or rejects if it can't load (offline / blocked) so callers can
// fall back to opening the mail client directly.
let _turnstileLoad = null;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (_turnstileLoad) return _turnstileLoad;
  _turnstileLoad = new Promise((resolve, reject) => {
    const started = performance.now();
    const ready = () => {
      if (window.turnstile) { resolve(window.turnstile); return true; }
      return false;
    };
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true; s.defer = true;
    s.onload = () => {
      (function wait() {
        if (ready()) return;
        if (performance.now() - started > 5000) { reject(new Error('turnstile timeout')); return; }
        setTimeout(wait, 50);
      })();
    };
    s.onerror = () => reject(new Error('turnstile failed to load'));
    document.head.appendChild(s);
  });
  // Don't cache a rejection - let a later click retry the load.
  _turnstileLoad.catch(() => { _turnstileLoad = null; });
  return _turnstileLoad;
}

// Run a Turnstile challenge inside `box`. Resolves once it passes; rejects with a
// reason of 'offline' (no network / script blocked - the challenge can't run) or
// 'failed' (rendered but errored/expired). Callers reveal the address ONLY in the
// resolve path, so it stays hidden until a real challenge is solved. Mail needs
// the network regardless, so offline is a hard stop, not a fallback.
async function turnstileChallenge(box, setStatus) {
  // Real reachability check, not just navigator.onLine - the Turnstile script may
  // be precached and load offline, but the challenge itself needs the network.
  if (!(await probeOnline())) throw 'offline';
  let ts;
  try { ts = await loadTurnstile(); } catch (_) { throw 'offline'; }
  return new Promise((resolve, reject) => {
    let wid = null;
    const drop = () => { if (wid != null) { try { ts.remove(wid); } catch (_) {} wid = null; } };
    wid = ts.render(box, {
      sitekey: TURNSTILE_SITEKEY,
      theme: 'auto',
      callback: () => resolve(),
      'error-callback': () => { drop(); reject('failed'); },
      'expired-callback': () => { drop(); reject('failed'); },
    });
  });
}

let _suggestPopEl = null;
let _suggestTimer = null;
// True from the moment the "suggest this format" popup is shown for a file until
// it's dismissed/reset. The post-analysis share nudge checks this so the two never
// compete for the same analysis - the format popup always wins (see scheduleShareNudge).
let _suggestActive = false;
export function hideSuggestPopup() {
  if (_suggestTimer) { clearTimeout(_suggestTimer); _suggestTimer = null; }
  if (_suggestPopEl) _suggestPopEl.classList.remove('is-open');
  _suggestActive = false;
}
export function showSuggestPopup(ext) {
  _suggestActive = true;
  const clean = (ext || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  const label = clean ? ('.' + clean.toUpperCase()) : 'this file type';
  if (!_suggestPopEl || !_suggestPopEl.isConnected) {
    const closeBtn = el('button', { type: 'button', class: 'anr-suggest-close', 'aria-label': 'Dismiss' }, '×');
    closeBtn.addEventListener('click', hideSuggestPopup);
    const kicker = el('span', { class: 'anr-suggest-kicker' }, 'Limited readout');
    const head = el('div', { class: 'anr-suggest-head' }, [kicker, closeBtn]);
    const text = el('p', { class: 'anr-suggest-text' }, '');
    const cta = el('button', { type: 'button', class: 'anr-suggest-cta' }, 'Email a suggestion →');
    // Turnstile widget + status line live here; hidden until the CTA is clicked.
    const gate = el('div', { class: 'anr-suggest-gate', hidden: '' });

    // The address is built ONLY here, and openMailto() is reached only from
    // Turnstile's success callback (or the offline fallback) - so it never exists
    // in the DOM or in scraper-reachable state until a challenge has passed.
    const openMailto = () => {
      const addr = ['valjdakosta', 'gmail.com'].join('@');
      const subject = 'Format suggestion: ' + (_suggestPopEl._label || 'a file type');
      const body = 'Hi! Analyser couldn’t get much out of ' + (_suggestPopEl._label || 'this file type') + '.\n'
        + 'Could you add (or improve) support for it?\n\n'
        + 'I can attach a sample file to this email if that helps.\n';
      // Open in a new tab so the current analysis page is never navigated away.
      window.open('mailto:' + addr
        + '?subject=' + encodeURIComponent(subject)
        + '&body=' + encodeURIComponent(body), '_blank');
    };

    const resetCta = () => {
      cta._busy = false;
      cta.disabled = false;
      cta.textContent = 'Email a suggestion →';
    };
    cta.addEventListener('click', async () => {
      if (cta._busy) return;
      cta._busy = true;
      cta.disabled = true;
      cta.textContent = 'Verifying…';
      gate.hidden = false;
      gate.textContent = '';
      const status = el('p', { class: 'anr-suggest-gate-status' }, 'Confirming you’re human…');
      const box = el('div', { class: 'anr-suggest-turnstile' });
      gate.appendChild(status);
      gate.appendChild(box);
      try {
        await turnstileChallenge(box, (t) => { status.textContent = t; });
        status.textContent = 'Verified - opening your mail app…';
        cta._busy = false;
        openMailto();
      } catch (reason) {
        if (reason === 'offline') {
          status.textContent = 'You need an internet connection to send mail. Please connect to a network and try again.';
        } else {
          status.textContent = 'Couldn’t verify. Tap “Email a suggestion” to retry.';
        }
        resetCta();
      }
    });

    _suggestPopEl = el('div', { class: 'anr-suggest-pop', role: 'status', 'aria-live': 'polite' }, [head, text, cta, gate]);
    _suggestPopEl._text = text;
    _suggestPopEl._cta = cta;
    _suggestPopEl._gate = gate;
    document.body.appendChild(_suggestPopEl);
  }
  // Reset the CTA/gate so a reused popup starts fresh for the new file.
  if (_suggestPopEl._cta) {
    _suggestPopEl._cta._busy = false;
    _suggestPopEl._cta.disabled = false;
    _suggestPopEl._cta.textContent = 'Email a suggestion →';
  }
  if (_suggestPopEl._gate) { _suggestPopEl._gate.hidden = true; _suggestPopEl._gate.textContent = ''; }
  _suggestPopEl._label = label;
  _suggestPopEl._text.textContent = (clean
    ? ('Analyser couldn’t read much from ' + label + ' files.')
    : 'Analyser couldn’t read much from this file.')
    + ' If you’d like it supported, email me - just the extension, or attach a sample.';
  // Hold the nudge back ~1s so it slides in just after the analysis settles,
  // rather than competing with the result render. A pending timer is cancelled by
  // hideSuggestPopup() (e.g. when the next file is dropped) so it can't pop up
  // after being dismissed.
  if (_suggestTimer) clearTimeout(_suggestTimer);
  _suggestTimer = setTimeout(() => {
    _suggestTimer = null;
    _suggestPopEl.classList.add('is-open');
  }, 1000);
}
window._anrSuggest = { show: showSuggestPopup, hide: hideSuggestPopup };

// Footer "Email me!" - opens a centred modal that runs the Turnstile human-check,
// then reveals the address and opens the mail app. The address is assembled only
// after the challenge passes, so the footer carries no scrapeable address. Reuses
// the .anr-modal overlay (same as anrConfirm). One modal at a time.
let _contactModalOpen = false;
function openContactModal() {
  if (_contactModalOpen) return;
  _contactModalOpen = true;

  const status = el('p', { class: 'anr-suggest-gate-status' }, 'Confirming you’re human…');
  const box = el('div', { class: 'anr-suggest-turnstile' });
  const closeBtn = el('button', { type: 'button', class: 'anr-modal-btn anr-modal-cancel' }, 'Close');
  const card = el('div', { class: 'anr-modal-card anr-contact-card' }, [
    el('p', { class: 'anr-modal-kicker' }, 'Contact'),
    el('p', { class: 'anr-modal-title' }, 'Quick human-check, then I’ll open your mail app.'),
    box,
    status,
    el('div', { class: 'anr-modal-actions' }, [closeBtn]),
  ]);
  const overlay = el('div', { class: 'anr-modal', role: 'dialog', 'aria-modal': 'true' }, card);
  document.body.appendChild(overlay);

  let settled = false;
  const close = () => {
    if (settled) return;
    settled = true;
    _contactModalOpen = false;
    overlay.classList.remove('is-open');
    setTimeout(() => overlay.remove(), 200);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  requestAnimationFrame(() => overlay.classList.add('is-open'));

  // Run the challenge inside the modal; reveal + open mail only on success.
  turnstileChallenge(box, (t) => { status.textContent = t; })
    .then(() => {
      status.textContent = 'Verified - opening your mail app…';
      const addr = ['valjdakosta', 'gmail.com'].join('@');
      const subject = 'Hello from the Analyser site';
      const body = 'Hi!\n\n'
        + 'I was using Analyser and wanted to get in touch about:\n\n'
        + '\n\n'
        + '(Feel free to attach a file if it helps.)\n';
      // Open in a new tab so this page stays put rather than being navigated away.
      window.open('mailto:' + addr
        + '?subject=' + encodeURIComponent(subject)
        + '&body=' + encodeURIComponent(body), '_blank');
      setTimeout(close, 700);
    })
    .catch((reason) => {
      status.textContent = reason === 'offline'
        ? 'You need an internet connection to send mail. Please connect to a network and try again.'
        : 'Couldn’t verify. Close this and try again.';
    });
}

// Wire the footer button to the modal. Re-runs each navigation (the footer is
// swapped on SPA page change); the per-element flag guards double-wiring.
export function wireFooterContact() {
  const btn = document.querySelector('.footer-contact');
  if (!btn || btn._wired) return;
  btn._wired = true;
  btn.addEventListener('click', openContactModal);
}

// ---------- Share ----------
// The nav "Share" button opens a centred modal (same .anr-modal overlay) with
// the canonical URL, a one-tap copy, native share on devices that support it,
// and a few quick share targets. Everything is local - no tracking, no backend.
const SHARE_URL = 'https://lab.valjdakosta.com/';
const SHARE_TITLE = 'Analyser';
const SHARE_TEXT = 'This website helped me analyse metadata of a file and reveal some cool info. Nothing was ever uploaded and it even works offline!';

// Build the outgoing message. With analysis context (from the post-analysis nudge)
// it leads with what the tool just did to that specific file - its extension plus a
// per-type highlight - then closes on the privacy/offline line. Without context it's
// the generic message above.
function shareMessage(ctx) {
  if (!ctx || !ctx.ext) return SHARE_TEXT;
  const e = '.' + String(ctx.ext).toUpperCase();
  const leads = {
    photo: 'This website pulled the full EXIF out of my ' + e + ' photo - camera, lens, even GPS.',
    audio: 'This website even drew a spectrogram of my ' + e + ' and broke down the audio.',
    video: 'This website analysed my ' + e + ' frame-by-frame and pulled the audio track out.',
    pdf:   'This website cracked open my ' + e + ' and listed everything packed inside.',
    docx:  'This website cracked open my ' + e + ' and listed everything packed inside.',
    xlsx:  'This website cracked open my ' + e + ' and listed everything packed inside.',
    pptx:  'This website cracked open my ' + e + ' and listed everything packed inside.',
    epub:  'This website cracked open my ' + e + ' and listed everything packed inside.',
  };
  const lead = leads[ctx.category] || ('This website revealed a ton about my ' + e + ' file.');
  return lead + ' Nothing was ever uploaded and it even works offline!';
}

// Entry point for the nav "Share" button (and the post-analysis nudge, which passes
// a context object). On a touch device that supports the OS share sheet, prompt that
// straight away (the click is a valid user gesture) - it's the natural way to share
// on a phone. Cancelling just dismisses the sheet; anything else (sharing
// unsupported, or a real error) falls back to the modal.
function openShareModal(ctx) {
  const text = shareMessage(ctx);
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  if (coarse && navigator.share) {
    try {
      navigator.share({ title: SHARE_TITLE, text, url: SHARE_URL })
        .catch((err) => { if (!err || err.name !== 'AbortError') showShareModal(ctx); });
      return;
    } catch (_) { /* fall through to the modal */ }
  }
  showShareModal(ctx);
}

let _shareModalOpen = false;
function showShareModal(ctx) {
  if (_shareModalOpen) return;
  _shareModalOpen = true;

  const msg = shareMessage(ctx);

  const urlField = el('input', {
    class: 'anr-share-url', type: 'text', readonly: 'readonly',
    value: SHARE_URL, 'aria-label': 'Link to share',
  });

  // Small copy button sitting next to the link field - copies the URL itself.
  const urlCopyBtn = el('button', { type: 'button', class: 'anr-modal-btn anr-share-urlcopy' }, 'Copy');
  const urlRow = el('div', { class: 'anr-share-urlrow' }, [urlField, urlCopyBtn]);

  // The primary button copies the whole share MESSAGE (the blurb), not just the link.
  const copyBtn = el('button', { type: 'button', class: 'anr-modal-btn anr-share-copy' }, 'Copy message');

  // Email gets a proper subject and a "Hello,"/"Best regards" letter body; it stays
  // visible next to Copy. The remaining platforms hide behind a "More" toggle.
  const emailHref = 'mailto:?subject=' + encodeURIComponent("Check out this File Analyser I've found")
    + '&body=' + encodeURIComponent('Hello,\n\n' + msg + '\n\n' + SHARE_URL + '\n\nBest regards, [name]');
  const emailLink = el('a', {
    class: 'anr-share-target anr-share-email', href: emailHref, target: '_blank', rel: 'noopener',
  }, 'Email');
  const primaryRow = el('div', { class: 'anr-share-primary' }, [copyBtn, emailLink]);

  // Secondary share targets (open in a new tab) - collapsed by default, revealed
  // by the toggle below so the modal stays compact.
  const moreTargets = [
    { label: 'Twitter', href: 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(msg) + '&url=' + encodeURIComponent(SHARE_URL) },
    { label: 'Bluesky', href: 'https://bsky.app/intent/compose?text=' + encodeURIComponent(msg + ' ' + SHARE_URL) },
    { label: 'LinkedIn', href: 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(SHARE_URL) },
    { label: 'Telegram', href: 'https://t.me/share/url?url=' + encodeURIComponent(SHARE_URL) + '&text=' + encodeURIComponent(msg) },
    { label: 'Reddit', href: 'https://www.reddit.com/submit?url=' + encodeURIComponent(SHARE_URL) + '&title=' + encodeURIComponent(SHARE_TITLE) },
  ];
  const moreLinks = moreTargets.map((t) => el('a', {
    class: 'anr-share-target', href: t.href,
    target: '_blank', rel: 'noopener',
  }, t.label));
  const morePanel = el('div', { class: 'anr-share-targets anr-share-more' }, moreLinks);
  const moreToggle = el('button', {
    type: 'button', class: 'anr-modal-btn anr-share-more-toggle', 'aria-expanded': 'false',
  }, 'More platforms ▾');
  moreToggle.addEventListener('click', () => {
    const open = morePanel.classList.toggle('is-open');
    moreToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    moreToggle.textContent = open ? 'Fewer platforms ▴' : 'More platforms ▾';
  });

  const closeBtn = el('button', { type: 'button', class: 'anr-modal-btn anr-modal-cancel' }, 'Cancel');

  const cardKids = [
    el('p', { class: 'anr-modal-kicker' }, 'Share'),
    el('p', { class: 'anr-modal-title' }, 'Enjoying Analyser? Pass it on.'),
    el('p', { class: 'anr-share-lead' }, 'Here’s the link - send it off with one tap, or grab a copy below. Thanks for spreading the word.'),
    urlRow,
  ];
  // Native share sheet, when available - put it up top as the primary action.
  if (navigator.share) {
    const nativeBtn = el('button', { type: 'button', class: 'anr-modal-btn anr-modal-ok anr-share-native' }, 'Share it…');
    nativeBtn.addEventListener('click', () => {
      navigator.share({ title: SHARE_TITLE, text: msg, url: SHARE_URL }).catch(() => {});
    });
    cardKids.push(el('div', { class: 'anr-share-nativewrap' }, [nativeBtn]));
  }
  cardKids.push(primaryRow);
  cardKids.push(moreToggle);
  cardKids.push(morePanel);
  cardKids.push(el('div', { class: 'anr-modal-actions' }, [closeBtn]));

  const card = el('div', { class: 'anr-modal-card anr-share-card' }, cardKids);
  const overlay = el('div', { class: 'anr-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Share Analyser' }, card);
  document.body.appendChild(overlay);

  let settled = false;
  const close = () => {
    if (settled) return;
    settled = true;
    _shareModalOpen = false;
    overlay.classList.remove('is-open');
    setTimeout(() => overlay.remove(), 200);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);

  // Clipboard API with an execCommand fallback via a throwaway textarea, so it
  // still works in insecure/older contexts where navigator.clipboard is absent.
  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) { /* fall through */ }
    try {
      const ta = el('textarea', { style: 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;' });
      ta.value = text;
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (_) { return false; }
  }
  function flashCopy(btn, ok, idle) {
    btn.textContent = ok ? 'Copied!' : 'Hit Ctrl+C';
    btn.classList.toggle('is-done', ok);
    setTimeout(() => { btn.textContent = idle; btn.classList.remove('is-done'); }, 1600);
  }

  // Next-to-the-field button copies the link; the primary button copies the message.
  urlCopyBtn.addEventListener('click', async () => {
    const ok = await copyText(SHARE_URL);
    if (!ok) { urlField.focus(); urlField.select(); }
    flashCopy(urlCopyBtn, ok, 'Copy');
  });
  copyBtn.addEventListener('click', async () => {
    const ok = await copyText(msg);
    flashCopy(copyBtn, ok, 'Copy message');
  });

  requestAnimationFrame(() => overlay.classList.add('is-open'));
}

// Wire every nav "Share" button to the modal. Re-runs each navigation (the
// header is swapped on SPA page change); the per-element flag guards double-wiring.
export function wireShareButtons() {
  document.querySelectorAll('.header-btn-share').forEach((btn) => {
    if (btn._wired) return;
    btn._wired = true;
    btn.addEventListener('click', () => openShareModal());
  });
}

// ---------- post-analysis share nudge ----------
// A few seconds after a file is analysed, a small card slides in at the bottom-
// left inviting a share. Capped to once per calendar day, and held off for 4 days
// after someone actually shares. The share it offers is context-aware (see
// shareMessage): it leads with the analysed file's type, and for audio it attaches
// the spectrogram - a PNG named after the file - when the share sheet accepts files.
const NUDGE_DAY_KEY = 'anrShareNudgeDay';
const NUDGE_HOLD_KEY = 'anrShareNudgeHoldUntil';
let _shareNudgeEl = null;
let _shareNudgeTimer = null;

function nudgeDayStamp() {
  const d = new Date();
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}
function shareNudgeAllowed() {
  try {
    const hold = parseInt(localStorage.getItem(NUDGE_HOLD_KEY) || '0', 10);
    if (hold && Date.now() < hold) return false;             // within the 4-day post-share hold
    if (localStorage.getItem(NUDGE_DAY_KEY) === nudgeDayStamp()) return false;  // already shown today
  } catch (_) {}
  return true;
}
function markShareNudgeShared() {
  try { localStorage.setItem(NUDGE_HOLD_KEY, String(Date.now() + 4 * 24 * 60 * 60 * 1000)); } catch (_) {}
}
// Only an explicit dismiss (the x) or a share counts toward the once-a-day cap,
// written to localStorage so it survives a hard refresh. The 30s auto-dismiss
// (ignored) does NOT, so an ignored nudge can reappear on a later analysis.
function markShareNudgeSeen() {
  try { localStorage.setItem(NUDGE_DAY_KEY, nudgeDayStamp()); } catch (_) {}
}

export function hideShareNudge() {
  if (_shareNudgeTimer) { clearTimeout(_shareNudgeTimer); _shareNudgeTimer = null; }
  if (_shareNudgeEl) {
    const elm = _shareNudgeEl;
    _shareNudgeEl = null;
    elm.classList.remove('is-open');
    setTimeout(() => elm.remove(), 220);
  }
}

// Snapshot the on-page spectrogram canvas to a PNG File named after the audio file.
// Pre-built when the nudge appears so the eventual navigator.share() call stays
// inside the click gesture (awaiting toBlob first would break the gesture on Safari).
function spectrogramFile(name) {
  return new Promise((resolve) => {
    const canvas = document.querySelector('.anr-spec-canvas');
    if (!canvas || !canvas.width || !canvas.toBlob) { resolve(null); return; }
    try {
      canvas.toBlob((blob) => {
        if (!blob) { resolve(null); return; }
        const base = (name || 'audio').replace(/\.[^.]+$/, '') || 'audio';
        resolve(new File([blob], base + '-spectrogram.png', { type: 'image/png' }));
      }, 'image/png');
    } catch (_) { resolve(null); }
  });
}

// Schedule the nudge 5s after an analysis settles. Skips entirely when the day/hold
// caps say no, so a suppressed run never marks the day as "seen".
export function scheduleShareNudge(ctx) {
  if (_shareNudgeTimer) { clearTimeout(_shareNudgeTimer); _shareNudgeTimer = null; }
  if (!shareNudgeAllowed()) return;
  // The "suggest this format" popup (shown during render, before this runs) owns the
  // analysis - don't even schedule the nudge if it's up for this file.
  if (_suggestActive) return;
  _shareNudgeTimer = setTimeout(() => {
    _shareNudgeTimer = null;
    // Belt-and-braces: also skip if the format popup or a share modal is up by now.
    if (_suggestActive || (_suggestPopEl && _suggestPopEl.classList.contains('is-open'))) return;
    if (_shareModalOpen) return;
    showShareNudge(ctx);
  }, 5000);
}

function showShareNudge(ctx) {
  if (_shareNudgeEl) return;

  // For audio, start rendering the spectrogram attachment now so it's ready by the
  // time (if) the user taps Share - keeping the share() call within the gesture.
  let pendingFile = null;
  if (ctx && ctx.category === 'audio') spectrogramFile(ctx.name).then((f) => { pendingFile = f; });

  const closeBtn = el('button', { type: 'button', class: 'anr-share-nudge-close', 'aria-label': 'Dismiss' }, '×');
  const kicker = el('span', { class: 'anr-share-nudge-kicker' }, 'Nice find?');
  const head = el('div', { class: 'anr-share-nudge-head' }, [kicker, closeBtn]);
  const text = el('p', { class: 'anr-share-nudge-text' }, 'If Analyser was useful, a quick share really helps it reach more people.');
  const shareBtn = el('button', { type: 'button', class: 'anr-share-nudge-cta' }, 'Share Analyser →');
  const card = el('div', { class: 'anr-share-nudge', role: 'status' }, [head, text, shareBtn]);
  _shareNudgeEl = card;
  document.body.appendChild(card);

  closeBtn.addEventListener('click', () => { markShareNudgeSeen(); hideShareNudge(); });
  shareBtn.addEventListener('click', () => {
    markShareNudgeShared();
    markShareNudgeSeen();
    hideShareNudge();
    const text2 = shareMessage(ctx) + ' ' + SHARE_URL;
    // Prefer the native sheet WITH the spectrogram attached when the platform takes
    // files (the file is already built, so this stays inside the click gesture).
    if (pendingFile && navigator.canShare && navigator.canShare({ files: [pendingFile] }) && navigator.share) {
      navigator.share({ title: SHARE_TITLE, text: text2, files: [pendingFile] }).catch(() => {});
      return;
    }
    // Otherwise the usual flow (native text share on mobile, modal on desktop).
    openShareModal(ctx);
  });

  // Auto-dismiss if ignored (does NOT count toward the daily cap), and slide in one
  // frame later for the transition.
  _shareNudgeTimer = setTimeout(hideShareNudge, 30000);
  requestAnimationFrame(() => card.classList.add('is-open'));
}

// Active reachability probe. navigator.onLine only knows whether a local network
// link exists (Wi-Fi/LAN up), NOT whether the internet is actually reachable - so
// it stays true when you disconnect the modem but keep the router, and the
// 'offline' event never fires. To know for real we HEAD-ping our own origin with a
// cache-busted URL: HEAD is not GET, so the service worker ignores it and it isn't
// cached - the request genuinely hits the network and rejects when offline. Stays
// own-origin (no third party, nothing uploaded). Resolves true if reachable.
function probeOnline() {
  if (!navigator.onLine) return Promise.resolve(false);
  let timer;
  const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  if (ctrl) timer = setTimeout(() => ctrl.abort(), 5000);
  return fetch(location.origin + '/?_anrping=' + performance.now(), {
    method: 'HEAD', cache: 'no-store', signal: ctrl ? ctrl.signal : undefined,
  }).then(() => true).catch(() => false).finally(() => { if (timer) clearTimeout(timer); });
}

function applyNetStatus(online) {
  document.querySelectorAll('.net-status').forEach((dd) => {
    dd.classList.toggle('is-offline', !online);
    const label = dd.querySelector('.net-label');
    if (label) label.textContent = online ? 'Online' : 'Offline';
    dd.title = online
      ? 'Connected - everything still runs locally in your browser; nothing is uploaded.'
      : 'No internet connection. Analysis still works offline; sending mail won’t.';
  });
}

// Reflect live connectivity in the header "Status" line. The app is always
// local-only (nothing is uploaded), but mail / Turnstile need the network, so the
// status surfaces online vs offline. A clear offline signal short-circuits the
// probe; otherwise we confirm real reachability. Re-run on boot, on the
// online/offline events, on tab focus, and on a modest interval (wired in boot).
let _netProbeBusy = false;
export async function updateNetStatus() {
  if (!navigator.onLine) { applyNetStatus(false); return; }
  if (_netProbeBusy) return;
  _netProbeBusy = true;
  try { applyNetStatus(await probeOnline()); }
  finally { _netProbeBusy = false; }
}
