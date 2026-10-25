// Cartoon world art for all three maps, shared by the host and phones.
// Style (from the art handoff): bright, chunky, flat colour, thick dark outlines.
//  - Terrain is vector (Phaser Graphics) so it stays crisp at any zoom.
//  - Props, pads and platforms are small canvas textures drawn once.
//  - No shadows baked into anything; riders get a separate shadow sprite.

/* global Phaser */
import { OUTLINE, drawCircle, drawRect } from './rig.js';
import { heightAt, groundAt, platformAngle, obstaclePose, STEP } from './maps.js';

export const FONT = '"Lilita One", "Arial Black", sans-serif';

/** Chunky white text with a dark outline, the handoff's UI text style. */
export function textStyle(size, color = '#ffffff', extra = {}) {
  return { fontFamily: FONT, fontSize: `${size}px`, color, stroke: OUTLINE, strokeThickness: Math.max(3, Math.round(size / 5)), ...extra };
}



function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tex(scene, key, w, h, draw) {
  if (scene.textures.exists(key)) return key;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  draw(ctx, w, h);
  scene.textures.addCanvas(key, c);
  return key;
}

function blob(ctx, circles, fill, stroke, lw) {
  // Outline pass first, then fill pass, so overlapping circles read as one shape.
  ctx.fillStyle = stroke;
  for (const [x, y, r] of circles) { ctx.beginPath(); ctx.arc(x, y, r + lw, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = fill;
  for (const [x, y, r] of circles) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
}

function poly(ctx, pts, fill, stroke = OUTLINE, lw = 4) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.stroke(); }
}

// ------------------------------------------------------------------ props

