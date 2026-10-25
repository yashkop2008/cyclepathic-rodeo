/* global Phaser */
import { players, sendToPlayer, broadcastSnap } from '../net.js';
import { MAPS, buildTrack, heightAt, groundAt, platformAngle, progressOf, surfaceProps, obstacleHits, obstaclePose } from '/shared/maps.js';
import { buildWorld, textStyle, dotTexture } from '/shared/art.js';
import { warmRig } from '/shared/rig.js';
import { STATE, WHY } from '/shared/protocol.js';
import { Unicycle, TUNING } from '../unicycle.js';

const DEG = Math.PI / 180;
const POINTS = [10, 8, 6, 5, 4, 3];
const COUNTDOWN_MS = 3500;
const FINISH_TIMEOUT_MS = 25000; // after the first finisher, everyone else gets this long
const RACE_LIMIT_MS = 180000;
const GOD_STRENGTH = 0.35; // finishers' average tilt is scaled by this and added to everyone else's gravity
const SNAP_MS = 50; // 20 position updates per second to phones
const RIDER_PX = 44; // rider height on the big screen
const TOP = 84; // HUD bar height
const ROWS = 3; // the course is wrapped into this many rows so the whole map fits on screen
const BOTTOM = 40; // standings bar height
const PASS_MARGIN = 40; // px a rider must be ahead before the HUD swaps their places

export const fmtTime = (ms) => {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
};

export class RaceScene extends Phaser.Scene {
  constructor() {
    super('race');
  }

  init(data) {
    this.mapIndex = data.mapIndex ?? 0;
    this.map = MAPS[this.mapIndex];
    this.track = buildTrack(this.map);
  }

  create() {
    const { width, height } = this.scale;
    this.matter.world.setGravity(0, 0);
    this.cameras.main.setBackgroundColor(this.map.theme.sky[0]);

    this.worldLayer = this.add.layer();
    this.hudLayer = this.add.layer();
    // bake: terrain drawn once into half-resolution textures (the big screen is zoomed way out anyway)
    this.world = buildWorld(this, this.map, this.track, { layer: this.worldLayer, parallax: 1, bake: 0.5 });
    this.buildBodies();
    this.setupCameras(width, height);
    this.cullRows();

    // Riders start side by side at the first checkpoint. They never collide.
    const list = [...players.values()];
    list.forEach((p) => warmRig(this, this.map.outfit, p.colorIdx, Math.min(1, this.boost * 0.5)));
    this.riders = list.map((p, i) => {
      const x = 90 + i * 34;
      const r = new Unicycle(this, p, x, heightAt(this.track, x), this.map, this.track, this.worldLayer, this.boost, 0.9 / this.zoom);
      return r;
    });

    this.dust = this.add.particles(0, 0, dotTexture(this), {
      emitting: false,
      speed: { min: 80 / this.zoom, max: 260 / this.zoom },
      angle: { min: 200, max: 340 },
      gravityY: 900 / this.zoom,
      lifespan: 500,
      scale: { start: 2.5 / this.zoom / 4, end: 0 },
      tint: this.map.theme.top,
    });
    this.worldLayer.add(this.dust);

    this.startAt = null; // set on the first update(), when the scene clock is valid
    this.firstFinishAt = null;
    this.godTwist = 0;
    this.ended = false;
    this.snapAcc = 0;
    this.leaderId = null;
    this.hudOrder = null;
    this.feed = [];

    const step = () => this.physicsStep();
    this.matter.world.on('beforeupdate', step);
    this.events.once('shutdown', () => this.matter.world?.off('beforeupdate', step));

    this.cursors = this.input.keyboard.createCursorKeys();
    this.input.keyboard.on('keydown-ESC', () => this.endRace());

    this.buildHud(width, height);
  }

  // ------------------------------------------------------------ world

