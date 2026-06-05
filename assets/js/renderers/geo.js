/* Analyser - geospatial files (GPX / KML / GeoJSON)
   Parses tracks / placemarks / features, computes counts, distance, bounds and
   time span, and plots the geometry on a Leaflet/OpenStreetMap map (lazy-loaded,
   same as the photo GPS map). */

import { el, row, rowHelp, h3help, errorCard, fmtBytes, loadCss, loadScript } from '../core/util.js';

const LEAFLET_CSS = 'assets/vendor/leaflet/leaflet.css';
const LEAFLET_JS  = 'assets/vendor/leaflet/leaflet.js';

function haversine(a, b) {                 // a,b = [lat, lon]
  const R = 6371000, toRad = (x) => x * Math.PI / 180;
  const dLat = toRad(b[0] - a[0]), dLon = toRad(b[1] - a[1]);
  const la1 = toRad(a[0]), la2 = toRad(b[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function fmtDist(m) {
  if (!m) return '—';
  return m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m';
}
function fmtDuration(sec) {
  if (!isFinite(sec) || sec <= 0) return '—';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60);
  return h > 0 ? h + 'h ' + m + 'm' : (m > 0 ? m + 'm ' + s + 's' : s + 's');
}

// Walk all per-point track detail and derive distance-along, elevation profile
// samples, ascent/descent (noise-thresholded), moving time and sensor stats.
function trackStats(tracks) {
  const ELE_THRESHOLD = 2;   // metres: ignore ele deltas below this (GPS noise)
  const PAUSE_GAP = 60;      // seconds: gaps longer than this are "stopped" time
  let ascent = 0, descent = 0, refEle = null;
  let totalDist = 0, movingTime = 0, movingDist = 0, hasTime = false;
  const profile = [];        // { dist (m), ele }
  const hr = [], cad = [], temp = [];
  for (const pts of tracks) {
    let prev = null;
    for (const p of pts) {
      if (prev) {
        const d = haversine([prev.lat, prev.lon], [p.lat, p.lon]);
        totalDist += d;
        if (isFinite(prev.time) && isFinite(p.time)) {
          hasTime = true;
          const dt = (p.time - prev.time) / 1000;
          if (dt > 0 && dt <= PAUSE_GAP) { movingTime += dt; movingDist += d; }
        }
      }
      if (isFinite(p.ele)) {
        if (refEle == null) refEle = p.ele;
        const delta = p.ele - refEle;
        if (delta >= ELE_THRESHOLD) { ascent += delta; refEle = p.ele; }
        else if (delta <= -ELE_THRESHOLD) { descent += -delta; refEle = p.ele; }
        profile.push({ dist: totalDist, ele: p.ele });
      }
      if (isFinite(p.hr)) hr.push(p.hr);
      if (isFinite(p.cad)) cad.push(p.cad);
      if (isFinite(p.temp)) temp.push(p.temp);
      prev = p;
    }
  }
  const agg = (arr) => arr.length ? { avg: arr.reduce((a, b) => a + b, 0) / arr.length, max: Math.max(...arr) } : null;
  return { ascent, descent, profile, hasTime, movingTime, movingDist, totalDist,
           hr: agg(hr), cad: agg(cad), temp: agg(temp) };
}

// Plain 2D-canvas line chart of elevation vs distance. No library.
function elevationProfileCanvas(profile) {
  const W = 640, H = 180, padL = 44, padR = 12, padT = 12, padB = 24;
  const cv = el('canvas', { class: 'anr-geo-elev', width: String(W), height: String(H) });
  cv.style.width = '100%'; cv.style.height = 'auto'; cv.style.maxWidth = W + 'px';
  const ctx = cv.getContext('2d');
  const eles = profile.map((p) => p.ele);
  let minE = Math.min(...eles), maxE = Math.max(...eles);
  if (minE === maxE) { minE -= 1; maxE += 1; }
  const maxD = profile[profile.length - 1].dist || 1;
  const x = (d) => padL + (d / maxD) * (W - padL - padR);
  const y = (e) => padT + (1 - (e - minE) / (maxE - minE)) * (H - padT - padB);
  // axes
  ctx.strokeStyle = '#c9d2da'; ctx.lineWidth = 1; ctx.beginPath();
  ctx.moveTo(padL, padT); ctx.lineTo(padL, H - padB); ctx.lineTo(W - padR, H - padB); ctx.stroke();
  // filled area under the line
  ctx.beginPath(); ctx.moveTo(x(profile[0].dist), y(profile[0].ele));
  for (const p of profile) ctx.lineTo(x(p.dist), y(p.ele));
  ctx.lineTo(x(profile[profile.length - 1].dist), H - padB); ctx.lineTo(x(profile[0].dist), H - padB);
  ctx.closePath(); ctx.fillStyle = 'rgba(68,95,116,0.15)'; ctx.fill();
  // line
  ctx.beginPath(); ctx.moveTo(x(profile[0].dist), y(profile[0].ele));
  for (const p of profile) ctx.lineTo(x(p.dist), y(p.ele));
  ctx.strokeStyle = '#445f74'; ctx.lineWidth = 1.5; ctx.stroke();
  // labels
  ctx.fillStyle = '#6b7682'; ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.fillText(Math.round(maxE) + ' m', padL - 4, y(maxE));
  ctx.fillText(Math.round(minE) + ' m', padL - 4, y(minE));
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('0', x(0), H - padB + 4);
  ctx.fillText(fmtDist(maxD), x(maxD), H - padB + 4);
  return cv;
}

// Accumulates geometry into a common shape used for stats + the map.
// `tracks` keeps per-point detail (lat/lon/ele/time/hr/cad/temp) for the lines
// that carry it (GPX track segments / routes), used for the elevation profile,
// ascent/descent and moving-time stats. `features` holds GeoJSON properties.
function makeGeo() {
  return { lines: [], markers: [], pointCount: 0, eleMin: Infinity, eleMax: -Infinity,
           timeStart: null, timeEnd: null, counts: {}, tracks: [], features: [] };
}
function bump(g, type) { g.counts[type] = (g.counts[type] || 0) + 1; }
function ele(g, v) { if (isFinite(v)) { g.eleMin = Math.min(g.eleMin, v); g.eleMax = Math.max(g.eleMax, v); } }
function tstamp(g, t) { const ms = Date.parse(t); if (!isNaN(ms)) { g.timeStart = g.timeStart == null ? ms : Math.min(g.timeStart, ms); g.timeEnd = g.timeEnd == null ? ms : Math.max(g.timeEnd, ms); } }

function parseGpx(xml) {
  const g = makeGeo();
  const num = (n, a) => parseFloat(n.getAttribute(a));
  // Garmin TrackPointExtension fields live under <extensions> with namespaced
  // tags like <gpxtpx:hr>; match by local name so we don't depend on the prefix.
  const extVal = (pt, local) => {
    const ext = pt.querySelector('extensions'); if (!ext) return NaN;
    for (const n of ext.querySelectorAll('*')) {
      const ln = (n.localName || n.tagName || '').toLowerCase();
      if (ln === local) { const v = parseFloat(n.textContent); if (isFinite(v)) return v; }
    }
    return NaN;
  };
  const segPts = (nodes) => {
    const line = [];                 // [[lat,lon],...] for the map
    const detail = [];               // {lat,lon,ele,time,hr,cad,temp} for stats
    for (const pt of nodes) {
      const lat = num(pt, 'lat'), lon = num(pt, 'lon');
      if (!isFinite(lat) || !isFinite(lon)) continue;
      line.push([lat, lon]); g.pointCount++;
      const eNode = pt.querySelector('ele'); const eVal = eNode ? parseFloat(eNode.textContent) : NaN;
      if (eNode) ele(g, eVal);
      const tNode = pt.querySelector('time'); const tMs = tNode ? Date.parse(tNode.textContent) : NaN;
      if (tNode) tstamp(g, tNode.textContent);
      detail.push({ lat, lon, ele: eVal, time: isNaN(tMs) ? NaN : tMs,
        hr: extVal(pt, 'hr'), cad: extVal(pt, 'cad'), temp: extVal(pt, 'atemp') });
    }
    if (detail.length) g.tracks.push(detail);
    return line;
  };
  xml.querySelectorAll('trkseg').forEach((seg) => { const l = segPts(seg.querySelectorAll('trkpt')); if (l.length) { g.lines.push(l); bump(g, 'track segments'); } });
  xml.querySelectorAll('rte').forEach((r) => { const l = segPts(r.querySelectorAll('rtept')); if (l.length) { g.lines.push(l); bump(g, 'routes'); } });
  xml.querySelectorAll('wpt').forEach((w) => {
    const lat = num(w, 'lat'), lon = num(w, 'lon');
    if (!isFinite(lat) || !isFinite(lon)) return;
    const nm = w.querySelector('name'); g.markers.push({ lat, lon, name: nm ? nm.textContent.trim() : '' });
    g.pointCount++; bump(g, 'waypoints');
  });
  return g;
}

function parseCoords(text) {        // KML "lon,lat,alt lon,lat,alt" -> [[lat,lon],...]
  const out = [];
  for (const tok of text.trim().split(/\s+/)) {
    const c = tok.split(',');
    const lon = parseFloat(c[0]), lat = parseFloat(c[1]);
    if (isFinite(lat) && isFinite(lon)) out.push([lat, lon]);
  }
  return out;
}
// Pull altitude values (3rd coordinate) out of a KML coordinate string, if any.
function coordAlts(text) {
  const out = [];
  for (const tok of text.trim().split(/\s+/)) {
    const c = tok.split(',');
    const alt = parseFloat(c[2]);
    if (isFinite(alt)) out.push(alt);
  }
  return out;
}
// KML <ExtendedData> -> { key: value } from either <Data name><value> or
// <SimpleData name> pairs. Returns null when there's nothing useful.
function parseExtendedData(pm) {
  const ed = pm.querySelector('ExtendedData'); if (!ed) return null;
  const out = {};
  ed.querySelectorAll('Data').forEach((d) => {
    const k = d.getAttribute('name'); const v = d.querySelector('value');
    if (k && v) out[k] = v.textContent.trim();
  });
  ed.querySelectorAll('SimpleData').forEach((d) => {
    const k = d.getAttribute('name'); if (k) out[k] = d.textContent.trim();
  });
  return Object.keys(out).length ? out : null;
}
function parseKml(xml) {
  const g = makeGeo();
  xml.querySelectorAll('Placemark').forEach((pm) => {
    const nameEl = pm.querySelector('name');
    const name = nameEl ? nameEl.textContent.trim() : '';
    const extended = parseExtendedData(pm);
    if (extended) g.features.push({ name, props: extended });
    pm.querySelectorAll('coordinates').forEach((c) => coordAlts(c.textContent).forEach((a) => ele(g, a)));
    pm.querySelectorAll('Point coordinates').forEach((c) => {
      const pts = parseCoords(c.textContent);
      if (pts.length) { g.markers.push({ lat: pts[0][0], lon: pts[0][1], name }); g.pointCount++; bump(g, 'points'); }
    });
    pm.querySelectorAll('LineString coordinates').forEach((c) => {
      const pts = parseCoords(c.textContent);
      if (pts.length) { g.lines.push(pts); g.pointCount += pts.length; bump(g, 'lines'); }
    });
    pm.querySelectorAll('Polygon coordinates').forEach((c) => {
      const pts = parseCoords(c.textContent);
      if (pts.length) { g.lines.push(pts); g.pointCount += pts.length; bump(g, 'polygons'); }
    });
  });
  return g;
}

function parseGeoJson(text) {
  const g = makeGeo();
  const json = JSON.parse(text);
  const features = json.type === 'FeatureCollection' ? (json.features || [])
    : json.type === 'Feature' ? [json] : json.geometry ? [json] : [{ geometry: json }];
  const ll = (c) => [c[1], c[0]];        // GeoJSON is [lon, lat]
  // Best-effort display name from common property keys.
  const featName = (props) => {
    if (!props) return '';
    for (const k of ['name', 'Name', 'NAME', 'title', 'Title', 'id', 'ID']) {
      if (props[k] != null && props[k] !== '') return String(props[k]);
    }
    return '';
  };
  const walk = (geom, name) => {
    if (!geom) return;
    const c = geom.coordinates;
    switch (geom.type) {
      case 'Point': { const p = ll(c); g.markers.push({ lat: p[0], lon: p[1], name }); g.pointCount++; bump(g, 'points'); break; }
      case 'MultiPoint': c.forEach((p) => { const x = ll(p); g.markers.push({ lat: x[0], lon: x[1], name }); g.pointCount++; }); bump(g, 'points'); break;
      case 'LineString': { const line = c.map(ll); g.lines.push(line); g.pointCount += line.length; bump(g, 'lines'); break; }
      case 'MultiLineString': c.forEach((l) => { const line = l.map(ll); g.lines.push(line); g.pointCount += line.length; }); bump(g, 'lines'); break;
      case 'Polygon': c.forEach((ring) => { const line = ring.map(ll); g.lines.push(line); g.pointCount += line.length; }); bump(g, 'polygons'); break;
      case 'MultiPolygon': c.forEach((poly) => poly.forEach((ring) => { const line = ring.map(ll); g.lines.push(line); g.pointCount += line.length; })); bump(g, 'polygons'); break;
      case 'GeometryCollection': (geom.geometries || []).forEach((gg) => walk(gg, name)); break;
    }
  };
  features.forEach((f) => {
    const props = f && f.properties && typeof f.properties === 'object' ? f.properties : null;
    const name = featName(props);
    if (props) g.features.push({ name, props });
    walk(f.geometry, name);
  });
  return g;
}

export async function renderGeo(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';

  let text = '';
  try { text = await file.text(); }
  catch (e) { resultsEl.appendChild(errorCard('Could not read this file.')); return; }

  const ext = (file.name.split('.').pop() || '').toLowerCase();
  let format, g;
  try {
    if (ext === 'geojson' || (/^\s*[{[]/.test(text) && ext !== 'gpx' && ext !== 'kml')) {
      format = 'GeoJSON'; g = parseGeoJson(text);
    } else {
      const xml = new DOMParser().parseFromString(text, 'application/xml');
      if (xml.querySelector('parsererror')) throw new Error('bad xml');
      if (ext === 'kml' || xml.querySelector('kml, Placemark')) { format = 'KML'; g = parseKml(xml); }
      else { format = 'GPX'; g = parseGpx(xml); }
    }
  } catch (e) {
    resultsEl.appendChild(errorCard('Could not parse this ' + (ext.toUpperCase() || 'geo') + ' file.'));
    return;
  }

  // Distance over all polylines.
  let distance = 0;
  for (const line of g.lines) for (let i = 1; i < line.length; i++) distance += haversine(line[i - 1], line[i]);

  // Bounds across everything.
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  const see = (lat, lon) => { minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat); minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon); };
  g.lines.forEach((l) => l.forEach((p) => see(p[0], p[1])));
  g.markers.forEach((m) => see(m.lat, m.lon));
  const hasGeo = isFinite(minLat);

  // ---- Info card ----
  const [h, help] = h3help(format + ' map data', 'Parses the geometry and plots it on an OpenStreetMap map. Distance is the great-circle length along all lines/tracks.');
  const infoCard = el('div', { class: 'anr-card' });
  infoCard.appendChild(h); infoCard.appendChild(help);
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('File', file.name));
  tbl.appendChild(row('Size', fmtBytes(file.size)));
  tbl.appendChild(row('Format', format));
  for (const [k, v] of Object.entries(g.counts)) tbl.appendChild(row(k.charAt(0).toUpperCase() + k.slice(1), String(v)));
  tbl.appendChild(row('Total points', g.pointCount.toLocaleString()));
  if (distance > 0) tbl.appendChild(row('Distance', fmtDist(distance)));
  if (isFinite(g.eleMin)) tbl.appendChild(row('Elevation', Math.round(g.eleMin) + ' – ' + Math.round(g.eleMax) + ' m'));
  if (g.timeStart != null) {
    tbl.appendChild(row('Start time', new Date(g.timeStart).toISOString().replace('T', ' ').slice(0, 19)));
    const span = (g.timeEnd - g.timeStart) / 1000;
    if (span > 0) tbl.appendChild(row('Duration', span >= 3600 ? (span / 3600).toFixed(1) + ' h' : Math.round(span / 60) + ' min'));
  }

  // ---- Track stats (ascent/descent, moving time/pace, sensors) ----
  let ts = null;
  try {
    if (g.tracks && g.tracks.length) {
      ts = trackStats(g.tracks);
      if (ts.ascent >= 1 || ts.descent >= 1) {
        tbl.appendChild(rowHelp('Total ascent', Math.round(ts.ascent) + ' m',
          'Sum of all uphill elevation gains along the track (changes under 2 m are ignored as GPS noise).'));
        tbl.appendChild(row('Total descent', Math.round(ts.descent) + ' m'));
      }
      if (ts.hasTime && ts.movingTime > 0) {
        tbl.appendChild(rowHelp('Moving time', fmtDuration(ts.movingTime),
          'Elapsed time excluding pauses (gaps longer than 60 s between points).'));
        if (ts.movingDist > 0) {
          const speed = (ts.movingDist / 1000) / (ts.movingTime / 3600);   // km/h
          tbl.appendChild(row('Average speed', speed.toFixed(1) + ' km/h'));
          if (speed > 0) {
            const paceSec = (ts.movingTime / 60) / (ts.movingDist / 1000);   // min/km
            const pm = Math.floor(paceSec), psec = Math.round((paceSec - pm) * 60);
            tbl.appendChild(row('Average pace', pm + ':' + String(psec).padStart(2, '0') + ' /km'));
          }
        }
      }
      if (ts.hr) tbl.appendChild(row('Heart rate', Math.round(ts.hr.avg) + ' avg, ' + Math.round(ts.hr.max) + ' max bpm'));
      if (ts.cad) tbl.appendChild(row('Cadence', Math.round(ts.cad.avg) + ' avg, ' + Math.round(ts.cad.max) + ' max'));
      if (ts.temp) tbl.appendChild(row('Temperature', ts.temp.avg.toFixed(1) + ' avg, ' + ts.temp.max.toFixed(1) + ' max °C'));
    }
  } catch (e) { ts = null; }
  if (hasGeo) {
    tbl.appendChild(rowHelp('Bounds', minLat.toFixed(4) + ', ' + minLon.toFixed(4) + '  →  ' + maxLat.toFixed(4) + ', ' + maxLon.toFixed(4),
      'Bounding box of all coordinates (SW corner → NE corner).'));
  }
  infoCard.appendChild(tbl);
  resultsEl.appendChild(infoCard);

  // ---- Elevation profile card ----
  try {
    if (ts && ts.profile && ts.profile.length > 1) {
      const elevCard = el('div', { class: 'anr-card' });
      const [eh, ehelp] = h3help('Elevation profile', 'Elevation (Y) against distance travelled (X), drawn on a plain canvas. Ascent/descent totals are in the summary above.');
      elevCard.appendChild(eh); elevCard.appendChild(ehelp);
      elevCard.appendChild(elevationProfileCanvas(ts.profile));
      resultsEl.appendChild(elevCard);
    }
  } catch (e) { /* never let the chart break parsing/map */ }

  // ---- GeoJSON / KML properties card ----
  try {
    if (g.features && g.features.length) {
      const propCard = el('div', { class: 'anr-card' });
      const [ph, phelp] = h3help('Properties', 'Feature attributes carried in the file (GeoJSON feature.properties / KML ExtendedData). Small sets list each feature; larger sets show the union of keys with how often each appears.');
      propCard.appendChild(ph); propCard.appendChild(phelp);
      const ptbl = el('table', { class: 'anr-readout' });
      if (g.features.length <= 20) {
        // Name each feature; fall back to a compact key=value preview of props.
        g.features.forEach((f, i) => {
          const keys = Object.keys(f.props || {});
          const preview = keys.slice(0, 4).map((k) => k + '=' + String(f.props[k])).join(', ');
          ptbl.appendChild(row(f.name || ('Feature ' + (i + 1)), keys.length ? preview + (keys.length > 4 ? ' …' : '') : '—'));
        });
      } else {
        // Union of keys + count of features carrying each.
        const counts = {};
        g.features.forEach((f) => Object.keys(f.props || {}).forEach((k) => { counts[k] = (counts[k] || 0) + 1; }));
        ptbl.appendChild(row('Features', g.features.length.toLocaleString()));
        Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 40)
          .forEach(([k, v]) => ptbl.appendChild(row(k, v.toLocaleString() + ' features')));
      }
      propCard.appendChild(ptbl);
      resultsEl.appendChild(propCard);
    }
  } catch (e) { /* properties are a bonus; ignore failures */ }

  if (!hasGeo) {
    resultsEl.appendChild(errorCard('No coordinates found to map.'));
    return;
  }

  // ---- Map ----
  const mapCard = el('div', { class: 'anr-card' });
  mapCard.appendChild(el('h3', {}, 'Map'));
  const mapEl = el('div', { class: 'anr-geo-map' });
  mapEl.appendChild(el('p', { class: 'anr-hint' }, 'Loading map…'));
  mapCard.appendChild(mapEl);
  resultsEl.appendChild(mapCard);

  try { await loadCss(LEAFLET_CSS); await loadScript(LEAFLET_JS); }
  catch (e) { mapEl.innerHTML = ''; mapEl.appendChild(errorCard('Map library failed to load. Offline?')); return; }

  mapEl.innerHTML = '';
  const map = L.map(mapEl);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
  for (const line of g.lines) if (line.length > 1) L.polyline(line, { color: '#445f74', weight: 3 }).addTo(map);
  // Cap markers so a huge waypoint set doesn't lock up the page.
  for (const m of g.markers.slice(0, 500)) L.marker([m.lat, m.lon]).addTo(map).bindPopup(m.name || (m.lat.toFixed(5) + ', ' + m.lon.toFixed(5)));
  map.fitBounds([[minLat, minLon], [maxLat, maxLon]], { padding: [20, 20], maxZoom: 16 });
  setTimeout(() => map.invalidateSize(), 60);
}
