/* global Phaser */
import { players, sendToPlayer } from '../net.js';
import { MAPS } from '/shared/maps.js';
import { RiderView } from '/shared/rig.js';
import { textStyle } from '/shared/art.js';
import { sunnyBackdrop, card, button, rankBadge } from './ui.js';
import { fmtTime, ordinal } from './RaceScene.js';

const AUTO_ADVANCE_MS = 14000;
const SMALL = { fontFamily: 'Nunito, sans-serif', fontSize: '16px', fontStyle: '900', color: '#1E1B2E' };

export class ResultsScene extends Phaser.Scene {
  constructor() {
    super('results');
  }

  init(data) {
    // Phaser reuses the scene object between visits: reset per-visit state, or the
    // second results screen would think it had already moved on and never advance.
    this.leaving = false;
    this.mapIndex = data.mapIndex;
    this.map = MAPS[this.mapIndex];
    this.results = data.results;
    this.final = this.mapIndex >= MAPS.length - 1;
  }

  create() {
    const { width, height } = this.scale;
    const th = this.map.theme;
    sunnyBackdrop(this, { top: th.sky[0], bottom: th.sky[1], ground: false });
    this.views = [];
    this.events.once('shutdown', () => this.views.forEach((v) => v.destroy()));

    const title = this.final ? 'GRAND PRIX FINAL' : `${this.map.short} RESULTS`;
    this.add.text(width / 2, 48, title, textStyle(54, '#FFD60A', { strokeThickness: 11 })).setOrigin(0.5);

    // Podium: this race's top three, in this world's outfit, celebrating
    const totals = [...players.values()].sort((a, b) => b.score - a.score || a.totalMs - b.totalMs);
    const podium = this.final ? totals.map((p) => ({ ...p, finished: true })) : this.results;
    const spots = [[260, 300, 0xffd60a, 1], [120, 360, 0xcbd5e1, 2], [400, 400, 0xd97706, 3]];
    spots.forEach(([x, top, color, place]) => {
      const r = podium[place - 1];
      const g = this.add.graphics();
      g.fillStyle(color, 1).fillRoundedRect(x - 70, top, 140, height - top - 40, 14).lineStyle(6, 0x1e1b2e, 1).strokeRoundedRect(x - 70, top, 140, height - top - 40, 14);
      this.add.text(x, top + 40, String(place), textStyle(58)).setOrigin(0.5);
      if (!r || r.finished === false) return;
      const v = new RiderView(this, { colorIdx: r.colorIdx, outfit: this.map.outfit, boost: 0.95, res: 1.5 });
      v.base = { x, y: top - 22, place };
      this.views.push(v);
      this.add.text(x, top + 84, r.name.toUpperCase(), textStyle(18, r.color)).setOrigin(0.5);
    });

    // Table
    card(this, 540, 100, 700, 470);
    const head = this.final ? ['', 'RIDER', 'POINTS', 'CRASHES', 'PERFECT'] : ['', 'RIDER', 'TIME', 'CRASHES', 'PERFECT', '+PTS', 'TOTAL'];
    const cols = this.final ? [570, 640, 900, 1010, 1130] : [570, 640, 840, 960, 1050, 1140, 1210];
    head.forEach((h, i) => this.add.text(cols[i], 122, h, { ...SMALL, color: '#64748B', fontSize: '14px' }).setOrigin(i < 2 ? 0 : 0.5, 0));
    const rows = this.final ? totals : this.results;
    rows.forEach((r, i) => {
      const y = 156 + i * 62;
      const p = players.get(r.id) || r;
      rankBadge(this, cols[0] + 20, y + 24, i + 1, 0.42);
      this.add.text(cols[1], y + 10, r.name.toUpperCase(), textStyle(24, r.color));
      const vals = this.final
        ? [String(p.score), String(p.crashes), String(p.perfects)]
        : [r.finished ? fmtTime(r.ms) : 'DNF', String(r.crashes), String(r.perfects), `+${r.pts}`, String(p.score)];
      vals.forEach((v, k) => this.add.text(cols[k + 2], y + 24, v, { ...SMALL, fontSize: k === 0 ? '22px' : '18px', fontFamily: k === 0 && !this.final ? 'ui-monospace, Menlo, Consolas, monospace' : SMALL.fontFamily }).setOrigin(0.5));
    });

    if (this.final && totals.length) {
      const most = (key, dir = 1) => [...totals].sort((a, b) => dir * (b[key] - a[key]))[0];
      const awards = [`CHAMPION: ${totals[0].name.toUpperCase()}`];
      const smooth = most('perfects');
      if (smooth.perfects > 0) awards.push(`SMOOTHEST: ${smooth.name.toUpperCase()} (${smooth.perfects} PERFECT)`);
      const crashy = most('crashes');
      if (crashy.crashes > 0) awards.push(`CRASH KING: ${crashy.name.toUpperCase()} (${crashy.crashes})`);
      this.add.text(890, 520, awards.join('   ·   '), textStyle(16, '#FFD60A')).setOrigin(0.5);
    }

    const next = this.final ? 'PLAY AGAIN' : `NEXT: ${MAPS[this.mapIndex + 1].short}`;
    button(this, 890, 640, 420, 76, next, () => this.advance(), this.final ? { fill: 0x52d14c, shade: 0x2f8f2a } : {});

    // Tell each phone how they did.
    totals.forEach((p, i) => {
      const r = this.results.find((x) => x.id === p.id);
      const status = this.final
        ? i === 0 ? 'YOU WON THE GRAND PRIX! BRAG RESPONSIBLY.' : `GRAND PRIX: ${ordinal(i + 1)} PLACE`
        : `${r?.finished ? `TIME ${fmtTime(r.ms)}` : 'DNF'} · ${r?.crashes ?? 0} CRASHES · OVERALL ${ordinal(i + 1)} (${p.score} PTS)`;
      sendToPlayer(p.id, { phase: 'results', status, place: i + 1, of: totals.length, final: this.final });
    });

    this.input.keyboard.once('keydown-SPACE', () => this.advance());
    if (!this.final) this.time.delayedCall(AUTO_ADVANCE_MS, () => this.advance());
  }

  update(time) {
    for (const v of this.views) {
      const hop = v.base.place === 1 ? Math.abs(Math.sin(time / 260)) * 26 : Math.abs(Math.sin(time / 330 + v.base.place)) * 10;
      v.set(v.base.x, v.base.y - hop, Math.sin(time / 400 + v.base.place) * 0.12, time / 150, 'victory', 1, v.base.y + 22);
    }
  }

  advance() {
    if (this.leaving) return;
    this.leaving = true;
    if (this.final || !players.size) this.scene.start('lobby');
    else this.scene.start('race', { mapIndex: this.mapIndex + 1 });
  }
}
