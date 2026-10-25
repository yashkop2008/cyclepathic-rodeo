// Worlds and tracks, shared by the host (physics) and phones (rendering).
//
// A track is built from a list of designed features (climbs, drops, kickers
// over gaps, bounce pads, rotating platforms, low-grip patches). Each one asks
// for a different tilt, so "tilt and hold" either crashes on the drops or
// stalls on the climbs. Both sides build the identical track from this data,
// so geometry never goes over the network.

// Crash rules, shared so phones can show the same limits the host enforces (degrees).
export const RULES = {
  crashLean: 50, // lean (tilt + slope) you can hold on full-grip ground; scaled by √grip
  // Landings are only judged after real air; little hops off bumps just land.
  landJudgeMs: 500,
  perfectLean: 14, // land within this of level = PERFECT speed boost
  sloppyLean: 28, // land more crooked than this = SLOPPY, lose speed (holding a big tilt costs you here)
  landCrashLean: 62, // land more crooked than this = crash
  hardImpact: 24, // px/step into the ground: only a crash if you also land crooked (> 30°)
  // Phones are ~0.1–0.2 s behind over the internet, so the host judges with the
  // best tilt the player had in this window: leveling out "just in time" counts.
  forgiveMs: 250,
};

/** Lean limit in degrees on a given surface. */
export function leanLimit(map, surface) {
  return RULES.crashLean * Math.sqrt(surfaceProps(map, surface).grip);
}

export const BASE_Y = 600;
export const STEP = 30; // terrain sample spacing (px)
export const PIT = 1400; // how far gaps drop (off-screen)

// Surfaces: grip lowers the lean you can survive; drag slows you while rolling on it.
export const SURFACES = {
  grass: { grip: 1, drag: 0.002, label: 'GRASS' },
  mud: { grip: 0.62, drag: 0.03, label: 'MUD' },
  moonrock: { grip: 0.8, drag: 0.0015, label: 'MOON ROCK' }, // dusty: a bit less forgiving than grass
  metal: { grip: 0.62, drag: 0.0008, label: 'SLICK METAL' },
  hardpan: { grip: 1, drag: 0.0016, label: 'HARDPAN' },
  sand: { grip: 0.72, drag: 0.024, label: 'LOOSE SAND' },
  quicksand: { grip: 0.45, drag: 0.06, label: 'QUICKSAND' },
};

