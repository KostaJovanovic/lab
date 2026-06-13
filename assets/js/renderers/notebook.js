/* Analyser - Jupyter notebook (.ipynb) viewer
   ============================================================================
   An .ipynb file is JSON: { cells: [...], metadata, nbformat }. Each cell is a
   markdown, code or raw cell whose `source` is a string or array of line
   strings. Code cells also carry `outputs` (stream text, execute results,
   rich display data, and errors). We render the notebook the way a reader sees
   it: narrative markdown, code with its In[n] prompt, and the captured outputs
   (text, PNG/JPEG images decoded from their base64 data URIs, error
   tracebacks). Everything is escaped and no scripts ever run.
   ============================================================================ */

import { el, row, buildReadout, fmtBytes, rowHelp, integrityCard, errorCard } from '../core/util.js';

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
// Strip ANSI colour escapes (common in stream output and tracebacks).
function stripAnsi(s) {
  return String(s).replace(/\[[0-9;]*[A-Za-z]/g, '');
}
// `source` is a string or an array of line strings.
function joinSrc(src) {
  return Array.isArray(src) ? src.join('') : (src == null ? '' : String(src));
}

// ---------- minimal, safe markdown for narrative cells ----------
// Operates on already-escaped text: inline code, bold, italic, links.
function mdInline(escaped) {
  let s = escaped;
  s = s.replace(/`([^`]+)`/g, (m, c) => '<code class="anr-md-icode">' + c + '</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    (m, t, h) => '<a class="anr-md-link" href="' + h + '" target="_blank" rel="noopener noreferrer">' + t + '</a>');
  return s;
}
function mdToEl(src) {
  const wrap = el('div', { class: 'anr-md-body anr-nb-md' });
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  let html = '';
  let inList = false, inCode = false, para = [];
  const flushPara = () => { if (para.length) { html += '<p>' + mdInline(esc(para.join(' '))) + '</p>'; para = []; } };
  const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
  for (const ln of lines) {
    if (/^```/.test(ln)) {
      flushPara(); closeList();
      if (!inCode) { html += '<pre class="anr-nb-mdcode"><code>'; inCode = true; }
      else { html += '</code></pre>'; inCode = false; }
      continue;
    }
    if (inCode) { html += esc(ln) + '\n'; continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(ln);
    if (h) { flushPara(); closeList(); const lvl = h[1].length; html += '<h' + lvl + '>' + mdInline(esc(h[2])) + '</h' + lvl + '>'; continue; }
    const li = /^\s*[-*+]\s+(.*)$/.exec(ln);
    if (li) { flushPara(); if (!inList) { html += '<ul>'; inList = true; } html += '<li>' + mdInline(esc(li[1])) + '</li>'; continue; }
    if (!ln.trim()) { flushPara(); closeList(); continue; }
    para.push(ln.trim());
  }
  if (inCode) html += '</code></pre>';
  flushPara(); closeList();
  wrap.innerHTML = html;
  return wrap;
}

// ---------- one output of a code cell ----------
function renderOutput(out) {
  const t = out.output_type;
  if (t === 'stream') {
    const pre = el('pre', { class: 'anr-nb-out' + (out.name === 'stderr' ? ' anr-nb-out--err' : '') });
    pre.textContent = stripAnsi(joinSrc(out.text));
    return pre;
  }
  if (t === 'error') {
    const pre = el('pre', { class: 'anr-nb-out anr-nb-out--err' });
    pre.textContent = (out.ename ? out.ename + ': ' : '') + (out.evalue || '') +
      (Array.isArray(out.traceback) ? '\n' + stripAnsi(out.traceback.join('\n')) : '');
    return pre;
  }
  if (t === 'execute_result' || t === 'display_data') {
    const data = out.data || {};
    // Prefer an image, then plain text. HTML outputs are shown as their
    // text/plain fallback (never injected as live markup).
    const img = data['image/png'] ? 'png' : data['image/jpeg'] ? 'jpeg' : data['image/gif'] ? 'gif' : null;
    if (img) {
      let b64 = data['image/' + img];
      if (Array.isArray(b64)) b64 = b64.join('');
      const image = el('img', { class: 'anr-nb-img', src: 'data:image/' + img + ';base64,' + String(b64).replace(/\s+/g, ''), alt: 'cell image output' });
      return image;
    }
    if (data['text/plain']) {
      const pre = el('pre', { class: 'anr-nb-out anr-nb-out--result' });
      pre.textContent = stripAnsi(joinSrc(data['text/plain']));
      return pre;
    }
    if (data['text/html']) {
      const note = el('pre', { class: 'anr-nb-out' });
      note.textContent = '[HTML output - ' + joinSrc(data['text/html']).length.toLocaleString() + ' chars, not rendered]';
      return note;
    }
  }
  return null;
}

