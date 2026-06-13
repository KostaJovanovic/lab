/* Prerender one static landing page per supported extension.
   ============================================================================
   WHAT / WHY
   The long-tail SEO intent here is per-extension ("how to open a .stl file",
   "view .arw exif"). On a static, backend-free site every rankable URL must be a
   real file (Cloudflare's SPA fallback would otherwise serve index.html for an
   ungenerated path - a soft-404). So this emits one real HTML file per extension
   into formats/, served at clean URLs nested under the /formats hub
   (formats.html the file and formats/ the directory coexist).

   SCOPE - every extension in the catalog
   Extensions whose catalog row has depth 'full' (a real viewer / deep analysis)
   get a page at /formats/<ext>; identification-only extensions get a page at
   /formats/id/<ext>. An extension that appears in BOTH a full and an id row
   (e.g. .h264, listed under Video and under streaming) gets only the full page.
   That predicate lives in the catalog (assets/js/core/formats.js) and is the
   single source of truth - add an extension there and it flows here.

   CONTENT
   Per-extension copy (the unique "what is a .X file" line) comes from
   tools/format-page-content.mjs; the "what Analyser does" part is the catalog
   row `desc`. A FULL-analysis extension missing from format-page-content.mjs is
   WARNED about and gets a generic fallback line, so save.bat surfaces the gap.
   Identification-only extensions fall back to a line built from their catalog
   row WITHOUT a warning - there are hundreds of them, so EXT_PAGES copy is
   welcome but optional there.

   OUTPUTS
   - formats/<ext>.html       one page per full-analysis extension
   - formats/id/<ext>.html    one page per identification-only extension
   - sitemap-formats.xml      lists every page URL (+ /formats)

   RUN: `node tools/prerender-format-pages.mjs` (save.bat runs it each commit).
   See CLAUDE.md -> "Generated SEO pages" for the upkeep checklist.
   ============================================================================ */
import { writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { esc, escAttr, buildFullKeys, makeHrefOf } from './prerender-common.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTDIR = join(ROOT, 'formats');
const SITE = 'https://lab.valjdakosta.com';

const { catalogGrouped } = await import(pathToFileURL(join(ROOT, 'assets/js/core/formats.js')).href);
const { EXT_PAGES } = await import(pathToFileURL(join(ROOT, 'tools/format-page-content.mjs')).href);
// Extra "Did you know" bullets, keyed by lowercase ext -> [fact, ...]. A
// generated-input sidecar (built in batches) so the 1000+ primary entries in
// format-page-content.mjs stay hand-curated and untouched. Absent = no extras.
let EXTRA_FACTS = {};
try {
  const { readFileSync } = await import('node:fs');
  EXTRA_FACTS = JSON.parse(readFileSync(join(ROOT, 'tools/dyk-extra.json'), 'utf8'));
} catch { /* no sidecar yet */ }

// ---- assemble per-extension data from the catalog ----
const groups = catalogGrouped();

// Which extensions live in at least one full-analysis row. Full pages win
// cross-depth collisions, and links route on this set everywhere.
const fullKeys = buildFullKeys(groups);

// The canonical URL path for an extension token, whichever depth it lives at.
const hrefOf = makeHrefOf(fullKeys);

// lowercase ext -> { display, rows:[{label,catKey,catLabel,desc}], sibs:Set }
function collect(depth) {
  const ext = new Map();
  for (const g of groups) {
    for (const r of g.rows) {
      if (r.depth !== depth) continue;
      for (const tok of r.exts) {
        const key = tok.toLowerCase();
        if (depth === 'id' && fullKeys.has(key)) continue; // the full page covers it
        let e = ext.get(key);
        if (!e) { e = { display: tok, rows: [], sibs: new Set() }; ext.set(key, e); }
        e.rows.push({ label: r.label, catKey: g.key, catLabel: g.label, desc: r.desc });
        for (const sib of r.exts) if (sib.toLowerCase() !== key) e.sibs.add(sib);
      }
    }
  }
  return ext;
}
const fullExt = collect('full');
const idExt = collect('id');

// Ordered, de-duplicated sequence of every page in catalog order - the exact
// order /formats lists the formats - so the per-page pager can step prev/next
// through them. First occurrence wins; full-wins routing means each ext is one
// page, so the sequence visits every generated page exactly once.
const orderedKeys = [];
const seenOrder = new Set();
for (const g of groups) {
  for (const r of g.rows) {
    for (const tok of r.exts) {
      const k = tok.toLowerCase();
      if (seenOrder.has(k)) continue;
      seenOrder.add(k);
      orderedKeys.push(k);
    }
  }
}
const orderIndex = new Map(orderedKeys.map((k, i) => [k, i]));

// Prev / "I'm feeling lucky" / next bar. Reuses the site-wide .site-nav strip
// (the same sticky navbar Home/About use, three equal cells via the existing
// `body:has(.about-page) .site-nav` rule) so it matches the rest of the site and
// the SPA router swaps it on navigation. Prev/next are baked links that wrap
// around the ends; lucky is a <button> reusing app.js's [data-fmt-random] (kept
// a button, not an a[href="#"], so the section scroll-spy never touches it).
function siteNav(key) {
  const n = orderedKeys.length;
  const i = orderIndex.get(key);
  const prev = orderedKeys[(i - 1 + n) % n];
  const next = orderedKeys[(i + 1) % n];
  return `<nav class="site-nav format-nav" aria-label="Browse file types">
  <a href="${escAttr(hrefOf(prev))}" class="nav-link" rel="prev"><span class="nav-num" aria-hidden="true">&larr;</span><span>Previous</span></a>
  <button type="button" class="nav-link nav-link-lucky" data-fmt-random><span class="nav-num" aria-hidden="true">&#9733;</span><span>I&rsquo;m feeling lucky</span></button>
  <a href="${escAttr(hrefOf(next))}" class="nav-link" rel="next"><span class="nav-num" aria-hidden="true">&rarr;</span><span>Next</span></a>
</nav>`;
}

const SHARE_SVG = '<svg class="header-btn-ico" viewBox="0 0 50 50" fill="currentColor" aria-hidden="true" focusable="false"><path d="M15 30c-2.8 0-5-2.2-5-5s2.2-5 5-5 5 2.2 5 5-2.2 5-5 5zm0-8c-1.7 0-3 1.3-3 3s1.3 3 3 3 3-1.3 3-3-1.3-3-3-3z"/><path d="M35 20c-2.8 0-5-2.2-5-5s2.2-5 5-5 5 2.2 5 5-2.2 5-5 5zm0-8c-1.7 0-3 1.3-3 3s1.3 3 3 3 3-1.3 3-3-1.3-3-3-3z"/><path d="M35 40c-2.8 0-5-2.2-5-5s2.2-5 5-5 5 2.2 5 5-2.2 5-5 5zm0-8c-1.7 0-3 1.3-3 3s1.3 3 3 3 3-1.3 3-3-1.3-3-3-3z"/><path d="M19.007 25.885l12.88 6.44-.895 1.788-12.88-6.44z"/><path d="M30.993 15.885l.894 1.79-12.88 6.438-.894-1.79z"/></svg>';

function capabilityBlocks(e, isFull) {
  // One "what Analyser does" entry per row the ext belongs to (collisions like
  // .ts -> video + code get both), then how-to-open and related-formats.
  const single = e.rows.length === 1;
  const singleDt = isFull ? 'What Analyser shows you' : 'What Analyser reads';
  const caps = e.rows.map((r) =>
    `<div><dt>${single ? singleDt : 'As ' + esc(r.label.toLowerCase())}</dt><dd>${esc(r.desc)}</dd></div>`
  );
  return caps.join('\n            ');
}

function relatedLinks(e) {
  const sibs = [...e.sibs].slice(0, 18);
  if (!sibs.length) return `Browse the <a href="/formats">full list of supported file types</a>.`;
  const links = sibs
    .map((s) => `<a href="${escAttr(hrefOf(s))}">.${esc(s)}</a>`)
    .join(' &middot; ');
  const more = e.sibs.size > sibs.length ? ` and <a href="/formats">more</a>` : '';
  return `${links}${more}. See <a href="/formats">all supported file types</a>.`;
}

// ---- "Did you know" facts: hand-authored (EXT_PAGES) + auto-derived ----
// Auto-derived tables let one rule enrich many formats at once. assembleFacts()
// appends them AFTER the hand-authored facts and skips any whose gist a hand
// fact already states, so we never repeat ourselves. Each auto-fact carries an
// html form (may contain <code>) and a plain form (for the FAQ JSON-LD).

const ZIP_CONTAINERS = new Set('docx docm dotx dotm xlsx xlsm xltx xltm pptx pptm ppsx ppsm potx potm odt ott ods ots odp otp odg otg odb jar war ear apk aar aab epub xpi crx 3mf usdz kmz idml nupkg vsix appx msix whl ipa cbz love sketch mscz'.split(' '));
const CFBF_CONTAINERS = new Set('doc dot xls xlt ppt pps msi msg vsd pub'.split(' '));
const TEXT_FORMATS = new Set('json xml yaml yml csv tsv md markdown txt ini toml log srt vtt ass ssa lrc m3u m3u8 gpx kml gcode cue reg ps1 svg geojson'.split(' '));
const MIME_TYPES = {
  png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif',
  webp:'image/webp', svg:'image/svg+xml', bmp:'image/bmp', tiff:'image/tiff',
  avif:'image/avif', heic:'image/heic',
  pdf:'application/pdf', json:'application/json', zip:'application/zip',
  gz:'application/gzip', tar:'application/x-tar', wasm:'application/wasm',
  mp3:'audio/mpeg', wav:'audio/wav', flac:'audio/flac', ogg:'audio/ogg',
  opus:'audio/opus', aac:'audio/aac', mid:'audio/midi',
  mp4:'video/mp4', webm:'video/webm', avi:'video/x-msvideo', mov:'video/quicktime',
  mkv:'video/x-matroska',
  html:'text/html', css:'text/css', csv:'text/csv',
  ttf:'font/ttf', otf:'font/otf', woff:'font/woff', woff2:'font/woff2',
  epub:'application/epub+zip',
};
const MAGIC_BYTES = {
  png:['89 50 4E 47','the next three bytes spell "PNG"'],
  pdf:['25 50 44 46','ASCII for "%PDF"'],
  gif:['47 49 46 38','ASCII for "GIF8"'],
  jpg:['FF D8 FF',''], jpeg:['FF D8 FF',''],
  bmp:['42 4D','ASCII for "BM"'],
  rar:['52 61 72 21','ASCII for "Rar!"'],
  '7z':['37 7A BC AF',''],
  gz:['1F 8B',''],
  psd:['38 42 50 53','ASCII for "8BPS"'],
  flac:['66 4C 61 43','ASCII for "fLaC"'],
  exe:['4D 5A','ASCII for "MZ", the initials of MS-DOS architect Mark Zbikowski'],
  dll:['4D 5A','ASCII for "MZ"'],
  class:['CA FE BA BE','the playful hex word "CAFEBABE"'],
  wasm:['00 61 73 6D','a NUL then "asm"'],
  mid:['4D 54 68 64','ASCII for "MThd"'],
  sqlite:['53 51 4C 69','the start of "SQLite format 3"'],
  ico:['00 00 01 00',''],
  ttf:['00 01 00 00',''],
  otf:['4F 54 54 4F','ASCII for "OTTO"'],
  wav:['52 49 46 46','the "RIFF" container tag'],
  avi:['52 49 46 46','the "RIFF" container tag'],
};

function assembleFacts(key, meta, d) {
  const items = []; // { html, plain }
  if (meta.fact) {
    items.push({
      html: esc(meta.fact) + (meta.factApprox ? ' <span class="fact-approx">(approximate)</span>' : ''),
      plain: meta.fact,
    });
  }
  if (Array.isArray(meta.facts)) {
    for (const f of meta.facts) if (f) items.push({ html: esc(f), plain: f });
  }
  const extra = EXTRA_FACTS[key];
  if (Array.isArray(extra)) {
    for (const f of extra) if (f) items.push({ html: esc(f), plain: f });
  }
  const lower = items.map((i) => i.plain.toLowerCase());
  const has = (...needles) => needles.some((n) => lower.some((f) => f.includes(n)));
  const push = (plain, html) => { items.push({ plain, html: html || esc(plain) }); lower.push(plain.toLowerCase()); };

  if (ZIP_CONTAINERS.has(key) && !has('zip archive', 'a zip', 'is a zip', 'really a zip')) {
    push(`Under the hood a .${d} file is really a ZIP archive - rename it to .zip and you can browse the files inside.`);
  } else if (CFBF_CONTAINERS.has(key) && !has('compound file', 'ole compound', 'ole container')) {
    push(`A .${d} file uses Microsoft's OLE Compound File container - the same wrapper as the legacy .doc and .xls binaries.`);
  }
  if (TEXT_FORMATS.has(key) && !has('plain text', 'text-based', 'human-readable', 'human readable', 'text file')) {
    push(`A .${d} file is plain text, so you can open and edit it in any text editor.`);
  }
  const mime = MIME_TYPES[key];
  if (mime && !has('mime', mime)) {
    push(`On the web a .${d} file is served with the MIME type ${mime}.`,
      `On the web a .${esc(d)} file is served with the MIME type <code>${esc(mime)}</code>.`);
  }
  const mg = MAGIC_BYTES[key];
  if (mg && !has('signature', 'magic byte', mg[0].toLowerCase())) {
    const tail = mg[1] ? ' - ' + mg[1] : '';
    push(`Analyser spots a .${d} file by its signature bytes ${mg[0]}${tail}.`,
      `Analyser spots a .${esc(d)} file by its signature bytes <code>${esc(mg[0])}</code>${esc(tail)}.`);
  }
  return items;
}

function page(key, e, depth) {
  const isFull = depth === 'full';
  const d = e.display;            // curated casing for display, e.g. WebP
  const fallback = isFull
    ? { name: '.' + d + ' file', blurb: `.${d} is a file format that Analyser can open and analyse in your browser.` }
    : { name: '.' + d + ' file (' + e.rows[0].label + ')', blurb: `.${d} files belong to the "${e.rows[0].label}" family of formats.` };
  const meta = EXT_PAGES[key] || fallback;
  const facts = assembleFacts(key, meta, d);
  const factBody = facts.length === 1
    ? facts[0].html
    : `<ul class="dyk-list">${facts.map((f) => `<li>${f.html}</li>`).join('')}</ul>`;
  const factBlock = facts.length
    ? `<div class="didyouknow"><dt>Did you know</dt><dd>${factBody}</dd></div>\n            `
    : '';
  const factPlain = facts.map((f) => f.plain).join(' ');
  const url = `${SITE}${isFull ? '/formats/' : '/formats/id/'}${key}`;
  const title = isFull
    ? `.${d} file - what it is and how to open it | Analyser`
    : `.${d} file - what it is and how to identify it | Analyser`;
  const desc = isFull
    ? `${meta.blurb} Open and inspect a .${d} file free in your browser with Analyser - nothing is uploaded.`
    : `${meta.blurb} Identify and inspect a .${d} file free in your browser with Analyser - nothing is uploaded.`;
  const kicker = [...new Set(e.rows.map((r) => r.catLabel))].join(' / ');

  const faq = {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: [
      { '@type': 'Question', name: `What is a .${d} file?`,
        acceptedAnswer: { '@type': 'Answer', text: meta.blurb + (factPlain ? ' ' + factPlain : '') } },
      { '@type': 'Question', name: `How do I open a .${d} file?`,
        acceptedAnswer: { '@type': 'Answer', text: `Drop a .${d} file onto Analyser at ${SITE}/ and it ${isFull ? 'opens' : 'is identified'} directly in your browser - no upload, no account and no software to install. ${e.rows[0].desc}` } },
    ],
  };
  const crumbs = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Analyser', item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: 'Supported file types', item: `${SITE}/formats` },
      { '@type': 'ListItem', position: 3, name: `.${d}`, item: url },
    ],
  };

  // Identification-only pages say so up front, instead of implying a viewer.
  const depthNote = isFull ? '' : `
            <div><dt>Depth of analysis</dt><dd>.${esc(d)} is an identification-grade format: Analyser recognises it from its bytes and decodes the header metadata it carries, rather than opening it in a full viewer. Formats that do get a full viewer are marked "Full" on the <a href="/formats">formats page</a>.</dd></div>`;
  const openVerb = isFull ? 'It opens' : 'It is identified';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escAttr(title)}</title>
  <meta name="description" content="${escAttr(desc)}">
  <link rel="canonical" href="${url}">
  <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#0a0a0a" media="(prefers-color-scheme: dark)">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="Analyser">
  <meta property="og:locale" content="en_GB">
  <meta property="og:title" content="${escAttr(title)}">
  <meta property="og:description" content="${escAttr(desc)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${SITE}/assets/img/banner.jpg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="The Analyser wordmark on a faint grid - a free, local, in-browser file metadata and forensics tool.">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escAttr(title)}">
  <meta name="twitter:description" content="${escAttr(desc)}">
  <meta name="twitter:image" content="${SITE}/assets/img/banner.jpg">
  <link rel="icon" href="/assets/img/favicon.png" type="image/png">
  <link rel="icon" href="/assets/img/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/assets/img/icon.png">
  <link rel="manifest" href="/manifest.json">
  <script type="application/ld+json">
  ${JSON.stringify(faq)}
  </script>
  <script type="application/ld+json">
  ${JSON.stringify(crumbs)}
  </script>
  <link rel="stylesheet" href="/assets/css/fonts.css">
  <link rel="stylesheet" href="/assets/css/analyser.css">
  <script>try{var t=localStorage.getItem('anr-theme'),s=parseInt(localStorage.getItem('anr-theme:ts'),10);if(t&&(!s||Date.now()-s>604800000)){localStorage.removeItem('anr-theme');localStorage.removeItem('anr-theme:ts');t=null;}if(!t&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)t='dark';if(t)document.documentElement.setAttribute('data-theme',t);}catch(e){}</script>
