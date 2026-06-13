/* Analyser - 2D vector diagram viewers (.drawio / .dxf)
   ============================================================================
   Two vector formats that deserve a real preview, not just identification:

     - draw.io / diagrams.net (.drawio) - XML describing an mxGraph. Each
       <diagram> holds an <mxGraphModel> either inline or deflate+base64
       compressed. We decode it and render the cells (boxes, ellipses, diamonds
       and the edges between them) to an SVG preview.

     - AutoCAD DXF (.dxf, ASCII) - a group-code list of drawing entities. We
       parse the ENTITIES section (LINE, CIRCLE, ARC, LWPOLYLINE, POLYLINE,
       TEXT) and draw them to SVG, flipping Y so the drawing is the right way up.

   Both degrade to a clear message if the file can't be drawn (e.g. binary DXF
   or an empty model), and always show the raw counts.
   ============================================================================ */

import { el, row, buildReadout, fmtBytes, rowHelp, integrityCard, errorCard } from '../core/util.js';
import { inflate } from '../core/binutil.js';

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function parseXml(text) { const d = new DOMParser().parseFromString(text, 'application/xml'); return d.querySelector('parsererror') ? null : d; }

// Wrap an SVG markup string in a scrollable, pannable preview stage.
function svgCard(title, svgMarkup) {
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, title));
  const stage = el('div', { class: 'anr-diagram-stage' });
  stage.innerHTML = svgMarkup;
  card.appendChild(stage);
  return card;
}

// ---------- draw.io ----------
async function decodeDiagram(node) {
  // A <diagram> may contain an inline <mxGraphModel> child, or compressed text.
  const inner = node.querySelector('mxGraphModel');
  if (inner) return inner;
  const raw = (node.textContent || '').trim();
  if (!raw) return null;
  if (/^</.test(raw)) { const d = parseXml(raw); return d && d.querySelector('mxGraphModel'); }
  // Compressed: base64 -> raw-deflate -> URL-encoded XML.
  try {
    const bin = atob(raw);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const out = await inflate(bytes, 'deflate-raw');
    if (!out) return null;
    const xml = decodeURIComponent(new TextDecoder().decode(out));
    const d = parseXml(xml);
    return d && d.querySelector('mxGraphModel');
  } catch (_) { return null; }
}

function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }
function labelOf(cell) {
  let v = cell.getAttribute('value') || '';
  if (!v) return '';
  // Cells with html=1 carry HTML; strip to text.
  if (/[<&]/.test(v)) { const tmp = document.createElement('div'); tmp.innerHTML = v; v = tmp.textContent || ''; }
  return v.replace(/\s+/g, ' ').trim();
}

