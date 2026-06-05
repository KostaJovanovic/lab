/* Analyser - shared utilities
   DOM helpers and small formatters used by every module. */

export function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const k in attrs) {
    if (k === 'class') e.className = attrs[k];
    else if (k === 'html') e.innerHTML = attrs[k];
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
    else e.setAttribute(k, attrs[k]);
  }
  for (const c of (Array.isArray(children) ? children : [children])) {
    if (c == null) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

// Plain-language explanations for non-obvious readout labels. Any row() whose
// label is a key here automatically gains the standard [?] tooltip - the same
// affordance rowHelp adds explicitly - so the renderer tables and the
// proprietary-parser `fields` readouts (rendered through row()) stay consistent
// without touching hundreds of call sites. Only labels whose meaning is the same
// everywhere they appear are listed; generic/ambiguous labels (Type, Format,
// Name, Title, Size, Date, Version, Resolution…) are intentionally left plain.
export const LABEL_HELP = {
  // --- Media: containers, codecs, streams ---
  'Container': 'The container (or wrapper) format that packages the media streams together - for example MP4, MKV or WebM. It is separate from the codecs stored inside, so the same container can hold different codecs.',
  'Codec': 'The codec is the method used to compress and store the media inside the container (for example H.264 for video or AAC for audio). Container and codec are independent.',
  'Audio codec': 'The method used to compress the audio stream (for example AAC, MP3 or Opus), independent of the container holding it.',
  'Video codec': 'The method used to compress the video stream (for example H.264, HEVC or AV1), independent of the container holding it.',
  'Aspect ratio': 'The ratio of frame width to height (for example 16:9). Shown as the exact pixel ratio, sometimes alongside the nearest standard ratio.',
  'Frame rate': 'How many frames are shown each second (fps). Higher rates look smoother; 24, 25, 30 and 60 are common.',
  'Bitrate': 'How many bits are used per second of audio or video. Higher bitrates generally mean better quality and larger files.',
  'Sample rate': 'How many audio samples are captured per second, in hertz (44,100 Hz is CD quality). Higher rates can represent higher frequencies.',
  'Bit depth': 'The number of bits stored per sample or per colour channel. More bits allow finer gradations - smoother audio dynamics or colour.',
  'Channels': 'The number of independent audio channels (1 = mono, 2 = stereo, 6 = 5.1 surround, and so on).',
  'Compression': 'The method used to shrink the file’s data. Lossless compression preserves every byte; lossy compression discards some detail to save space.',
  // --- Text & encoding ---
  'Encoding': 'The character encoding used to store the text (for example UTF-8 or UTF-16), which determines how the raw bytes map to characters.',
  'Code page': 'A legacy character-encoding table (for example Windows-1252) mapping byte values to characters. Reading text with the wrong code page produces garbled characters.',
  'Line endings': 'The byte sequence that marks the end of each line - LF on Unix/Mac, CRLF on Windows - which often hints at where a file came from.',
  'Units': 'The measurement units the file’s coordinates or dimensions are expressed in, such as millimetres or inches.',
  // --- Photo / EXIF ---
  'Orientation': 'How the camera was held when the photo was taken, stored in EXIF. Viewers use it to rotate the image upright automatically.',
  'Temperature': 'The white-balance colour temperature, in kelvin, the camera recorded for the shot - lower is warmer (orange), higher is cooler (blue).',
  // --- Detection / sniffing ---
  'Detected original format': 'The true format detected from the file’s actual bytes, which can differ from what its extension claims.',
  'Confidence': 'How sure the detector is about its guess, based on how strongly the file’s bytes match a known signature.',
  'Recognised tokens': 'How many known keywords or markers were found while scanning the file, used to identify its format.',
  'DHT': 'Define Huffman Table - the JPEG segment holding the code tables used to compress the image data.',
  // --- Documents / office ---
  'Tracked changes': 'Whether the document records edits (insertions and deletions) made with revision tracking turned on.',
  'Track changes': 'Whether the document records edits (insertions and deletions) made with revision tracking turned on.',
  'Macros': 'Embedded VBA code that can run inside the document. Macros automate tasks but are also a common malware vector, so unexpected ones warrant caution.',
  'Document protection': 'Restrictions the author placed on the document, such as preventing editing, formatting or printing.',
  'Restricted actions': 'Things the author has locked down in this document, such as editing, copying or printing.',
  'Hidden slides': 'Slides kept in the file but marked not to appear when the presentation is played.',
  'Hidden slides (declared)': 'Slides kept in the file but marked not to appear when the presentation is played.',
  'Hidden sheets': 'Worksheets present in the workbook but hidden from view in the spreadsheet.',
  'Named ranges': 'Cell ranges given a human-readable name so formulas can refer to them by name instead of by coordinates.',
  'External workbook links': 'References to data in other files or on the web that this document pulls in when opened.',
  'External links': 'References to data in other files or on the web that this document pulls in when opened.',
  'Editing time': 'The total time the document reports being open for editing, accumulated in its metadata.',
  'Reading direction': 'The direction the content flows - left-to-right or right-to-left (for example manga, or Arabic and Hebrew text).',
  'TOC entries': 'The number of entries in the document’s table of contents.',
  // --- Subtitles / lyrics ---
  'Cues': 'A cue is a single timed subtitle entry - its text plus the start and end times it appears on screen.',
  'Timestamped': 'Whether each line carries timing information, so the lyrics or subtitles can sync to playback.',
  // --- CSV / tabular ---
  'Delimiter confidence': 'How confident the parser is that it picked the right character separating the columns.',
  'Data rows': 'The number of rows of actual data, not counting the header row.',
  // --- Fitness / GPS tracks ---
  'Cadence': 'Pedalling or step rate recorded during the activity, typically in revolutions or steps per minute.',
  'Average pace': 'The average time taken per unit of distance, such as minutes per kilometre.',
  'Total descent': 'The cumulative height lost over the route, summing every downhill section.',
  // --- 3D printing / slicing ---
  'Layer height': 'The thickness of each printed layer. Thinner layers give finer detail but take longer to print.',
  'Nozzle temp': 'The temperature the printer heats its nozzle to in order to melt the filament.',
  'Bed temp': 'The temperature of the heated print bed, which helps the first layer stick and prevents warping.',
  'Nozzle': 'The nozzle diameter the file was sliced for, which sets the width of each extruded line of plastic.',
  'Slicer': 'The software that sliced the 3D model into printer instructions (G-code), such as Cura or PrusaSlicer.',
  'Print size': 'The width, depth and height the finished print occupies.',
  'Layout': 'How the data is arranged within the file.',
  // --- CNC / G-code ---
  'G-code type': 'The dialect of G-code, which varies between machine controllers and target machines (3D printer, CNC mill, laser, etc.).',
  'CAM software': 'The computer-aided-manufacturing program that generated the toolpaths (G-code) from a CAD model.',
  'Controller': 'The machine controller or firmware the G-code targets, which determines which commands it understands.',
  'Likely machine': 'A best guess at the kind of machine this G-code drives - 3D printer, CNC router, laser cutter - inferred from the commands used.',
  'Coolant': 'Whether and how the program switches cutting coolant on, used in CNC machining to cool the tool and clear away chips.',
  'Max feed rate': 'The highest commanded movement speed (feed rate) found anywhere in the program.',
  'Max spindle / power': 'The highest spindle speed (for a mill or router) or laser power level commanded in the program.',
  'Work offsets': 'Stored coordinate systems (G54-G59) a CNC program switches between to locate the workpiece on the table.',
  'Canned cycles': 'Built-in multi-step machining routines, such as drilling or tapping, each invoked by a single G-code command.',
  'Arc moves': 'The number of curved (arc) tool movements (G2/G3) in the program, as opposed to straight-line moves.',
  'Tool': 'The cutting tool the program selects, identified by its tool-changer number.',
  'Tools used': 'The set of cutting tools the program calls up, identified by their tool-changer numbers.',
  // --- MIDI / music ---
  'PPQ (ticks/beat)': 'Pulses per quarter note - the MIDI file’s timing resolution, i.e. how many ticks make up one beat. Higher values allow finer timing.',
  'Tempo': 'The playback speed, in beats per minute (BPM).',
  'Time signature': 'How beats are grouped into bars, written as a fraction such as 4/4 or 3/4.',
  // --- Torrents ---
  'Piece size': 'The size of each fixed chunk a torrent splits its data into for transfer and verification.',
  'Pieces': 'The number of fixed-size chunks the torrent’s data is divided into; each is checked independently as it downloads.',
  'Tracker': 'A server that coordinates a torrent swarm by telling peers about one another.',
  'Trackers': 'Servers that coordinate a torrent swarm by telling peers about one another.',
  // --- CAD exchange (STEP / IGES) ---
  'Implementation level': 'A STEP/IGES conformance level indicating which subset of the standard the file uses.',
  'Originating system': 'The CAD application that originally created the exchange file.',
  'Sending system': 'The system that exported or transmitted the exchange file.',
  'Schema': 'The data schema (for example AP203 or AP214 for STEP) defining which entity types the file may contain.',
  'Schema version': 'The version of the data schema the file conforms to.',
  // --- Disk images ---
  'Disk GUID': 'A globally unique identifier stored on a GPT-partitioned disk to distinguish it from any other disk.',
  'Partitioning': 'The partition-table scheme dividing the disk - MBR (older) or GPT (modern).',
  'Partitions': 'The number of partitions (separate storage volumes) defined on the disk image.',
  // --- Logs ---
  'Log format': 'The detected structure of the log lines, such as Apache combined, JSON or syslog.',
  'Log levels (sample)': 'A sample of the severity levels seen in the log, such as INFO, WARN and ERROR.',
  'IPs (sample)': 'A sample of the IP addresses appearing in the log.',
  // --- Windows shortcut (.lnk) / OS links ---
  'Relative path': "The target's location written relative to the shortcut's own folder, so the link still resolves if the pair is moved together.",
  'Working directory': 'The folder the target program treats as its current directory when launched from this shortcut.',
  'Arguments': 'Command-line arguments passed to the target program each time the shortcut is run.',
  'Window': 'How the target opens when you run the shortcut - in a normal, maximised or minimised window.',
  'Icon location': 'The file the shortcut pulls its displayed icon from.',
  'Hotkey': 'A global keyboard shortcut assigned to launch this link.',
  // --- Certificates / keys / crypto ---
  'Issuer': 'The certificate authority that issued and signed this certificate, vouching for its subject.',
  'Valid from': 'The start of the certificate’s validity period; before this date it is not yet trusted.',
  'Valid to': 'The expiry date of the certificate; after this it is no longer trusted and software will warn.',
  'Serial': 'The serial number the issuing authority assigned to this certificate, unique within that issuer.',
  'Signature': 'The algorithm used to cryptographically sign the certificate or file, binding its contents to the signer.',
  'Key size': 'The length of the cryptographic key in bits. Larger keys are harder to break but slower; 2048-bit RSA or 256-bit elliptic-curve are typical.',
  'Key type': 'The cryptographic algorithm family of the key, such as RSA, ECDSA or Ed25519.',
  'Recovery ID': 'A small value stored alongside some signatures that lets the signer’s public key be recovered from the signature itself.',
};

// Build a <th> for a readout row. If `helpText` is given (passed explicitly via
// rowHelp, or looked up in LABEL_HELP by row()), the label gets the standard [?]
// info button + click-to-reveal tooltip - the same affordance everywhere, so the
// renderer tables and the proprietary-parser readouts stay consistent.
function helpTh(label, helpText) {
  const th = el('th', {});
  if (!helpText) { th.textContent = label; return th; }
  if (!helpTh._init) {
    helpTh._init = true;
    document.addEventListener('click', () => {
      document.querySelectorAll('.anr-tip.is-active').forEach(t => t.classList.remove('is-active'));
    });
  }
  th.appendChild(document.createTextNode(label + ' '));
  const btn = el('button', { type: 'button', class: 'anr-tip-btn', title: 'Info' }, '[?]');
  const tip = el('div', { class: 'anr-tip' }, helpText);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasActive = tip.classList.contains('is-active');
    document.querySelectorAll('.anr-tip.is-active').forEach(t => t.classList.remove('is-active'));
    if (!wasActive) tip.classList.add('is-active');
  });
  th.appendChild(btn);
  th.appendChild(tip);
  return th;
}