  buildBodies() {
    const T = 160; // slab thickness (thick, so a fast landing can't tunnel through)
    const pts = this.track.pts;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      // Gap walls get their own thin bodies below; a thick slab here would poke up above the ramp lip.
      if (Math.abs(angle) > 1.2 || this.track.gaps.some((g) => (a.x + b.x) / 2 > g.x0 && (a.x + b.x) / 2 < g.x1)) continue;
      const len = Math.hypot(b.x - a.x, b.y - a.y) + 6; // overlap so wheels don't snag on seams
      // Shift the slab along the surface normal so its top face is the terrain line.
      const cx = (a.x + b.x) / 2 - (Math.sin(angle) * T) / 2;
      const cy = (a.y + b.y) / 2 + (Math.cos(angle) * T) / 2;
      this.matter.add.rectangle(cx, cy, len, T, { isStatic: true, angle, friction: 0, label: 'ground' });
    }
    // Gap walls: thin, tucked inside the ground, starting just below the lip.
    for (const g of this.track.gaps) {
      this.matter.add.rectangle(g.x0 - 12, g.rim + 30 + 700, 24, 1400, { isStatic: true, friction: 0, label: 'wall' });
      this.matter.add.rectangle(g.x1 + 12, g.rim + 30 + 700, 24, 1400, { isStatic: true, friction: 0, label: 'wall' });
    }
    const end = pts[pts.length - 1];
    this.matter.add.rectangle(-30, 0, 60, 6000, { isStatic: true });
    this.matter.add.rectangle(end.x + 30, 0, 60, 6000, { isStatic: true });

