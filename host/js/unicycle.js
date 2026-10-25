// One rider = a single physics wheel. Gravity is applied per-wheel (world
// gravity is off) and points wherever the player's phone tilt says: your phone
// IS the ground, so tipping it 20° makes the course 20° steeper or flatter.
//
// Your rider always stands upright in the real world, so how far they lean
// against the ground is exactly how steep the ground under them is right now
// (tilt + slope). That one number drives the skill:
//   - steeper = faster, but lean past ~50° (less on low-grip ground) and you wipe out;
//   - land with the ground under you level for a PERFECT boost; land crooked or
//     too hard and you crash;
//   - crashes cost you: tumble, then respawn at the last checkpoint, clock running.
//
// Motion is pure physics, no motor: gravity along the slope, rolling drag
// (per surface), and air drag that sets a natural top speed.

/* global Phaser */
import { RiderView, POSES } from '/shared/rig.js';
import { groundAt, surfaceProps, RULES } from '/shared/maps.js';
import { textStyle } from '/shared/art.js';
import { R, STATE } from '/shared/protocol.js';

const M = Phaser.Physics.Matter.Matter;
const DT2 = (1000 / 60) ** 2; // Matter: Δv (px/step) = force / mass × dt²
const DEG = Math.PI / 180;

export const WHEEL_R = 22;
const CAT_GROUND = 0x1; // Matter's default category, used by the terrain
const CAT_WHEEL = 0x2; // wheels only collide with the ground, never with each other

export const TUNING = {
  gravityScale: 0.001, // Matter's own default (≈ 1000 px/s², about real g at this scale)
  drag: 0.0006, // quadratic air drag: sets top speed
  safetyCap: 30, // px/step, only to stop the wheel tunnelling through the ground
  crashLean: RULES.crashLean, // degrees of lean (tilt + slope) you can hold on full-grip ground
  overLeanMs: 350, // ...for this long before you go over
  perfectBoost: 5, // px/step added along the ground
  sloppyKeep: 0.5, // a sloppy landing keeps this much of your speed
  crashMs: 1300, // tumble time before respawn
  ghostMs: 1500, // see-through after respawn: no crashes, nobody can hurt you
  bonkMs: 1000, // see-through recovery after an obstacle knocks you back
};

export class Unicycle {
  /**
   * @param boost draw the rider this many times bigger than its physics size
   *              (the big screen zooms way out, so icons need boosting)
   */
  constructor(scene, player, x, groundY, map, track, layer, boost = 1, labelScale = 1) {
    this.scene = scene;
    this.player = player;
    this.map = map;
    this.track = track;
    this.state = STATE.RACING;
    this.gravityAngle = 0;
    this.grounded = true;
    this.airSince = 0;
    this.prevV = { x: 0, y: 0 };
    this.sway = 0;
    this.spin = 0;
    this.spinRate = 0;
    this.lean = 0;
    this.overLean = 0;
    this.cp = 0;
    this.gHist = []; // recent gravity angles, for lag forgiveness
    this.sloppySeq = 0;
    this.bonkSeq = 0;
    this.bonks = 0;
    this.failStreak = 0; // crashes since the last checkpoint (comeback rule)
    this.finishMs = 0;
    this.crashes = 0;
    this.perfects = 0;
    this.crashSeq = 0;
    this.crashWhy = 0;
    this.crashAt = 0;
    this.ghostUntil = 0;
    this.perfectSeq = 0;
    this.landSeq = 0;
    this.landHit = 0;
    this.padSeq = 0;
    this.lastPad = 0;
    this.pose = 'riding';
    this.ground = null;

    // Physically the rider's weight sits on the axle and the wheel barely matters, so the
    // body glides without friction or rotation (a = g·sinθ along the slope, very stable);
    // the wheel graphic spins from the distance travelled.
    this.wheel = scene.matter.add.circle(x, groundY - WHEEL_R - 2, WHEEL_R, {
      friction: 0,
      frictionStatic: 0,
      frictionAir: 0,
      restitution: 0.05,
      density: 0.004,
      collisionFilter: { category: CAT_WHEEL, mask: CAT_GROUND },
      label: 'wheel',
    });
    M.Body.setInertia(this.wheel, Infinity);

    this.view = new RiderView(scene, {
      colorIdx: player.colorIdx,
      outfit: map.outfit,
      res: Math.min(1, boost * 0.5),
      boost,
      label: player.name.toUpperCase(),
      labelStyle: textStyle(15, player.color),
      container: layer,
    });
    this.labelScale = labelScale;
  }

