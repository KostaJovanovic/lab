/* Analyser - lazy parser chunk: camera RAW edit sidecars (chunk: 'raw').

   Small text / XML / plist files that sit next to a RAW or JPEG and record the
   non-destructive edits a raw developer applied. The RAW images themselves are
   handled by the photo renderer; these are the adjustment recipes. */

import { el, preBlock } from '../core/util.js';
import { parsePlist } from '../lib/plist.js';

// Apple Photos .aae adjustments sidecar (XML or binary plist).
async function parseAae(file) {
  const res = await parsePlist(file);
  if (!res || !res.value) return null;
  const v = res.value;
  const out = { 'Format': 'Apple Photos adjustments (' + res.format + ' plist)' };
  if (v.adjustmentFormatVersion != null) out['Format version'] = v.adjustmentFormatVersion;
  if (v.adjustmentBaseVersion != null) out['Base version'] = v.adjustmentBaseVersion;
  if (v.adjustmentFormatIdentifier) out['Adjustment type'] = v.adjustmentFormatIdentifier;
  if (v.adjustmentEditorBundleID) out['Editor'] = v.adjustmentEditorBundleID;
  if (v.adjustmentData) out['Edits'] = 'present (encoded adjustmentData)';
  return out;
}

// RawTherapee .pp3 processing profile (INI-style).
async function parsePp3(file) {
  const text = await file.text();
  if (!/\[(Version|General|Exposure|RAW|White Balance)\]/i.test(text)) return null;
  const ver = (text.match(/AppVersion\s*=\s*([^\r\n]+)/i) || [])[1] || (text.match(/^Version\s*=\s*([^\r\n]+)/im) || [])[1];
  const sections = Array.from(text.matchAll(/^\[([^\]]+)\]/gm)).map((m) => m[1]);
  const out = { 'Format': 'RawTherapee profile (PP3)' };
  if (ver) out['RawTherapee version'] = ver;
  out['Adjustment sections'] = sections.length;
  if (sections.length) out._sections = [{ title: 'Applied tool sections', node: preBlock(sections.join('\n')) }];
  return out;
}

// Capture One .cos settings (XML key/value tree).
async function parseCos(file) {
  const text = await file.slice(0, Math.min(file.size, 1_000_000)).text();
  if (!/CaptureOne|<SL|<E\s+K=/.test(text)) return null;
  const adjustments = (text.match(/<E\s+K=/g) || []).length;
  const src = (text.match(/(?:RawPath|ImagePath)[^>]*>([^<]+)/) || [])[1];
  const out = { 'Format': 'Capture One settings (COS)', 'Adjustments': adjustments };
  if (src) out['Source image'] = src;
  return out;
}

// DxO PhotoLab .dop sidecar (Lua-table / text).
async function parseDop(file) {
  const text = await file.slice(0, Math.min(file.size, 1_000_000)).text();
  const ver = (text.match(/Version\s*=\s*"?([\d.]+)/) || [])[1];
  const tools = Array.from(new Set(text.match(/\b(DeepPRIME|PRIME|Optics|Vignetting|Distortion|ChromaticAberration|Sharpness|Exposure|SmartLighting|ClearView|HotPixel|Moire)\b/g) || []));
  const out = { 'Format': 'DxO PhotoLab sidecar (DOP)' };
  if (ver) out['Version'] = ver;
  if (tools.length) out['Corrections'] = tools.join(', ');
  return out;
}

// Nikon NX Studio .nksc sidecar - locate an embedded XMP packet.
async function parseNksc(file) {
  const buf = new Uint8Array(await file.slice(0, Math.min(file.size, 524288)).arrayBuffer());
  const text = new TextDecoder('latin1').decode(buf);
  const out = { 'Format': 'Nikon NX Studio sidecar (NKSC)' };
  const xmp = text.match(/<x:xmpmeta[\s\S]*?<\/x:xmpmeta>/);
  if (xmp) {
    out['Embedded XMP'] = 'yes';
    const creator = (xmp[0].match(/CreatorTool>([^<]+)/) || [])[1];
    if (creator) out['Creator tool'] = creator;
  }
  return out;
}

const idOnly = (ext, name) => ({ 'Format': name, 'Note': 'Identified - ' + ext.toUpperCase() + ' camera edit/preview sidecar.' });

export const PARSERS = {
  aae: (c) => parseAae(c.file),
  pp3: (c) => parsePp3(c.file),
  cos: (c) => parseCos(c.file),
  dop: (c) => parseDop(c.file),
  nksc: (c) => parseNksc(c.file),
  cof: (c) => idOnly(c.ext, 'Capture One sidecar'),
  cop: (c) => idOnly(c.ext, 'Capture One preview'),
  comask: (c) => idOnly(c.ext, 'Capture One mask'),
};