export function row(label, value) {
  return el('tr', {}, [
    helpTh(label, LABEL_HELP[label]),
    el('td', {}, value == null || value === '' ? '-' : String(value))
  ]);
}

// True when a read failure looks like an unavailable/cloud-only file rather than
// a corrupt/unsupported one. OneDrive/iCloud/etc. "online-only" placeholders
// throw NotReadableError/NotFoundError when their sync app can't hydrate them.
export function isUnreadableError(e) {
  if (!e) return false;
  const name = e.name || '';
  const msg = (e.message || '').toLowerCase();
  return name === 'NotReadableError' || name === 'NotFoundError' ||
    msg.includes('could not be read') ||
    msg.includes('a requested file or directory could not be found') ||
    (msg.includes('permission') && msg.includes('file'));
}

// Probe whether a File's bytes are actually readable. Returns null on success,
// or the thrown error on failure. Used to detect cloud-only placeholders before
// a renderer fails deep in its pipeline. Reads the head AND the last byte: a
// OneDrive/iCloud "online-only" file often serves a cached header (so a 1-byte
// head read passes) while the body/tail isn't on disk, so the tail read is what
// reliably trips. (Any successful read also triggers the sync app to hydrate the
// whole file, which is what a renderer would do anyway.)
export async function probeReadable(file) {
  if (!file || file.size === 0) return null;
  try {
    await file.slice(0, Math.min(file.size, 65536)).arrayBuffer();
    if (file.size > 65536) await file.slice(file.size - 1, file.size).arrayBuffer();
    return null;
  } catch (e) {
    return e;
  }
}

