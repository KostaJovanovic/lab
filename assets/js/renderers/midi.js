/* Analyser - Standard MIDI File (.mid/.midi)
   Hand-written SMF parser: header, tempo map, time/key signature, track names,
   General MIDI instruments (program changes), note counts, and duration.
   No playback - MIDI is a score, not sampled audio (browsers can't decode it). */

import { el, row, rowHelp, h3help, errorCard, fmtBytes } from '../core/util.js';

const GM = [
  'Acoustic Grand Piano','Bright Acoustic Piano','Electric Grand Piano','Honky-tonk Piano','Electric Piano 1','Electric Piano 2','Harpsichord','Clavi',
  'Celesta','Glockenspiel','Music Box','Vibraphone','Marimba','Xylophone','Tubular Bells','Dulcimer',
  'Drawbar Organ','Percussive Organ','Rock Organ','Church Organ','Reed Organ','Accordion','Harmonica','Tango Accordion',
  'Acoustic Guitar (nylon)','Acoustic Guitar (steel)','Electric Guitar (jazz)','Electric Guitar (clean)','Electric Guitar (muted)','Overdriven Guitar','Distortion Guitar','Guitar harmonics',
  'Acoustic Bass','Electric Bass (finger)','Electric Bass (pick)','Fretless Bass','Slap Bass 1','Slap Bass 2','Synth Bass 1','Synth Bass 2',
  'Violin','Viola','Cello','Contrabass','Tremolo Strings','Pizzicato Strings','Orchestral Harp','Timpani',
  'String Ensemble 1','String Ensemble 2','SynthStrings 1','SynthStrings 2','Choir Aahs','Voice Oohs','Synth Voice','Orchestra Hit',
  'Trumpet','Trombone','Tuba','Muted Trumpet','French Horn','Brass Section','SynthBrass 1','SynthBrass 2',
  'Soprano Sax','Alto Sax','Tenor Sax','Baritone Sax','Oboe','English Horn','Bassoon','Clarinet',
  'Piccolo','Flute','Recorder','Pan Flute','Blown Bottle','Shakuhachi','Whistle','Ocarina',
  'Lead 1 (square)','Lead 2 (sawtooth)','Lead 3 (calliope)','Lead 4 (chiff)','Lead 5 (charang)','Lead 6 (voice)','Lead 7 (fifths)','Lead 8 (bass + lead)',
  'Pad 1 (new age)','Pad 2 (warm)','Pad 3 (polysynth)','Pad 4 (choir)','Pad 5 (bowed)','Pad 6 (metallic)','Pad 7 (halo)','Pad 8 (sweep)',
  'FX 1 (rain)','FX 2 (soundtrack)','FX 3 (crystal)','FX 4 (atmosphere)','FX 5 (brightness)','FX 6 (goblins)','FX 7 (echoes)','FX 8 (sci-fi)',
  'Sitar','Banjo','Shamisen','Koto','Kalimba','Bag pipe','Fiddle','Shanai',
  'Tinkle Bell','Agogo','Steel Drums','Woodblock','Taiko Drum','Melodic Tom','Synth Drum','Reverse Cymbal',
  'Guitar Fret Noise','Breath Noise','Seashore','Bird Tweet','Telephone Ring','Helicopter','Applause','Gunshot',
];

function fmtDur(sec) {
  if (!isFinite(sec) || sec <= 0) return '—';
  const m = Math.floor(sec / 60), s = sec % 60;
  return m + ':' + s.toFixed(1).padStart(4, '0');
}

