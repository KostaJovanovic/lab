/* Analyser - folder overview
   Recursively walks a dropped folder via webkitGetAsEntry
   and renders a quick summary: file count, total size, type breakdown, tree. */

import { el, row, fmtBytes } from './util.js';

function readEntries(reader) {
  return new Promise((resolve, reject) => {
    const all = [];
    (function read() {
      reader.readEntries(entries => {
        if (!entries.length) return resolve(all);
        all.push(...entries);
        read();
      }, reject);
    })();
  });
}

function entryToFile(entry) {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function walk(entry, path) {
  if (entry.isFile) {
    try {
      const file = await entryToFile(entry);
      return [{ path: path + entry.name, size: file.size, file }];
    } catch (_) {
      return [];
    }
  }
  if (entry.isDirectory) {
    const reader = entry.createReader();
    const children = await readEntries(reader);
    const results = [];
    for (const child of children) {
      results.push(...await walk(child, path + entry.name + '/'));
    }
    return results;
  }
  return [];
}

export async function walkItems(dataTransfer) {
  const items = dataTransfer.items;
  if (!items) return null;
  let hasFolder = false;
  const entries = [];
  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry();
    if (entry && entry.isDirectory) { hasFolder = true; entries.push(entry); }
  }
  if (!hasFolder) return null;
  const files = [];
  for (const entry of entries) {
    files.push(...await walk(entry, ''));
  }
  return files;
}

function extOf(name) {
  const m = name.match(/\.([^./]+)$/);
  return m ? m[1].toLowerCase() : '';
}

function buildTree(files, folderName) {
  const tree = {};
  for (const f of files) {
    const parts = f.path.split('/');
    let node = tree;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node[parts[i]]) node[parts[i]] = {};
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = f.size;
  }

  function renderNode(obj, depth) {
    const lines = [];
    const keys = Object.keys(obj).sort((a, b) => {
      const aDir = typeof obj[a] === 'object';
      const bDir = typeof obj[b] === 'object';
      if (aDir !== bDir) return aDir ? -1 : 1;
      return a.localeCompare(b);
    });
    for (const key of keys) {
      const val = obj[key];
      const indent = '  '.repeat(depth);
      if (typeof val === 'object') {
        const count = countInObj(val);
        lines.push(indent + key + '/  (' + count + ')');
        lines.push(...renderNode(val, depth + 1));
      } else {
        lines.push(indent + key + '  ' + fmtBytes(val));
      }
    }
    return lines;
  }

  function countInObj(obj) {
    let n = 0;
    for (const v of Object.values(obj)) {
      n += typeof v === 'object' ? countInObj(v) : 1;
    }
    return n;
  }

  return renderNode(tree, 0).join('\n');
}

export function renderFolder(files, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';

  const folderName = files.length ? files[0].path.split('/')[0] : 'folder';
  const totalSize = files.reduce((s, f) => s + f.size, 0);

  // Type breakdown
  const byExt = {};
  for (const f of files) {
    const ext = extOf(f.path) || '(no ext)';
    if (!byExt[ext]) byExt[ext] = { count: 0, size: 0 };
    byExt[ext].count++;
    byExt[ext].size += f.size;
  }
  const sorted = Object.entries(byExt).sort((a, b) => b[1].count - a[1].count);

  // Category breakdown
  const cats = { photo: 0, audio: 0, video: 0, document: 0, other: 0 };
  const PHOTO = new Set(['jpg','jpeg','png','gif','webp','heic','heif','bmp','tiff','tif','avif','jxl','ico','raw','arw','cr2','cr3','nef','dng','svg','psd']);
  const AUDIO = new Set(['mp3','wav','m4a','aac','flac','ogg','opus','aiff','wma','mid','midi']);
  const VIDEO = new Set(['mp4','mov','avi','mkv','webm','wmv','flv','3gp','mpg','mpeg','mts']);
  const DOC = new Set(['pdf','doc','docx','xls','xlsx','ppt','pptx','txt','md','csv','json','xml','html','css','js']);
  for (const f of files) {
    const ext = extOf(f.path);
    if (PHOTO.has(ext)) cats.photo++;
    else if (AUDIO.has(ext)) cats.audio++;
    else if (VIDEO.has(ext)) cats.video++;
    else if (DOC.has(ext)) cats.document++;
    else cats.other++;
  }

  // Summary card
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Folder overview'));
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Name', folderName));
  tbl.appendChild(row('Files', files.length.toLocaleString()));
  tbl.appendChild(row('Total size', fmtBytes(totalSize) + '  (' + totalSize.toLocaleString() + ' bytes)'));

  const catParts = [];
  if (cats.photo) catParts.push(cats.photo + ' photo');
  if (cats.audio) catParts.push(cats.audio + ' audio');
  if (cats.video) catParts.push(cats.video + ' video');
  if (cats.document) catParts.push(cats.document + ' document');
  if (cats.other) catParts.push(cats.other + ' other');
  tbl.appendChild(row('Categories', catParts.join(', ') || '-'));
  tbl.appendChild(row('Unique extensions', sorted.length));
  card.appendChild(tbl);
  resultsEl.appendChild(card);

  // Type breakdown card
  if (sorted.length) {
    const extCard = el('div', { class: 'anr-card' });
    extCard.appendChild(el('h3', {}, 'File types'));
    const extTbl = el('table', { class: 'anr-readout' });
    for (const [ext, data] of sorted) {
      extTbl.appendChild(row('.' + ext, data.count + (data.count === 1 ? ' file' : ' files') + '  (' + fmtBytes(data.size) + ')'));
    }
    extCard.appendChild(extTbl);
    resultsEl.appendChild(extCard);
  }

  // Tree card
  const treeCard = el('div', { class: 'anr-card' });
  treeCard.appendChild(el('h3', {}, 'File tree'));
  const treeText = buildTree(files, folderName);
  const pre = el('pre', { class: 'anr-pre-scroll' });
  pre.style.fontSize = '11px';
  pre.style.lineHeight = '1.6';
  pre.textContent = treeText;
  treeCard.appendChild(pre);
  resultsEl.appendChild(treeCard);
}
