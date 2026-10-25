// 8-bit music and sound effects, synthesised live with Web Audio (no audio files).
// Shared by the big screen and the phones.
//
//   audio.music('world')  // 'lobby' | 'world' | 'space' | 'desert' | 'results' | null
//   audio.sfx('crash')    // see SFX below
//   audio.setMuted('music' | 'sfx', bool), audio.muted.music / .sfx (remembered per device)
//
// Browsers only allow sound after a tap or key press, so the context starts (or resumes)
// on the first user gesture; anything asked for before that just waits.

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

let ctx = null;
let master;
let musicBus;
let sfxBus;
let noiseBuf;
const muted = { music: store.get('cr-mute-music') === '1', sfx: store.get('cr-mute-sfx') === '1' };
let musicVolume = 0.5;
let wanted = null; // track that should be playing
let playing = null; // { name, step, next }
const listeners = new Set();

function init() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createDynamicsCompressor();
  master.threshold.value = -14;
  master.ratio.value = 4;
  master.connect(ctx.destination);
  musicBus = ctx.createGain();
  sfxBus = ctx.createGain();
  musicBus.connect(master);
  sfxBus.connect(master);
  applyMute();
  // One second of white noise, reused for drums, crashes and whooshes.
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  setInterval(schedule, 25);
  return ctx;
}

function unlock() {
  if (!init()) return;
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
}
['pointerdown', 'touchend', 'keydown'].forEach((e) => window.addEventListener(e, unlock, { capture: true, passive: true }));

function applyMute() {
  if (!ctx) return;
  musicBus.gain.setTargetAtTime(muted.music ? 0 : musicVolume, ctx.currentTime, 0.05);
  sfxBus.gain.setTargetAtTime(muted.sfx ? 0 : 0.8, ctx.currentTime, 0.02);
}

// ------------------------------------------------------------------ synth voices

const NOTES = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
/** 'A4' → Hz */
function hz(n) {
  const m = /^([A-G]#?)(\d)$/.exec(n);
  return 440 * 2 ** ((NOTES[m[1]] + (Number(m[2]) + 1) * 12 - 69) / 12);
}

function tone(bus, { type = 'square', f, f2 = null, t, dur, vol = 0.2, attack = 0.005, duty = null }) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  if (type === 'pulse') {
    // Narrow pulse wave (the classic NES lead) from a periodic wave.
    const n = 32;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    const dc = duty ?? 0.25;
    for (let k = 1; k < n; k++) im[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * dc);
    o.setPeriodicWave(ctx.createPeriodicWave(re, im));
  } else o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  o.connect(g).connect(bus);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(bus, { t, dur, vol = 0.2, hp = 800, lp = 12000, lp2 = null }) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const h = ctx.createBiquadFilter();
  h.type = 'highpass';
  h.frequency.value = hp;
  const l = ctx.createBiquadFilter();
  l.type = 'lowpass';
  l.frequency.setValueAtTime(lp, t);
  if (lp2) l.frequency.exponentialRampToValueAtTime(lp2, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  s.connect(h).connect(l).connect(g).connect(bus);
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur + 0.02);
}

const DRUMS = {
  k: (t) => tone(musicBus, { type: 'sine', f: 150, f2: 40, t, dur: 0.16, vol: 0.55 }),
  s: (t) => { noise(musicBus, { t, dur: 0.12, vol: 0.22, hp: 1200 }); tone(musicBus, { type: 'triangle', f: 220, f2: 120, t, dur: 0.07, vol: 0.18 }); },
  h: (t) => noise(musicBus, { t, dur: 0.035, vol: 0.07, hp: 7000 }),
  o: (t) => noise(musicBus, { t, dur: 0.16, vol: 0.06, hp: 6000 }),
};

// ------------------------------------------------------------------ music
// Each track: tempo, a 16th-note grid. lead/bass/arp: one entry per step ('' = rest,
// '-' = hold). drums: one character per step (k kick, s snare, h hat, o open hat, . rest).