</head>
<body>

<div id="pageDrop" class="page-drop" hidden aria-hidden="true">
  <div class="page-drop-inner">
    <span class="page-drop-icon" aria-hidden="true">+</span>
    <strong>Drop anywhere</strong>
    <p>Photo, sound, video, or anything else. I&rsquo;ll figure it out</p>
  </div>
</div>

<header class="site-header">
  <div class="grid">
    <div class="site-mark">
      <span class="site-kicker">${esc(kicker)}</span>
      <h1 class="site-title">.${esc(d)}</h1>
      <p class="site-byline"><a href="/" style="color:inherit;text-decoration:none">Analyser</a> by <a href="https://link.valjdakosta.com/" class="site-byline-link" target="_blank" rel="noopener">valjdakosta</a></p>
      <p class="site-sub">${esc(meta.name)}</p>
      <nav class="site-mark-nav" aria-label="Pages">
        <a href="/" class="header-btn">Home</a>
        <a href="/about" class="header-btn">About</a>
        <a href="/formats" class="header-btn">Formats</a>
        <a href="/stats" class="header-btn">Stats</a>
        <button type="button" class="header-btn header-btn-share">${SHARE_SVG}Share</button>
      </nav>
    </div>
    <div class="site-meta">
      <dl>
        <dt>Version</dt><dd id="versionNum">0.00</dd>
        <dt>Status</dt><dd class="net-status"><span class="dot"></span> <span class="net-label">Local-only</span></dd>
        <dt>Other stuff</dt><dd><a href="https://link.valjdakosta.com/" id="otherStuffLink" target="_blank" rel="noopener" class="dark-toggle" style="text-decoration:none;display:inline-block;text-align:center;">Links ↗</a></dd>
        <dt>Dark mode</dt><dd><button type="button" id="darkToggle" class="dark-toggle">&#9728;&#65038; DAY</button></dd>
      </dl>
    </div>
  </div>