  get x() {
    return this.wheel.position.x;
  }

  get y() {
    return this.wheel.position.y;
  }

  get speed() {
    return Math.hypot(this.wheel.velocity.x, this.wheel.velocity.y);
  }

  get racing() {
    return this.state === STATE.RACING || this.state === STATE.GHOST;
  }

  /** Called from Matter's beforeupdate, once per physics step. */
  applyForces(gravityAngle) {
    this.gravityAngle = gravityAngle;
    if (this.state === STATE.CRASHED) return this.hold(gravityAngle);
    const b = this.wheel;
    const g = this.map.gravity * TUNING.gravityScale * b.mass;
    b.force.x += Math.sin(gravityAngle) * g;
    b.force.y += Math.cos(gravityAngle) * g;

    const v = b.velocity;
    const sp = Math.hypot(v.x, v.y);
    if (sp > 0.01) {
      const rolling = this.grounded ? surfaceProps(this.map, this.ground?.surface).drag : 0;
      const decel = TUNING.drag * this.map.air * sp * sp + rolling;
      const f = (Math.min(decel, sp) * b.mass) / DT2;
      b.force.x -= (v.x / sp) * f;
      b.force.y -= (v.y / sp) * f;
    }
    if (sp > TUNING.safetyCap) M.Body.setVelocity(b, { x: (v.x / sp) * TUNING.safetyCap, y: (v.y / sp) * TUNING.safetyCap });
  }

  /** Past the flag: normal gravity and a hard brake, so finishers stop in the finish zone. */
  park() {
    this.applyForces(0);
    const v = this.wheel.velocity;
    if (this.grounded) M.Body.setVelocity(this.wheel, { x: v.x * 0.94, y: v.y });
  }

  /** Pin the rider in place (countdown, mid-crash): they can tilt and look around, but not roll. */
  hold(gravityAngle) {
    this.gravityAngle = gravityAngle;
    M.Body.setVelocity(this.wheel, { x: 0, y: 0 });
  }