const PROPS = {
  tree: [220, 280, (ctx) => {
    drawRect(ctx, 96, 140, 30, 136, 8, '#9B6B43', OUTLINE, 5);
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(110, 190); ctx.lineTo(70, 150); ctx.stroke();
    ctx.strokeStyle = '#9B6B43'; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(108, 188); ctx.lineTo(72, 152); ctx.stroke();
    blob(ctx, [[110, 90, 62], [60, 120, 44], [160, 118, 46], [80, 60, 40], [145, 62, 42]], '#4CC947', OUTLINE, 5);
    ctx.fillStyle = '#68E062';
    for (const [x, y, r] of [[92, 62, 16], [140, 72, 14], [70, 112, 12]]) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
  }],
  bush: [150, 80, (ctx) => {
    blob(ctx, [[45, 52, 26], [78, 40, 32], [110, 52, 26]], '#4CC947', OUTLINE, 4);
    ctx.fillStyle = '#68E062'; ctx.beginPath(); ctx.arc(70, 30, 9, 0, Math.PI * 2); ctx.fill();
  }],
  flowers: [70, 60, (ctx) => {
    [[16, '#FF8FA3'], [36, '#FFEA00'], [54, '#FFFFFF']].forEach(([x, c], i) => {
      ctx.strokeStyle = '#1E5E1A'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x, 58); ctx.lineTo(x, 28 + i * 4); ctx.stroke();
      drawCircle(ctx, x, 24 + i * 4, 8, c, OUTLINE, 3);
      drawCircle(ctx, x, 24 + i * 4, 3, '#FFB703', null, 0);
    });
  }],
  fence: [170, 80, (ctx) => {
    drawRect(ctx, 6, 30, 158, 14, 4, '#C87D4B', OUTLINE, 4);
    drawRect(ctx, 6, 54, 158, 14, 4, '#C87D4B', OUTLINE, 4);
    [14, 80, 146].forEach((x) => drawRect(ctx, x, 14, 14, 64, 4, '#B06A3A', OUTLINE, 4));
  }],
  crystals: [130, 120, (ctx) => {
    poly(ctx, [[30, 118], [22, 60], [38, 30], [52, 64], [50, 118]], '#FF4D94', '#211838', 4);
    poly(ctx, [[48, 118], [56, 40], [72, 6], [88, 44], [86, 118]], '#FF6FB0', '#211838', 4);
    poly(ctx, [[84, 118], [92, 70], [108, 50], [116, 80], [112, 118]], '#E0367A', '#211838', 4);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    poly(ctx, [[62, 50], [72, 18], [74, 60]], 'rgba(255,255,255,0.55)', null);
  }],
  dish: [130, 150, (ctx) => {
    drawRect(ctx, 58, 80, 14, 68, 4, '#94A3B8', '#211838', 4);
    drawRect(ctx, 36, 136, 58, 12, 4, '#64748B', '#211838', 4);
    ctx.save(); ctx.translate(64, 64); ctx.rotate(-0.5);
    ctx.beginPath(); ctx.ellipse(0, 0, 50, 22, 0, 0, Math.PI); ctx.closePath();
    ctx.fillStyle = '#CBD5E1'; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = '#211838'; ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = '#211838'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(64, 64); ctx.lineTo(86, 22); ctx.stroke();
    drawCircle(ctx, 88, 18, 7, '#00F5D4', '#211838', 3);
  }],
  flag: [80, 150, (ctx) => {
    drawRect(ctx, 12, 10, 8, 138, 3, '#CBD5E1', '#211838', 3);
    poly(ctx, [[20, 14], [74, 26], [20, 46]], '#FF4D94', '#211838', 4);
  }],
  moonrock: [110, 60, (ctx) => {
    poly(ctx, [[8, 58], [18, 24], [52, 8], [90, 18], [104, 58]], '#655691', '#211838', 4);
    drawCircle(ctx, 50, 34, 9, '#55477F', '#211838', 3);
  }],
  cactus: [130, 190, (ctx) => {
    const c = '#14B8A6';
    const o = '#0F5248';
    drawRect(ctx, 52, 20, 28, 168, 14, c, o, 5);
    drawRect(ctx, 14, 70, 22, 60, 11, c, o, 5);
    drawRect(ctx, 22, 110, 38, 20, 10, c, o, 5);
    drawRect(ctx, 96, 50, 22, 56, 11, c, o, 5);
    drawRect(ctx, 72, 90, 40, 20, 10, c, o, 5);
    drawRect(ctx, 52, 20, 28, 168, 14, c, o, 5);
    ctx.strokeStyle = '#2DD4BF'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(66, 34); ctx.lineTo(66, 170); ctx.stroke();
  }],
  tumbleweed: [90, 90, (ctx) => {
    ctx.strokeStyle = '#7A5428'; ctx.lineWidth = 3;
    for (let i = 0; i < 9; i++) {
      ctx.beginPath(); ctx.ellipse(45, 45, 38 - i * 2, 26 + i * 1.5, i * 0.7, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.strokeStyle = '#B88648'; ctx.lineWidth = 2;
    for (let i = 0; i < 7; i++) { ctx.beginPath(); ctx.ellipse(45, 45, 34 - i * 3, 22 + i * 2, i * 0.9 + 0.3, 0, Math.PI * 2); ctx.stroke(); }
  }],
  pole: [120, 300, (ctx) => {
    drawRect(ctx, 52, 20, 16, 278, 4, '#8B5A2B', '#5C2E14', 4);
    drawRect(ctx, 14, 40, 92, 12, 4, '#8B5A2B', '#5C2E14', 4);
    [22, 58, 96].forEach((x) => drawCircle(ctx, x, 36, 5, '#94A3B8', '#5C2E14', 2));
  }],
  barrel: [80, 90, (ctx) => {
    drawRect(ctx, 8, 6, 64, 82, 14, '#9E582F', '#5C2E14', 4);
    drawRect(ctx, 8, 24, 64, 8, 2, '#475569', '#5C2E14', 3);
    drawRect(ctx, 8, 62, 64, 8, 2, '#475569', '#5C2E14', 3);
  }],
  skull: [100, 60, (ctx) => {
    ctx.strokeStyle = '#5C2E14'; ctx.lineWidth = 4; ctx.fillStyle = '#F8F1E3';
    ctx.beginPath(); ctx.moveTo(30, 22); ctx.quadraticCurveTo(6, 6, 6, 30); ctx.quadraticCurveTo(14, 16, 30, 30); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(70, 22); ctx.quadraticCurveTo(94, 6, 94, 30); ctx.quadraticCurveTo(86, 16, 70, 30); ctx.fill(); ctx.stroke();
    drawRect(ctx, 30, 16, 40, 40, 14, '#F8F1E3', '#5C2E14', 4);
    drawCircle(ctx, 42, 32, 5, '#5C2E14', null, 0);
    drawCircle(ctx, 58, 32, 5, '#5C2E14', null, 0);
  }],
};

const MAP_PROPS = {
  world: [['tree', 3], ['bush', 3], ['flowers', 3], ['fence', 1]],
  space: [['crystals', 3], ['dish', 1], ['flag', 1], ['moonrock', 3]],
  desert: [['cactus', 3], ['tumbleweed', 2], ['pole', 1], ['barrel', 1], ['skull', 1]],
};

function prop(scene, name) {
  const [w, h, draw] = PROPS[name];
  return tex(scene, `prop-${name}`, w, h, draw);
}

// ------------------------------------------------------------------ sky decor

export function cloudTex(scene) {
  return tex(scene, 'cloud', 260, 110, (ctx) => blob(ctx, [[60, 70, 34], [110, 52, 44], [170, 60, 38], [210, 76, 26], [130, 82, 30]], '#FFFFFF', '#9ADBEA', 5));
}
function sunTex(scene, color, size) {
  return tex(scene, `sun-${color}`, size, size, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, w * 0.2, w / 2, w / 2, w / 2);
    g.addColorStop(0, color); g.addColorStop(0.45, color); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
  });
}
function starTex(scene) {
  return tex(scene, 'stars', 512, 900, (ctx, w, h) => {
    const rand = mulberry32(99);
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = rand() < 0.2 ? '#FF9AD5' : '#FFFFFF';
      ctx.globalAlpha = 0.5 + rand() * 0.5;
      ctx.beginPath(); ctx.arc(rand() * w, rand() * h, 0.6 + rand() * 1.3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  });
}
function glowTex(scene) {
  return tex(scene, 'nebula', 256, 256, (ctx) => {
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, 'rgba(123,44,191,0.45)'); g.addColorStop(1, 'rgba(123,44,191,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
  });
}
function planetTex(scene) {
  return tex(scene, 'planet', 220, 140, (ctx) => {
    drawCircle(ctx, 110, 70, 46, '#B5179E', '#211838', 5);
    ctx.fillStyle = '#D946C0'; ctx.beginPath(); ctx.arc(96, 56, 16, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#211838'; ctx.lineWidth = 9; ctx.beginPath(); ctx.ellipse(110, 74, 98, 20, -0.2, 0.15, Math.PI - 0.15); ctx.stroke();
    ctx.strokeStyle = '#FFB703'; ctx.lineWidth = 5; ctx.beginPath(); ctx.ellipse(110, 74, 98, 20, -0.2, 0.15, Math.PI - 0.15); ctx.stroke();
  });
}
function asteroidTex(scene) {
  return tex(scene, 'asteroid', 90, 80, (ctx) => {
    poly(ctx, [[10, 40], [24, 10], [58, 6], [84, 30], [76, 66], [36, 74]], '#655691', '#211838', 5);
    drawCircle(ctx, 40, 34, 9, '#55477F', '#211838', 3);
    drawCircle(ctx, 62, 52, 6, '#55477F', '#211838', 3);
  });
}

// ------------------------------------------------------------------ track features

function padTex(scene, kind) {
  if (kind === 'spring') {
    return tex(scene, 'pad-spring', 100, 90, (ctx) => {
      ctx.strokeStyle = OUTLINE; ctx.lineWidth = 9;
      ctx.beginPath(); for (let i = 0; i <= 6; i++) ctx.lineTo(i % 2 ? 22 : 78, 82 - i * 9); ctx.stroke();
      ctx.strokeStyle = '#94A3B8'; ctx.lineWidth = 5;
      ctx.beginPath(); for (let i = 0; i <= 6; i++) ctx.lineTo(i % 2 ? 22 : 78, 82 - i * 9); ctx.stroke();
      drawRect(ctx, 6, 14, 88, 20, 10, '#FF3B5C', OUTLINE, 5);
      drawRect(ctx, 14, 82, 72, 8, 3, '#64748B', OUTLINE, 3);
    });
  }
  if (kind === 'hover') {
    return tex(scene, 'pad-hover', 140, 180, (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, 150);
      g.addColorStop(0, 'rgba(0,245,212,0)'); g.addColorStop(1, 'rgba(0,245,212,0.45)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(30, 0); ctx.lineTo(110, 0); ctx.lineTo(118, 152); ctx.lineTo(22, 152); ctx.fill();
      ctx.fillStyle = 'rgba(200,255,250,0.8)';
      [[50, 40], [80, 70], [62, 110], [94, 20], [40, 130]].forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); });
      drawRect(ctx, 10, 150, 120, 26, 12, '#475569', '#211838', 4);
      ctx.beginPath(); ctx.ellipse(70, 152, 52, 10, 0, 0, Math.PI * 2); ctx.fillStyle = '#00F5D4'; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = '#211838'; ctx.stroke();
    });
  }
  return tex(scene, 'pad-barrel', 100, 110, (ctx) => {
    drawRect(ctx, 14, 26, 72, 80, 14, '#9E582F', '#5C2E14', 5);
    drawRect(ctx, 14, 44, 72, 9, 2, '#475569', '#5C2E14', 3);
    drawRect(ctx, 14, 82, 72, 9, 2, '#475569', '#5C2E14', 3);
    ctx.strokeStyle = '#5C2E14'; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(30, 26); ctx.lineTo(70, 16); ctx.lineTo(30, 6); ctx.stroke();
    ctx.strokeStyle = '#94A3B8'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(30, 26); ctx.lineTo(70, 16); ctx.lineTo(30, 6); ctx.stroke();
    drawRect(ctx, 8, 0, 84, 14, 7, '#FF6D00', '#5C2E14', 4);
  });
}

