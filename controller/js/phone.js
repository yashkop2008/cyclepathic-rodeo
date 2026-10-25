// Phone: motion controller + its own view of the race.
//
// Your phone IS the ground. The screen always shows the course level, and the
// phone's real tilt is the course's tilt. Your rider is drawn standing along
// gravity, so they stay upright in the real world, and how far they lean
// against the ground (the balance meter) is how close you are to wiping out.
//
// The host runs the physics and streams rider positions (~20/s); the phone
// builds the same track locally from the shared map data, keeps your rider
// centred, draws everyone else as translucent ghosts, and adds the effects.

/* global io, Phaser */
import { MAPS, buildTrack, groundAt, progressOf, leanLimit, RULES } from '/shared/maps.js';
import { buildWorld, dotTexture, textStyle } from '/shared/art.js';
import { RiderView, warmRig, drawRigAt, PLAYERS, POSES } from '/shared/rig.js';
import { R, STATE, WHY } from '/shared/protocol.js';

const $ = (id) => document.getElementById(id);
const DEG = Math.PI / 180;
const MAX_TILT = 75;
const DEAD_ZONE = 1.5; // degrees that count as perfectly level (not subtracted: tilt stays 1:1)
const VIEW_H = 470; // world px visible top-to-bottom when standing still
const VIEW_H_FAST = 760; // ...and at top speed (zooming out sells the speed)
const DPR = Math.min(2, window.devicePixelRatio || 1); // render sharp on retina screens
const CRASH_MS = 1300;

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const params = new URLSearchParams(location.search);
$('room').value = (params.get('room') || '').toUpperCase();
$('name').value = store.get('cr-name') || '';
// Home-screen installs open straight into this room.
if ($('room').value) $('manifest').href = `manifest.webmanifest?room=${encodeURIComponent($('room').value)}`;

const net = { socket: null, myId: null, snap: null, snapAt: 0, buf: [], lags: [], offset: 0, delay: 100, phase: 'join', color: PLAYERS[0].pri, colorIdx: 0 };

// ---------------------------------------------------------------- fullscreen

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
const root = document.documentElement;
const requestFs = root.requestFullscreen || root.webkitRequestFullscreen;
const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);

// iPhone Safari has no fullscreen API for pages; a home-screen install is the only way to lose the browser bars.
$('ios-tip').hidden = !(isIOS && !standalone && !requestFs);

function goFullscreen() {
  if (!requestFs || isFullscreen()) return;
  try {
    // Fire-and-forget: some browsers never settle these promises, and joining must not wait on them.
    const p = requestFs.call(root, { navigationUI: 'hide' });
    p?.then?.(() => screen.orientation?.lock?.('landscape')?.catch(() => {})).catch(() => {});
  } catch { /* not allowed */ }
}

function refreshFullscreenButton() {
  $('fullscreen').hidden = !requestFs || standalone || isFullscreen();
}
$('fullscreen').onclick = goFullscreen;
document.addEventListener('fullscreenchange', refreshFullscreenButton);
document.addEventListener('webkitfullscreenchange', refreshFullscreenButton);

// ---------------------------------------------------------------- orientation

let landscapeAngle = null; // the landscape orientation the player is holding (90 or 270; 0 on desktops)
let phaser = null; // the Phaser game, created after joining
let barW = 0; // inner width of the progress bar in px (re-measured whenever the layout changes)

function screenAngle() {
  const a = (screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0;
  return ((a % 360) + 360) % 360;
}

/**
 * Tilting a landscape phone far enough makes iOS flip the page to portrait.
 * Instead of interrupting the race with a "rotate" screen, counter-rotate the
 * game so it stays glued to the phone exactly as it was in landscape.
 */
function layout() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const portrait = h > w;
  const a = screenAngle();
  if (!portrait) landscapeAngle = a;

  const playing = document.body.classList.contains('playing');
  // The whole game is landscape: ask to rotate on the join screen too. Mid-race flips are handled below instead.
  document.body.classList.toggle('need-rotate', portrait && (!playing || landscapeAngle === null));

  const stage = $('stage');
  let sw = w;
  let sh = h;
  let rot = 0;
  if (portrait && landscapeAngle !== null) {
    rot = (((landscapeAngle - a) % 360) + 360) % 360;
    if (rot > 180) rot -= 360;
    sw = h;
    sh = w;
  }
  stage.style.width = `${sw}px`;
  stage.style.height = `${sh}px`;
  // HUD scale: designed for a 390 px-tall landscape screen.
  document.documentElement.style.setProperty('--ui', Math.max(0.6, Math.min(1.2, Math.min(sh / 390, sw / 760))).toFixed(3));
  barW = 0; // re-measure the progress bar
  stage.style.transform = `translate(-50%, -50%) rotate(${rot}deg)`;
  // Phaser measures its parent with getBoundingClientRect (which sees the rotation), so size it by
  // hand, at device resolution, displayed at CSS size.
  if (phaser) {
    phaser.scale.resize(Math.round(sw * DPR), Math.round(sh * DPR));
    phaser.scale.setZoom(1 / DPR);
  }
}
layout();
window.addEventListener('resize', layout);
window.addEventListener('orientationchange', () => setTimeout(layout, 50));
screen.orientation?.addEventListener?.('change', layout);

