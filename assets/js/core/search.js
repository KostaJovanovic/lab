/* Analyser - in-page search
   Highlights matching cards/rows across all result panels, with synonym
   expansion, prev/next navigation, and a separate mobile overlay. */

export function initSearch() {
  const searchInput = document.getElementById('navSearch');
  const searchWrap = document.getElementById('navSearchWrap');
  const searchBtn = document.getElementById('navSearchBtn');
  if (searchInput && searchWrap && searchBtn) {
    const nav = searchWrap.closest('nav');
    let debounceTimer = null;
    let matches = [];
    let matchIdx = -1;
    const isMobile = () => window.innerWidth <= 700;

    // Desktop: arrows inside nav
    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'nav-search-arrow';
    prevBtn.innerHTML = '&#8249;';
    prevBtn.setAttribute('aria-label', 'Previous result');
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'nav-search-arrow';
    nextBtn.innerHTML = '&#8250;';
    nextBtn.setAttribute('aria-label', 'Next result');
    searchWrap.appendChild(prevBtn);
    searchWrap.appendChild(nextBtn);

    function sizeSearch() {
      const h = nav.clientHeight + 'px';
      searchBtn.style.width = h;
      prevBtn.style.width = h;
      nextBtn.style.width = h;
    }
    sizeSearch();
    window.addEventListener('resize', sizeSearch);

    // Mobile: overlay
    const mobileOverlay = document.createElement('div');
    mobileOverlay.className = 'search-overlay';
    mobileOverlay.innerHTML = '<div class="search-overlay-bar">'
      + '<button type="button" class="search-overlay-arrow search-overlay-prev" aria-label="Previous result">&#8249;</button>'
      + '<button type="button" class="search-overlay-arrow search-overlay-next" aria-label="Next result">&#8250;</button>'
      + '<input type="text" class="search-overlay-input" placeholder="Search" autocomplete="off" spellcheck="false">'
      + '<button type="button" class="search-overlay-close">&times;</button>'
      + '</div>';
    document.body.appendChild(mobileOverlay);
    const mobileInput = mobileOverlay.querySelector('.search-overlay-input');
    const mobilePrev = mobileOverlay.querySelector('.search-overlay-prev');
    const mobileNext = mobileOverlay.querySelector('.search-overlay-next');
    const mobileClose = mobileOverlay.querySelector('.search-overlay-close');

    function scrollToMatch(i) {
      if (!matches.length) return;
      const old = document.querySelector('.anr-search-current');
      if (old) old.classList.remove('anr-search-current');
      matchIdx = ((i % matches.length) + matches.length) % matches.length;
      const m = matches[matchIdx];
      // Reveal the match if it sits inside a collapsed <details> (e.g. a schema /
      // sample-data / source block) so the scroll lands on something visible.
      let p = m.parentElement;
      while (p) { if (p.tagName === 'DETAILS' && !p.open) p.open = true; p = p.parentElement; }
      m.classList.add('anr-search-current');
      m.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    const SYNONYMS = {
      // video
      fps: ['frame rate', 'framerate'],
      framerate: ['frame rate', 'fps'],
      'frame rate': ['fps', 'framerate'],
      res: ['resolution', 'dimensions'],
      resolution: ['dimensions', 'res'],
      br: ['bitrate'],
      bitrate: ['br', 'kbps', 'mbps'],
      kbps: ['bitrate'],
      mbps: ['bitrate'],
      codec: ['container', 'format'],
      container: ['codec', 'format'],
      format: ['container', 'codec', 'mime'],
      mime: ['format', 'type', 'container'],
      type: ['mime', 'format'],
      dur: ['duration', 'length'],
      duration: ['dur', 'length', 'time'],
      length: ['duration', 'dur'],
      scene: ['scene change', 'cut'],
      cut: ['scene change', 'scene'],
      // photo - exposure
      iso: ['sensitivity'],
      sensitivity: ['iso'],
      ev: ['exposure', 'exposure comp'],
      exposure: ['shutter', 'exposure time', 'exposure comp', 'exposure program', 'ev'],
      shutter: ['exposure time', 'shutter speed'],
      'shutterspeed': ['exposure time', 'shutter'],
      aperture: ['f/', 'fnumber', 'fstop', 'f-stop'],
      fstop: ['aperture', 'f/', 'fnumber'],
      'f-stop': ['aperture', 'fnumber'],
      focal: ['focal length'],
      fl: ['focal length'],
      'focallength': ['focal length', 'fl', '35mm'],
      '35mm': ['focal length', 'focal (35mm'],
      metering: ['metering mode'],
      flash: ['flash'],
      wb: ['white balance'],
      whitebalance: ['white balance'],
      'white balance': ['wb'],
      // photo - camera
      cam: ['camera', 'make', 'model'],
      camera: ['make', 'model', 'body'],
      make: ['camera', 'manufacturer', 'brand'],
      model: ['camera', 'body'],
      brand: ['make', 'manufacturer'],
      lens: ['lens make', 'lens model', 'lensmodel'],
      serial: ['body s/n', 'lens s/n', 'serial number'],
      sn: ['body s/n', 'lens s/n', 'serial number'],
      software: ['software', 'editor'],
      editor: ['software'],
      // photo - dimensions & analysis
      mp: ['megapixels'],
      megapixel: ['megapixels', 'mp'],
      megapixels: ['mp'],
      dim: ['dimensions', 'resolution', 'width', 'height'],
      dimensions: ['dim', 'resolution', 'width', 'height'],
      width: ['dimensions', 'resolution', 'stereo width'],
      height: ['dimensions', 'resolution'],
      ar: ['aspect ratio'],
      ratio: ['aspect ratio'],
      'aspectratio': ['aspect ratio', 'ar'],
      sharp: ['sharpness'],
      sharpness: ['sharp', 'focus'],
      focus: ['focus point', 'sharpness', 'sharp'],
      blur: ['sharpness', 'sharp'],
      orientation: ['rotation', 'orient'],
      rotation: ['orientation'],
      // photo - colour
      color: ['colour', 'average colour', 'palette', 'tonal'],
      colour: ['color', 'average colour', 'palette', 'tonal'],
      palette: ['dominant palette', 'color', 'colour'],
      tonal: ['tonal split', 'shadows', 'midtones', 'highlights'],
      shadows: ['tonal split', 'tonal'],
      midtones: ['tonal split', 'tonal'],
      highlights: ['tonal split', 'tonal'],
      colorspace: ['colour space', 'srgb', 'adobe rgb'],
      'colourspace': ['colour space', 'srgb', 'adobe rgb'],
      srgb: ['colour space', 'color space'],
      icc: ['icc profile', 'colour space'],
      dpi: ['x resolution', 'y resolution', 'ppi'],
      ppi: ['x resolution', 'y resolution', 'dpi'],
      // photo - GPS
      gps: ['latitude', 'longitude', 'altitude', 'location'],
      location: ['latitude', 'longitude', 'gps', 'map'],
      map: ['latitude', 'longitude', 'gps', 'location'],
      coords: ['latitude', 'longitude'],
      coordinates: ['latitude', 'longitude'],
      lat: ['latitude'],
      latitude: ['lat', 'gps', 'location'],
      lon: ['longitude'],
      lng: ['longitude'],
      longitude: ['lon', 'lng', 'gps', 'location'],
      alt: ['altitude'],
      altitude: ['alt', 'elevation', 'height'],
      elevation: ['altitude', 'alt'],
      direction: ['image direction', 'heading'],
      heading: ['image direction', 'direction'],
      speed: ['gps speed'],
      // photo - date/time
      date: ['taken', 'created', 'modified', 'creation date', 'modification date'],
      time: ['taken', 'created', 'modified', 'datetime'],
      taken: ['date', 'datetimeoriginal'],
      created: ['date', 'creation date'],
      modified: ['date', 'modification date'],
      when: ['taken', 'created', 'date'],
      // photo - text/QR
      ocr: ['text', 'extract text'],
      text: ['ocr', 'extract text'],
      qr: ['qr code', 'barcode'],
      barcode: ['qr', 'qr code'],
      // photo - hashes
      hash: ['sha-256', 'phash', 'checksum'],
      sha: ['sha-256'],
      sha256: ['sha-256'],
      checksum: ['sha-256', 'hash'],
      phash: ['perceptual hash', 'hash'],
      // photo - description/IPTC
      title: ['title', 'name', 'objectname'],
      description: ['caption', 'desc'],
      caption: ['description'],
      creator: ['artist', 'author', 'photographer'],
      artist: ['creator', 'author'],
      author: ['creator', 'artist'],
      photographer: ['creator', 'artist'],
      copyright: ['rights', 'license'],
      rights: ['copyright'],
      keywords: ['tags', 'subject'],
      tags: ['keywords', 'subject'],
      // audio
      sr: ['sample rate', 'samplerate'],
      samplerate: ['sample rate', 'sr', 'hz'],
      'samplerate': ['sample rate', 'sr'],
      hz: ['sample rate', 'frequency'],
      khz: ['sample rate'],
      ch: ['channels'],
      channels: ['ch', 'mono', 'stereo'],
      mono: ['channels'],
      stereo: ['channels', 'stereo width', 'phase correlation'],
      db: ['dbfs', 'peak', 'rms', 'decibel'],
      dbfs: ['db', 'peak', 'rms', 'decibel'],
      decibel: ['db', 'dbfs', 'peak', 'rms'],
      volume: ['peak', 'rms', 'dbfs', 'loudness', 'lufs'],
      loud: ['loudness', 'lufs', 'peak', 'rms'],
      loudness: ['lufs', 'volume', 'loud'],
      lufs: ['loudness', 'volume'],
      peak: ['peak', 'clipping', 'dbfs'],
      rms: ['rms', 'dbfs', 'volume'],
      clip: ['clipping', 'clipped'],
      clipping: ['clip', 'clipped', 'peak'],
      bpm: ['tempo', 'beats'],
      tempo: ['bpm', 'beats'],
      beats: ['bpm', 'tempo'],
      pitch: ['note', 'frequency', 'tuning'],
      note: ['pitch', 'frequency'],
      tune: ['pitch', 'tuning', 'cents'],
      tuning: ['pitch', 'cents'],
      centroid: ['spectral centroid', 'brightness', 'warm', 'bright'],
      brightness: ['spectral centroid', 'bright', 'warm'],
      warm: ['spectral centroid'],
      bright: ['spectral centroid'],
      bitdepth: ['bit depth'],
      'bit depth': ['bitdepth', 'bits'],
      samples: ['total samples'],
      phase: ['phase correlation'],
      mid: ['mid level', 'mid/side'],
      side: ['side level', 'side / mid', 'mid/side'],
      // archive
      zip: ['archive', 'compressed'],
      archive: ['zip', 'compressed', 'files', 'directories'],
      compressed: ['compression ratio', 'total compressed'],
      uncompressed: ['total uncompressed'],
      compression: ['compression ratio', 'compressed'],
      // PDF
      pdf: ['pages', 'pdf version'],
      pages: ['pdf', 'page'],
      // CSV
      csv: ['delimiter', 'columns', 'data rows'],
      delimiter: ['comma', 'tab', 'separator'],
      columns: ['csv', 'fields'],
      rows: ['data rows', 'lines'],
      // SVG
      svg: ['viewbox', 'elements'],
      viewbox: ['svg', 'viewBox'],
      // general
      name: ['filename'],
      filename: ['name'],
      size: ['filesize', 'bytes'],
      filesize: ['size', 'bytes'],
      bytes: ['size', 'filesize'],
      ext: ['extension'],
      extension: ['ext'],
      magic: ['magic guess'],
      app: ['application', 'software'],
      application: ['app', 'software'],
      // databases / SQL
      database: ['table', 'schema', 'rows', 'sqlite'],
      table: ['tables', 'rows', 'columns', 'schema'],
      schema: ['ddl', 'create table', 'columns', 'table'],
      sql: ['sqlite', 'database', 'table', 'dialect'],
      sqlite: ['database', 'table', 'schema'],
      ddl: ['schema', 'create table'],
      // comics / pages
      comic: ['page', 'pages', 'comicinfo', 'series'],
      page: ['pages'],
      series: ['title', 'issue'],
      // 3D / geo / misc
      vertices: ['vertex', 'triangles', 'faces'],
      triangles: ['faces', 'vertices', 'polygons'],
      track: ['gpx', 'route', 'elevation'],
      ascent: ['elevation gain', 'climb'],
    };

    function expandQuery(q) {
      const terms = [q];
      const syn = SYNONYMS[q.replace(/\s+/g, '')];
      if (syn) terms.push(...syn);
      return terms;
    }

    function textMatches(text, terms) {
      const t = text.toLowerCase();
      return terms.some(term => t.includes(term));
    }

    function runSearch() {
      const q = searchInput.value.trim().toLowerCase();
      for (const el of document.querySelectorAll('.anr-search-highlight')) el.classList.remove('anr-search-highlight');
      const cur = document.querySelector('.anr-search-current');
      if (cur) cur.classList.remove('anr-search-current');
      matches = [];
      matchIdx = -1;
      if (!q) return;
      const terms = expandQuery(q);
      for (const container of document.querySelectorAll('.anr-results')) {
        if (container.hidden) continue;
        for (const card of container.querySelectorAll('.anr-card')) {
          // Prefer highlighting the specific matching rows inside a card (any
          // table - readouts, sample data, etc.); fall back to the whole card when
          // the match is in prose / a <pre> / a list rather than a table row.
          const rows = [...card.querySelectorAll('table tr')].filter((tr) => textMatches(tr.textContent, terms));
          if (rows.length) {
            for (const tr of rows) { tr.classList.add('anr-search-highlight'); matches.push(tr); }
          } else if (textMatches(card.textContent, terms)) {
            card.classList.add('anr-search-highlight');
            matches.push(card);
          }
        }
      }
      if (matches.length) scrollToMatch(0);
    }

    function triggerSearch(input) {
      searchInput.value = input.value;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(runSearch, 150);
    }

    function openSearch() {
      if (isMobile()) {
        mobileOverlay.classList.add('is-open');
        mobileInput.value = searchInput.value;
        requestAnimationFrame(() => mobileInput.focus());
      } else {
        searchWrap.classList.add('is-open');
        searchInput.focus();
      }
    }

    function closeSearch() {
      if (mobileOverlay.classList.contains('is-open')) {
        mobileOverlay.classList.remove('is-open');
        searchInput.value = mobileInput.value;
        return;
      }
      if (!searchWrap.classList.contains('is-open')) return;
      searchWrap.classList.remove('is-open');
    }

    // Desktop events
    searchBtn.addEventListener('click', openSearch);
    searchInput.addEventListener('input', () => triggerSearch(searchInput));
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { searchInput.value = ''; runSearch(); searchInput.blur(); closeSearch(); }
      else if (e.key === 'Enter') { e.preventDefault(); scrollToMatch(e.shiftKey ? matchIdx - 1 : matchIdx + 1); }
    });
    searchInput.addEventListener('blur', (e) => {
      if (e.relatedTarget === prevBtn || e.relatedTarget === nextBtn) return;
      if (!searchInput.value) closeSearch();
    });
    prevBtn.addEventListener('click', (e) => { e.preventDefault(); scrollToMatch(matchIdx - 1); });
    nextBtn.addEventListener('click', (e) => { e.preventDefault(); scrollToMatch(matchIdx + 1); });

    // Mobile overlay events
    mobileInput.addEventListener('input', () => triggerSearch(mobileInput));
    mobileInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { mobileInput.value = ''; searchInput.value = ''; runSearch(); closeSearch(); }
      else if (e.key === 'Enter') { e.preventDefault(); scrollToMatch(e.shiftKey ? matchIdx - 1 : matchIdx + 1); }
    });
    mobilePrev.addEventListener('click', (e) => { e.preventDefault(); scrollToMatch(matchIdx - 1); });
    mobileNext.addEventListener('click', (e) => { e.preventDefault(); scrollToMatch(matchIdx + 1); });
    mobileClose.addEventListener('click', () => { mobileInput.value = ''; searchInput.value = ''; runSearch(); closeSearch(); });
  }
}