function plankTex(scene, kind, len) {
  const key = `plank-${kind}-${len}`;
  return tex(scene, key, len + 8, 40, (ctx) => {
    if (kind === 'ring') {
      drawRect(ctx, 4, 6, len, 28, 8, '#7C6FA6', '#211838', 5);
      drawRect(ctx, 4, 6, len, 9, 4, '#9D91C9', null, 0);
      for (let x = 24; x < len; x += 40) drawCircle(ctx, x, 24, 3.5, '#CBD5E1', '#211838', 2);
    } else {
      drawRect(ctx, 4, 6, len, 28, 8, '#C87D4B', OUTLINE, 5);
      ctx.strokeStyle = '#9B5E34'; ctx.lineWidth = 3;
      for (let x = 50; x < len; x += 70) { ctx.beginPath(); ctx.moveTo(x, 12); ctx.lineTo(x + 18, 12); ctx.stroke(); }
    }
  });
}

function wagonWheelTex(scene, r) {
  const R = Math.round(r);
  return tex(scene, `wagon-${R}`, R * 2 + 12, R * 2 + 12, (ctx) => {
    const c = R + 6;
    drawCircle(ctx, c, c, R - 6, null, '#5C2E14', 22);
    drawCircle(ctx, c, c, R - 6, null, '#9E582F', 14);
    ctx.strokeStyle = '#5C2E14'; ctx.lineWidth = 16;
    for (let i = 0; i < 6; i++) { const a = (i * Math.PI) / 6; ctx.beginPath(); ctx.moveTo(c - Math.cos(a) * (R - 14), c - Math.sin(a) * (R - 14)); ctx.lineTo(c + Math.cos(a) * (R - 14), c + Math.sin(a) * (R - 14)); ctx.stroke(); }
    ctx.strokeStyle = '#7F4422'; ctx.lineWidth = 9;
    for (let i = 0; i < 6; i++) { const a = (i * Math.PI) / 6; ctx.beginPath(); ctx.moveTo(c - Math.cos(a) * (R - 14), c - Math.sin(a) * (R - 14)); ctx.lineTo(c + Math.cos(a) * (R - 14), c + Math.sin(a) * (R - 14)); ctx.stroke(); }
    drawCircle(ctx, c, c, R * 0.16, '#D9B26F', '#5C2E14', 6);
  });
}