// ---------------------------------------------------------------- tilt input

let rawTilt = 0; // degrees: + = right edge of the screen dipped down
let smoothTilt = 0;
let invert = store.get('cr-invert') === '1';
let gotSensor = false;
let touchDir = 0;
let touchTilt = 0;

// Turn the browser's orientation angles into the real "up" direction in phone
// coordinates, then measure how far the screen's right edge has dipped below
// level. That angle is the course's tilt, 1:1, whether the phone is held flat
// like a tray or upright like a steering wheel, and it needs no calibration.
function onOrientation(e) {
  if (e.beta == null || e.gamma == null) return;
  if (!gotSensor) {
    // Sensor woke up late: drop the touch fallback.
    $('touch').classList.remove('on');
    $('sensor-hint').textContent = '';
  }
  gotSensor = true;
  const b = e.beta * DEG;
  const g = e.gamma * DEG;
  const up = [-Math.cos(b) * Math.sin(g), Math.sin(b), Math.cos(b) * Math.cos(g)];
  // Measure against the landscape the game is drawn in, even if iOS has flipped the page.
  const a = landscapeAngle ?? screenAngle();
  const right = a === 90 ? [0, -1, 0] : a === 270 ? [0, 1, 0] : a === 180 ? [-1, 0, 0] : [1, 0, 0];
  const dip = -(up[0] * right[0] + up[1] * right[1] + up[2] * right[2]);
  rawTilt = Math.asin(Math.max(-1, Math.min(1, dip))) / DEG;
}

async function enableSensors() {
  // iOS 13+ needs an explicit permission prompt from a user tap.
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) await DeviceOrientationEvent.requestPermission();
  } catch { /* denied: fall back to touch */ }
  window.addEventListener('deviceorientation', onOrientation);
  setTimeout(() => {
    if (gotSensor) return;
    $('touch').classList.add('on');
    $('sensor-hint').textContent = window.isSecureContext ? 'NO MOTION SENSOR: TOUCH MODE' : 'MOTION NEEDS HTTPS: TOUCH MODE';
  }, 1500);
}

function hold(btn, dir) {
  const down = (e) => { e.preventDefault(); touchDir = dir; };
  const up = (e) => { e.preventDefault(); if (touchDir === dir) touchDir = 0; };
  btn.addEventListener('pointerdown', down);
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointerleave', up);
  btn.addEventListener('pointercancel', up);
}
hold($('left'), -1);
hold($('right'), 1);

/** The course tilt in degrees: your phone's real tilt, lightly smoothed. */
function currentTilt() {
  if (!gotSensor) {
    touchTilt = touchDir ? Math.max(-45, Math.min(45, touchTilt + touchDir * 3)) : touchTilt * 0.85;
    return touchTilt;
  }
  const t = smoothTilt * (invert ? -1 : 1);
  return Math.abs(t) < DEAD_ZONE ? 0 : Math.max(-MAX_TILT, Math.min(MAX_TILT, t));
}

setInterval(() => {
  smoothTilt += (rawTilt - smoothTilt) * 0.5;
  const tilt = currentTilt();
  net.socket?.emit('input', { tilt: Math.round(tilt * 10) / 10 });
  if (document.body.classList.contains('waiting')) drawDemo(tilt);
}, 33);

$('invert').onclick = () => { invert = !invert; store.set('cr-invert', invert ? '1' : '0'); };

// ---------------------------------------------------------------- join screen + demo rider