</header>

${siteNav(key)}

<main class="site-main about-page patch-page format-page">
  <div class="format-cta">
    <a href="/" class="format-cta-btn">Click here to analyse any file <span aria-hidden="true">&rarr;</span></a>
  </div>
  <section class="section">
    <div class="grid">
      <div class="section-content">
        <p class="format-crumbs"><a href="/">Home</a> &rsaquo; <a href="/formats">Formats</a> &rsaquo; <span>.${esc(d)}</span><span class="fmt-item-badge format-crumb-badge ${isFull ? 'is-full' : 'is-id'}" title="${isFull ? 'Opens in a viewer with deep metadata' : 'Identified + header metadata'}">${isFull ? 'Full' : 'ID'}</span></p>
        <h2 class="section-head">What is a .${esc(d)} file?</h2>
        <p class="section-lede">${esc(meta.blurb)}</p>

        <div class="about-block">
          <dl class="about-caps">
            ${factBlock}${capabilityBlocks(e, isFull)}${depthNote}
            <div><dt>Open a .${esc(d)} file</dt><dd>Drag a .${esc(d)} file onto <a href="/">the Analyser home page</a> (or tap to pick one). ${openVerb} entirely in your browser - nothing is uploaded, there is no account, and it works offline once installed.</dd></div>
            <div><dt>Related formats</dt><dd>${relatedLinks(e)}</dd></div>
          </dl>
        </div>
      </div>
    </div>
  </section>