const seq = (s) => s.trim().split(/\s+/).map((x) => (x === '.' ? '' : x));

const TRACKS = {
  lobby: {
    bpm: 128, leadType: 'pulse', leadVol: 0.09, duty: 0.25,
    lead: seq(`
      C5 . E5 . G5 . E5 . A5 - G5 . E5 . C5 .   D5 . F5 . A5 . F5 . G5 - - . . . . .
      C5 . E5 . G5 . E5 . C6 - B5 . A5 . G5 .   F5 . E5 . D5 . E5 . C5 - - . . . . .`),
    bass: seq(`
      C3 . . . G2 . . . A2 . . . E2 . . .   F2 . . . C3 . . . G2 . . . G2 . . .
      C3 . . . G2 . . . A2 . . . E2 . . .   F2 . . . G2 . . . C3 . . . C3 . . .`),
    drums: 'k.h.s.h.k.h.s.hhk.h.s.h.k.h.s.h.k.h.s.h.k.h.s.hhk.h.s.h.k.k.s.hs',
  },
  world: {
    // Sunny Grassland: bright, bouncy, G major
    bpm: 150, leadType: 'pulse', leadVol: 0.085, duty: 0.25,
    lead: seq(`
      G5 . B5 . D6 . B5 . C6 . A5 . F#5 . D5 .   G5 . B5 . D6 . G6 . F#6 - E6 . D6 - . .
      E6 . D6 . C6 . B5 . A5 . B5 . C6 . A5 .   B5 . G5 . A5 . F#5 . G5 - - . . . . .`),
    bass: seq(`
      G2 . G3 . D3 . G3 . A2 . A3 . D3 . F#3 .   G2 . G3 . D3 . G3 . C3 . C3 . D3 . D3 .
      C3 . C4 . G3 . C4 . D3 . D4 . A3 . D4 .   G2 . D3 . D3 . F#3 . G2 . G3 . G2 . . .`),
    arp: seq(`
      B4 D5 G5 D5 B4 D5 G5 D5 A4 D5 F#5 D5 A4 D5 F#5 D5   B4 D5 G5 D5 B4 D5 G5 D5 C5 E5 G5 E5 A4 D5 F#5 D5
      C5 E5 G5 E5 C5 E5 G5 E5 A4 D5 F#5 D5 A4 D5 F#5 D5   B4 D5 G5 D5 A4 C5 F#5 C5 B4 D5 G5 D5 B4 D5 G5 D5`),
    drums: 'k.h.s.hkk.h.s.h.k.h.s.hkk.h.s.shk.h.s.hkk.h.s.h.k.h.s.hkk.k.s.ss',
  },
  space: {
    // Low-Gravity Space: slow, floaty, minor arpeggios with a sparse beat
    bpm: 108, leadType: 'triangle', leadVol: 0.16,
    lead: seq(`
      A5 - - - - - E5 - G5 - - - F5 - E5 -   D5 - - - - - E5 - C5 - - - - - - -
      A5 - - - - - C6 - B5 - - - G5 - E5 -   F5 - - - E5 - D5 - E5 - - - - - - -`),
    bass: seq(`
      A2 . . . . . . . A2 . . . . . . .   F2 . . . . . . . F2 . . . . . . .
      D2 . . . . . . . D2 . . . . . . .   E2 . . . . . . . E2 . . . G2 . . .`),
    arp: seq(`
      A4 C5 E5 A5 E5 C5 A4 C5 E5 A5 E5 C5 A4 C5 E5 C5   F4 A4 C5 F5 C5 A4 F4 A4 C5 F5 C5 A4 F4 A4 C5 A4
      D4 F4 A4 D5 A4 F4 D4 F4 A4 D5 A4 F4 D4 F4 A4 F4   E4 G#4 B4 E5 B4 G#4 E4 G#4 B4 E5 B4 G#4 E4 G#4 B4 G#4`),
    arpType: 'pulse', arpVol: 0.035, echo: true,
    drums: 'k.......s.....h.k.......s...h.h.k.......s.....h.k.....k.s...hhh.',
  },
  desert: {
    // Dusty Desert: spaghetti-western gallop, A minor with a twangy lead
    bpm: 132, leadType: 'pulse', leadVol: 0.09, duty: 0.125,
    lead: seq(`
      A4 . . E5 - - . . D5 . C5 . B4 - A4 .   G4 . . A4 - - . . . . . . . . . .
      A4 . . E5 - - . . G5 . F5 . E5 - D5 .   E5 . . A4 - - . . . . E5 . A5 - - .`),
    bass: seq(`
      A2 . E3 A2 . E3 A2 . G2 . D3 G2 . D3 G2 .   F2 . C3 F2 . C3 E2 . E2 . B2 E2 . B2 E2 .
      A2 . E3 A2 . E3 A2 . C3 . G3 C3 . G3 C3 .   D3 . A3 D3 . A3 E2 . E2 . B2 E2 . E3 E2 .`),
    drums: 'k.hkk.hks.hkk.hhk.hkk.hks.hkk.hsk.hkk.hks.hkk.hhk.hkk.hks.hks.ss',
  },
  results: {
    bpm: 120, leadType: 'pulse', leadVol: 0.09, duty: 0.25,
    lead: seq(`
      C5 . C5 . C5 . G5 - - - E5 . G5 . C6 -   - - - - A5 . G5 . F5 . E5 . D5 . . .
      C5 . C5 . C5 . G5 - - - E5 . G5 . A5 -   - - G5 . F5 . E5 . D5 . C5 - - - . .`),
    bass: seq(`
      C3 . G2 . C3 . G2 . C3 . G2 . C3 . G2 .   F2 . C3 . F2 . C3 . G2 . D3 . G2 . D3 .
      C3 . G2 . C3 . G2 . A2 . E3 . A2 . E3 .   F2 . G2 . F2 . G2 . C3 . G2 . C3 . . .`),
    drums: 'k...s...k.k.s...k...s...k.k.s.s.k...s...k.k.s...k...s...k.k.sss.',
  },
};