let joinSpin = 0;
(function joinLoop() {
  if (document.body.classList.contains('playing')) return;
  const c = $('join-rider');
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  const t = performance.now();
  joinSpin += 0.12;
  const hop = Math.abs(Math.sin(t / 320)) * 18;
  drawRigAt(ctx, 120, 176 - hop, Math.sin(t / 320) * 0.12, 0.85, 'classic', Math.floor(t / 1200) % PLAYERS.length, { pose: hop > 10 ? 'airborne' : 'riding', wheelAngle: joinSpin });
  requestAnimationFrame(joinLoop);
})();

// Lobby demo: the box is your phone, the ground is level with your screen,
// and the rider stays upright in the real world as you tilt.
let demoSpin = 0;
function drawDemo(tilt) {
  const c = $('demo');
  const ctx = c.getContext('2d');
  const W = c.width;
  const H = c.height;
  const limit = leanLimit(MAPS[0], null);
  const lean = Math.abs(tilt);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#56CFE1'); g.addColorStop(1, '#C8F7FF');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#8D5B34'; ctx.fillRect(0, H - 70, W, 70);
  ctx.fillStyle = '#52D14C'; ctx.fillRect(0, H - 78, W, 26);
  ctx.fillStyle = '#1E5E1A'; ctx.fillRect(0, H - 82, W, 5);
  demoSpin += tilt * 0.006;
  const pose = lean > limit ? 'crash' : lean > limit * 0.75 ? 'panic' : 'riding';
  drawRigAt(ctx, W / 2, H - 80 - 22 * 0.95, -tilt * DEG, 0.95, 'classic', net.colorIdx, { pose, wheelAngle: demoSpin });
  ctx.font = '28px "Lilita One"';
  ctx.textAlign = 'center';
  ctx.lineWidth = 7; ctx.strokeStyle = '#1E1B2E'; ctx.fillStyle = '#FFD60A';
  const msg = lean > limit ? 'TOO STEEP!' : tilt > 4 ? 'ROLLS RIGHT >>' : tilt < -4 ? '<< ROLLS LEFT' : 'LEVEL';
  ctx.strokeText(msg, W / 2, 40); ctx.fillText(msg, W / 2, 40);
  $('demo-state').textContent = `GROUND ${Math.round(tilt)}°${lean > limit ? ' · WIPEOUT!' : lean > limit * 0.75 ? ' · CAREFUL' : ''}`;
  $('demo-state').style.color = lean > limit ? '#C81E3C' : lean > limit * 0.75 ? '#CCA800' : '#1E1B2E';
}

// ---------------------------------------------------------------- HUD

const fmtTime = (ms) => {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
};
const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

function drawRank(place) {
  const fill = ['#FFD60A', '#CBD5E1', '#D97706'][place - 1] || '#5B6EE1';
  $('rank').innerHTML = place
    ? `<svg viewBox="-42 -48 84 98"><path d="M-40 -46H40V14L0 46L-40 14Z" fill="${fill}" stroke="#1E1B2E" stroke-width="6" stroke-linejoin="round"/>
       <text y="6" text-anchor="middle" font-family="Lilita One" font-size="34" fill="#fff" stroke="#1E1B2E" stroke-width="7" paint-order="stroke">${ordinal(place)}</text></svg>`
    : '';
}

let zonesFor = null;
function drawZones(limit) {
  if (zonesFor === limit) return;
  zonesFor = limit;
  // Gauge spans ±60° of lean over a half circle; green / yellow / red zones.
  const arc = (a0, a1, color) => {
    const p = (deg) => { const a = (deg / 60) * 90 * DEG; return `${Math.sin(a) * 58} ${-Math.cos(a) * 58}`; };
    return `<path d="M${p(a0)} A58 58 0 0 1 ${p(a1)}" fill="none" stroke="${color}" stroke-width="14" />`;
  };
  const y = limit * 0.75;
  $('zones').innerHTML =
    `<path d="M-58 0 A58 58 0 0 1 58 0" fill="none" stroke="#1E1B2E" stroke-width="22" />` +
    arc(-60, -limit, '#FF3B5C') + arc(-limit, -y, '#FFD60A') + arc(-y, y, '#52D14C') + arc(y, limit, '#FFD60A') + arc(limit, 60, '#FF3B5C');
}

let calloutTimer = null;
function callout(text, sub = '', color = '#ffffff', ms = 1100) {
  const el = $('callout');
  el.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
  el.style.color = color;
  el.classList.remove('on');
  void el.offsetWidth; // restart the pop animation
  el.classList.add('on');
  clearTimeout(calloutTimer);
  calloutTimer = setTimeout(() => el.classList.remove('on'), ms);
}