function renderMxModel(model) {
  const cells = Array.from(model.getElementsByTagName('mxCell'));
  const verts = [];
  const edges = [];
  const byId = {};
  for (const c of cells) {
    const geo = c.getElementsByTagName('mxGeometry')[0];
    if (c.getAttribute('vertex') === '1' && geo && geo.getAttribute('width')) {
      const v = { id: c.getAttribute('id'), x: num(geo.getAttribute('x')), y: num(geo.getAttribute('y')),
        w: num(geo.getAttribute('width')), h: num(geo.getAttribute('height')),
        style: c.getAttribute('style') || '', label: labelOf(c) };
      v.cx = v.x + v.w / 2; v.cy = v.y + v.h / 2;
      byId[v.id] = v; verts.push(v);
    } else if (c.getAttribute('edge') === '1') {
      edges.push({ source: c.getAttribute('source'), target: c.getAttribute('target'), label: labelOf(c) });
    }
  }
  if (!verts.length) return { svg: null, verts: 0, edges: edges.length };

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const v of verts) { minX = Math.min(minX, v.x); minY = Math.min(minY, v.y); maxX = Math.max(maxX, v.x + v.w); maxY = Math.max(maxY, v.y + v.h); }
  const pad = 20;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const W = Math.max(1, maxX - minX), H = Math.max(1, maxY - minY);

  let body = '';
  // Edges first (under the boxes).
  for (const e of edges) {
    const s = byId[e.source], t = byId[e.target];
    if (!s || !t) continue;
    body += '<line x1="' + s.cx + '" y1="' + s.cy + '" x2="' + t.cx + '" y2="' + t.cy + '" class="anr-dg-edge"/>';
    if (e.label) body += '<text x="' + ((s.cx + t.cx) / 2) + '" y="' + ((s.cy + t.cy) / 2) + '" class="anr-dg-elabel">' + esc(e.label) + '</text>';
  }
  for (const v of verts) {
    const st = v.style;
    if (/ellipse/.test(st)) body += '<ellipse cx="' + v.cx + '" cy="' + v.cy + '" rx="' + (v.w / 2) + '" ry="' + (v.h / 2) + '" class="anr-dg-shape"/>';
    else if (/rhombus/.test(st)) body += '<polygon points="' + [[v.cx, v.y], [v.x + v.w, v.cy], [v.cx, v.y + v.h], [v.x, v.cy]].map((p) => p.join(',')).join(' ') + '" class="anr-dg-shape"/>';
    else { const rnd = /rounded=1/.test(st) ? ' rx="8"' : ''; body += '<rect x="' + v.x + '" y="' + v.y + '" width="' + v.w + '" height="' + v.h + '"' + rnd + ' class="anr-dg-shape"/>'; }
    if (v.label) body += '<text x="' + v.cx + '" y="' + v.cy + '" class="anr-dg-label">' + esc(v.label.slice(0, 60)) + '</text>';
  }
  const svg = '<svg viewBox="' + minX + ' ' + minY + ' ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" class="anr-diagram-svg">' + body + '</svg>';
  return { svg, verts: verts.length, edges: edges.length };
}

export async function renderDrawio(file, container) {
  container.hidden = false;
  container.innerHTML = '';
  container.appendChild(el('div', { class: 'anr-info' }, 'Reading diagram...'));
  try {
    const text = await file.text();
    const doc = parseXml(text);
    const diagrams = doc ? Array.from(doc.getElementsByTagName('diagram')) : [];
    container.innerHTML = '';

    const info = el('div', { class: 'anr-card' });
    info.appendChild(el('h3', {}, 'draw.io diagram'));
    const host = (doc && doc.documentElement.getAttribute('host')) || '';
    info.appendChild(buildReadout([
      ['File', file.name],
      ['Size', fmtBytes(file.size)],
      ['Pages', String(diagrams.length || 1)],
      host && ['Editor', host],
    ]));
    container.appendChild(info);

    if (!diagrams.length) { container.appendChild(errorCard('No diagram pages found in this file.')); return; }

    let drewAny = false;
    for (let i = 0; i < diagrams.length; i++) {
      const name = diagrams[i].getAttribute('name') || ('Page ' + (i + 1));
      const model = await decodeDiagram(diagrams[i]);
      if (!model) { container.appendChild(el('div', { class: 'anr-card' }, [el('h3', {}, name), el('p', { class: 'anr-hint' }, 'Could not decode this page.')])); continue; }
      const r = renderMxModel(model);
      if (r.svg) {
        drewAny = true;
        const card = svgCard(name, r.svg);
        card.appendChild(el('p', { class: 'anr-hint' }, r.verts + ' shape' + (r.verts === 1 ? '' : 's') + ', ' + r.edges + ' connector' + (r.edges === 1 ? '' : 's')));
        container.appendChild(card);
      } else {
        container.appendChild(el('div', { class: 'anr-card' }, [el('h3', {}, name), el('p', { class: 'anr-hint' }, 'This page has no drawable shapes (' + r.edges + ' connectors).')]));
      }
    }
    if (!drewAny && diagrams.length) { /* messages already shown per page */ }

    if (file.size <= 500 * 1024 * 1024) container.appendChild(integrityCard(file));
  } catch (e) {
    container.innerHTML = '';
    container.appendChild(errorCard('Could not read diagram: ' + (e && e.message || 'unknown error')));
  }
}