export const MAPS = [
  {
    key: 'world',
    name: 'WORLD 1: SUNNY GRASSLAND',
    short: 'SUNNY GRASSLAND',
    outfit: 'classic',
    gravity: 1,
    air: 1,
    base: 'grass',
    platform: 'seesaw',
    pad: 'spring',
    barColor: '#52D14C',
    seed: 11,
    features: [
      ['flat', 700],
      ['hills', 1400, 55, 700],
      ['down', 700, 240],
      ['flat', 300],
      ['kicker', 320, 70], ['gap', 240], ['down', 600, 160],
      ['checkpoint'],
      ['pendulum', 300, 190, 1.3, 3400], ['flat', 600],
      ['bumps', 4, 26, 290],
      ['up', 650, 300],
      ['flat', 250],
      ['down', 900, 430],
      ['bobber', 350, 280, 1500], ['surface', 'mud', 700],
      ['checkpoint'],
      ['pad', 15], ['gap', 360], ['flat', 300],
      ['hills', 1200, 70, 600],
      ['platform', 440],
      ['flat', 200],
      ['checkpoint'],
      ['down', 700, 260], ['kicker', 260, 60], ['gap', 280], ['down', 500, 130],
      ['bumps', 3, 32, 340],
      ['pendulum', 250, 180, 1.3, 3000], ['flat', 500],
      ['up', 520, 220],
      ['finish'],
    ],
    theme: {
      sky: [0x56cfe1, 0xc8f7ff],
      far: 0x80ed99, far2: 0x5fd38a,
      top: 0x52d14c, topHi: 0x7ee36f, topLine: 0x1e5e1a,
      dirt: 0x8d5b34, dirt2: 0x74482a, dirtLine: 0x4a2c18, pebble: 0x6b4226,
    },
  },
  {
    key: 'space',
    name: 'WORLD 2: LOW-GRAVITY SPACE',
    short: 'LOW-GRAVITY SPACE',
    outfit: 'astronaut',
    gravity: 0.4,
    air: 0.45,
    base: 'moonrock',
    platform: 'ring',
    pad: 'hover',
    barColor: '#B5179E',
    seed: 23,
    features: [
      ['flat', 700],
      ['hills', 1500, 90, 900],
      ['flat', 650], ['pad', 10], ['gap', 380], ['down', 700, 220],
      ['checkpoint'],
      ['gate', 450, 2600], ['surface', 'metal', 900],
      ['bumps', 4, 34, 320],
      ['up', 700, 320],
      ['bobber', 300, 300, 2600], ['flat', 600],
      ['down', 900, 420],
      ['checkpoint'],
      ['flat', 450], ['pad', 11], ['gap', 460], ['flat', 300],
      ['platform', 460],
      ['pendulum', 220, 200, 1.25, 3800], ['flat', 400],
      ['gate', 350, 2000], ['surface', 'metal', 700],
      ['checkpoint'],
      ['hills', 1200, 70, 600], // max ~36°: keep every climb under the lean limit
      ['down', 700, 260], ['kicker', 300, 90], ['gap', 320], ['down', 700, 260],
      ['up', 600, 220],
      ['finish'],
    ],
    theme: {
      sky: [0x130d26, 0x381e56],
      far: 0x2a1d4a, far2: 0x3a2a63,
      top: 0x7c6fa6, topHi: 0x9d91c9, topLine: 0x211838,
      dirt: 0x5c4d8a, dirt2: 0x4a3e6d, dirtLine: 0x211838, pebble: 0x433766,
    },
  },
  {
    key: 'desert',
    name: 'WORLD 3: DUSTY DESERT',
    short: 'DUSTY DESERT',
    outfit: 'cowboy',
    gravity: 1,
    air: 1,
    base: 'hardpan',
    platform: 'wagonwheel',
    pad: 'barrel',
    barColor: '#FF7B00',
    seed: 37,
    features: [
      ['flat', 700],
      ['tumble', 900, 0.32, 1200], ['surface', 'sand', 800],
      ['down', 800, 330],
      ['kicker', 300, 70], ['gap', 300], ['down', 600, 170],
      ['checkpoint'],
      ['bumps', 4, 26, 300],
      ['surface', 'quicksand', 500],
      ['up', 700, 330],
      ['pendulum', 250, 190, 1.3, 3200], ['flat', 500],
      ['platform', 300],
      ['checkpoint'],
      ['down', 1000, 480],
      ['surface', 'sand', 600],
      ['pad', 15], ['gap', 380], ['flat', 300],
      ['tumble', 1200, 0.28, 1300], ['hills', 1200, 70, 600],
      ['checkpoint'],
      ['down', 900, 320], ['kicker', 280, 80], ['gap', 280], ['down', 600, 200],
      ['surface', 'quicksand', 400],
      ['up', 600, 260],
      ['finish'],
    ],
    theme: {
      sky: [0xf4a261, 0xfff1c1],
      far: 0xe08e55, far2: 0xeaa874,
      top: 0xf2c97d, topHi: 0xfadb9c, topLine: 0x5c2e14,
      dirt: 0xc86438, dirt2: 0x9e472a, dirtLine: 0x5c2e14, pebble: 0xa8522f,
    },
  },
];

const smooth = (t) => (1 - Math.cos(Math.PI * Math.max(0, Math.min(1, t)))) / 2;

/**
 * Build a track from a map's feature list.
 * Returns { pts, surfaces, pads, platforms, gaps, obstacles, checkpoints, finishX, endX }.
 */