// The HUD runs every frame, so it only touches the page when a value actually changes,
// and moves things with GPU-friendly transforms (no layout work).
const domCache = new Map();
function setText(id, text) {
  if (domCache.get(id) === text) return;
  domCache.set(id, text);
  $(id).textContent = text;
}
function setStyle(id, prop, value) {
  const k = `${id}.${prop}`;
  if (domCache.get(k) === value) return;
  domCache.set(k, value);
  $(id).style[prop] = value;
}

const marks = new Map(); // id -> { el, p (eased progress) }
const hud = { needle: 0, fill: 0 };

function updateHud(scene, snap, t, dt) {
  const map = MAPS[snap.m];
  const track = scene.track;
  const rows = snap.r;
  const ease = 1 - Math.pow(0.001, dt / 1000); // frame-rate independent smoothing (~0.1 s)
  const prog = (row) => (row[R.STATE] === STATE.FINISHED ? 1 : progressOf(track, row[R.X]));
  const order = [...rows].sort((a, b) => {
    const fa = a[R.STATE] === STATE.FINISHED;
    const fb = b[R.STATE] === STATE.FINISHED;
    if (fa && fb) return a[R.FINISH_MS] - b[R.FINISH_MS];
    if (fa !== fb) return fa ? -1 : 1;
    return prog(b) - prog(a);
  });
  const me = rows.find((r) => r[R.ID] === net.myId);
  const place = me ? order.indexOf(me) + 1 : 0;
  if (place !== updateHud.place) drawRank((updateHud.place = place));
  setText('world', map.name);
  setStyle('bar-fill', 'background', map.barColor);

  // Progress bar: everything eases toward its target, positioned with transforms.
  if (!barW) barW = $('bar').clientWidth - 6;
  hud.fill += ((order[0] ? prog(order[0]) : 0) - hud.fill) * ease;
  $('bar-fill').style.transform = `scaleX(${Math.max(0.02, hud.fill)})`;
  const seen = new Set();
  for (const row of rows) {
    const id = row[R.ID];
    seen.add(id);
    let m = marks.get(id);
    if (!m) {
      const el = document.createElement('div');
      el.className = `mark${id === net.myId ? ' me' : ''}`;
      el.style.background = PLAYERS[row[R.COLOR] % PLAYERS.length].pri;
      $('bar').appendChild(el);
      m = { el, p: prog(row) };
      marks.set(id, m);
    }
    m.p += (prog(row) - m.p) * ease;
    m.el.style.transform = `translateX(${(m.p * barW).toFixed(1)}px)`;
  }
  for (const [id, m] of marks) if (!seen.has(id)) (m.el.remove(), marks.delete(id));

  setText('time', fmtTime(me && me[R.FINISH_MS] ? me[R.FINISH_MS] : t));
  setText('count', snap.ph === 'countdown' && snap.cd > 0 ? String(snap.cd) : '');

  const tilt = currentTilt();
  $('tilt-phone').setAttribute('transform', `rotate(${tilt.toFixed(1)})`);

  // Balance: how steep is the ground under you right now (tilt + slope), against your limit here.
  const gnd = me ? groundAt(track, me[R.X], t) : null;
  const limit = leanLimit(map, gnd?.surface);
  drawZones(Math.round(limit));
  const racing = me && (me[R.STATE] === STATE.RACING || me[R.STATE] === STATE.GHOST);
  const lean = racing ? tilt + (snap.ph === 'race' ? snap.gt / DEG : 0) + (gnd ? gnd.slope / DEG : 0) : 0;
  const a = Math.max(-100, Math.min(100, (lean / 60) * 90));
  hud.needle += (a - hud.needle) * Math.min(1, ease * 2.5);
  const rot = `rotate(${hud.needle.toFixed(1)})`;
  $('needle').setAttribute('transform', rot);
  $('needle-in').setAttribute('transform', rot);
  const inAir = me && POSES[me[R.POSE]] === 'airborne';
  let label = `GROUND ${Math.round(lean)}°`;
  let color = '#fff';
  if (!racing) label = me?.[R.STATE] === STATE.CRASHED ? 'OUCH!' : 'BALANCE';
  else if (inAir) {
    const l = Math.abs(lean);
    label = l < RULES.perfectLean ? 'LANDING: PERFECT' : l < RULES.sloppyLean ? 'LANDING: OK' : 'LEVEL OUT!';
    color = l < RULES.perfectLean ? '#52D14C' : l < RULES.sloppyLean ? '#ffffff' : '#FF3B5C';
  } else if (Math.abs(lean) > limit) [label, color] = ['TOO STEEP!', '#FF3B5C'];
  else if (Math.abs(lean) > limit * 0.75) [label, color] = ['CAREFUL', '#FFD60A'];
  setText('balance-lbl', label);
  setStyle('balance-lbl', 'color', color);

  const god = me && me[R.STATE] === STATE.FINISHED && rows.some((r) => r[R.STATE] !== STATE.FINISHED);
  if ($('banner').hidden === god) $('banner').hidden = !god;
  if (god) setText('banner', "YOU'RE A GRAVITY GOD! TILT TO TIP EVERYONE ELSE'S WORLD");
}