// ---------- DXF (ASCII) ----------
// Parse the flat (code,value) pair stream into entity objects.
function parseDxfEntities(text) {
  const lines = text.split(/\r\n|\r|\n/);
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([parseInt(lines[i].trim(), 10), lines[i + 1]]);

  // Find the ENTITIES section.
  let start = -1, end = pairs.length;
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i][0] === 2 && (pairs[i][1] || '').trim() === 'ENTITIES') { start = i + 1; break; }
  }
  if (start < 0) return [];
  for (let i = start; i < pairs.length; i++) {
    if (pairs[i][0] === 0 && (pairs[i][1] || '').trim() === 'ENDSEC') { end = i; break; }
  }

  const entities = [];
  let cur = null;
  for (let i = start; i < end; i++) {
    const code = pairs[i][0], val = pairs[i][1];
    if (code === 0) {
      if (cur) entities.push(cur);
      cur = { type: (val || '').trim(), codes: {}, xs: [], ys: [] };
    } else if (cur) {
      const v = (val || '').trim();
      if (code === 10) cur.xs.push(parseFloat(v));
      else if (code === 20) cur.ys.push(parseFloat(v));
      else if (code === 11) { cur.x2 = parseFloat(v); }
      else if (code === 21) { cur.y2 = parseFloat(v); }
      else cur.codes[code] = v;
    }
  }
  if (cur) entities.push(cur);
  return entities;
}

function dxfToSvg(entities) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const see = (x, y) => { if (Number.isFinite(x) && Number.isFinite(y)) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); } };
  const counts = {};
  const draw = [];
  const Y = (y) => -y;   // flip so the drawing is upright

  for (const e of entities) {
    counts[e.type] = (counts[e.type] || 0) + 1;
    const t = e.type;
    if (t === 'LINE' && e.xs.length && e.x2 != null) {
      see(e.xs[0], e.ys[0]); see(e.x2, e.y2);
      draw.push('<line x1="' + e.xs[0] + '" y1="' + Y(e.ys[0]) + '" x2="' + e.x2 + '" y2="' + Y(e.y2) + '" class="anr-dxf-line"/>');
    } else if (t === 'CIRCLE' && e.xs.length) {
      const r = parseFloat(e.codes[40]) || 0; see(e.xs[0] - r, e.ys[0] - r); see(e.xs[0] + r, e.ys[0] + r);
      draw.push('<circle cx="' + e.xs[0] + '" cy="' + Y(e.ys[0]) + '" r="' + r + '" class="anr-dxf-shape"/>');
    } else if (t === 'ARC' && e.xs.length) {
      const r = parseFloat(e.codes[40]) || 0;
      const a0 = (parseFloat(e.codes[50]) || 0) * Math.PI / 180, a1 = (parseFloat(e.codes[51]) || 0) * Math.PI / 180;
      let sweep = a1 - a0; while (sweep <= 0) sweep += Math.PI * 2;
      const steps = Math.max(6, Math.ceil(sweep / (Math.PI / 18)));
      const pts = [];
      for (let s = 0; s <= steps; s++) { const a = a0 + sweep * (s / steps); const x = e.xs[0] + r * Math.cos(a), y = e.ys[0] + r * Math.sin(a); see(x, y); pts.push(x + ',' + Y(y)); }
      draw.push('<polyline points="' + pts.join(' ') + '" class="anr-dxf-line"/>');
    } else if ((t === 'LWPOLYLINE' || t === 'POLYLINE') && e.xs.length) {
      const pts = [];
      for (let k = 0; k < e.xs.length && k < e.ys.length; k++) { see(e.xs[k], e.ys[k]); pts.push(e.xs[k] + ',' + Y(e.ys[k])); }
      const closed = (parseInt(e.codes[70], 10) || 0) & 1;
      if (pts.length) draw.push('<' + (closed ? 'polygon' : 'polyline') + ' points="' + pts.join(' ') + '" class="anr-dxf-line"/>');
    } else if ((t === 'TEXT' || t === 'MTEXT') && e.xs.length) {
      const h = parseFloat(e.codes[40]) || 4; see(e.xs[0], e.ys[0]);
      const txt = (e.codes[1] || '').replace(/\\[A-Za-z][^;]*;?/g, '').slice(0, 80);
      if (txt) draw.push('<text x="' + e.xs[0] + '" y="' + Y(e.ys[0]) + '" font-size="' + h + '" class="anr-dxf-text">' + esc(txt) + '</text>');
    } else if (t === 'POINT' && e.xs.length) {
      see(e.xs[0], e.ys[0]);
      draw.push('<circle cx="' + e.xs[0] + '" cy="' + Y(e.ys[0]) + '" r="0.5" class="anr-dxf-shape"/>');
    }
  }
  if (!Number.isFinite(minX) || !draw.length) return { svg: null, counts };
  const pad = (maxX - minX + maxY - minY) * 0.02 + 1;
  const vbX = minX - pad, vbY = -maxY - pad, W = (maxX - minX) + pad * 2, H = (maxY - minY) + pad * 2;
  const svg = '<svg viewBox="' + vbX + ' ' + vbY + ' ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" class="anr-diagram-svg anr-dxf-svg">' + draw.join('') + '</svg>';
  return { svg, counts };
}