    // Moving platforms: planks are re-angled every physics step; the wagon wheel is a big static circle.
    this.platformBodies = this.track.platforms.map((p) =>
      p.kind === 'wagonwheel'
        ? { p, body: this.matter.add.circle(p.x, p.y, p.r, { isStatic: true, friction: 0 }) }
        : { p, body: this.matter.add.rectangle(p.x, p.y, p.len, 24, { isStatic: true, friction: 0 }) },
    );
  }

  /** Wrap the course into rows: each row is a camera looking at one third of the track. */
  setupCameras(width, height) {
    const L = this.track.endX + 200;
    const span = L / ROWS;
    const rowH = (height - TOP - BOTTOM) / ROWS;
    this.rowCams = [];
    let zoom = Infinity;
    const rows = [];
    for (let i = 0; i < ROWS; i++) {
      const x0 = i * span - 100;
      const x1 = x0 + span;
      let lo = Infinity;
      let hi = -Infinity;
      for (let x = Math.max(0, x0); x < x1; x += 40) {
        const g = groundAt(this.track, x, 0);
        if (g.gap) continue;
        lo = Math.min(lo, g.y);
        hi = Math.max(hi, g.y);
      }
      rows.push({ x0, x1, lo, hi });
      zoom = Math.min(zoom, width / (span + 120), rowH / (hi - lo + 420));
    }
    this.zoom = zoom;
    this.boost = RIDER_PX / (120 * zoom);
    rows.forEach((r, i) => {
      const cam = i === 0 ? this.cameras.main : this.cameras.add();
      cam.setViewport(0, TOP + i * rowH, width, rowH).setZoom(zoom).setBackgroundColor(this.map.theme.sky[0]);
      cam.centerOn((r.x0 + r.x1) / 2, (r.lo + r.hi) / 2 - 110);
      cam.ignore(this.hudLayer);
      this.rowCams.push(cam);
    });
    const hudCam = this.cameras.add(0, 0, width, height);
    hudCam.ignore(this.worldLayer);
    this.rowH = rowH;
  }

  /**
   * Each row camera only needs the scenery in its own third of the track. Without this,
   * every row redraws the whole map (3× the work).
   */
  cullRows() {
    const statics = this.worldLayer.list.slice();
    for (const cam of this.rowCams) {
      // (cam.worldView isn't refreshed until the first render, so work the range out directly.)
      const half = cam.width / cam.zoom / 2;
      const v = { x: cam.midPoint.x - half, right: cam.midPoint.x + half };
      for (const o of statics) {
        let x0;
        let x1;
        if (o.bounds) ({ x0, x1 } = o.bounds); // terrain chunks
        else if (o.type === 'Image' && o.scrollFactorX === 1) {
          const b = o.getBounds();
          x0 = b.x;
          x1 = b.right;
        } else continue; // sky, ridges, platforms etc. span or move: keep
        if (x1 < v.x - 300 || x0 > v.right + 300) cam.ignore(o);
      }
    }
  }

  buildHud(width, height) {
    const add = (o) => (this.hudLayer.add(o), o);
    const g = add(this.add.graphics());
    // Top bar
    g.fillStyle(0x14121f, 0.82).fillRect(0, 0, width, TOP);
    g.fillStyle(0x14121f, 0.82).fillRect(0, height - BOTTOM, width, BOTTOM);
    // Row separators
    g.lineStyle(4, 0x1e1b2e, 1);
    for (let i = 1; i < ROWS; i++) g.lineBetween(0, TOP + i * this.rowH, width, TOP + i * this.rowH);
    add(this.add.text(24, 16, this.map.name, textStyle(26)));
    add(this.add.text(24, 50, 'PHONE = GROUND · TOO STEEP = WIPEOUT · LAND LEVEL = BOOST', textStyle(15, '#C8F7FF')));

    // Progress bar (handoff HUD): track + fill + a marker per rider
    this.bar = { x: 560, y: 24, w: 400, h: 32 };
    const b = this.bar;
    g.fillStyle(0x262335, 1).fillRoundedRect(b.x, b.y, b.w, b.h, 16).lineStyle(4, 0xffffff, 1).strokeRoundedRect(b.x, b.y, b.w, b.h, 16);
    // Fill: a bar image scaled from the left; markers: one sprite per rider. Both ease every frame.
    const fillKey = barTexture(this, 'bar-fill', b.w - 12, b.h - 12, this.map.barColor);
    this.barFill = add(this.add.image(b.x + 6, b.y + 6, fillKey).setOrigin(0, 0).setScale(0.02, 1));
    this.barFillP = 0;
    this.barFillS = { x: 0, v: 0 };
    this.marks = new Map(this.riders.map((r) => [r, { img: add(this.add.image(b.x, b.y + b.h / 2, markTexture(this, r.player.color))), x: 0, v: 0 }]));

    // Timer pill
    g.fillStyle(0x14121f, 0.78).fillRoundedRect(width - 250, 18, 226, 48, 24).lineStyle(3, 0xffffff, 1).strokeRoundedRect(width - 250, 18, 226, 48, 24);
    g.lineStyle(4, 0xffffff, 1).strokeEllipse(width - 222, 42, 22, 22, 16).lineBetween(width - 222, 42, width - 222, 35).lineBetween(width - 226, 28, width - 218, 28);
    this.hudTime = add(this.add.text(width - 200, 42, '00:00.00', { fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: '28px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(0, 0.5));

    // Standings bar along the bottom: a chip per rider that slides into its new place on every overtake.
    const n = Math.max(1, this.riders.length);
    this.chipW = Math.min(204, (width - 24) / n - 8);
    this.chips = new Map(
      this.riders.map((r, i) => {
        const x = 12 + i * (this.chipW + 8);
        const c = add(this.add.container(x, height - BOTTOM / 2));
        // Chip backgrounds are pre-drawn textures (rounded vector shapes cost hundreds of points a frame).
        const bg = this.add.image(0, 0, chipTexture(this, r.player.color, this.chipW, false)).setOrigin(0, 0.5);
        const draw = (lead) => bg.setTexture(chipTexture(this, r.player.color, this.chipW, lead));
        const rank = this.add.text(15, 0, String(i + 1), textStyle(16)).setOrigin(0.5);
        const name = this.add.text(38, 0, r.player.name.toUpperCase(), textStyle(14, r.player.color)).setOrigin(0, 0.5);
        const status = this.add.text(this.chipW - 8, 0, '', textStyle(14, '#C8F7FF')).setOrigin(1, 0.5);
        c.add([bg, rank, name, status]);
        return [r, { c, x, v: 0, rank, status, draw, lead: false, place: i + 1, y: height - BOTTOM / 2 }];
      }),
    );
    this.hudCenter = add(this.add.text(width / 2, height / 2, '', textStyle(110, '#FFD60A', { strokeThickness: 14 })).setOrigin(0.5));
    this.hudGods = add(this.add.text(width / 2, TOP + 10, '', textStyle(18, '#FF8FA3')).setOrigin(0.5, 0));
    this.hudFeed = add(this.add.text(width - 16, height - BOTTOM - 10, '', textStyle(18, '#ffffff', { align: 'right', lineSpacing: 4 })).setOrigin(1, 1));

    // The static HUD frame never changes: bake it into one texture instead of re-drawing it every frame.
    if (this.textures.exists('hud-frame')) this.textures.remove('hud-frame');
    g.generateTexture('hud-frame', width, height);
    const frame = this.add.image(0, 0, 'hud-frame').setOrigin(0, 0);
    this.hudLayer.addAt(frame, this.hudLayer.getIndex(g));
    g.destroy();
  }

  // ------------------------------------------------------------ input

  updateLocalInputs(dt, t) {
    const kb = players.get('keyboard');
    if (kb) {
      const dir = (this.cursors.right.isDown ? 1 : 0) - (this.cursors.left.isDown ? 1 : 0);
      // Arrow keys ease the tilt like a real wrist would, and it springs back when released.
      kb.tilt = dir ? Phaser.Math.Clamp(kb.tilt + dir * dt * 0.12, -60, 60) : kb.tilt * 0.9;
    }
    for (const r of this.riders) if (r.player.kind === 'bot') r.player.tilt += (this.botTilt(r, t) - r.player.tilt) * r.player.reflex;
  }

  /**
   * Bots read the course like a decent player: lean ~30° into the ground, ease off before
   * drops, push harder on climbs, and level the landing zone while in the air. Each bot has
   * its own aggression and sloppiness, so they make (some) mistakes.
   */
  botTilt(r, t) {
    const p = r.player;
    if (r.state === STATE.FINISHED) return Math.sin(this.time.now / 700 + p.colorIdx) * 45; // Gravity God mode
    const v = r.wheel.velocity;
    const noise = Math.sin(this.time.now / 430 + p.colorIdx * 3) * p.sloppy;
    const twist = this.godTwist / DEG;
    if (!r.grounded) {
      // Predict the flight under current gravity. Over a gap: keep pushing forward to stretch
      // the jump. Close to touchdown on solid ground: level the ground where we'll land.
      let x = r.x;
      let y = r.y;
      let vx = v.x;
      let vy = v.y;
      const G = this.map.gravity * 0.278;
      let n = 0;
      for (; n < 400; n++) {
        x += vx;
        y += vy;
        vx += Math.sin(r.gravityAngle) * G;
        vy += Math.cos(r.gravityAngle) * G;
        if (y > groundAt(this.track, x, t).y - 22) break;
      }
      const land = groundAt(this.track, x, t);
      if (land.gap && !land.platform) return Phaser.Math.Clamp(p.aggro + 10 - twist, -45, 55);
      if (n > 35) return Phaser.Math.Clamp(p.aggro * 0.5 - twist + noise, -45, 55);
      return -land.slope / DEG - twist + noise;
    }
    const here = r.ground ? r.ground.slope / DEG : 0;
    let steepestDown = here;
    const look = Phaser.Math.Clamp(Math.abs(v.x) * 22, 80, 420);
    for (let d = 30; d < look; d += 30) {
      const g = groundAt(this.track, r.x + d, t);
      if (!g.gap || g.platform) steepestDown = Math.max(steepestDown, g.slope / DEG);
    }
    const limit = TUNING.crashLean * Math.sqrt(surfaceProps(this.map, r.ground?.surface).grip);
    let tilt = p.aggro - here;
    tilt = Math.min(tilt, limit - 10 - steepestDown);
    // Timing obstacles: ease off well before one that will be in the way, brake to wait just
    // outside its reach, and once inside its reach just go.
    const danger = this.obstacleAhead(r, t);
    if (danger) {
      if (danger.dist > danger.reach + 140) tilt = Math.min(tilt, 4 - here);
      else if (danger.dist > danger.reach) tilt = -here - 18;
    }
    return Phaser.Math.Clamp(tilt - twist + noise, -45, 60);
  }

  /** How far from its centre an obstacle can hit you (px). */
  reachOf(o) {
    if (o.kind === 'pendulum') return o.len * Math.sin(o.amp) + 50;
    if (o.kind === 'gate') return 40;
    return o.r + 50;
  }

  /**
   * Bot helper: at our current speed, will we reach an obstacle while it's in the way?
   * Returns { dist, reach } if so, else null.
   */
  obstacleAhead(r, t) {
    const vx = Math.max(1.5, r.wheel.velocity.x);
    for (const o of this.track.obstacles) {
      const ox = o.x ?? null;
      if (ox !== null && (ox < r.x - 20 || ox > r.x + 600)) continue;
      if (ox === null && (o.xb < r.x || o.xa > r.x + 600)) continue;
      for (let n = 2; n < 80; n += 2) {
        const at = t + n * 16.67;
        const px = r.x + vx * n;
        const pose = obstaclePose(this.track, o, at);
        const inWay = o.kind === 'gate'
          ? Math.abs(px - pose.x) < 30 && (pose.on || pose.warn)
          : Math.abs(px - pose.x) < pose.r + 30 && pose.y > heightAt(this.track, pose.x) - 175;
        if (inWay) return { dist: Math.abs((ox ?? pose.x) - r.x), reach: this.reachOf(o) };
      }
    }
    return null;
  }

  // ------------------------------------------------------------ simulation

  racing() {
    return this.startAt !== null && this.time.now >= this.startAt && !this.ended;
  }

  raceTime() {
    return this.startAt === null ? 0 : Math.max(0, this.time.now - this.startAt);
  }

  physicsStep() {
    const live = this.racing();
    const t = this.raceTime();
    for (const { p, body } of this.platformBodies) {
      if (p.kind !== 'wagonwheel') this.matter.body.setAngle(body, platformAngle(p, t));
    }
    for (const r of this.riders) {
      const tilt = r.player.tilt * DEG;
      if (!live) r.hold(tilt); // countdown: tilt freely, but nobody rolls yet
      else if (r.state === STATE.FINISHED) r.park();
      else r.applyForces(tilt + this.godTwist);
    }
  }

  update(time, dt) {
    if (this.ended) return;
    if (this.startAt === null) this.startAt = time + COUNTDOWN_MS;
    const live = this.racing();
    const t = this.raceTime();
    this.updateLocalInputs(dt, t);

    // Gravity Gods: riders who already finished twist gravity for everyone still racing.
    const gods = this.riders.filter((r) => r.state === STATE.FINISHED);
    this.godTwist = gods.length ? (gods.reduce((s, r) => s + r.player.tilt, 0) / gods.length) * GOD_STRENGTH * DEG : 0;

    for (const r of this.riders) {
      const landSeq = r.landSeq;
      let ev = r.tick(time, t, dt, live);
      // Moving obstacles knock you back (ghosts and finishers pass through)
      if (live && r.state === STATE.RACING) {
        const hit = this.track.obstacles.find((o) => Math.abs((o.x ?? (o.xa + o.xb) / 2) - r.x) < 700 && obstacleHits(this.track, o, t, r.bodyCircles()));
        if (hit) ev = r.bonk(time, obstaclePose(this.track, hit, t).x);
      }
      if (r.landSeq !== landSeq) this.dust.explode(Math.min(24, 4 + Math.round(r.landHit * 1.5)), r.x, r.ground.y);
      if (ev === 'crash') this.say(`${r.player.name.toUpperCase()}: ${WHY[r.crashWhy]}`, r.player.color);
      else if (ev === 'bonk') this.say(`${r.player.name.toUpperCase()} GOT BONKED!`, r.player.color);
      else if (ev === 'perfect') this.say(`${r.player.name.toUpperCase()}: PERFECT LANDING!`, '#FFD60A');
      if (r.racing && r.x >= this.track.finishX) {
        r.finish(t);
        const place = this.riders.filter((o) => o.state === STATE.FINISHED).length;
        if (!this.firstFinishAt) this.firstFinishAt = time;
        this.say(`${r.player.name.toUpperCase()} FINISHED ${ordinal(place)} - ${fmtTime(t)}`, '#52D14C');
        if (place === 1) this.say('FINISHERS ARE NOW GRAVITY GODS!', '#FF8FA3');
      }
      r.draw(time);
    }
    this.world.update(t, null);

    const order = this.hudStandings();
    const lead = order[0];
    if (live && lead && lead.player.id !== this.leaderId && t > 2000) {
      if (this.leaderId) this.say(`${lead.player.name.toUpperCase()} TAKES THE LEAD!`, lead.player.color);
      this.leaderId = lead.player.id;
    } else if (!this.leaderId && lead) this.leaderId = lead.player.id;

    this.updateHud(time, t, order);
    this.updatePhones(order, live);
    this.snapAcc += dt;
    if (this.snapAcc >= SNAP_MS) {
      this.snapAcc = 0;
      this.sendSnap(time, t, live);
    }
    this.checkRaceOver(time, t);
  }

  standings() {
    const done = this.riders.filter((r) => r.state === STATE.FINISHED).sort((a, b) => a.finishMs - b.finishMs);
    const rest = this.riders.filter((r) => r.state !== STATE.FINISHED).sort((a, b) => (b.state === STATE.CRASHED ? b.crashX : b.x) - (a.state === STATE.CRASHED ? a.crashX : a.x));
    return [...done, ...rest];
  }

  /**
   * Standings for the screens: like standings(), but two riders only swap once one is clearly
   * ahead (PASS_MARGIN px). Riders rocking back and forth side by side on bumps used to make
   * the bottom bar flip every few frames.
   */
  hudStandings() {
    const key = (r) => (r.state === STATE.FINISHED ? 1e9 - r.finishMs : r.state === STATE.CRASHED ? r.crashX : r.x);
    const o = this.hudOrder || (this.hudOrder = this.standings());
    // One bubble pass per frame: at most one place change per rider per frame, which also reads better.
    for (let i = 0; i < o.length - 1; i++) {
      const a = o[i];
      const b = o[i + 1];
      const certain = b.state === STATE.FINISHED || a.state === STATE.FINISHED;
      if (key(b) > key(a) + (certain ? 0 : PASS_MARGIN)) {
        o[i] = b;
        o[i + 1] = a;
      }
    }
    return o;
  }

  say(text, color) {
    this.feed.unshift({ text, color, at: this.time.now });
    this.feed.length = Math.min(this.feed.length, 4);
  }

  sendSnap(time, t, live) {
    broadcastSnap({
      ht: Math.round(time), // host clock: phones interpolate between snapshots on this timeline
      ph: live ? 'race' : 'countdown',
      m: this.mapIndex,
      cd: live ? 0 : Math.max(0, Math.ceil((this.startAt - time) / 1000)),
      gt: Math.round(this.godTwist * 1000) / 1000,
      t: Math.round(t),
      r: this.riders.map((r) => r.snapshot(time)),
    });
  }

  updateHud(time, t, order) {
    if (time < this.startAt) this.hudCenter.setFontSize(110).setText(String(Math.ceil((this.startAt - time) / 1000)));
    else if (time < this.startAt + 800) this.hudCenter.setFontSize(110).setText('GO!');
    else if (this.firstFinishAt) this.hudCenter.setFontSize(36).setText(`RACE ENDS IN ${Math.max(0, Math.ceil((this.firstFinishAt + FINISH_TIMEOUT_MS - time) / 1000))}`);
    else this.hudCenter.setText('');

    this.hudTime.setText(fmtTime(t));

    // Progress bar: fill eases toward the leader, markers ease toward each rider (leader on top)
    const b = this.bar;
    // Clamp the frame time so a hitch (tab switch, GC) can't make anything jump.
    const dt = Math.min(0.05, this.game.loop.delta / 1000);
    const prog = (r) => (r.state === STATE.FINISHED ? 1 : progressOf(this.track, r.state === STATE.CRASHED ? r.crashX : r.x));
    this.barFillP = spring(this.barFillS, order[0] ? prog(order[0]) : 0, dt, 9);
    this.barFill.setScale(Math.max(0.02, this.barFillP), 1);
    order.forEach((r, i) => {
      const m = this.marks.get(r);
      if (!m) return;
      spring(m, prog(r), dt, 12);
      m.img.setX(b.x + 6 + (b.w - 12) * m.x).setDepth(10 - i);
    });

    // Standings chips ride critically-damped springs to their slots (no overshoot, no snapping,
    // velocity carries through when places change again mid-slide). The chip gaining a place
    // lifts and grows a little while it passes over the others.
    order.forEach((r, i) => {
      const chip = this.chips.get(r);
      if (!chip) return;
      const target = 12 + i * (this.chipW + 8);
      spring(chip, target, dt, 11);
      const lift = Phaser.Math.Clamp(-chip.v / 900, 0, 1); // moving left = gaining
      chip.c.setPosition(chip.x, chip.y - lift * 5).setScale(1 + lift * 0.05).setDepth(lift > 0.05 ? 2 : 1);
      if (chip.place !== i + 1) {
        chip.place = i + 1;
        chip.rank.setText(String(i + 1));
        this.tweens.add({ targets: chip.rank, scale: { from: 1.6, to: 1 }, duration: 380, ease: 'Back.easeOut' });
      }
      const lead = i === 0;
      if (lead !== chip.lead) {
        chip.lead = lead;
        chip.draw(lead);
      }
      const status = r.state === STATE.FINISHED ? fmtTime(r.finishMs) : r.state === STATE.CRASHED ? 'CRASH!' : r.state === STATE.GHOST ? 'OUCH' : `${Math.round(prog(r) * 100)}%`;
      if (chip.status.text !== status) chip.status.setText(status);
    });

    const gods = this.riders.filter((r) => r.state === STATE.FINISHED);
    this.hudGods.setText(gods.length && gods.length < this.riders.length ? `GRAVITY GODS AT WORK: ${gods.map((r) => r.player.name.toUpperCase()).join(', ')}` : '');

    this.feed = this.feed.filter((f) => time - f.at < 4500);
    this.hudFeed.setText(this.feed.map((f) => f.text).join('\n'));
    this.hudFeed.setColor(this.feed[0]?.color || '#ffffff');
  }

  updatePhones(order, live) {
    for (const r of this.riders) {
      const place = order.indexOf(r) + 1;
      let phase = 'racing';
      if (!live) phase = 'countdown';
      else if (r.state === STATE.FINISHED) phase = this.riders.every((o) => o.state === STATE.FINISHED) ? 'finished' : 'god';
      sendToPlayer(r.player.id, { phase, place, of: this.riders.length, map: this.mapIndex });
    }
  }

  checkRaceOver(time, t) {
    if (!this.racing()) return;
    const allDone = this.riders.every((r) => r.state === STATE.FINISHED);
    const timeout = this.firstFinishAt && time - this.firstFinishAt > FINISH_TIMEOUT_MS;
    if (allDone || timeout || t > RACE_LIMIT_MS) this.endRace();
  }

  endRace() {
    if (this.ended) return;
    this.ended = true;
    let place = 0;
    const results = this.standings().map((r) => {
      const finished = r.state === STATE.FINISHED;
      const pts = finished ? POINTS[place++] ?? 1 : 0;
      r.player.score += pts;
      r.player.crashes += r.crashes;
      r.player.perfects += r.perfects;
      r.player.totalMs += finished ? r.finishMs : RACE_LIMIT_MS;
      return { id: r.player.id, name: r.player.name, colorIdx: r.player.colorIdx, color: r.player.color, finished, ms: r.finishMs, crashes: r.crashes, perfects: r.perfects, pts };
    });
    this.time.delayedCall(900, () => this.scene.start('results', { mapIndex: this.mapIndex, results }));
  }
}

/** Rounded bar texture for the progress fill (scaled from the left each frame). */
function barTexture(scene, key, w, h, color) {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, h / 2);
  ctx.fill();
  scene.textures.addCanvas(key, c);
  return key;
}

/**
 * Critically-damped spring step: moves s.x toward target with velocity s.v. Stable at any
 * frame rate (sub-stepped), never overshoots, and keeps momentum when the target moves.
 * omega ≈ 4 / settle-time in seconds. Returns the new value.
 */
function spring(s, target, dt, omega) {
  const steps = Math.ceil(dt / (1 / 120));
  const h = dt / steps;
  for (let k = 0; k < steps; k++) {
    s.v += (omega * omega * (target - s.x) - 2 * omega * s.v) * h;
    s.x += s.v * h;
  }
  return s.x;
}

/** Standings chip background: dark pill with the rider's colour on the left; gold ring for the leader. */
function chipTexture(scene, color, w, lead) {
  const key = `chip-${color}-${Math.round(w)}-${lead ? 1 : 0}`;
  if (scene.textures.exists(key)) return key;
  const W = Math.round(w) + 4;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = 32;
  const ctx = c.getContext('2d');
  ctx.beginPath(); ctx.roundRect(2, 2, W - 4, 28, 10); ctx.fillStyle = '#262335'; ctx.fill();
  ctx.save(); ctx.clip(); ctx.fillStyle = color; ctx.fillRect(2, 2, 30, 28); ctx.restore();
  ctx.lineWidth = 3; ctx.strokeStyle = lead ? '#FFD60A' : '#1E1B2E'; ctx.stroke();
  scene.textures.addCanvas(key, c);
  return key;
}

/** Progress-bar marker: a rider-coloured dot with a dark ring. */
function markTexture(scene, color) {
  const key = `mark-${color}`;
  if (scene.textures.exists(key)) return key;
  const c = document.createElement('canvas');
  c.width = 26;
  c.height = 26;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1E1B2E';
  ctx.beginPath(); ctx.arc(13, 13, 12, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(13, 13, 8.5, 0, Math.PI * 2); ctx.fill();
  scene.textures.addCanvas(key, c);
  return key;
}

export const ordinal = (n) => {
  const s = ['TH', 'ST', 'ND', 'RD'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};