// ---------------------------------------------------------------- snapshot interpolation

/**
 * Snapshots arrive ~20×/s with network jitter. Instead of snapping to the newest one,
 * render a little in the past (on the host's clock) and blend between the two snapshots
 * around that moment. The delay adapts to how jittery the connection is.
 */
function onSnap(snap) {
  const at = performance.now();
  net.snap = snap;
  net.snapAt = at;
  if (typeof snap.ht !== 'number') return;
  const buf = net.buf;
  if (buf.length && snap.ht < buf[buf.length - 1].ht) buf.length = 0; // host restarted
  buf.push({ ht: snap.ht, at, snap });
  if (buf.length > 16) buf.shift();
  const lag = net.lags;
  lag.push(at - snap.ht);
  if (lag.length > 60) lag.shift();
  net.offset = Math.min(...lag); // best case: clock offset + minimum latency
  const sorted = lag.map((l) => l - net.offset).sort((a, b) => a - b);
  const p90 = sorted[Math.floor(sorted.length * 0.9)] || 0;
  net.delay = Math.max(70, Math.min(250, p90 + 40));
}

function sampleSnap() {
  const buf = net.buf;
  if (!buf.length) return net.snap; // older host without timestamps: just use the latest
  const renderHt = performance.now() - net.offset - net.delay;
  const last = buf[buf.length - 1];
  if (renderHt >= last.ht) return blend(last, last, 0, Math.min(renderHt - last.ht, 150)); // ran dry: extrapolate briefly
  if (renderHt <= buf[0].ht) return blend(buf[0], buf[0], 0, 0);
  for (let i = buf.length - 1; i > 0; i--) {
    if (buf[i - 1].ht <= renderHt) {
      const a = buf[i - 1];
      const b = buf[i];
      return blend(a, b, (renderHt - a.ht) / Math.max(1, b.ht - a.ht), 0, b.ht - renderHt);
    }
  }
  return last.snap;
}

function blend(A, B, k, ahead, behind = 0) {
  const sa = A.snap;
  const sb = B.snap;
  const steps = ahead / 16.67;
  const prev = new Map(sa.r.map((r) => [r[R.ID], r]));
  const lerpAngle = (x, y) => x + Math.atan2(Math.sin(y - x), Math.cos(y - x)) * k;
  const rows = sb.r.map((rb) => {
    const ra = prev.get(rb[R.ID]) || rb;
    const row = rb.slice();
    const jump = Math.hypot(rb[R.X] - ra[R.X], rb[R.Y] - ra[R.Y]) > 300; // respawn: don't slide across the map
    const L = (i) => (jump ? rb[i] : ra[i] + (rb[i] - ra[i]) * k);
    row[R.X] = L(R.X) + rb[R.VX] * steps;
    row[R.Y] = L(R.Y) + rb[R.VY] * steps;
    row[R.VX] = L(R.VX);
    row[R.VY] = L(R.VY);
    row[R.GRAV] = jump ? rb[R.GRAV] : lerpAngle(ra[R.GRAV], rb[R.GRAV]);
    row[R.SWAY] = L(R.SWAY);
    if (rb[R.CRASH_T]) row[R.CRASH_T] = Math.max(0, rb[R.CRASH_T] - behind + ahead);
    return row;
  });
  const t = sa.t + (sb.t - sa.t) * k + (sb.ph === 'race' ? ahead : 0);
  return { ...sb, t, r: rows };
}

// ---------------------------------------------------------------- server status