  /**
   * Once per frame, after physics: ground contact, crashes, landings, pads, checkpoints.
   * @param now  scene time (ms) · @param t race time (ms) · @param live race running?
   * @returns event string for the big-screen feed, or null
   */
  tick(now, t, dt, live) {
    const v = this.wheel.velocity;
    const gnd = groundAt(this.track, this.x, t);
    this.ground = gnd;
    // A wheel resting on a slope sits r / cos(slope) above the surface at its centre.
    const clearance = gnd.y - this.y - WHEEL_R / Math.cos(gnd.slope);
    const grounded = clearance < 6;
    const lean = this.gravityAngle + gnd.slope;
    this.lean = lean;
    let event = null;

    // Lag forgiveness: remember recent gravity angles and judge with the most level one.
    this.gHist.push({ at: now, g: this.gravityAngle });
    while (this.gHist.length > 2 && now - this.gHist[0].at > RULES.forgiveMs) this.gHist.shift();
    const bestLean = Math.min(...this.gHist.map((h) => Math.abs(h.g + gnd.slope)));

    if (this.state === STATE.CRASHED) {
      if (now - this.crashAt > TUNING.crashMs) this.respawn(now);
      this.pose = 'crash';
      return null;
    }
    if (this.state === STATE.GHOST && now > this.ghostUntil) this.state = STATE.RACING;
    const safe = this.state === STATE.GHOST || !live || this.state === STATE.FINISHED;
    const grip = surfaceProps(this.map, gnd.surface).grip;
    const limit = TUNING.crashLean * Math.sqrt(grip) * DEG;

    if (!safe && gnd.gap && !gnd.platform && this.y > gnd.gap.rim + 220) {
      return this.crash(now, 2);
    }

    const air = now - this.airSince;
    if (grounded && !this.grounded && air > 200) {
      // Landing: how hard did we hit (along the surface normal), and how crooked?
      const into = this.prevV.y * Math.cos(gnd.slope) - this.prevV.x * Math.sin(gnd.slope);
      this.landSeq += 1;
      this.landHit = Math.round(Math.max(0, into) * 10) / 10;
      // Only real jumps are judged. Tiers: PERFECT boost / fine / SLOPPY (lose speed) / crash.
      if (!safe && air > RULES.landJudgeMs) {
        const dir = Math.sign(v.x) || 1;
        if (into > RULES.hardImpact && bestLean > 30 * DEG) return this.crash(now, 3);
        if (bestLean > RULES.landCrashLean * DEG) return this.crash(now, 1);
        if (bestLean > RULES.sloppyLean * DEG) {
          M.Body.setVelocity(this.wheel, { x: v.x * TUNING.sloppyKeep, y: v.y * TUNING.sloppyKeep });
          this.sloppySeq += 1;
          event = 'sloppy';
        } else if (bestLean < RULES.perfectLean * DEG) {
          // PERFECT: reward the clean landing with speed along the ground
          M.Body.setVelocity(this.wheel, { x: v.x + Math.cos(gnd.slope) * TUNING.perfectBoost * dir, y: v.y + Math.sin(gnd.slope) * TUNING.perfectBoost * dir });
          this.perfectSeq += 1;
          this.perfects += 1;
          event = 'perfect';
        }
      }
    }
    if (!grounded && this.grounded) this.airSince = now;
    this.grounded = grounded;

    // Leaning too far for too long while rolling = over you go (judged with lag forgiveness too).
    // Skimming just above the ground counts as on it (otherwise you could "fly" down a cliff
    // with a huge tilt), and a frame of air doesn't reset the clock; only riding level does.
    // (Low gravity floats you higher above a slope you're really still riding, so scale with it.)
    const skimming = clearance < 40 / Math.sqrt(this.map.gravity);
    if (skimming && !safe && bestLean > limit) {
      this.overLean += dt;
      if (this.overLean > TUNING.overLeanMs) return this.crash(now, 0);
    } else if (grounded || safe) {
      this.overLean = 0;
    }

    // Bounce pads (also catch riders skimming over them at speed)
    if (clearance < 45 && live && this.state !== STATE.FINISHED) {
      for (const p of this.track.pads) {
        if (Math.abs(this.x - p.x) < 65 && now - this.lastPad > 800) {
          this.lastPad = now;
          this.padSeq += 1;
          M.Body.setVelocity(this.wheel, { x: Math.max(v.x, 6), y: -p.strength });
          this.grounded = false;
          this.airSince = now;
        }
      }
    }

    // Checkpoints
    const cps = this.track.checkpoints;
    while (this.cp + 1 < cps.length && this.x > cps[this.cp + 1]) {
      this.cp += 1;
      this.failStreak = 0;
      event = event || 'checkpoint';
    }

    // Wheel turns by distance rolled; in the air it keeps spinning as it was.
    if (grounded) this.spinRate = (v.x * Math.cos(gnd.slope) + v.y * Math.sin(gnd.slope)) / WHEEL_R;
    this.spin += this.spinRate;

    // Accelerating forward rocks the rider back and vice versa; in the air they settle.
    const ax = v.x - this.prevV.x;
    const target = grounded ? Phaser.Math.Clamp(-ax * 0.6, -0.4, 0.4) : 0;
    this.sway += (target - this.sway) * 0.12;
    this.prevV = { x: v.x, y: v.y };

    // Pose: what the rider's body language says
    if (this.state === STATE.FINISHED) this.pose = 'victory';
    else if (!grounded) this.pose = 'airborne';
    else if (Math.abs(lean) > limit * 0.75) this.pose = 'panic';
    else if (ax < -0.08) this.pose = 'lean_back';
    else this.pose = 'riding';
    return event;
  }

  crash(now, why) {
    this.state = STATE.CRASHED;
    this.crashAt = now;
    this.crashWhy = why;
    this.crashSeq += 1;
    this.crashes += 1;
    this.failStreak += 1;
    this.overLean = 0;
    this.crashX = this.x;
    this.crashY = this.y;
    this.crashVx = this.wheel.velocity.x;
    this.hold(this.gravityAngle);
    return 'crash';
  }