function playStep(tr, i, t, sixteenth) {
  const n = tr.lead.length;
  const note = (arr) => arr && arr[i % arr.length];
  const len = (arr) => {
    let k = 1;
    while (arr[(i + k) % arr.length] === '-' && k < 16) k++;
    return k * sixteenth;
  };
  const L = note(tr.lead);
  if (L && L !== '-') {
    const d = len(tr.lead);
    tone(musicBus, { type: tr.leadType, duty: tr.duty, f: hz(L), t, dur: Math.max(0.09, d * 0.95), vol: tr.leadVol });
    if (tr.echo) tone(musicBus, { type: 'triangle', f: hz(L), t: t + sixteenth * 3, dur: d * 0.8, vol: tr.leadVol * 0.35 });
  }
  const B = note(tr.bass);
  if (B && B !== '-') tone(musicBus, { type: 'triangle', f: hz(B), t, dur: Math.max(0.1, len(tr.bass) * 0.9), vol: 0.22 });
  const A = note(tr.arp);
  if (A && A !== '-') tone(musicBus, { type: tr.arpType === 'pulse' ? 'pulse' : 'square', duty: 0.5, f: hz(A), t, dur: sixteenth * 0.8, vol: tr.arpVol ?? 0.025 });
  const D = tr.drums[i % tr.drums.length];
  if (DRUMS[D]) DRUMS[D](t);
  return n;
}

function schedule() {
  if (!ctx || ctx.state !== 'running') return;
  if ((playing?.name ?? null) !== wanted) {
    playing = wanted ? { name: wanted, step: 0, next: ctx.currentTime + 0.08 } : null;
  }
  if (!playing) return;
  const tr = TRACKS[playing.name];
  const sixteenth = 60 / tr.bpm / 4;
  while (playing.next < ctx.currentTime + 0.15) {
    playStep(tr, playing.step, playing.next, sixteenth);
    playing.step += 1;
    playing.next += sixteenth;
  }
}

// ------------------------------------------------------------------ sound effects