export async function renderNotebook(file, container) {
  container.hidden = false;
  container.innerHTML = '';
  container.appendChild(el('div', { class: 'anr-info' }, 'Reading notebook...'));

  let nb;
  try {
    nb = JSON.parse(await file.text());
  } catch (e) {
    container.innerHTML = '';
    container.appendChild(errorCard('This .ipynb file is not valid JSON: ' + (e && e.message || 'parse error')));
    return;
  }

  const cells = Array.isArray(nb.cells) ? nb.cells
    : (nb.worksheets && nb.worksheets[0] && nb.worksheets[0].cells) || [];   // nbformat 3
  const meta = nb.metadata || {};
  const lang = (meta.kernelspec && (meta.kernelspec.language || meta.kernelspec.name)) ||
    (meta.language_info && meta.language_info.name) || '';
  const langVer = meta.language_info && meta.language_info.version;
  const kernel = meta.kernelspec && meta.kernelspec.display_name;
  const counts = { code: 0, markdown: 0, raw: 0 };
  for (const c of cells) { const k = c.cell_type; if (counts[k] != null) counts[k]++; }

  container.innerHTML = '';

  const info = el('div', { class: 'anr-card' });
  info.appendChild(el('h3', {}, 'Jupyter notebook'));
  info.appendChild(buildReadout([
    ['File', file.name],
    ['Size', fmtBytes(file.size)],
    nb.nbformat && ['Notebook format', 'v' + nb.nbformat + (nb.nbformat_minor != null ? '.' + nb.nbformat_minor : '')],
    kernel && ['Kernel', kernel],
    (lang || langVer) && ['Language', [lang, langVer].filter(Boolean).join(' ')],
    ['Cells', cells.length.toLocaleString()],
    rowHelp('Breakdown', counts.code + ' code, ' + counts.markdown + ' markdown' + (counts.raw ? ', ' + counts.raw + ' raw' : ''),
      'How the notebook cells split between executable code, narrative markdown, and raw (unformatted) cells.'),
  ]));
  container.appendChild(info);

  if (!cells.length) {
    container.appendChild(el('div', { class: 'anr-card' }, [el('h3', {}, 'Cells'), el('p', { class: 'anr-hint' }, 'This notebook has no cells.')]));
    return;
  }

  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Notebook'));
  const flow = el('div', { class: 'anr-nb-flow' });
  card.appendChild(flow);

  const BATCH = 40;
  let shown = 0;
  function addCell(i) {
    const c = cells[i];
    const src = joinSrc(c.source || c.input);
    const block = el('div', { class: 'anr-nb-cell anr-nb-cell--' + (c.cell_type || 'raw') });
    if (c.cell_type === 'markdown') {
      block.appendChild(mdToEl(src));
    } else if (c.cell_type === 'code') {
      const head = el('div', { class: 'anr-nb-prompt' }, 'In [' + (c.execution_count == null ? ' ' : c.execution_count) + ']:');
      block.appendChild(head);
      const code = el('pre', { class: 'anr-nb-code' });
      code.textContent = src;
      block.appendChild(code);
      const outs = c.outputs || [];
      for (const o of outs) { const node = renderOutput(o); if (node) block.appendChild(node); }
    } else {
      const pre = el('pre', { class: 'anr-nb-code' });
      pre.textContent = src;
      block.appendChild(pre);
    }
    flow.appendChild(block);
  }

  const btnRow = el('div', { class: 'anr-btn-row' });
  const moreBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Show more cells');
  const allBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Show all');
  btnRow.appendChild(moreBtn);
  btnRow.appendChild(allBtn);
  card.appendChild(btnRow);
  function reveal(upTo) {
    for (; shown < upTo && shown < cells.length; shown++) addCell(shown);
    if (shown >= cells.length) btnRow.hidden = true;
    else { btnRow.hidden = false; moreBtn.textContent = 'Show more cells (' + shown + '/' + cells.length + ')'; }
  }
  moreBtn.addEventListener('click', () => reveal(shown + BATCH));
  allBtn.addEventListener('click', () => reveal(cells.length));
  reveal(Math.min(cells.length, BATCH));
  container.appendChild(card);

  if (file.size <= 500 * 1024 * 1024) container.appendChild(integrityCard(file));
}
