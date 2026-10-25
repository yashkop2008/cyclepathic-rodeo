/* ============================================================================
 * rig.js — procedural rider + unicycle renderer (from unicycle_rig.js in the
 * art handoff), plus Phaser helpers to cache it as textures.
 *
 * CORE RULE: the rider is ALWAYS seated on the unicycle in every pose/frame.
 * The whole rig rotates together around the wheel hub.
 *
 * Changes from the handoff version:
 *  - ES module.
 *  - `layer` option ('back' | 'wheel' | 'front') so the wheel can be a separate
 *    sprite that spins live, sandwiched between the back leg and the frame.
 *  - Textures use the recommended 320×256 cell with the hub at (112, 200), so
 *    crash / panic / cowboy-hat poses are no longer clipped.
 * ========================================================================== */

/* global Phaser */

export const OUTLINE = '#1E1B2E';

export const PLAYERS = [
  { name: 'red', pri: '#FF3B5C', sec: '#C81E3C', hi: '#FF8FA3' },
  { name: 'blue', pri: '#00A8FF', sec: '#0077B6', hi: '#80D4FF' },
  { name: 'green', pri: '#00E676', sec: '#00A854', hi: '#80FFBA' },
  { name: 'yellow', pri: '#FFEA00', sec: '#CCA800', hi: '#FFF59D' },
  { name: 'purple', pri: '#D500F9', sec: '#8E00B6', hi: '#F380FF' },
  { name: 'orange', pri: '#FF6D00', sec: '#C43E00', hi: '#FFB74D' },
];

export const OUTFITS = ['classic', 'astronaut', 'cowboy'];
export const POSES = ['riding', 'lean_forward', 'lean_back', 'panic', 'airborne', 'victory', 'crash'];
export const RIG_CELL = { width: 320, height: 256, hubX: 112, hubY: 200 };
export const RIG_TIRE_R = 34;

// Older Safari lacks roundRect; a plain rect is a fine stand-in.
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h) {
    this.rect(x, y, w, h);
  };
}

export function drawCircle(ctx, x, y, r, fill, stroke = OUTLINE, lw = 4) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke && lw > 0) { ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.stroke(); }
}

export function drawRect(ctx, x, y, w, h, r, fill, stroke = OUTLINE, lw = 4) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke && lw > 0) { ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.stroke(); }
}

