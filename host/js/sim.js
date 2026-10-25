// Dev tool: race bots at full speed (no rendering) to check balance and stability.
// Not loaded by the game. From the host page's browser console:
//
//   const sim = await import('/host/js/sim.js');
//   sim.holdTest(1, 5)        // 5 races on Space: fixed-tilt "holders" vs terrain-reading bots
//   sim.race(0, ['bot', 'human', 'human', 'hold:35'])  // one race, any mix
//   sim.grandPrix(['bot', 'bot', 'human', 'human', 'hold:30', 'hold:40'])
//   sim.done()                // hand the screen back to the normal game loop
//
// Rider kinds: 'bot' (reads the terrain), 'human' (same brain, but 150 ms of network lag
// and shakier hands, like a real phone over the internet), 'hold:N' (holds N° the whole race).

/* global game */
import { players } from './net.js';

const STEP_MS = 1000 / 60;
let T = 0;
let S = null;
const errors = [];
window.addEventListener('error', (e) => errors.push(String(e.message)));

function step(n) {
  for (let i = 0; i < n; i++) {
    T += STEP_MS;
    if (S && S.riders) {
      const t = S.raceTime();
      for (const r of S.riders) {
        const p = r.player;
        if (!p.human) continue;
        p.q.push(S.botTilt(r, t));
        const lagged = p.q.length > 9 ? p.q.shift() : p.q[0]; // ~150 ms behind
        p.tilt += (lagged - p.tilt) * p.reflex;
      }
    }
    game.scene.update(T, STEP_MS);
  }
}

function roster(kinds) {
  for (const [id] of players) players.delete(id);
  kinds.forEach((k, i) => {
    const [kind, arg] = k.split(':');
    const p = { id: `sim${i}`, name: kind === 'hold' ? `HOLD${arg}` : `${kind.toUpperCase()}${i + 1}`, color: '', colorIdx: i % 6, tilt: 0, score: 0, crashes: 0, perfects: 0, totalMs: 0 };
    if (kind === 'bot') Object.assign(p, { kind: 'bot', aggro: 30 + Math.random() * 10, sloppy: 3 + Math.random() * 8, reflex: 0.1 + Math.random() * 0.12 });
    else if (kind === 'human') Object.assign(p, { kind: 'phone', human: true, aggro: 28 + Math.random() * 10, sloppy: 8 + Math.random() * 8, reflex: 0.12 + Math.random() * 0.06, q: [] });
    else Object.assign(p, { kind: 'phone', tilt: Number(arg) || 30 });
    players.set(p.id, p);
  });
}

function runRace(mapIndex) {
  if (!T) {
    game.loop.sleep();
    T = performance.now();
  }
  game.scene.getScenes(true)[0].scene.start('race', { mapIndex });
  S = null;
  step(3);
  S = game.scene.getScene('race');
  S.updatePhones = () => {};
  S.sendSnap = () => {};
  const t0 = performance.now();
  for (let k = 0; k < 24 && !S.ended; k++) step(600);
  const out = S.standings().map((r) => ({
    name: r.player.name,
    finished: r.state === 1,
    seconds: r.state === 1 ? +(r.finishMs / 1000).toFixed(1) : null,
    crashes: r.crashes,
    bonks: r.bonks,
    sloppy: r.sloppySeq,
    perfects: r.perfects,
  }));
  return { map: S.map.key, raceSeconds: +(S.raceTime() / 1000).toFixed(1), simMs: Math.round(performance.now() - t0), errors: errors.splice(0), results: out };
}

/** One race. Returns standings with times and crash/bonk/landing stats. */
export function race(mapIndex, kinds) {
  roster(kinds);
  return runRace(mapIndex);
}

/** Several races of 3 random fixed-tilt holders vs 3 bots. Returns one summary line per race. */
export function holdTest(mapIndex, runs = 5) {
  const lines = [];
  let holderWins = 0;
  for (let i = 0; i < runs; i++) {
    const holds = [15, 20, 25, 30, 35, 40, 45].sort(() => Math.random() - 0.5).slice(0, 3);
    const r = race(mapIndex, [...holds.map((h) => `hold:${h}`), 'bot', 'bot', 'bot']);
    if (r.results[0].name.startsWith('HOLD')) holderWins += 1;
    lines.push(r.results.map((x, k) => `${k + 1}.${x.name} ${x.finished ? `${x.seconds}s` : 'DNF'}`).join('  '));
  }
  return { map: ['world', 'space', 'desert'][mapIndex], holderWins, runs, lines };
}

/** A whole Grand Prix (all three worlds) with one roster. */
export function grandPrix(kinds) {
  roster(kinds);
  return [0, 1, 2].map((m) => runRace(m));
}

/**
 * The real flow, end to end: race → results → next world → … → final results → lobby,
 * exactly as the game runs it (including scene changes and scoring). Returns a timeline,
 * final scores and any errors.
 */
export function fullFlow(kinds) {
  roster(kinds);
  if (!T) {
    game.loop.sleep();
    T = performance.now();
  }
  game.scene.getScenes(true)[0].scene.start('race', { mapIndex: 0 });
  S = null;
  const timeline = [];
  let last = '';
  let scores = [];
  for (let i = 0; i < 60 * 60 * 8; i++) {
    step(1);
    const active = game.scene.getScenes(true).map((s) => s.sys.settings.key).join(',');
    const race = game.scene.getScene('race');
    S = race.sys.isActive() ? race : null;
    if (active !== last) {
      timeline.push(`${(i / 60).toFixed(1)}s ${active}${S?.map ? ` (${S.map.key})` : ''}`);
      last = active;
    }
    const res = game.scene.getScene('results');
    if (res.sys.isActive() && res.final && i % 300 === 0) {
      scores = [...players.values()].sort((a, b) => b.score - a.score).map((p) => `${p.name} ${p.score}pts (${p.crashes} crashes, ${p.perfects} perfect)`);
      res.advance(); // the final screen waits for a click
    }
    if (active === 'lobby' && i > 60) break;
  }
  return { timeline, scores, errors: errors.splice(0) };
}

/** Give the screen back to the real game loop. */
export function done() {
  S = null;
  T = 0;
  game.loop.wake();
  game.scene.getScenes(true)[0].scene.start('lobby');
}