function applyState(s) {
  if (s.phase === 'kicked') {
    // The host removed us from the lobby: back to the join screen, no auto-reconnect.
    net.kicked = true;
    net.socket?.disconnect();
    document.body.classList.remove('playing', 'waiting');
    $('err').textContent = 'The host removed you from the room. You can join again.';
    return;
  }
  net.phase = s.phase || net.phase;
  if (s.color) {
    net.color = s.color;
    document.documentElement.style.setProperty('--c', s.color);
  }
  if (Number.isInteger(s.colorIdx)) net.colorIdx = s.colorIdx;
  const waiting = s.phase === 'lobby' || s.phase === 'results' || s.phase === 'gone';
  document.body.classList.toggle('waiting', waiting);
  if (s.phase === 'results') {
    $('wait-title').textContent = s.final ? (s.place === 1 ? 'GRAND PRIX CHAMPION!' : `GRAND PRIX: ${ordinal(s.place)}`.toUpperCase()) : 'RACE OVER!';
    $('wait-msg').textContent = s.status || '';
  } else if (s.phase === 'gone') {
    $('wait-title').textContent = 'HOST LEFT';
    $('wait-msg').textContent = 'Reloading...';
    setTimeout(() => location.reload(), 2500);
  } else if (s.phase === 'lobby') {
    $('wait-title').textContent = "YOU'RE IN!";
    $('wait-msg').textContent = s.status || 'WAITING FOR THE HOST TO START';
  }
}

// ---------------------------------------------------------------- rendering

class PhoneScene extends Phaser.Scene {
  constructor() {
    super('phone');
  }

  create() {
    this.mapIndex = -1;
    this.riders = new Map();
    this.viewH = VIEW_H;
    this.cameras.main.setBackgroundColor('#56CFE1');
    this.scale.on('resize', () => this.fitZoom());
    this.fitZoom();
  }

  fitZoom() {
    this.cameras.main.setZoom(this.scale.height / this.viewH);
  }

  buildMap(i, rows) {
    this.children.list.slice().forEach((o) => o.destroy());
    this.riders.clear();
    this.mapIndex = i;
    this.map = MAPS[i];
    this.track = buildTrack(this.map);
    this.cameras.main.setBackgroundColor(this.map.theme.sky[0]);
    // Parallax maths uses the camera's width in screen pixels (that's how Phaser's scroll factor works).
    this.world = buildWorld(this, this.map, this.track, { parallax: 0.35, viewW: this.scale.width, cull: true });
    for (const row of rows) warmRig(this, this.map.outfit, row[R.COLOR], row[R.ID] === net.myId ? 1.5 : 1);
    // Dust kicked up by wheels and landings, crash stars, and speed streaks when you're flying.
    this.dust = this.add.particles(0, 0, dotTexture(this), {
      emitting: false,
      lifespan: { min: 300, max: 650 },
      speed: { min: 40, max: 200 },
      angle: { min: 200, max: 340 },
      gravityY: 700 * this.map.gravity,
      scale: { start: 1.6, end: 0.3 },
      alpha: { start: 0.9, end: 0 },
      tint: this.map.theme.top,
    }).setDepth(15);
    this.stars = this.add.particles(0, 0, dotTexture(this), {
      emitting: false,
      lifespan: 700,
      speed: { min: 120, max: 320 },
      scale: { start: 1.4, end: 0 },
      tint: [0xffd60a, 0xffffff, 0xff3b5c],
    }).setDepth(30);
    this.streaks = this.add.particles(0, 0, dotTexture(this), {
      emitting: false,
      lifespan: 220,
      scaleX: { min: 6, max: 14 },
      scaleY: 0.35,
      alpha: { start: 0.6, end: 0 },
    }).setDepth(30);
  }

  rider(row) {
    const id = row[R.ID];
    let r = this.riders.get(id);
    if (r) return r;
    const mine = id === net.myId;
    const color = PLAYERS[row[R.COLOR] % PLAYERS.length].pri;
    r = {
      mine,
      init: false,
      x: 0, y: 0, spin: 0, vx: 0,
      state: row[R.STATE],
      seq: { land: row[R.LAND_SEQ], crash: row[R.CRASH_SEQ], perfect: row[R.PERFECT_SEQ], pad: row[R.PAD_SEQ], cp: row[R.CP], sloppy: row[R.SLOPPY_SEQ], bonk: row[R.BONK_SEQ] },
      view: new RiderView(this, {
        colorIdx: row[R.COLOR],
        outfit: this.map.outfit,
        res: mine ? 1.5 : 1,
        label: mine ? 'YOU' : row[R.NAME].toUpperCase(),
        labelStyle: textStyle(mine ? 22 : 16, color),
        depth: mine ? 20 : 10,
      }),
    };
    this.riders.set(id, r);
    return r;
  }

