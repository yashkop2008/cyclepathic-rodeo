// Shared big-screen UI pieces in the handoff's cartoon style: sky backdrop,
// rounded cards, chunky buttons.

/* global Phaser */
import { textStyle } from '/shared/art.js';

const OUTLINE = 0x1e1b2e;

/** Sunny sky gradient, a few clouds and a strip of grassy hills along the bottom. */
export function sunnyBackdrop(scene, { top = 0x56cfe1, bottom = 0xc8f7ff, ground = true } = {}) {
  const { width, height } = scene.scale;
  const g = scene.add.graphics().setDepth(-10);
  g.fillGradientStyle(top, top, bottom, bottom, 1).fillRect(0, 0, width, height);
  if (scene.textures.exists('cloud')) {
    [[160, 120, 0.8], [1080, 90, 0.7], [700, 170, 0.5]].forEach(([x, y, s]) => scene.add.image(x, y, 'cloud').setScale(s).setDepth(-9).setAlpha(0.9));
  }
  if (ground) {
    const hills = [];
    for (let x = 0; x <= width; x += 20) hills.push({ x, y: height - 70 - Math.sin(x / 140) * 18 - Math.sin(x / 57) * 6 });
    g.fillStyle(0x80ed99, 1).fillPoints([...hills.map((p) => ({ x: p.x, y: p.y - 40 })), { x: width, y: height }, { x: 0, y: height }], true);
    g.fillStyle(0x8d5b34, 1).fillPoints([...hills, { x: width, y: height }, { x: 0, y: height }], true);
    g.fillStyle(0x52d14c, 1).fillPoints([...hills.map((p) => ({ x: p.x, y: p.y - 8 })), ...hills.slice().reverse().map((p) => ({ x: p.x, y: p.y + 16 }))], true);
    g.lineStyle(4, 0x1e5e1a, 1).strokePoints(hills.map((p) => ({ x: p.x, y: p.y - 8 })), false);
  }
  return g;
}

/** Rounded white card with a thick dark outline. */
export function card(scene, x, y, w, h, { fill = 0xffffff, alpha = 0.94, border = OUTLINE, lw = 5, r = 22 } = {}) {
  const g = scene.add.graphics();
  g.fillStyle(0x000000, 0.18).fillRoundedRect(x + 6, y + 8, w, h, r);
  g.fillStyle(fill, alpha).fillRoundedRect(x, y, w, h, r);
  g.lineStyle(lw, border, 1).strokeRoundedRect(x, y, w, h, r);
  return g;
}

/** Big chunky button (PLAY blue by default). Returns the hit zone. */
export function button(scene, x, y, w, h, label, onClick, { fill = 0x00a8ff, shade = 0x0077b6, size = 30 } = {}) {
  const g = scene.add.graphics();
  const draw = (pressed) => {
    g.clear();
    g.fillStyle(shade, 1).fillRoundedRect(x - w / 2, y - h / 2 + 6, w, h, 18);
    g.fillStyle(fill, 1).fillRoundedRect(x - w / 2, y - h / 2 + (pressed ? 6 : 0), w, h - 6, 18);
    g.lineStyle(5, OUTLINE, 1).strokeRoundedRect(x - w / 2, y - h / 2 + (pressed ? 6 : 0), w, h - (pressed ? 0 : 0), 18);
  };
  draw(false);
  const t = scene.add.text(x, y - 2, label, textStyle(size)).setOrigin(0.5);
  const zone = scene.add.zone(x, y, w, h).setInteractive({ useHandCursor: true });
  zone.on('pointerdown', () => { draw(true); t.y = y + 4; });
  zone.on('pointerout', () => { draw(false); t.y = y - 2; });
  zone.on('pointerup', () => { draw(false); t.y = y - 2; onClick(); });
  return { g, t, zone, setAlpha: (a) => { g.setAlpha(a); t.setAlpha(a); } };
}

/** Shield-shaped rank badge (handoff HUD): gold / silver / bronze / plain. */
export function rankBadge(scene, x, y, place, s = 1) {
  const fills = [0xffd60a, 0xcbd5e1, 0xd97706];
  const g = scene.add.graphics();
  const pts = [[-40, -46], [40, -46], [40, 14], [0, 46], [-40, 14]].map(([px, py]) => ({ x: x + px * s, y: y + py * s }));
  g.fillStyle(fills[place - 1] ?? 0x5b6ee1, 1).fillPoints(pts, true).lineStyle(6 * s, OUTLINE, 1).strokePoints(pts, true);
  const suffix = ['ST', 'ND', 'RD'][place - 1] ?? 'TH';
  const t = scene.add.text(x, y - 8 * s, `${place}${suffix.toLowerCase()}`, textStyle(Math.round(34 * s))).setOrigin(0.5);
  return [g, t];
}