// A friendly "this file can't be read" card body, tailored to the cloud-only
// case (the overwhelmingly common cause of an otherwise-valid File failing).
export function cloudFileWarning(file) {
  const box = el('div', { class: 'anr-error anr-cloud-warning' });
  box.appendChild(el('p', { style: 'margin:0 0 10px; font-weight:600;' },
    'Couldn’t read “' + ((file && file.name) || 'this file') + '”.'));
  box.appendChild(el('p', { style: 'margin:0 0 10px;' },
    'It looks like a cloud-only file (OneDrive, iCloud Drive, Google Drive, Dropbox…) whose contents aren’t on this device yet, or whose sync app isn’t running. The name and size are known, but the actual bytes couldn’t be downloaded.'));
  const ul = el('ul', { style: 'margin:0; padding-left:18px;' }, [
    el('li', {}, 'Make sure OneDrive (or your sync app) is running and signed in.'),
    el('li', {}, 'In the file manager, right-click the file → “Always keep on this device”, wait for the download to finish, then try again.'),
  ]);
  box.appendChild(ul);
  return box;
}

// Standard inline error notice (styled by .anr-error). The canonical way for a
// renderer to report that a file couldn't be read or parsed.
export function errorCard(message) {
  return el('div', { class: 'anr-error' }, message);
}