  update(time, dt) {
    // Smooth motion: render slightly in the past, between two real snapshots.
    const snap = sampleSnap();
    if (!snap || (snap.ph !== 'race' && snap.ph !== 'countdown')) return;
    if (snap.m !== this.mapIndex) this.buildMap(snap.m, snap.r);
    const cam = this.cameras.main;
    const t = snap.t;
    const seen = new Set();
    let me = null;
    let leader = null;

    for (const row of snap.r) {
      const id = row[R.ID];
      seen.add(id);
      const r = this.rider(row);
      const state = row[R.STATE];
      const crashed = state === STATE.CRASHED;
      if (crashed && r.state !== STATE.CRASHED) {
        r.crashX = r.x;
        r.crashY = r.y;
        r.crashVx = r.vx;
        this.stars.explode(16, r.x, r.y - 40);
      }
      r.state = state;

      let dx;
      let dy;
      let angle;
      const grav = r.mine && (state === STATE.RACING || state === STATE.GHOST) ? currentTilt() * DEG + (snap.ph === 'race' ? snap.gt : 0) : row[R.GRAV];
      if (crashed) {
        // Rider and unicycle tumble over together in a little hop
        const k = Math.min(1, row[R.CRASH_T] / CRASH_MS);
        dx = r.crashX + r.crashVx * 8 * k;
        dy = r.crashY - Math.sin(Math.PI * k) * 60;
        angle = -grav + k * 6;
      } else {
        r.x = row[R.X];
        r.y = row[R.Y];
        r.vx = row[R.VX];
        dx = r.x;
        dy = r.y;
        angle = -grav + row[R.SWAY];
      }
      r.speed = Math.hypot(row[R.VX], row[R.VY]);
      r.spin += (row[R.VX] / 22) * (dt / 16.67);
      r.dx = dx;
      r.dy = dy;

      const ground = groundAt(this.track, dx, t).y;
      // Opponents are ghosts (handoff rule); everyone fades while invulnerable after a respawn.
      let alpha = r.mine ? 1 : 0.5;
      if (state === STATE.GHOST) alpha *= 0.45;
      if (crashed) alpha *= 1 - Math.max(0, (row[R.CRASH_T] - 900) / 400);
      r.view.set(dx, dy, angle, r.spin, POSES[row[R.POSE]] || 'riding', alpha, ground);

      // Dust trail when rolling fast, bursts on landings
      const inAir = POSES[row[R.POSE]] === 'airborne';
      if (!crashed && !inAir && r.speed > 5 && Math.random() < r.speed / 22) this.dust.emitParticleAt(dx - Math.sign(row[R.VX]) * 18, ground, 1);
      if (row[R.LAND_SEQ] !== r.seq.land) {
        r.seq.land = row[R.LAND_SEQ];
        this.dust.explode(Math.min(28, 6 + Math.round(row[R.LAND_HIT] * 2)), dx, ground);
        if (r.mine) this.thud(r, row[R.LAND_HIT]);
      }
      if (r.mine) this.myEvents(r, row);
      if (r.mine) me = r;
      if (!leader || row[R.X] > leader.x) leader = r;
    }
    for (const [id, r] of this.riders) if (!seen.has(id)) (r.view.destroy(), this.riders.delete(id));

    const focus = me || leader; // spectators (joined mid-race) follow the leader
    if (!focus) return;
    cam.centerOn(focus.dx, focus.dy - 70);

    // The faster you go, the more the camera pulls back, and streaks rush past.
    const targetH = VIEW_H + Math.min(1, focus.speed / 22) * (VIEW_H_FAST - VIEW_H);
    this.viewH += (targetH - this.viewH) * Math.min(1, dt / 400);
    this.fitZoom();
    if (focus.speed > 10 && Math.random() < (focus.speed - 9) / 8) {
      const v = cam.worldView;
      const dir = Math.sign(focus.vx) || 1;
      this.streaks.setParticleSpeed(-dir * (900 + focus.speed * 40), 0);
      this.streaks.emitParticleAt(Phaser.Math.Between(v.x, v.right) + dir * v.width * 0.3, Phaser.Math.Between(v.y, v.bottom), 1);
    }
    this.world.update(t, cam.worldView);
    updateHud(this, snap, t, dt); // every frame, so the bar and meter glide instead of ticking
  }