export function buildTrack(map) {
  if (map._track) return map._track;
  const pts = [];
  const surfaces = [];
  const pads = [];
  const platforms = [];
  const gaps = [];
  const obstacles = [];
  const checkpoints = [120];
  let x = 0;
  let y = BASE_Y;
  let finishX = null;

  const push = (px, py) => {
    if (pts.length && px <= pts[pts.length - 1].x) return;
    pts.push({ x: px, y: py });
  };
  // Sample a shape f(t) (t: 0..1 → y offset) over len px, starting at the current point.
  const shape = (len, f) => {
    const y0 = y;
    for (let d = STEP; d <= len; d += STEP) push(x + d, y0 + f(d / len));
    if (len % STEP) push(x + len, y0 + f(1));
    x += len;
    y = y0 + f(1);
  };

  push(0, y);
  for (const [type, ...a] of map.features) {
    if (type === 'flat') shape(a[0], () => 0);
    else if (type === 'hills') shape(a[0], (t) => -a[1] * Math.sin((t * a[0] * 2 * Math.PI) / a[2]));
    else if (type === 'down') shape(a[0], (t) => a[1] * smooth(t));
    else if (type === 'up') shape(a[0], (t) => -a[1] * smooth(t));
    else if (type === 'kicker') shape(a[0], (t) => -a[1] * t * t); // steepest right at the lip
    else if (type === 'bumps') {
      // Rolling bumps (sin²: steepest slope = π·h/w). Kept under ~18° so they're a rhythm to ride, not a wall.
      for (let i = 0; i < a[0]; i++) shape(a[2], (t) => -a[1] * Math.sin(Math.PI * t) ** 2);
    } else if (type === 'surface') {
      surfaces.push({ x0: x, x1: x + a[1], type: a[0] });
      shape(a[1], (t) => -12 * Math.sin(t * Math.PI * 3)); // gentle ripples
    } else if (type === 'pad') {
      shape(140, () => 0);
      pads.push({ x: x - 70, y, strength: a[0] });
      shape(60, () => 0);
    } else if (type === 'gap' || type === 'platform') {
      const w = a[0];
      const rim = y;
      push(x + 2, rim + PIT);
      push(x + w - 2, rim + PIT);
      push(x + w, rim);
      gaps.push({ x0: x, x1: x + w, rim });
      if (type === 'platform') {
        const p = { kind: map.platform, x: x + w / 2, y: rim, w };
        if (map.platform === 'wagonwheel') {
          // A big wheel bridging the gap: its rim meets both edges and its top bulges 55px above them.
          const H = 55;
          const r = (H * H + (w * w) / 4) / (2 * H);
          Object.assign(p, { r, y: rim - H + r });
        }
        else Object.assign(p, { len: w - 24, amp: 0.26, period: 3600, phase: 0 });
        platforms.push(p);
      }
      x += w;
    } else if (type === 'pendulum') {
      // ['pendulum', offset, rope length, swing amplitude (rad), period ms]
      obstacles.push({ kind: 'pendulum', x: x + a[0], len: a[1], amp: a[2], period: a[3], r: 26, phase: obstacles.length * 1.9 });
    } else if (type === 'bobber') {
      // ['bobber', offset, bounce height, period ms]: bounces in place; pass while it's up high
      obstacles.push({ kind: 'bobber', x: x + a[0], h: a[1], period: a[2], r: 34, phase: obstacles.length * 1.3 });
    } else if (type === 'gate') {
      // ['gate', offset, period ms]: energy barrier, on for half of each period (flickers before it switches on)
      obstacles.push({ kind: 'gate', x: x + a[0], period: a[1], phase: obstacles.length * 0.7 });
    } else if (type === 'tumble') {
      // ['tumble', span, speed px/ms, hop period ms]: rolls toward you over the next `span` px in big hops
      obstacles.push({ kind: 'tumble', xa: x, xb: x + a[0], speed: a[1], hop: a[2], r: 26, phase: obstacles.length * 517 });
    } else if (type === 'checkpoint') {
      checkpoints.push(x);
    } else if (type === 'finish') {
      shape(200, () => 0);
      finishX = x;
      shape(900, () => 0);
    }
  }
  map._track = { pts, surfaces, pads, platforms, gaps, obstacles, checkpoints, finishX, endX: x };
  return map._track;
}

function seg(pts, x) {
  let lo = 0;
  let hi = pts.length - 1;
  if (x <= pts[0].x) return 0;
  if (x >= pts[hi].x) return hi - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].x <= x) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Terrain height at x (ignores platforms). */
export function heightAt(track, x) {
  const p = track.pts;
  const i = seg(p, x);
  const t = Math.max(0, Math.min(1, (x - p[i].x) / (p[i + 1].x - p[i].x)));
  return p[i].y + (p[i + 1].y - p[i].y) * t;
}

/** Terrain angle at x in radians (+ = downhill to the right). */
export function slopeAt(track, x) {
  const p = track.pts;
  const i = seg(p, x);
  const a = Math.atan2(p[i + 1].y - p[i].y, p[i + 1].x - p[i].x);
  if (Math.abs(a) < 1.2) return a;
  // On a gap's cliff wall: use the ground at the nearer rim instead. (Measuring the ~90°
  // wall here made landings right at a gap's edge count as wildly crooked.)
  const j = x - p[i].x < p[i + 1].x - x ? i - 1 : i + 1;
  if (j < 0 || j >= p.length - 1) return 0;
  return Math.atan2(p[j + 1].y - p[j].y, p[j + 1].x - p[j].x);
}