// ============================================================================
// UNIFIED RIDER + UNICYCLE RIG (pivot at hub 80,176 in the original 160×224 box)
// outfit: 'classic' | 'astronaut' | 'cowboy'
// p:      one entry of PLAYERS
// opts:   { pose, isGhost, wheelAngle, layer }
// ============================================================================
export function drawUnicycleRider(ctx, outfit, p, opts = {}) {
  const { pose = 'riding', isGhost = false, wheelAngle = 0, layer = 'all' } = opts;
  const show = (l) => layer === 'all' || layer === l;
  ctx.save();
  if (isGhost) ctx.globalAlpha = 0.48;

  ctx.translate(80, 176);

  // Global Rig Pose Rotation (Rider + Unicycle ALWAYS move together!)
  let rigTilt = 0;
  let bodyLean = 0;
  let faceType = 'normal';
  let armsUp = false;

  if (pose === 'riding' || pose === 'lean_forward') { rigTilt = 0.08; bodyLean = 0.08; }
  else if (pose === 'lean_back') { rigTilt = -0.18; bodyLean = -0.12; }
  else if (pose === 'panic') { rigTilt = -0.26; bodyLean = -0.18; faceType = 'panic'; armsUp = true; }
  else if (pose === 'airborne') { rigTilt = -0.15; bodyLean = 0.05; faceType = 'happy'; armsUp = true; }
  else if (pose === 'victory') { rigTilt = -0.22; bodyLean = -0.05; faceType = 'happy'; armsUp = true; }
  else if (pose === 'crash') { rigTilt = 1.15; bodyLean = 0.25; faceType = 'crash'; armsUp = true; }

  ctx.rotate(rigTilt);

  const suitFill = outfit === 'astronaut' ? '#F8FAFC' : p.pri;
  const legFill = outfit === 'cowboy' ? '#3B5998' : suitFill;
  const bootFill = outfit === 'cowboy' ? '#5D4037' : outfit === 'astronaut' ? p.pri : p.sec;

  // 1. BACK CRANK & BACK PEDAL + BACK LEG ON PEDAL
  const backPedalX = -14, backPedalY = -12;
  if (show('back')) {
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(backPedalX, backPedalY);
    ctx.lineWidth = 6; ctx.strokeStyle = '#64748B'; ctx.stroke();
    drawRect(ctx, backPedalX - 9, backPedalY - 4, 18, 8, 3, '#334155', OUTLINE, 3);

    ctx.beginPath();
    ctx.moveTo(-4, -72); ctx.lineTo(-22, -42); ctx.lineTo(backPedalX, backPedalY - 4);
    ctx.lineWidth = 14; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = OUTLINE; ctx.stroke();
    ctx.lineWidth = 7; ctx.strokeStyle = legFill; ctx.stroke();
    drawRect(ctx, backPedalX - 8, backPedalY - 12, 18, 10, 4, bootFill, OUTLINE, 3);
  }

  // 2. SHARED UNICYCLE WHEEL (Tire, Rim, Spokes, Hub)
  if (show('wheel')) {
    ctx.save();
    ctx.rotate(wheelAngle);
    drawCircle(ctx, 0, 0, 34, '#262335', OUTLINE, 4.5); // Chunky Tire
    drawCircle(ctx, 0, 0, 24, '#CBD5E1', OUTLINE, 3.5); // Rim
    drawCircle(ctx, 0, 0, 19, '#1E1B2E', null, 0); // Inner spoke well
    ctx.lineWidth = 3.5; ctx.strokeStyle = '#CBD5E1';
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      ctx.beginPath();
      ctx.moveTo(-Math.cos(a) * 19, -Math.sin(a) * 19);
      ctx.lineTo(Math.cos(a) * 19, Math.sin(a) * 19);
      ctx.stroke();
    }
    drawCircle(ctx, 0, 0, 7, p.pri, OUTLINE, 3.5); // Center Hub
    ctx.restore();
  }

  if (show('front')) {
    // 3. UNICYCLE FORK, SEAT POST & SADDLE
    drawRect(ctx, -5, -52, 10, 52, 4, p.pri, OUTLINE, 4); // Colored Fork
    drawRect(ctx, -4, -72, 8, 24, 3, '#CBD5E1', OUTLINE, 3.5); // Metal Seat Post
    drawRect(ctx, -20, -80, 40, 12, 6, '#7C4D2B', OUTLINE, 4); // Curved Brown Saddle

    // 4. RIDER UPPER BODY (Seated firmly on Saddle at 0, -78)
    ctx.save();
    ctx.translate(0, -78);
    ctx.rotate(bodyLean);

    if (armsUp) {
      drawRect(ctx, -34, -46, 28, 12, 6, suitFill, OUTLINE, 3.5);
      drawCircle(ctx, -36, -40, 7, outfit === 'astronaut' ? p.pri : '#FFCBA4', OUTLINE, 3);
    } else {
      drawRect(ctx, -6, -38, 28, 12, 6, suitFill, OUTLINE, 3.5);
    }

    if (outfit === 'classic') {
      ctx.beginPath();
      ctx.moveTo(-14, -64); ctx.quadraticCurveTo(-44, -68, -50, -52);
      ctx.quadraticCurveTo(-34, -46, -12, -54); ctx.closePath();
      ctx.fillStyle = '#4A3B32'; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = OUTLINE; ctx.stroke();
    } else if (outfit === 'astronaut') {
      drawRect(ctx, -32, -48, 18, 38, 6, '#E2E8F0', OUTLINE, 4);
      drawRect(ctx, -28, -40, 10, 18, 3, p.pri, OUTLINE, 3);
      ctx.beginPath(); ctx.moveTo(-23, -48); ctx.lineTo(-30, -74);
      ctx.lineWidth = 3.5; ctx.strokeStyle = OUTLINE; ctx.stroke();
      drawCircle(ctx, -30, -76, 5, '#00F5D4', OUTLINE, 3);
    } else if (outfit === 'cowboy') {
      ctx.beginPath();
      ctx.moveTo(-12, -46); ctx.lineTo(-46, -56); ctx.lineTo(-38, -42); ctx.lineTo(-50, -34); ctx.lineTo(-12, -36);
      ctx.closePath(); ctx.fillStyle = p.pri; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = OUTLINE; ctx.stroke();
    }

    // Torso
    drawRect(ctx, -17, -48, 34, 48, 14, suitFill, OUTLINE, 4);
    if (outfit === 'astronaut') {
      drawRect(ctx, -11, -40, 22, 24, 5, p.pri, OUTLINE, 3);
      drawCircle(ctx, 4, -30, 4.5, '#FFD60A', OUTLINE, 2);
    } else if (outfit === 'cowboy') {
      drawRect(ctx, -15, -44, 28, 38, 6, '#5D4037', OUTLINE, 3.5);
      drawCircle(ctx, 5, -30, 5, '#FFD60A', OUTLINE, 2); // Sheriff Star
      drawRect(ctx, -15, -50, 32, 11, 5, p.pri, OUTLINE, 3.5); // Bandana Collar
    } else {
      drawRect(ctx, -9, -40, 10, 30, 4, p.hi, null, 0);
    }

    // Goofy Head & Face
    const hx = 2, hy = -68;
    drawCircle(ctx, hx, hy, 21, '#FFCBA4', OUTLINE, 4);
    drawCircle(ctx, hx + 6, hy - 3, 7.5, '#FFFFFF', OUTLINE, 3.5);
    drawCircle(ctx, hx + 19, hy - 4, 7, '#FFFFFF', OUTLINE, 3.5);
    if (faceType === 'crash') {
      ctx.lineWidth = 3; ctx.strokeStyle = OUTLINE;
      [[hx + 6, hy - 3], [hx + 19, hy - 4]].forEach(([ex, ey]) => {
        ctx.beginPath(); ctx.moveTo(ex - 3, ey - 3); ctx.lineTo(ex + 3, ey + 3); ctx.moveTo(ex + 3, ey - 3); ctx.lineTo(ex - 3, ey + 3); ctx.stroke();
      });
    } else {
      const px = faceType === 'panic' ? -1.5 : 2;
      drawCircle(ctx, hx + 6 + px, hy - 3, 2.5, OUTLINE, null, 0);
      drawCircle(ctx, hx + 19 + px, hy - 4, 2.5, OUTLINE, null, 0);
    }
    if (faceType === 'panic') {
      drawRect(ctx, hx + 4, hy + 6, 12, 9, 4, '#7A1C24', OUTLINE, 3);
    } else {
      ctx.beginPath(); ctx.arc(hx + 9, hy + 5, 8.5, 0, Math.PI * 0.95); ctx.closePath();
      ctx.fillStyle = '#7A1C24'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = OUTLINE; ctx.stroke();
      ctx.beginPath(); ctx.arc(hx + 9, hy + 10, 4.5, Math.PI, 0); ctx.fillStyle = '#FF6B8B'; ctx.fill();
    }

    // Headgear
    if (outfit === 'classic') {
      ctx.beginPath(); ctx.arc(hx - 2, hy - 5, 24, Math.PI * 0.88, Math.PI * 2.06); ctx.closePath();
      ctx.fillStyle = p.pri; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = OUTLINE; ctx.stroke();
      drawRect(ctx, hx - 14, hy - 20, 16, 6, 3, p.hi, null, 0);
    } else if (outfit === 'astronaut') {
      drawRect(ctx, hx - 22, hy + 12, 44, 9, 4, p.pri, OUTLINE, 3.5);
      drawCircle(ctx, hx, hy - 2, 28, 'rgba(128, 212, 255, 0.30)', OUTLINE, 4);
      drawRect(ctx, hx - 16, hy - 20, 13, 7, 3.5, '#FFFFFF', null, 0);
    } else if (outfit === 'cowboy') {
      ctx.beginPath();
      ctx.moveTo(hx - 24, hy - 12); ctx.lineTo(hx - 12, hy - 36); ctx.lineTo(hx, hy - 28);
      ctx.lineTo(hx + 12, hy - 36); ctx.lineTo(hx + 22, hy - 12); ctx.closePath();
      ctx.fillStyle = p.pri; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = OUTLINE; ctx.stroke();
      drawRect(ctx, hx - 18, hy - 17, 36, 7, 3, p.sec, OUTLINE, 3);
      drawRect(ctx, hx - 36, hy - 12, 72, 9, 4.5, p.pri, OUTLINE, 4);
    }

    if (armsUp) {
      drawRect(ctx, 6, -48, 28, 12, 6, suitFill, OUTLINE, 3.5);
      drawCircle(ctx, 34, -42, 7, outfit === 'astronaut' ? p.pri : '#FFCBA4', OUTLINE, 3);
    } else {
      drawRect(ctx, -2, -34, 26, 12, 6, suitFill, OUTLINE, 3.5);
      drawCircle(ctx, 22, -28, 7, outfit === 'astronaut' ? p.pri : '#FFCBA4', OUTLINE, 3);
    }

    if (pose === 'crash') {
      [-22, 0, 22].forEach((sx, idx) => {
        drawCircle(ctx, sx, hy - 36 - (idx % 2) * 8, 5, '#FFD60A', OUTLINE, 2.5);
      });
    }

    ctx.restore(); // End Upper Body

    // 5. FRONT LEG BENT ON FRONT PEDAL + FRONT CRANK
    const frontPedalX = 14, frontPedalY = 12;
    ctx.beginPath();
    ctx.moveTo(2, -72); ctx.lineTo(22, -32); ctx.lineTo(frontPedalX, frontPedalY - 4);
    ctx.lineWidth = 15; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = OUTLINE; ctx.stroke();
    ctx.lineWidth = 8; ctx.strokeStyle = legFill; ctx.stroke();

    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(frontPedalX, frontPedalY);
    ctx.lineWidth = 6; ctx.strokeStyle = '#94A3B8'; ctx.stroke();
    drawRect(ctx, frontPedalX - 6, frontPedalY - 12, 20, 10, 4, bootFill, OUTLINE, 3.5);
    if (outfit === 'cowboy') drawCircle(ctx, frontPedalX - 9, frontPedalY - 7, 3.5, '#FFD60A', OUTLINE, 2); // Spur
    drawRect(ctx, frontPedalX - 8, frontPedalY - 3, 18, 7, 3, '#475569', OUTLINE, 3);
  }

  ctx.restore();
}