// Monospace ASCII progress bar - the [////////        ] look used everywhere a
// loading bar appears. Two modes share the same glyphs so every loader reads the
// same way:
//   bar.set(frac)        determinate fill (0–1), left-to-right
//   bar.indeterminate()  a window of slashes that bounces left↔right, for work
//                        whose length isn't known up front
//   bar.stop()           halt the animation
// The indeterminate animation runs on rAF and stops itself once the element is
// detached from the DOM, so callers don't have to tear it down.
export function asciiBar(opts = {}) {
  if (typeof opts === 'number') opts = { width: opts };   // back-compat
  const fit = !!opts.fit;            // size to fill the parent (e.g. popup card)
  const SWEEP = 1900;                // ms for one left→right pass (indeterminate)
  let W = opts.width || 20;
  let win = Math.max(4, Math.round(W * 0.25));
  const bar = el('div', { class: 'anr-progress-bar' });
  let raf = null, seen = false, t0 = null;

  // fit:true → recompute the character count so the bar spans its container.
  // Measured lazily, once the bar is actually in the DOM (clientWidth is 0
  // before that). Uses the same font-size×0.6 monospace estimate as the app's
  // other progress bars.
  function measure() {
    if (!fit || !bar.parentElement) return;
    const ch = (parseFloat(getComputedStyle(bar).fontSize) || 13) * 0.6;
    // Measure the bar's own content box, not the parent's clientWidth - the
    // latter includes the container padding, which would over-count characters
    // and overflow the box, clipping the trailing "]".
    const avail = bar.clientWidth || bar.parentElement.clientWidth;
    const n = Math.floor(avail / ch) - 2; // minus brackets
    W = Math.max(10, Math.min(80, n));
    win = Math.max(4, Math.round(W * 0.25));
  }
  function paintRange(start, len) {
    start = Math.max(0, Math.min(W - len, start));
    bar.innerHTML = '[' + ' '.repeat(start) +
      '<span class="anr-bar-fill">' + '/'.repeat(len) + '</span>' +
      ' '.repeat(Math.max(0, W - len - start)) + ']';
  }
  bar.set = (frac) => {
    bar.stop();
    measure();
    const filled = Math.round(Math.max(0, Math.min(1, frac)) * W);
    bar.innerHTML = '[<span class="anr-bar-fill">' + '/'.repeat(filled) + '</span>' +
      ' '.repeat(Math.max(0, W - filled)) + ']';
  };
  bar.indeterminate = () => {
    if (raf) return;
    let measured = false;
    const loop = (ts) => {
      if (bar.isConnected) seen = true;
      else if (seen) { raf = null; return; }   // removed from DOM → self-stop
      if (!measured && bar.isConnected) { measure(); measured = true; }
      if (t0 == null) t0 = ts;
      const span = Math.max(1, W - win);
      const u = ((ts - t0) % (2 * SWEEP)) / SWEEP;   // 0..2 over a full cycle
      const tri = u <= 1 ? u : 2 - u;                // 0→1→0 triangle (bounce)
      paintRange(Math.round(tri * span), win);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  };
  bar.stop = () => { if (raf) { cancelAnimationFrame(raf); raf = null; } };
  bar.set(0);
  return bar;
}

// Small inline "working…" indicator with an indeterminate ASCII bar. Used to
// fill a card while a slower piece (e.g. a treemap for a huge folder) builds.
export function inlineLoader(text) {
  const bar = asciiBar();
  bar.indeterminate();
  return el('div', { class: 'anr-inline-loader' }, [
    el('span', { class: 'anr-inline-loader-label' }, text || 'Loading…'),
    bar
  ]);
}

export function rowHelp(label, value, helpText) {
  return el('tr', {}, [
    helpTh(label, helpText),
    el('td', {}, value == null || value === '' ? '-' : String(value))
  ]);
}

export function fmtBytes(n) {
  if (n == null) return '-';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(2) + ' MB';
  return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// A scrollable, wrapping <pre> for raw text payloads (hex dumps, headers, etc.).
// Shared by the lazy parser chunks so every readout block looks the same.
export function preBlock(text, cls) {
  return el('pre', {
    class: cls || 'anr-code',
    style: 'max-height:360px;overflow:auto;font-size:12px;white-space:pre-wrap;word-break:break-word;margin:0;',
  }, text || '');
}

// Format a Date for display, tolerating non-Date / invalid values.
export const fmtDate = (d) => (d instanceof Date && !isNaN(d)) ? d.toLocaleString() : String(d);

// Read up to `n` bytes from a File starting at `off`. Returns a Uint8Array
// (empty when the offset is past EOF). Shared by the binary parser chunks.
export async function readSlice(file, off, n) {
  const end = Math.min(file.size, off + n);
  if (off >= file.size || end <= off) return new Uint8Array(0);
  return new Uint8Array(await file.slice(off, end).arrayBuffer());
}

// Wire a [?] info button to an inline dropdown panel (.anr-info-panel shown/hidden
// via .is-hidden). The button label flips between [?] (closed) and [-] (open). If
// the button sits inside a collapsed <details>, the first click also opens that
// section so the panel is actually visible. Use this for every dropdown-style [?]
// (the popup [?] in rowHelp is intentionally left as a plain tip).
export function wireInfoToggle(btn, panel) {
  const sync = () => { btn.textContent = panel.classList.contains('is-hidden') ? '[?]' : '[-]'; };
  sync();
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const det = btn.closest('details');
    if (det && !det.open) {
      det.open = true;
      panel.classList.remove('is-hidden');
    } else {
      panel.classList.toggle('is-hidden');
    }
    sync();
  });
}