function flagTex(scene, color, finish) {
  return tex(scene, `flag-${finish ? 'finish' : color}`, 120, 240, (ctx) => {
    drawRect(ctx, 14, 10, 10, 228, 4, '#CBD5E1', OUTLINE, 4);
    if (finish) {
      ctx.save();
      ctx.beginPath(); ctx.moveTo(24, 14); ctx.lineTo(112, 22); ctx.lineTo(112, 82); ctx.lineTo(24, 74); ctx.closePath(); ctx.clip();
      for (let y = 0; y < 5; y++) for (let x = 0; x < 6; x++) { ctx.fillStyle = (x + y) % 2 ? '#1E1B2E' : '#FFFFFF'; ctx.fillRect(24 + x * 15, 12 + y * 15, 15, 15); }
      ctx.restore();
      poly(ctx, [[24, 14], [112, 22], [112, 82], [24, 74]], null, OUTLINE, 5);
    } else {
      poly(ctx, [[24, 16], [96, 38], [24, 62]], color, OUTLINE, 5);
    }
  });
}

// ------------------------------------------------------------------ moving obstacles

/** Texture for a moving obstacle's body, per world. Diameter ≈ 2 × collision radius. */
function obstacleTex(scene, map, kind) {
  const key = `obs-${map.key}-${kind}`;
  const W = 88;
  const c = W / 2;
  if (kind === 'pendulum') {
    if (map.key === 'world') {
      return tex(scene, key, W, W, (ctx) => { // tire swing
        drawCircle(ctx, c, c, 36, '#262335', OUTLINE, 5);
        drawCircle(ctx, c, c, 18, '#C8F7FF', OUTLINE, 4);
        ctx.strokeStyle = '#4B4560'; ctx.lineWidth = 3;
        for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4; ctx.beginPath(); ctx.moveTo(c + Math.cos(a) * 22, c + Math.sin(a) * 22); ctx.lineTo(c + Math.cos(a) * 32, c + Math.sin(a) * 32); ctx.stroke(); }
      });
    }
    if (map.key === 'space') {
      return tex(scene, key, W, W, (ctx) => { // swinging station pod
        drawCircle(ctx, c, c, 34, '#94A3B8', '#211838', 5);
        drawCircle(ctx, c, c, 16, '#00F5D4', '#211838', 4);
        [[c - 22, c - 18], [c + 22, c - 18], [c - 22, c + 18], [c + 22, c + 18]].forEach(([x, y]) => drawCircle(ctx, x, y, 3.5, '#CBD5E1', '#211838', 2));
      });
    }
    return tex(scene, key, W, W, (ctx) => { // swinging boulder
      poly(ctx, [[10, 46], [18, 18], [44, 6], [72, 16], [82, 46], [70, 76], [38, 82], [14, 70]], '#9E472A', '#5C2E14', 5);
      ctx.strokeStyle = '#5C2E14'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(30, 30); ctx.lineTo(44, 44); ctx.lineTo(40, 60); ctx.stroke();
    });
  }
  if (kind === 'bobber') {
    if (map.key === 'space') {
      return tex(scene, key, W, W, (ctx) => { // drifting asteroid
        poly(ctx, [[8, 44], [16, 16], [44, 6], [74, 14], [84, 44], [72, 74], [40, 84], [14, 70]], '#655691', '#211838', 5);
        drawCircle(ctx, 34, 34, 10, '#55477F', '#211838', 3);
        drawCircle(ctx, 58, 56, 7, '#55477F', '#211838', 3);
        drawCircle(ctx, 56, 26, 4, '#55477F', '#211838', 2);
      });
    }
    return tex(scene, key, W, W, (ctx) => { // big bouncy beach ball
      const cols = ['#FF3B5C', '#FFFFFF', '#00A8FF', '#FFFFFF', '#FFEA00', '#FFFFFF'];
      cols.forEach((col, i) => { ctx.beginPath(); ctx.moveTo(c, c); ctx.arc(c, c, 38, (i * Math.PI) / 3, ((i + 1) * Math.PI) / 3); ctx.closePath(); ctx.fillStyle = col; ctx.fill(); });
      drawCircle(ctx, c, c, 38, null, OUTLINE, 5);
      drawCircle(ctx, c, c, 8, '#FFFFFF', OUTLINE, 3);
    });
  }
  return prop(scene, 'tumbleweed');
}