  /** Your own events: callouts, buzz, shake. */
  myEvents(r, row) {
    const s = r.seq;
    if (row[R.CRASH_SEQ] !== s.crash) {
      s.crash = row[R.CRASH_SEQ];
      callout(WHY[row[R.CRASH_WHY]] || 'CRASH!', 'BACK TO THE LAST CHECKPOINT', '#FF3B5C', 1400);
      this.cameras.main.shake(350, 0.02);
      navigator.vibrate?.([120, 60, 200]);
    }
    if (row[R.PERFECT_SEQ] !== s.perfect) {
      s.perfect = row[R.PERFECT_SEQ];
      callout('PERFECT!', 'SPEED BOOST', '#FFD60A');
      navigator.vibrate?.([30, 40, 30]);
    }
    if (row[R.BONK_SEQ] !== s.bonk) {
      s.bonk = row[R.BONK_SEQ];
      callout('BONK!', 'TIME IT BETTER', '#FF6D00', 1000);
      this.cameras.main.shake(250, 0.015);
      navigator.vibrate?.([80, 40, 80]);
    }
    if (row[R.SLOPPY_SEQ] !== s.sloppy) {
      s.sloppy = row[R.SLOPPY_SEQ];
      callout('SLOPPY LANDING', 'LEVEL OUT TO KEEP YOUR SPEED', '#FFB74D', 1000);
      navigator.vibrate?.(60);
    }
    if (row[R.PAD_SEQ] !== s.pad) {
      s.pad = row[R.PAD_SEQ];
      callout('BOING!', '', '#00F5D4', 700);
    }
    if (row[R.CP] !== s.cp) {
      if (row[R.CP] > s.cp) callout('CHECKPOINT!', '', '#52D14C', 900);
      s.cp = row[R.CP];
    }
    if (row[R.STATE] === STATE.FINISHED && !r.finished) {
      r.finished = true;
      callout('FINISHED!', fmtTime(row[R.FINISH_MS]), '#52D14C', 2200);
      navigator.vibrate?.([60, 60, 60, 60, 200]);
    }
  }

  /** Your own landing: the harder you hit, the bigger the thud. */
  thud(r, hit) {
    const k = Math.min(1, hit / 16);
    this.cameras.main.shake(100 + k * 200, 0.003 + k * 0.016);
    navigator.vibrate?.(Math.round(15 + k * 100));
  }
}

// ---------------------------------------------------------------- joining

let gameStarted = false;

async function startGame() {
  await Promise.race([document.fonts.load('32px "Lilita One"'), new Promise((r) => setTimeout(r, 2500))]).catch(() => {});
  // (Not `window.game`: the #game element already owns that name.) Exposed as window.rodeo for debugging.
  phaser = window.rodeo = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#56CFE1',
    antialias: true,
    width: Math.round(window.innerWidth * DPR),
    height: Math.round(window.innerHeight * DPR),
    scale: { mode: Phaser.Scale.NONE, zoom: 1 / DPR },
    scene: [PhoneScene],
  });
  phaser.events.once('ready', layout);
}

$('join-btn').onclick = async () => {
  const room = $('room').value.trim().toUpperCase();
  const name = $('name').value.trim() || 'RIDER';
  if (room.length !== 4) { $('err').textContent = 'Enter the 4-letter room code'; return; }
  store.set('cr-name', name);
  $('err').textContent = '';
  net.kicked = false;
  $('manifest').href = `manifest.webmanifest?room=${encodeURIComponent(room)}`;
  await enableSensors(); // must run inside this tap for iOS
  goFullscreen(); // Android / iPad: real fullscreen + landscape lock
  try { navigator.wakeLock?.request('screen').catch(() => {}); } catch { /* optional */ }

  net.socket?.disconnect();
  const socket = io();
  net.socket = socket;
  socket.on('connect', () => {
    socket.emit('player:join', { room, name }, (res) => {
      if (!res?.ok) { $('err').textContent = res?.error || 'Could not join'; document.body.classList.remove('playing'); return; }
      net.myId = res.id;
      net.colorIdx = Math.max(0, PLAYERS.findIndex((p) => p.pri.toLowerCase() === String(res.color).toLowerCase()));
      document.body.classList.add('playing');
      applyState({ color: res.color, status: 'WAITING FOR THE HOST TO START', phase: 'lobby' });
      refreshFullscreenButton();
      layout();
      if (!gameStarted) {
        gameStarted = true;
        startGame();
      }
    });
  });
  socket.on('state', applyState);
  socket.on('snap', onSnap);
  socket.on('disconnect', () => !net.kicked && callout('RECONNECTING...', '', '#ffffff', 2000));
};