const SFX = {
  beep: (t) => tone(sfxBus, { type: 'square', f: 660, t, dur: 0.14, vol: 0.18 }),
  go: (t) => { [880, 1320].forEach((f, i) => tone(sfxBus, { type: 'square', f, t: t + i * 0.08, dur: 0.35, vol: 0.18 })); },
  crash: (t) => {
    noise(sfxBus, { t, dur: 0.5, vol: 0.4, hp: 100, lp: 4000, lp2: 300 });
    tone(sfxBus, { type: 'square', f: 400, f2: 60, t, dur: 0.45, vol: 0.18 });
  },
  bonk: (t) => { tone(sfxBus, { type: 'square', f: 300, f2: 120, t, dur: 0.12, vol: 0.22 }); tone(sfxBus, { type: 'triangle', f: 180, f2: 90, t: t + 0.05, dur: 0.18, vol: 0.25 }); },
  perfect: (t) => { ['C6', 'E6', 'G6', 'C7'].forEach((n, i) => tone(sfxBus, { type: 'pulse', duty: 0.25, f: hz(n), t: t + i * 0.05, dur: 0.18, vol: 0.12 })); },
  sloppy: (t) => tone(sfxBus, { type: 'square', f: 330, f2: 180, t, dur: 0.25, vol: 0.12 }),
  land: (t, k = 0.5) => { tone(sfxBus, { type: 'sine', f: 120, f2: 45, t, dur: 0.12 + 0.1 * k, vol: 0.2 + 0.35 * k }); noise(sfxBus, { t, dur: 0.06 + 0.08 * k, vol: 0.05 + 0.12 * k, hp: 300, lp: 2500 }); },
  boing: (t) => tone(sfxBus, { type: 'square', f: 180, f2: 900, t, dur: 0.3, vol: 0.14 }),
  checkpoint: (t) => { ['G5', 'D6'].forEach((n, i) => tone(sfxBus, { type: 'pulse', duty: 0.5, f: hz(n), t: t + i * 0.09, dur: 0.16, vol: 0.12 })); },
  finish: (t) => {
    ['C5', 'E5', 'G5', 'C6', 'G5', 'C6'].forEach((n, i) => tone(sfxBus, { type: 'pulse', duty: 0.25, f: hz(n), t: t + i * 0.1, dur: i === 5 ? 0.6 : 0.12, vol: 0.13 }));
  },
  lead: (t) => { ['E5', 'A5'].forEach((n, i) => tone(sfxBus, { type: 'square', f: hz(n), t: t + i * 0.07, dur: 0.12, vol: 0.08 })); },
  warn: (t) => tone(sfxBus, { type: 'square', f: 1100, t, dur: 0.05, vol: 0.06 }),
  join: (t) => { ['C5', 'G5'].forEach((n, i) => tone(sfxBus, { type: 'pulse', duty: 0.25, f: hz(n), t: t + i * 0.07, dur: 0.12, vol: 0.12 })); },
  click: (t) => tone(sfxBus, { type: 'square', f: 900, t, dur: 0.03, vol: 0.08 }),
  whoosh: (t) => noise(sfxBus, { t, dur: 0.35, vol: 0.12, hp: 400, lp: 800, lp2: 6000 }),
};

export const audio = {
  muted,
  /** Switch the background track (null = silence). Safe to call every frame. */
  music(name) {
    wanted = name && TRACKS[name] ? name : null;
  },
  /** Quieter music (phones play under the big screen). */
  setMusicVolume(v) {
    musicVolume = v;
    applyMute();
  },
  sfx(name, arg) {
    if (!ctx || ctx.state !== 'running' || muted.sfx || !SFX[name]) return;
    SFX[name](ctx.currentTime + 0.005, arg);
  },
  setMuted(kind, on) {
    muted[kind] = on;
    store.set(`cr-mute-${kind}`, on ? '1' : '0');
    applyMute();
    listeners.forEach((fn) => fn());
  },
  toggle(kind) {
    this.setMuted(kind, !muted[kind]);
  },
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  unlock,
};
