/* Analyser - folder overview
   Recursively walks a dropped folder via webkitGetAsEntry
   and renders a treemap + summary using the shared folder/archive modules. */

import { el, row, fmtBytes, buildFileTree, inlineLoader } from '../core/util.js';
import { normalizeFolder, renderBreakdownCards, renderViewToggle } from './folder-archive-shared.js';
import { ARCHIVE_EXTS } from '../core/formats.js';

// Marks a tree leaf (file) so directory objects can never be mistaken for files.
const LEAF = Symbol('leaf');

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

export function renderFolder(files, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';

  const folderName = files.length ? files[0].path.split('/')[0] : 'folder';
  const items = normalizeFolder(files);

  // Build a lookup from path → original file object for click-to-analyse
  const fileByPath = {};
  for (const f of files) fileByPath[f.path] = f.file;

  // Summary + breakdown cards (with folder name as extra row) - rendered
  // immediately so the Overview/File-types paint instantly for big folders.
  renderBreakdownCards(items, resultsEl, [
    row('Name', folderName)
  ]);

  // Contents (treemap/tree) can be heavy to build for a large folder, so show a
  // placeholder with a loading bar and defer the real build to the next frames.
  const pendingCard = el('div', { class: 'anr-card' });
  pendingCard.appendChild(el('h3', {}, 'Contents'));
  pendingCard.appendChild(inlineLoader('Building file map…'));
  resultsEl.appendChild(pendingCard);

  // Open a file: nested archive → archive view; everything else → main analyser.
  function openFile(file) {
    if (!file) return;
    const ext = extOf(file.name);
    if (ARCHIVE_EXTS.has(ext)) {
      import('./archive.js').then(m => {
        resultsEl.innerHTML = '';
        m.renderArchive(file, resultsEl);
      });
    } else if (window._anrHandleFile) {
      window._anrHandleFile(file);
    }
  }

  // Treemap click → normalized item carries .file / .path directly.
  function onFileClick(item) {
    openFile(item.file || fileByPath[item.path]);
  }

  // Tree click → the leaf object carries the File directly (no name matching).
  function onTreeFileClick(_key, leaf) {
    if (leaf && leaf.file) openFile(leaf.file);
  }

  // Defer the (potentially heavy) tree build + treemap layout by two frames so
  // the Overview and File-types cards paint first, then swap in the real card.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    // Leaves are tagged with a Symbol so directory objects (plain {}) can never
    // be mistaken for files, even if a file is literally named "name"/"size".
    const tree = {};
    for (const f of files) {
      const parts = f.path.split('/');
      let node = tree;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!node[parts[i]] || typeof node[parts[i]] !== 'object' || node[parts[i]][LEAF]) node[parts[i]] = {};
        node = node[parts[i]];
      }
      node[parts[parts.length - 1]] = { [LEAF]: true, size: f.size, file: f.file, path: f.path };
    }

    pendingCard.remove();
    renderViewToggle(resultsEl, items, tree, {
      isDir: (v) => v !== null && typeof v === 'object' && !v[LEAF],
      fileSize: (v) => v.size,
      copyPath: (_key, leaf) => leaf && leaf.path,
      onFileClick: onTreeFileClick
    }, onFileClick);
  }));
}
