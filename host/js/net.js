// Host-side networking + the shared player roster.
// Real phones, bots and the keyboard rider all live in `players`, so the
// game scenes never care where an input came from.

/* global io */
import { PLAYERS } from '/shared/rig.js';

const BOT_NAMES = ['Wobbles', 'Spokes', 'Unibot', 'Pedalina', 'Crashley', 'Tippy'];
export const MAX_PLAYERS = PLAYERS.length; // one colour each (handoff: 6 player colours)

/**
 * id -> { id, name, color, colorIdx, kind: 'phone'|'bot'|'keyboard', tilt (deg, + = right edge down),
 *         score, crashes, perfects, totalMs, and for bots: aggro, sloppy, reflex }
 */
export const players = new Map();
export const room = { code: null, joinUrl: null };

const socket = io();
const listeners = new Set();
const lastSent = new Map();

export function onRosterChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function changed() {
  listeners.forEach((fn) => fn());
}

function freeColorIdx(prefer = -1) {
  const used = new Set([...players.values()].map((p) => p.colorIdx));
  if (prefer >= 0 && !used.has(prefer)) return prefer;
  const i = PLAYERS.findIndex((_, k) => !used.has(k));
  return i < 0 ? players.size % PLAYERS.length : i;
}

function addPlayer(p, kind, extra = {}) {
  const colorIdx = freeColorIdx(PLAYERS.findIndex((c) => c.pri.toLowerCase() === String(p.color || '').toLowerCase()));
  players.set(p.id, { ...p, kind, colorIdx, color: PLAYERS[colorIdx].pri, tilt: 0, score: 0, crashes: 0, perfects: 0, totalMs: 0, ...extra });
  changed();
  return players.get(p.id);
}

socket.on('connect', () => {
  // A new connection means a new room; phones from an old room are gone.
  for (const [id, p] of players) if (p.kind === 'phone') players.delete(id);
  socket.emit('host:create', async ({ code }) => {
    room.code = code;
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    let base = location.origin;
    if (local) {
      try {
        base = (await (await fetch('/api/info')).json()).lanBase;
      } catch { /* keep origin */ }
    }
    room.joinUrl = `${base}/play/?room=${code}`;
    changed();
  });
});

socket.on('player:joined', (p) => {
  const me = addPlayer(p, 'phone');
  sendToPlayer(p.id, { phase: 'lobby', status: 'WAITING FOR THE HOST TO START', color: me.color, colorIdx: me.colorIdx });
});

socket.on('player:left', ({ id }) => {
  players.delete(id);
  lastSent.delete(id);
  changed();
});

socket.on('input', ({ id, tilt }) => {
  const p = players.get(id);
  if (p && Number.isFinite(tilt)) p.tilt = Math.max(-75, Math.min(75, tilt));
});

/** Push a status object to one phone (deduped, so it is safe to call every frame). */
export function sendToPlayer(id, state) {
  const p = players.get(id);
  if (!p || p.kind !== 'phone') return;
  const json = JSON.stringify(state);
  if (lastSent.get(id) === json) return;
  lastSent.set(id, json);
  socket.emit('to-player', { id, state });
}

/** Rider positions for every phone in the room to render (sent ~20×/s, dropped if lagging). */
export function broadcastSnap(snap) {
  socket.volatile.emit('snap', snap);
}

export function addBot() {
  if (players.size >= MAX_PLAYERS) return;
  const n = [...players.values()].filter((p) => p.kind === 'bot').length;
  // Each bot gets a personality: how hard it leans, how sloppy it is, how fast it reacts.
  addPlayer({ id: `bot-${Date.now()}-${n}`, name: BOT_NAMES[n % BOT_NAMES.length] }, 'bot', {
    aggro: 30 + Math.random() * 10,
    sloppy: 3 + Math.random() * 8,
    reflex: 0.1 + Math.random() * 0.12,
  });
}

export function addKeyboardRider() {
  if ([...players.values()].some((p) => p.kind === 'keyboard') || players.size >= MAX_PLAYERS) return;
  addPlayer({ id: 'keyboard', name: 'Keyboard' }, 'keyboard');
}

/** Remove one rider from the lobby. Phones get told and sent back to their join screen. */
export function removePlayer(id) {
  const p = players.get(id);
  if (!p) return;
  if (p.kind === 'phone') socket.emit('kick', { id });
  players.delete(id);
  lastSent.delete(id);
  changed();
}

export function removeLocalPlayers() {
  for (const [id, p] of players) if (p.kind !== 'phone') players.delete(id);
  changed();
}

export function resetScores() {
  for (const p of players.values()) Object.assign(p, { score: 0, crashes: 0, perfects: 0, totalMs: 0 });
}