export async function renderDxf(file, container) {
  container.hidden = false;
  container.innerHTML = '';
  container.appendChild(el('div', { class: 'anr-info' }, 'Reading DXF drawing...'));
  try {
    const head = new Uint8Array(await file.slice(0, 22).arrayBuffer());
    const sentinel = String.fromCharCode(...head);
    container.innerHTML = '';
    const info = el('div', { class: 'anr-card' });
    info.appendChild(el('h3', {}, 'AutoCAD DXF drawing'));

    if (sentinel.startsWith('AutoCAD Binary DXF')) {
      info.appendChild(buildReadout([['File', file.name], ['Size', fmtBytes(file.size)], ['Variant', 'Binary DXF']]));
      container.appendChild(info);
      container.appendChild(el('div', { class: 'anr-card' }, [el('h3', {}, 'Preview'), el('p', { class: 'anr-hint' }, 'This is a binary DXF. Analyser previews ASCII DXF drawings; the binary variant is identified only.')]));
      if (file.size <= 500 * 1024 * 1024) container.appendChild(integrityCard(file));
      return;
    }

    const text = await file.text();
    const entities = parseDxfEntities(text);
    const verMatch = /\$ACADVER\s*\n\s*1\s*\n\s*(AC\d+)/.exec(text);
    const r = dxfToSvg(entities);

    const typeList = Object.entries(r.counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' x' + v).join(', ');
    info.appendChild(buildReadout([
      ['File', file.name],
      ['Size', fmtBytes(file.size)],
      verMatch && ['DXF version', verMatch[1]],
      ['Entities', entities.length.toLocaleString()],
      typeList && ['Types', typeList],
    ]));
    container.appendChild(info);

    if (r.svg) container.appendChild(svgCard('Drawing preview', r.svg));
    else container.appendChild(el('div', { class: 'anr-card' }, [el('h3', {}, 'Preview'), el('p', { class: 'anr-hint' }, entities.length ? 'No drawable geometry in the ENTITIES section (it may use blocks/inserts only).' : 'No entities found to draw.')]));

    if (file.size <= 500 * 1024 * 1024) container.appendChild(integrityCard(file));
  } catch (e) {
    container.innerHTML = '';
    container.appendChild(errorCard('Could not read DXF: ' + (e && e.message || 'unknown error')));
  }
}