/** Draw a full rig on any canvas with the hub at (x, y), rotated, at a scale. For DOM previews. */
export function drawRigAt(ctx, x, y, angle, scale, outfit, colorIdx, opts = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(scale, scale);
  ctx.translate(-80, -176);
  drawUnicycleRider(ctx, outfit, PLAYERS[colorIdx % PLAYERS.length], opts);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Phaser: cache rig layers as textures, and a view that composes them
// ---------------------------------------------------------------------------

/** The game's physics wheel has radius 22; the rig's tire is 34. */
export const RIG_SCALE = 22 / RIG_TIRE_R;

/**
 * Texture for one layer of one rig look. Rendered once at `res` × world scale.
 * Wheel textures are 80×80 cells (hub centred); body layers use RIG_CELL.
 */
export function rigTexture(scene, outfit, colorIdx, pose, layer, res = 1) {
  const key = `rig-${outfit}-${colorIdx}-${layer === 'wheel' ? 'any' : pose}-${layer}-${res}`;
  if (scene.textures.exists(key)) return key;
  const cell = layer === 'wheel' ? { width: 80, height: 80, hubX: 40, hubY: 40 } : RIG_CELL;
  const s = RIG_SCALE * res;
  const c = document.createElement('canvas');
  c.width = Math.ceil(cell.width * s);
  c.height = Math.ceil(cell.height * s);
  const ctx = c.getContext('2d');
  ctx.scale(s, s);
  ctx.translate(cell.hubX - 80, cell.hubY - 176);
  drawUnicycleRider(ctx, outfit, PLAYERS[colorIdx % PLAYERS.length], { pose, layer });
  scene.textures.addCanvas(key, c);
  return key;
}

/** Pre-render the poses a race will need so nobody hitches the first time they crash. */
export function warmRig(scene, outfit, colorIdx, res) {
  for (const pose of ['riding', 'lean_back', 'panic', 'airborne', 'victory', 'crash']) {
    rigTexture(scene, outfit, colorIdx, pose, 'back', res);
    rigTexture(scene, outfit, colorIdx, pose, 'front', res);
  }
  rigTexture(scene, outfit, colorIdx, 'riding', 'wheel', res);
}

let shadowReady = false;
function shadowTexture(scene) {
  if (shadowReady && scene.textures.exists('rig-shadow')) return 'rig-shadow';
  if (!scene.textures.exists('rig-shadow')) {
    const c = document.createElement('canvas');
    c.width = 96; c.height = 32;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(20, 16, 40, 0.28)';
    ctx.beginPath(); ctx.ellipse(48, 16, 46, 14, 0, 0, Math.PI * 2); ctx.fill();
    scene.textures.addCanvas('rig-shadow', c);
  }
  shadowReady = true;
  return 'rig-shadow';
}

/**
 * A rider on screen: back layer, spinning wheel, front layer, ground shadow,
 * optional name tag. Everything pivots on the hub. `boost` draws it bigger
 * than physics (the zoomed-out big screen) and lifts it so the wheel still
 * sits on the ground.
 */
export class RiderView {
  constructor(scene, { colorIdx, outfit, res = 1, boost = 1, label = null, labelStyle = null, depth = 10, container = null }) {
    this.scene = scene;
    this.colorIdx = colorIdx;
    this.outfit = outfit;
    this.res = res;
    this.boost = boost;
    this.pose = null;
    const s = boost / res;
    const o = { x: RIG_CELL.hubX / RIG_CELL.width, y: RIG_CELL.hubY / RIG_CELL.height };
    this.shadow = scene.add.image(0, 0, shadowTexture(scene)).setDepth(depth - 1).setScale(0.55 * boost);
    this.back = scene.add.image(0, 0, rigTexture(scene, outfit, colorIdx, 'riding', 'back', res)).setOrigin(o.x, o.y).setScale(s).setDepth(depth);
    this.wheel = scene.add.image(0, 0, rigTexture(scene, outfit, colorIdx, 'riding', 'wheel', res)).setScale(s).setDepth(depth + 0.1);
    this.front = scene.add.image(0, 0, rigTexture(scene, outfit, colorIdx, 'riding', 'front', res)).setOrigin(o.x, o.y).setScale(s).setDepth(depth + 0.2);
    this.parts = [this.shadow, this.back, this.wheel, this.front];
    if (label) {
      this.label = scene.add.text(0, 0, label, labelStyle).setOrigin(0.5, 1).setDepth(depth + 0.3);
      this.parts.push(this.label);
    }
    container?.add(this.parts);
    this.setPose('riding');
  }

  setPose(pose) {
    if (pose === this.pose) return;
    this.pose = pose;
    this.back.setTexture(rigTexture(this.scene, this.outfit, this.colorIdx, pose, 'back', this.res));
    this.front.setTexture(rigTexture(this.scene, this.outfit, this.colorIdx, pose, 'front', this.res));
  }

  /**
   * @param x,y     hub (physics wheel centre)
   * @param angle   whole-rig rotation (0 = upright on screen)
   * @param spin    wheel rotation
   * @param groundY ground height under the rider (for the shadow); null hides it
   */
  set(x, y, angle, spin, pose, alpha = 1, groundY = null, labelScale = 1) {
    this.setPose(pose);
    const lift = 22 * (this.boost - 1);
    const hx = x + Math.sin(angle) * lift;
    const hy = y - Math.cos(angle) * lift;
    this.back.setPosition(hx, hy).setRotation(angle).setAlpha(alpha);
    this.wheel.setPosition(hx, hy).setRotation(spin).setAlpha(alpha);
    this.front.setPosition(hx, hy).setRotation(angle).setAlpha(alpha);
    if (groundY == null) this.shadow.setVisible(false);
    else {
      const h = Math.max(0, groundY - y - 22);
      const k = Math.max(0.25, 1 - h / 400);
      this.shadow.setVisible(true).setPosition(x, groundY + 2).setScale(0.55 * this.boost * k, 0.55 * this.boost * k).setAlpha(alpha * k);
    }
    if (this.label) {
      const head = 175 * RIG_SCALE * this.boost + 10 * labelScale;
      this.label.setPosition(hx + Math.sin(angle) * head, hy - Math.cos(angle) * head).setAlpha(Math.max(alpha, 0.7)).setScale(labelScale);
    }
  }

  setVisible(v) {
    this.parts.forEach((p) => p.setVisible(v));
  }

  destroy() {
    this.parts.forEach((p) => p.destroy());
  }
}