export async function renderMidi(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';

  let buf;
  try { buf = new Uint8Array(await file.arrayBuffer()); }
  catch (e) { resultsEl.appendChild(errorCard('Could not read this MIDI file.')); return; }

  const ascii = (o, l) => String.fromCharCode(...buf.slice(o, o + l));
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.length < 14 || ascii(0, 4) !== 'MThd') {
    resultsEl.appendChild(errorCard('Not a Standard MIDI File (missing "MThd" header).'));
    return;
  }

  const format = dv.getUint16(8, false);
  const ntrks  = dv.getUint16(10, false);
  const division = dv.getUint16(12, false);
  let ppq = 0, smpte = null;
  if (division & 0x8000) smpte = { fps: 256 - (division >> 8), tpf: division & 0xFF };
  else ppq = division;

  const tempos = [];                 // real set-tempo events {tick, us}
  let timeSig = null, keySig = null;
  const trackNames = [], instrNames = [];
  const programs = new Set();        // GM program numbers used (melodic)
  let hasDrums = false;
  const channels = new Set();
  let noteOns = 0;
  let maxTick = 0;
  const dec = new TextDecoder();

  function readVLQ(p) { let v = 0, b; do { b = buf[p++]; v = (v << 7) | (b & 0x7F); } while (b & 0x80); return [v, p]; }

  let pos = 14;
  for (let t = 0; t < ntrks && pos + 8 <= buf.length; t++) {
    if (ascii(pos, 4) !== 'MTrk') break;
    const len = dv.getUint32(pos + 4, false);
    let p = pos + 8;
    const endTrk = Math.min(p + len, buf.length);
    let tick = 0, running = 0;
    while (p < endTrk) {
      let dt; [dt, p] = readVLQ(p); tick += dt;
      let status = buf[p];
      if (status & 0x80) { p++; running = status; } else { status = running; }
      if (status === 0xFF) {
        const type = buf[p++]; let mlen; [mlen, p] = readVLQ(p);
        const data = buf.slice(p, p + mlen); p += mlen;
        if (type === 0x51 && mlen === 3) tempos.push({ tick, us: (data[0] << 16) | (data[1] << 8) | data[2] });
        else if (type === 0x58 && mlen >= 2 && !timeSig) timeSig = data[0] + '/' + (1 << data[1]);
        else if (type === 0x59 && mlen >= 2 && !keySig) keySig = data;
        else if (type === 0x03) { const n = dec.decode(data).trim(); if (n) trackNames.push(n); }
        else if (type === 0x04) { const n = dec.decode(data).trim(); if (n) instrNames.push(n); }
      } else if (status === 0xF0 || status === 0xF7) {
        let slen; [slen, p] = readVLQ(p); p += slen;
      } else {
        const hi = status & 0xF0, ch = status & 0x0F;
        channels.add(ch);
        if (hi === 0xC0) { if (ch === 9) hasDrums = true; else programs.add(buf[p]); p += 1; }
        else if (hi === 0x90) { if (buf[p + 1] > 0) noteOns++; p += 2; }
        else if (hi === 0xD0) p += 1;
        else p += 2;   // 0x80/0xA0/0xB0/0xE0
      }
    }
    maxTick = Math.max(maxTick, tick);
    pos = endTrk;
  }

  // Duration via the tempo map (integrate ticks through tempo segments).
  const map = tempos.slice().sort((a, b) => a.tick - b.tick);
  if (!map.length || map[0].tick > 0) map.unshift({ tick: 0, us: 500000 });
  let durSec = 0;
  if (ppq > 0) {
    let lastTick = map[0].tick, lastUs = map[0].us;
    for (let i = 1; i < map.length; i++) {
      durSec += (map[i].tick - lastTick) / ppq * (lastUs / 1e6);
      lastTick = map[i].tick; lastUs = map[i].us;
    }
    durSec += Math.max(0, maxTick - lastTick) / ppq * (lastUs / 1e6);
  }
  const initialBpm = 60000000 / map[0].us;

  // ---- Info card ----
  const [h, help] = h3help('MIDI file',
    'A Standard MIDI File stores a musical score (notes, tempo, instruments) - not sampled audio - so there is no waveform or spectrogram to play.');
  const infoCard = el('div', { class: 'anr-card' });
  infoCard.appendChild(h); infoCard.appendChild(help);
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('File', file.name));
  tbl.appendChild(row('Size', fmtBytes(file.size)));
  const fmtName = { 0: '0 - single track', 1: '1 - multi-track', 2: '2 - multi-song' }[format] || String(format);
  tbl.appendChild(row('Format', fmtName));
  tbl.appendChild(row('Tracks', String(ntrks)));
  tbl.appendChild(rowHelp('Division', smpte ? (smpte.fps + ' fps · ' + smpte.tpf + ' ticks/frame') : (ppq + ' ticks/quarter'),
    'Timing resolution - ticks per quarter-note (or SMPTE frames).'));
  tbl.appendChild(rowHelp('Tempo', Math.round(initialBpm) + ' BPM' + (tempos.length > 1 ? ' (' + tempos.length + ' changes)' : ''),
    'Initial tempo from the first set-tempo event (default 120 if none).'));
  if (timeSig) tbl.appendChild(row('Time signature', timeSig));
  tbl.appendChild(row('Duration', fmtDur(durSec)));
  tbl.appendChild(row('Notes', noteOns.toLocaleString()));
  tbl.appendChild(row('Channels used', channels.size + (hasDrums ? ' (incl. drums)' : '')));
  infoCard.appendChild(tbl);
  resultsEl.appendChild(infoCard);

  // ---- Instruments ----
  const instrs = [...programs].sort((a, b) => a - b).map((p) => GM[p] || ('Program ' + p));
  if (hasDrums) instrs.push('Drum kit (channel 10)');
  if (instrs.length) {
    const card = el('div', { class: 'anr-card' });
    card.appendChild(el('h3', {}, 'Instruments (General MIDI)'));
    const ul = el('ul', { class: 'anr-midi-list' });
    for (const name of instrs) ul.appendChild(el('li', {}, name));
    card.appendChild(ul);
    resultsEl.appendChild(card);
  }

  // ---- Track / instrument names embedded in the file ----
  const names = [...trackNames, ...instrNames];
  if (names.length) {
    const card = el('div', { class: 'anr-card' });
    card.appendChild(el('h3', {}, 'Track names'));
    const ul = el('ul', { class: 'anr-midi-list' });
    for (const n of names) ul.appendChild(el('li', {}, n));
    card.appendChild(ul);
    resultsEl.appendChild(card);
  }
}