/** Sprites for every moving obstacle; returns an updater (time → positions). */
function buildObstacles(scene, map, track, add) {
  const outline = OUTLINE_N(map);
  return track.obstacles.map((o) => {
    const parts = { o };
    if (o.kind === 'gate') {
      const g = heightAt(track, o.x);
      const frame = add(scene.add.graphics().setDepth(3));
      // Two emitter posts; the beam between them is redrawn as it switches
      frame.fillStyle(0x475569, 1).fillRect(o.x - 14, g - 216, 28, 30).lineStyle(4, outline, 1).strokeRect(o.x - 14, g - 216, 28, 30);
      frame.fillStyle(0x475569, 1).fillRect(o.x - 18, g - 10, 36, 16).lineStyle(4, outline, 1).strokeRect(o.x - 18, g - 10, 36, 16);
      frame.fillStyle(0xff4d94, 1).fillRect(o.x - 6, g - 196, 12, 12).fillRect(o.x - 6, g - 12, 12, 12);
      parts.beam = add(scene.add.graphics().setDepth(3.1));
      parts.g = g;
      return parts;
    }
    if (o.kind === 'pendulum') {
      const pose = obstaclePose(track, o, 0);
      const { x: px, y: py } = pose.pivot;
      const g = heightAt(track, o.x);
      const frame = add(scene.add.graphics().setDepth(-1.5));
      const wood = map.key === 'space' ? 0x64748b : 0x9b6b43;
      // A crane: post on one side (outside the swing), an arm reaching over the track to the pivot
      const reach = o.len * Math.sin(o.amp) + o.r + 30;
      frame.fillStyle(wood, 1).fillRect(px - reach, py - 14, 22, g - py + 20).lineStyle(4, outline, 1).strokeRect(px - reach, py - 14, 22, g - py + 20);
      frame.fillStyle(wood, 1).fillRect(px - reach, py - 18, reach + 20, 18).lineStyle(4, outline, 1).strokeRect(px - reach, py - 18, reach + 20, 18);
      frame.fillStyle(0xffd60a, 1).fillEllipse(px, py, 14, 14, 16).lineStyle(3, outline, 1).strokeEllipse(px, py, 14, 14, 16);
      parts.rope = add(scene.add.graphics().setDepth(2.9));
    }
    parts.img = add(scene.add.image(0, 0, obstacleTex(scene, map, o.kind)).setDepth(3).setScale((o.r * 2.3) / 88));
    return parts;
  });
}

function updateObstacles(views, track, t) {
  for (const v of views) {
    const p = obstaclePose(track, v.o, t);
    if (v.o.kind === 'gate') {
      v.beam.clear();
      if (p.on || (p.warn && Math.floor(t / 90) % 2 === 0)) {
        const a = p.on ? 0.9 : 0.35;
        v.beam.fillStyle(0xff4d94, a * 0.4).fillRect(p.x - 12, v.g - 190, 24, 184);
        v.beam.fillStyle(0xffffff, a).fillRect(p.x - 3, v.g - 190, 6, 184);
      }
      continue;
    }
    if (v.rope) v.rope.clear().lineStyle(4, 0x1e1b2e, 1).lineBetween(p.pivot.x, p.pivot.y, p.x, p.y);
    v.img.setPosition(p.x, p.y).setRotation(p.angle);
  }
}

// ------------------------------------------------------------------ world builder

/**
 * Draw a whole map. Everything is added to `layer` (if given).
 * @param o.parallax  scroll factor for the far scenery (phones ~0.35, the big screen 1)
 * @param o.viewW     viewport width in world px (to size parallax coverage)
 * @returns {{ update(t, view): void }} call every frame: spins platforms, culls terrain chunks
 */