/** Seesaw / ring tilt at race time t (ms). Same on every device. */
export function platformAngle(p, t) {
  return p.kind === 'wagonwheel' ? 0 : p.amp * Math.sin((2 * Math.PI * t) / p.period + p.phase);
}

/**
 * What's under x right now: the top of a platform if there is one, else terrain.
 * Returns { y, slope, surface, gap } (gap: the gap object if x is over one).
 */
export function groundAt(track, x, t = 0) {
  for (const p of track.platforms) {
    if (p.kind === 'wagonwheel') {
      const dx = x - p.x;
      if (Math.abs(dx) < p.w / 2) {
        const h = Math.sqrt(p.r * p.r - dx * dx);
        return { y: p.y - h, slope: Math.atan2(dx, h), surface: 'hardpan', platform: p };
      }
    } else {
      const a = platformAngle(p, t);
      const dx = x - p.x;
      if (Math.abs(dx) < (p.len / 2) * Math.cos(a)) {
        return { y: p.y - 12 / Math.cos(a) + dx * Math.tan(a), slope: a, surface: p.kind === 'ring' ? 'metal' : 'grass', platform: p };
      }
    }
  }
  const gap = track.gaps.find((g) => x > g.x0 && x < g.x1) || null;
  const s = track.surfaces.find((r) => x >= r.x0 && x < r.x1);
  return { y: heightAt(track, x), slope: slopeAt(track, x), surface: s ? s.type : null, gap };
}

/**
 * Where a moving obstacle is at race time t (ms). Pure function of t, so the host
 * (collisions) and every phone (drawing) agree without sending anything.
 * Returns { x, y, r, angle, on, pivot? }; a gate is a beam (r = 0) that is only
 * dangerous while `on`.
 */
export function obstaclePose(track, o, t) {
  const TAU = Math.PI * 2;
  if (o.kind === 'pendulum') {
    const g = heightAt(track, o.x);
    const th = o.amp * Math.sin((TAU * t) / o.period + o.phase);
    const px = o.x;
    const py = g - 70 - o.len; // at the bottom of the swing the bob sits at chest height
    return { x: px + Math.sin(th) * o.len, y: py + Math.cos(th) * o.len, r: o.r, angle: -th, on: true, pivot: { x: px, y: py } };
  }
  if (o.kind === 'bobber') {
    const g = heightAt(track, o.x);
    const k = Math.abs(Math.sin((Math.PI * t) / o.period + o.phase)); // bouncing-ball arc: quick at the bottom
    return { x: o.x, y: g - o.r - 4 - o.h * k, r: o.r, angle: t / 900, on: true };
  }
  if (o.kind === 'gate') {
    const s = Math.sin((TAU * t) / o.period + o.phase);
    return { x: o.x, y: heightAt(track, o.x), r: 0, angle: 0, on: s > 0.2, warn: s > -0.2 && s <= 0.2 };
  }
  // tumbleweed: rolls from xb back toward xa (toward the riders), hopping, then starts over
  const span = o.xb - o.xa;
  const d = (((t * o.speed + o.phase) % span) + span) % span;
  const x = o.xb - d;
  const hop = Math.abs(Math.sin((Math.PI * (t + o.phase)) / o.hop));
  return { x, y: heightAt(track, x) - o.r - 2 - 250 * hop, r: o.r, angle: -d / o.r, on: true };
}

/** Does this obstacle hit a rider made of circles [{x, y, r}] at time t? */
export function obstacleHits(track, o, t, circles) {
  const p = obstaclePose(track, o, t);
  if (o.kind === 'gate') {
    // Beam from the ground up to 190 px; only while on.
    return p.on && circles.some((c) => Math.abs(c.x - p.x) < c.r + 6 && c.y > p.y - 190);
  }
  return circles.some((c) => Math.hypot(c.x - p.x, c.y - p.y) < c.r + p.r - 6);
}

/** Surface properties at x (falls back to the map's base surface). */
export function surfaceProps(map, name) {
  return SURFACES[name || map.base] || SURFACES[map.base];
}

/** 0..1 progress along the track. */
export function progressOf(track, x) {
  return Math.max(0, Math.min(1, (x - 100) / (track.finishX - 100)));
}