</main>

<footer id="about" class="site-footer site-footer--about">
  <div class="footer-about-heading">
    <p class="footer-mark">Everything runs in your browser.</p>
    <p class="footer-meta">No upload, no analytics, no servers in the loop.</p>
  </div>
  <div class="footer-row footer-bottom">
    <a href="/formats" class="footer-nav-btn">&larr; All formats</a>
    <p class="footer-meta">2026 &middot; <a href="https://valjdakosta.com/">valjdakosta.com</a></p>
    <p class="footer-meta footer-contact-line">Contact: <button type="button" class="footer-contact">Email me!</button></p>
  </div>
</footer>

<script src="/assets/js/core/navigate.js"></script>
<script type="module" src="/assets/js/core/app.js"></script>
<script>
  if ('serviceWorker' in navigator) {
    if (navigator.serviceWorker.controller) {
      var anrRefreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (anrRefreshing) return;
        anrRefreshing = true;
        window.location.reload();
      });
    }
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
        .then(function (reg) { reg.update(); })
        .catch(function (e) { console.warn('SW failed:', e); });
    });
  }
</script>

</body>
</html>
`;
}

// ---- write pages (regenerate formats/ from scratch so removed exts go) ----
mkdirSync(OUTDIR, { recursive: true });
for (const f of readdirSync(OUTDIR)) {
  if (f.endsWith('.html')) rmSync(join(OUTDIR, f));
}
rmSync(join(OUTDIR, 'id'), { recursive: true, force: true });
mkdirSync(join(OUTDIR, 'id'), { recursive: true });

const fullKeysSorted = [...fullExt.keys()].sort();
const missing = [];
for (const key of fullKeysSorted) {
  if (!EXT_PAGES[key]) missing.push(key);
  writeFileSync(join(OUTDIR, key + '.html'), page(key, fullExt.get(key), 'full'));
}

const idKeysSorted = [...idExt.keys()].sort();
for (const key of idKeysSorted) {
  writeFileSync(join(OUTDIR, 'id', key + '.html'), page(key, idExt.get(key), 'id'));
}

// ---- sitemap for the per-format pages (+ the hub) ----
const entry = (loc, priority) =>
  `  <url><loc>${loc}</loc><changefreq>monthly</changefreq><priority>${priority}</priority></url>`;
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[
  entry(`${SITE}/formats`, '0.7'),
  ...fullKeysSorted.map((k) => entry(`${SITE}/formats/${k}`, '0.7')),
  ...idKeysSorted.map((k) => entry(`${SITE}/formats/id/${k}`, '0.5')),
].join('\n')}
</urlset>
`;
writeFileSync(join(ROOT, 'sitemap-formats.xml'), sitemap);

const total = 1 + fullKeysSorted.length + idKeysSorted.length;
console.log(`prerender-format-pages: ${fullKeysSorted.length} full pages -> formats/, ${idKeysSorted.length} id pages -> formats/id/, ${total} urls -> sitemap-formats.xml`);
if (missing.length) {
  console.log(`  WARNING: ${missing.length} full-analysis ext(s) missing from format-page-content.mjs (generic fallback used): ${missing.join(', ')}`);
}