export function buildWorld(scene, map, track, { layer = null, parallax = 1, viewW = 1600, cull = false, bake = 0 } = {}) {
  const t = map.theme;
  const add = (o) => (layer ? layer.add(o) : null, o);
  const endX = track.endX;
  const ys = track.pts.filter((p, i) => !track.gaps.some((g) => p.x > g.x0 && p.x < g.x1)).map((p) => p.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rand = mulberry32(map.seed);

  // Smoothed terrain line, for laying far scenery near the horizon.
  const smoothH = (x) => {
    let s = 0;
    let n = 0;
    for (let d = -1500; d <= 1500; d += 150) {
      const xx = Math.max(0, Math.min(endX, x + d));
      const g = track.gaps.find((gg) => xx > gg.x0 && xx < gg.x1);
      s += g ? g.rim : heightAt(track, xx);
      n += 1;
    }
    return s / n;
  };

  // ---- sky (world space, so it works for every camera) ----
  const sky = add(scene.add.graphics().setDepth(-30));
  const skyTop = minY - 900; // strong colour up high, pale near the ground, like the mockup
  const skyBot = maxY + 200;
  sky.fillStyle(t.sky[0], 1).fillRect(-4000, skyTop - 4000, endX + 8000, 4000);
  sky.fillGradientStyle(t.sky[0], t.sky[0], t.sky[1], t.sky[1], 1).fillRect(-4000, skyTop, endX + 8000, skyBot - skyTop);
  sky.fillStyle(t.sky[1], 1).fillRect(-4000, skyBot, endX + 8000, 4000);

  // ---- far scenery (parallax) ----
  const pf = parallax;
  const farX0 = -1500;
  const farX1 = endX * pf + viewW * (1 - pf) + 2500;
  const trackXOf = (fx) => (pf === 1 ? fx : (fx - (viewW / 2) * (1 - pf)) / pf);
  const far = add(scene.add.graphics().setDepth(-20).setScrollFactor(pf, 1));
  const horizon = (fx) => smoothH(Math.max(0, Math.min(endX, trackXOf(fx)))) - 140;

  // Sky decor first (behind the hills)
  for (let fx = farX0; fx < farX1; fx += 500 + rand() * 600) {
    const hy = horizon(fx);
    if (map.key === 'space') {
      const o = add(scene.add.image(fx, hy - 260 - rand() * 600, rand() < 0.25 ? planetTex(scene) : asteroidTex(scene)).setDepth(-25).setScrollFactor(pf * 0.8, 1));
      o.setScale(0.6 + rand() * 0.8).setRotation(rand() * 6);
    } else {
      add(scene.add.image(fx, hy - 320 - rand() * 380, cloudTex(scene)).setDepth(-25).setScrollFactor(pf * 0.8, 1).setScale(0.6 + rand() * 0.7));
    }
  }
  if (map.key === 'space') {
    // Starfield and nebula glow are pre-drawn textures. (Phaser draws every vector circle with
    // ~600 points; hundreds of star circles made this world crawl on phones and the big screen.)
    const tile = starTex(scene);
    for (let fx = farX0; fx < farX1; fx += 1024) {
      add(scene.add.image(fx, horizon(fx) - 120, tile).setOrigin(0, 1).setScale(2).setDepth(-26).setScrollFactor(pf * 0.5, 1));
    }
    for (let i = 0; i < 6; i++) {
      const fx = farX0 + rand() * (farX1 - farX0);
      add(scene.add.image(fx, horizon(fx) - 700, glowTex(scene)).setScale((600 + rand() * 600) / 256).setAlpha(0.5).setDepth(-27).setScrollFactor(pf * 0.5, 1));
    }
  } else {
    // A big sun every so often
    for (let fx = 300; fx < farX1; fx += 3500) {
      add(scene.add.image(fx, horizon(fx) - 520, sunTex(scene, map.key === 'desert' ? '#FFF8D6' : '#FFF59D', 360)).setDepth(-27).setScrollFactor(pf * 0.5, 1));
    }
  }

  // Two rows of far hills / ridges / mesas
  const ridge = (g, color, amp, wl, lift, flatTop) => {
    const pts = [];
    for (let fx = farX0; fx <= farX1; fx += 40) {
      let y = horizon(fx) - lift - amp * (0.5 + 0.5 * Math.sin(fx / wl)) - amp * 0.3 * Math.sin(fx / (wl * 0.37));
      if (flatTop) y = Math.min(y, horizon(fx) - lift - amp * 0.9 + (Math.sin(fx / (wl * 2.3)) > 0.2 ? 0 : amp * 0.8));
      pts.push({ x: fx, y });
    }
    pts.push({ x: farX1, y: maxY + 3000 }, { x: farX0, y: maxY + 3000 });
    g.fillStyle(color, 1).fillPoints(pts, true);
    g.lineStyle(4, OUTLINE_N(map), 0.35).strokePoints(pts.slice(0, -2), false);
  };
  ridge(far, t.far2, 140, 380, 90, map.key === 'desert');
  ridge(far, t.far, 90, 250, 0, false);

  // ---- terrain ----
  const chunks = [];
  const CH = 1200;
  const runs = splitRuns(track);
  const surfaceColors = {
    mud: [0x6b4226, 0x4e3221], metal: [0x94a3b8, 0x64748b], sand: [0xf5d9a0, 0xe6c07f], quicksand: [0xb98b4e, 0x8e6635],
  };
  for (let cx = 0; cx < endX; cx += CH) {
    const x0 = cx - STEP;
    const x1 = cx + CH + STEP;
    const g = add(scene.add.graphics().setDepth(0));
    g.bounds = { x0, x1 };
    // Dirt body (includes gap walls; the space between walls stays open so the sky shows through)
    const body = track.pts.filter((p) => p.x >= x0 && p.x <= x1);
    if (body.length < 2) continue;
    const bottom = maxY + 3200;
    g.fillStyle(t.dirt, 1).fillPoints([...body, { x: body[body.length - 1].x, y: bottom }, { x: body[0].x, y: bottom }], true);

    for (const run of runs) {
      const rp = run.filter((p) => p.x >= x0 - STEP && p.x <= x1 + STEP);
      if (rp.length < 2) continue;
      const band = (a, b, color, alpha = 1) => g.fillStyle(color, alpha).fillPoints([...rp.map((p) => ({ x: p.x, y: p.y + a })), ...rp.slice().reverse().map((p) => ({ x: p.x, y: p.y + b }))], true);
      band(80, 120, t.dirt2);
      band(150, 175, t.dirt2);
      // Pebbles / craters in the dirt
      for (let x = rp[0].x; x < rp[rp.length - 1].x; x += 55) {
        const r = rand();
        if (r < 0.55) g.fillStyle(t.pebble, 1).fillEllipse(x + rand() * 40, heightAt(track, x) + 40 + rand() * 220, 10 + rand() * 18, 7 + rand() * 9);
      }
      band(-6, 22, t.top);
      band(-6, 2, t.topHi);
      g.lineStyle(5, t.topLine, 1).strokePoints(rp.map((p) => ({ x: p.x, y: p.y - 6 })), false);
      g.lineStyle(3, t.dirtLine, 0.8).strokePoints(rp.map((p) => ({ x: p.x, y: p.y + 22 })), false);
      // Grass tufts / dust bumps along the top
      if (map.key === 'world') {
        for (let i = 2; i < rp.length - 2; i += 3) {
          const p = rp[i];
          g.fillStyle(t.top, 1).fillTriangle(p.x - 7, p.y - 4, p.x, p.y - 16 - rand() * 6, p.x + 7, p.y - 4);
        }
      }
    }

    // Low-grip surfaces: clearly different colour and texture (they change grip!)
    for (const s of track.surfaces) {
      if (s.x1 < x0 || s.x0 > x1) continue;
      const sp = track.pts.filter((p) => p.x >= Math.max(s.x0, x0) && p.x <= Math.min(s.x1, x1));
      if (sp.length < 2) continue;
      const [c1, c2] = surfaceColors[s.type];
      g.fillStyle(c1, 1).fillPoints([...sp.map((p) => ({ x: p.x, y: p.y - 8 })), ...sp.slice().reverse().map((p) => ({ x: p.x, y: p.y + 30 }))], true);
      g.lineStyle(5, t.topLine, 1).strokePoints(sp.map((p) => ({ x: p.x, y: p.y - 8 })), false);
      for (let i = 1; i < sp.length - 1; i += 2) {
        const p = sp[i];
        if (s.type === 'mud') g.fillStyle(c2, 1).fillEllipse(p.x, p.y + 6, 26, 8);
        else if (s.type === 'metal') { g.fillStyle(c2, 1).fillRect(p.x - 3, p.y + 9, 6, 6); g.lineStyle(2, c2, 1).lineBetween(p.x + 15, p.y - 6, p.x + 15, p.y + 28); }
        else if (s.type === 'sand') g.lineStyle(3, c2, 1).lineBetween(p.x - 10, p.y + 4, p.x + 10, p.y + 1);
        else g.fillStyle(c2, 1).fillEllipse(p.x, p.y + 10, 30, 10);
      }
    }
    if (!bake) {
      chunks.push(g);
      continue;
    }
    // Bake: draw this chunk once into a texture (vector Graphics are re-built every frame for
    // every camera, which is far too slow for the big screen's three rows of whole-map view).
    const ys = body.filter((p) => p.y < maxY + 100).map((p) => p.y);
    const top = Math.min(...ys) - 40;
    const bot = Math.max(...ys) + 300;
    const rt = add(scene.add.renderTexture(x0, top, Math.ceil((x1 - x0) * bake), Math.ceil((bot - top) * bake)).setOrigin(0, 0).setScale(1 / bake).setDepth(0));
    g.setScale(bake);
    rt.draw(g, -x0 * bake, -top * bake);
    g.destroy();
    rt.bounds = { x0, x1 };
    const fill = add(scene.add.rectangle(x0, bot - 2, x1 - x0, maxY + 3200 - bot, t.dirt).setOrigin(0, 0).setDepth(0));
    fill.bounds = { x0, x1 };
    chunks.push(rt, fill);
  }

  // Gap depth: darken the inside of every gap
  const pits = add(scene.add.graphics().setDepth(1));
  for (const gp of track.gaps) {
    pits.fillGradientStyle(0x1e1b2e, 0x1e1b2e, 0x1e1b2e, 0x1e1b2e, 0.15, 0.15, 0.9, 0.9).fillRect(gp.x0 + 2, gp.rim + 10, gp.x1 - gp.x0 - 4, 260);
    pits.fillStyle(0x1e1b2e, 0.9).fillRect(gp.x0 + 2, gp.rim + 270, gp.x1 - gp.x0 - 4, 1200);
    pits.lineStyle(5, t.dirtLine, 1).lineBetween(gp.x0, gp.rim - 6, gp.x0, gp.rim + 900).lineBetween(gp.x1, gp.rim - 6, gp.x1, gp.rim + 900);
  }

  // ---- props along the track ----
  const kinds = MAP_PROPS[map.key];
  const total = kinds.reduce((s, [, w]) => s + w, 0);
  const busy = (x) =>
    track.gaps.some((g) => x > g.x0 - 160 && x < g.x1 + 160) ||
    track.pads.some((p) => Math.abs(x - p.x) < 160) ||
    track.checkpoints.some((c) => Math.abs(x - c) < 120) ||
    track.obstacles.some((o) => o.x != null && Math.abs(x - o.x) < 240) ||
    Math.abs(x - track.finishX) < 200;
  for (let x = 260; x < endX - 200; x += 260 + rand() * 420) {
    if (busy(x)) continue;
    let r = rand() * total;
    const [name] = kinds.find(([, w]) => (r -= w) < 0);
    const img = add(scene.add.image(x, heightAt(track, x) + 8, prop(scene, name)).setOrigin(0.5, 1).setDepth(-2));
    img.setScale(0.75 + rand() * 0.45).setFlipX(rand() < 0.5);
  }

  // ---- pads, checkpoints, finish ----
  for (const p of track.pads) {
    const k = padTex(scene, map.pad);
    add(scene.add.image(p.x, p.y + 4, k).setOrigin(0.5, 1).setDepth(2).setScale(0.8));
  }
  track.checkpoints.slice(1).forEach((x) => {
    add(scene.add.image(x, heightAt(track, x) + 6, flagTex(scene, map.barColor, false)).setOrigin(0.1, 1).setDepth(-1).setScale(0.75));
  });
  add(scene.add.image(track.finishX, heightAt(track, track.finishX) + 6, flagTex(scene, '', true)).setOrigin(0.1, 1).setDepth(-1).setScale(1.1));
  const fy = heightAt(track, track.finishX);
  const finishLine = add(scene.add.graphics().setDepth(1));
  for (let i = 0; i < 6; i++) finishLine.fillStyle(i % 2 ? 0x1e1b2e : 0xffffff, 1).fillRect(track.finishX - 6, fy - 4 + i * 6, 12, 6);

  // ---- rotating platforms ----
  const plats = track.platforms.map((p) => {
    if (p.kind === 'wagonwheel') {
      const img = add(scene.add.image(p.x, p.y, wagonWheelTex(scene, p.r)).setDepth(1));
      const hub = add(scene.add.graphics().setDepth(0.5));
      hub.fillStyle(0x7f4422, 1).fillRect(p.x - 14, p.y, 28, 900).lineStyle(4, 0x5c2e14, 1).strokeRect(p.x - 14, p.y, 28, 900);
      return { p, img };
    }
    const post = add(scene.add.graphics().setDepth(0.5));
    const postColor = p.kind === 'ring' ? 0x4a3e6d : 0x9b6b43;
    post.fillStyle(postColor, 1).fillRect(p.x - 16, p.y, 32, 900).lineStyle(5, OUTLINE_N(map), 1).strokeRect(p.x - 16, p.y, 32, 900);
    // Curved yellow arrows: "this one moves"
    // (Arc built from a handful of points: Phaser's own arcs use hundreds.)
    const arcPts = Array.from({ length: 13 }, (_, i) => { const a = 0.35 + ((Math.PI - 0.7) * i) / 12; return { x: p.x + Math.cos(a) * 70, y: p.y + 20 + Math.sin(a) * 70 }; });
    post.lineStyle(6, 0x1e1b2e, 1).strokePoints(arcPts, false);
    post.lineStyle(3, 0xffd60a, 1).strokePoints(arcPts, false);
    const img = add(scene.add.image(p.x, p.y, plankTex(scene, p.kind, Math.round(p.len))).setDepth(1.2));
    const hub = add(scene.add.graphics().setDepth(1.3));
    hub.fillStyle(p.kind === 'ring' ? 0x00f5d4 : 0xd9b26f, 1).fillEllipse(p.x, p.y, 26, 26, 16).lineStyle(4, OUTLINE_N(map), 1).strokeEllipse(p.x, p.y, 26, 26, 16);
    return { p, img };
  });

  const obstacles = buildObstacles(scene, map, track, add);

  return {
    minY,
    maxY,
    update(time, view) {
      updateObstacles(obstacles, track, time);
      for (const { p, img } of plats) {
        if (p.kind === 'wagonwheel') img.setRotation(time / 900);
        else img.setRotation(platformAngle(p, time));
      }
      if (cull && view) {
        for (const c of chunks) c.setVisible(c.bounds.x1 > view.x - 200 && c.bounds.x0 < view.right + 200);
      }
    },
  };
}

function OUTLINE_N(map) {
  return map.key === 'space' ? 0x211838 : map.key === 'desert' ? 0x5c2e14 : 0x1e1b2e;
}

/** Split the terrain into continuous ground runs (cut at gaps), for drawing grass/edges. */
function splitRuns(track) {
  const runs = [];
  let cur = [];
  for (const p of track.pts) {
    const inGap = track.gaps.some((g) => p.x > g.x0 + 1 && p.x < g.x1 - 1);
    if (inGap) {
      if (cur.length > 1) runs.push(cur);
      cur = [];
    } else cur.push(p);
  }
  if (cur.length > 1) runs.push(cur);
  return runs;
}

/** Dust colour for a map's ground (particles). */
export function dustColor(map) {
  return map.theme.top;
}

/** 4×4 white dot texture for particles (tint it). */
export function dotTexture(scene) {
  return tex(scene, 'dot', 8, 8, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(4, 4, 4, 0, Math.PI * 2); ctx.fill();
  });
}

export { groundAt };