export function h3help(title, helpHtml) {
  const h = el('h3', {});
  h.appendChild(document.createTextNode(title));
  const btn = el('button', { type: 'button', class: 'anr-info-btn', title: 'Info' }, '[?]');
  const panel = el('div', { class: 'anr-info-panel is-hidden', html: helpHtml });
  wireInfoToggle(btn, panel);
  h.appendChild(btn);
  return [h, panel];
}

export function fileExt(name) {
  const m = (name || '').match(/\.([^.]+)$/);
  return m ? m[1].toLowerCase() : '';
}

export async function sha256Hex(file) {
  if (!crypto.subtle) return null;
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function sha256Row(file) {
  const hashRow = rowHelp('SHA-256', '',
    "SHA-256 is a cryptographic fingerprint of the file’s exact bytes. Identical files share the same hash; changing even a single byte changes it completely - useful for verifying a file hasn't been altered or matches a known copy.");
  const td = hashRow.querySelector('td');
  const bar = asciiBar();
  bar.indeterminate();
  td.textContent = '';
  td.appendChild(bar);
  sha256Hex(file).then(h => {
    bar.stop();
    td.textContent = h || 'unavailable';
    td.style.wordBreak = 'break-all';
  });
  return hashRow;
}

// Standard "Integrity" card: a heading + readout table whose last row is the
// (async) SHA-256. Pass extraRows as [[label, value], …] to prepend rows.
export function integrityCard(file, extraRows = []) {
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Integrity'));
  const tbl = el('table', { class: 'anr-readout' });
  for (const [label, value] of extraRows) tbl.appendChild(row(label, value));
  tbl.appendChild(sha256Row(file));
  card.appendChild(tbl);
  return card;
}

// Build a collapsible directory tree from a nested object. Directories are
// rendered as <details>/<summary> nodes (closed by default, children rendered
// lazily on first expand); files as plain rows. Shared by folder.js and
// archive.js. Callers supply:
//   isDir(value)   - true if value is a directory node (a sub-object)
//   fileSize(value) - byte size for a file node (number)
export function buildFileTree(obj, opts) {
  const isDir = opts.isDir;
  const fileSize = opts.fileSize;

  function countAndSize(node) {
    let files = 0, bytes = 0;
    for (const v of Object.values(node)) {
      if (isDir(v)) { const r = countAndSize(v); files += r.files; bytes += r.bytes; }
      else { files++; bytes += fileSize(v) || 0; }
    }
    return { files, bytes };
  }

  function sortedKeys(node) {
    return Object.keys(node).sort((a, b) => {
      const ad = isDir(node[a]), bd = isDir(node[b]);
      if (ad !== bd) return ad ? -1 : 1;
      return a.localeCompare(b);
    });
  }

  function renderNode(node) {
    const frag = document.createDocumentFragment();
    for (const key of sortedKeys(node)) {
      const val = node[key];
      if (isDir(val)) {
        const { files, bytes } = countAndSize(val);
        const details = el('details', { class: 'anr-tree-dir' });
        const summary = el('summary', { class: 'anr-tree-summary' }, [
          el('span', { class: 'anr-tree-icon' }, '▸'),
          el('span', { class: 'anr-tree-name' }, key),
          el('span', { class: 'anr-tree-meta' }, files + (files === 1 ? ' file · ' : ' files · ') + fmtBytes(bytes))
        ]);
        details.appendChild(summary);
        let filled = false;
        details.addEventListener('toggle', () => {
          if (details.open && !filled) {
            filled = true;
            const kids = el('div', { class: 'anr-tree-children' });
            kids.appendChild(renderNode(val));
            details.appendChild(kids);
          }
        });
        frag.appendChild(details);
      } else {
        const cls = opts.onFileClick ? 'anr-tree-file is-clickable' : 'anr-tree-file';
        const lead = el('span', { class: 'anr-tree-lead' });
        if (opts.fileAccent) {
          const color = opts.fileAccent(key, val);
          if (color) lead.appendChild(el('span', { class: 'anr-tree-dot', style: 'background:' + color }));
        }
        const fileDiv = el('div', { class: cls }, [
          lead,
          el('span', { class: 'anr-tree-name' }, key),
          el('span', { class: 'anr-tree-meta' }, fmtBytes(fileSize(val) || 0))
        ]);
        if (opts.copyPath) {
          const path = opts.copyPath(key, val);
          if (path) {
            const copyBtn = el('button', { class: 'anr-tree-copy', type: 'button', title: 'Copy path' }, '⧉');
            copyBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              const done = () => { copyBtn.textContent = '✓'; setTimeout(() => { copyBtn.textContent = '⧉'; }, 1000); };
              if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(path).then(done).catch(() => {});
              } else {
                const ta = document.createElement('textarea');
                ta.value = path; document.body.appendChild(ta); ta.select();
                try { document.execCommand('copy'); done(); } catch (_) {}
                ta.remove();
              }
            });
            fileDiv.appendChild(copyBtn);
          }
        }
        if (opts.onFileClick) {
          fileDiv.addEventListener('click', () => opts.onFileClick(key, val));
        }
        frag.appendChild(fileDiv);
      }
    }
    return frag;
  }

  const rootTotals = countAndSize(obj);
  const wrap = el('div', { class: 'anr-tree' });
  wrap.appendChild(renderNode(obj));
  wrap._totals = rootTotals;
  return wrap;
}

// Lazy-load an external stylesheet/script by injecting a <link>/<script> tag,
// resolving once it's ready (and immediately if already present). Used to pull
// in heavy optional libraries (Leaflet, Tesseract, heic2any, jsQR) on demand.
export function loadCss(href) {
  return new Promise((resolve) => {
    if (document.querySelector(`link[href="${href}"]`)) return resolve();
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href;
    l.onload = resolve; l.onerror = resolve;
    document.head.appendChild(l);
  });
}
export function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

// Snap a measured frame rate to the nearest standard rate when it's within
// 0.5 fps (so 29.96 reads as 29.97), otherwise keep two decimals. Shared by the
// video module and its container parser.
export function roundFps(raw) {
  const standard = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120, 240];
  let closest = raw, minDiff = Infinity;
  for (const s of standard) {
    const d = Math.abs(raw - s);
    if (d < minDiff) { minDiff = d; closest = s; }
  }
  return minDiff < 0.5 ? closest : Math.round(raw * 100) / 100;
}