  /**
   * Hit by a moving obstacle: knocked back and popped up, then a second of see-through
   * recovery. Costs a couple of seconds, but no checkpoint reset (timing obstacles
   * shouldn't be as harsh as wiping out).
   */
  bonk(now, fromX) {
    const away = this.x < fromX ? -1 : 1;
    M.Body.setVelocity(this.wheel, { x: away * 5, y: -6 });
    this.grounded = false;
    this.airSince = now;
    this.gHist = [];
    this.state = STATE.GHOST;
    this.ghostUntil = now + TUNING.bonkMs;
    this.bonkSeq += 1;
    this.bonks += 1;
    return 'bonk';
  }

  respawn(now) {
    const x = this.track.checkpoints[this.cp] + 60;
    const gnd = groundAt(this.track, x, 0);
    M.Body.setPosition(this.wheel, { x, y: gnd.y - WHEEL_R - 4 });
    // Comeback rule: stuck on the same section 3 times? Respawn with a running start.
    const push = this.failStreak >= 3 ? Math.min(16, 6 + 2 * this.failStreak) : 0;
    this.boostStart = push > 0;
    M.Body.setVelocity(this.wheel, { x: push * Math.cos(gnd.slope), y: push * Math.sin(gnd.slope) });
    this.prevV = { x: 0, y: 0 };
    this.gHist = [];
    this.grounded = true;
    this.state = STATE.GHOST;
    this.ghostUntil = now + TUNING.ghostMs;
  }

  finish(t) {
    this.state = STATE.FINISHED;
    this.finishMs = Math.round(t);
  }

  snapshot(now) {
    const w = this.wheel;
    const r1 = (n) => Math.round(n * 10) / 10;
    const r3 = (n) => Math.round(n * 1000) / 1000;
    const row = [];
    row[R.ID] = this.player.id;
    row[R.X] = r1(w.position.x);
    row[R.Y] = r1(w.position.y);
    row[R.VX] = r1(w.velocity.x);
    row[R.VY] = r1(w.velocity.y);
    row[R.SPIN] = r3(this.spin % (Math.PI * 2));
    row[R.GRAV] = r3(this.gravityAngle);
    row[R.SWAY] = r3(this.sway);
    row[R.STATE] = this.state;
    row[R.NAME] = this.player.name;
    row[R.COLOR] = this.player.colorIdx;
    row[R.POSE] = POSES.indexOf(this.pose);
    row[R.LEAN] = Math.round(this.lean / DEG);
    row[R.CP] = this.cp;
    row[R.FINISH_MS] = this.finishMs;
    row[R.CRASHES] = this.crashes;
    row[R.CRASH_SEQ] = this.crashSeq;
    row[R.CRASH_WHY] = this.crashWhy;
    row[R.PERFECT_SEQ] = this.perfectSeq;
    row[R.LAND_SEQ] = this.landSeq;
    row[R.LAND_HIT] = this.landHit;
    row[R.PAD_SEQ] = this.padSeq;
    row[R.CRASH_T] = this.state === STATE.CRASHED ? Math.round(now - this.crashAt) : 0;
    row[R.SLOPPY_SEQ] = this.sloppySeq;
    row[R.BONK_SEQ] = this.bonkSeq;
    return row;
  }

  /** Rough body shape for obstacle hits: wheel, torso, head (circles along the rider's up). */
  bodyCircles() {
    const a = -this.gravityAngle + this.sway;
    const ux = Math.sin(a);
    const uy = -Math.cos(a);
    const { x, y } = this.wheel.position;
    return [
      { x, y, r: 20 },
      { x: x + ux * 52, y: y + uy * 52, r: 16 },
      { x: x + ux * 92, y: y + uy * 92, r: 15 },
    ];
  }

  draw(now) {
    let { x, y } = this.wheel.position;
    let angle = -this.gravityAngle + this.sway;
    if (this.state === STATE.CRASHED) {
      // Tumble: rider and unicycle go over together in a little hop
      const k = Math.min(1, (now - this.crashAt) / TUNING.crashMs);
      x = this.crashX + this.crashVx * 8 * k;
      y = this.crashY - Math.sin(Math.PI * k) * 60;
      angle = -this.gravityAngle + k * 6;
    }
    const alpha = this.state === STATE.GHOST ? 0.45 : this.state === STATE.CRASHED ? 1 - Math.max(0, (now - this.crashAt - 900) / 400) : 1;
    this.view.set(x, y, angle, this.spin, this.pose, alpha, this.ground ? this.ground.y : null, this.labelScale);
  }
}
