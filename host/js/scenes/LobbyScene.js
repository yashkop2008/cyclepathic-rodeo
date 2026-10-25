/* global Phaser */
import { players, room, onRosterChange, sendToPlayer, addBot, addKeyboardRider, removeLocalPlayers, removePlayer, resetScores, MAX_PLAYERS } from '../net.js';
import { RiderView, PLAYERS } from '/shared/rig.js';
import { MAPS } from '/shared/maps.js';
import { textStyle, cloudTex } from '/shared/art.js';
import { sunnyBackdrop, card, button } from './ui.js';

const RULES = [
  ['YOUR PHONE IS THE GROUND.', 'Hold it sideways. Tilt it and the course tilts with it.'],
  ['STEEPER = FASTER...', '...but if the ground under you gets steeper than ~50° you WIPE OUT.'],
  ['LAND LEVEL.', 'Clean landing = speed boost. Crooked = lose speed. Way off = crash.'],
  ['TIME THE OBSTACLES.', 'Swinging, bouncing things BONK you backwards. Crash = last checkpoint.'],
  ['FINISH = GRAVITY GOD.', 'Your tilt now tips everyone else\'s world.'],
];

export class LobbyScene extends Phaser.Scene {
  constructor() {
    super('lobby');
  }

  create() {
    const { width } = this.scale;
    resetScores();
    cloudTex(this);
    sunnyBackdrop(this);

    // Logo with a rider popping a wheelie next to it
    // The logo floats slowly: a gentle bob plus a slight sway, the two words a little out of step.
    const top = this.add.text(width / 2 - 40, 58, 'CYCLEPATHIC', textStyle(64, '#FFD60A', { strokeThickness: 12 })).setOrigin(0.5);
    const bottom = this.add.text(width / 2 - 40, 118, 'RODEO', textStyle(56, '#FF3B5C', { strokeThickness: 12 })).setOrigin(0.5);
    [top, bottom].forEach((t, i) => {
      this.tweens.add({ targets: t, y: t.y - 7, duration: 2200, ease: 'Sine.easeInOut', yoyo: true, repeat: -1, delay: i * 350 });
      t.setAngle(-1.2);
      this.tweens.add({ targets: t, angle: 1.2, duration: 3400, ease: 'Sine.easeInOut', yoyo: true, repeat: -1, delay: i * 500 });
    });
    this.mascot = new RiderView(this, { colorIdx: 0, outfit: 'classic', boost: 0.9, res: 1.5 });
    this.mascotColor = 0;

    // Room + QR
    card(this, 36, 172, 340, 386);
    this.codeText = this.add.text(206, 200, 'CREATING ROOM...', textStyle(34, '#00A8FF')).setOrigin(0.5, 0);
    this.add.text(206, 524, 'SCAN WITH YOUR PHONE CAMERA', { fontFamily: 'Nunito, sans-serif', fontSize: '16px', fontStyle: '900', color: '#334155' }).setOrigin(0.5, 0);

    // How to play
    card(this, 400, 172, 480, 386);
    this.add.text(640, 196, 'HOW TO PLAY', textStyle(32, '#FFD60A')).setOrigin(0.5, 0);
    RULES.forEach(([head, body], i) => {
      const y = 240 + i * 62;
      this.add.circle(432, y + 14, 16, PLAYERS[i % PLAYERS.length].pri).setStrokeStyle(4, 0x1e1b2e);
      this.add.text(432, y + 14, String(i + 1), textStyle(18)).setOrigin(0.5);
      this.add.text(460, y, head, textStyle(19, '#1E1B2E', { stroke: '#ffffff', strokeThickness: 0 }));
      this.add.text(460, y + 24, body, { fontFamily: 'Nunito, sans-serif', fontSize: '15px', fontStyle: '800', color: '#334155', wordWrap: { width: 405 }, lineSpacing: -2 });
    });

    // Grand prix + start
    card(this, 904, 172, 340, 386);
    this.add.text(1074, 196, 'GRAND PRIX', textStyle(32, '#52D14C')).setOrigin(0.5, 0);
    MAPS.forEach((m, i) => {
      const y = 254 + i * 58;
      this.add.rectangle(934, y + 16, 22, 22, Phaser.Display.Color.HexStringToColor(m.barColor).color).setStrokeStyle(4, 0x1e1b2e);
      this.add.text(956, y, m.short, textStyle(20, '#1E1B2E', { strokeThickness: 0 }));
      this.add.text(956, y + 24, ['Normal gravity · mud slows you', 'Low gravity · slick metal', 'Loose sand · quicksand'][i], { fontFamily: 'Nunito, sans-serif', fontSize: '16px', fontStyle: '800', color: '#475569' });
    });
    this.startBtn = button(this, 1074, 488, 280, 76, 'START RACE', () => this.start());

    this.add.text(width / 2, 712, 'SPACE start · B add bot · K keyboard rider (←/→) · X remove bots · click ✕ on a rider to remove them',{ fontFamily: 'Nunito, sans-serif', fontSize: '15px', fontStyle: '800', color: '#1E1B2E', backgroundColor: 'rgba(255,255,255,0.75)', padding: { x: 10, y: 3 } }).setOrigin(0.5, 1).setDepth(5);

    // Rider slots
    this.slots = [];
    this.slotLayer = this.add.container(0, 0).setDepth(4);

    this.input.keyboard.on('keydown-SPACE', () => this.start());
    this.input.keyboard.on('keydown-ENTER', () => this.start());
    this.input.keyboard.on('keydown-B', (e) => !e.repeat && addBot());
    this.input.keyboard.on('keydown-K', (e) => !e.repeat && addKeyboardRider());
    this.input.keyboard.on('keydown-X', (e) => !e.repeat && removeLocalPlayers());

    const off = onRosterChange(() => this.refresh());
    this.events.once('shutdown', () => {
      off();
      this.slots.forEach((s) => s.view?.destroy());
    });
    this.refresh();
  }

  update(time) {
    // Mascot does little hops and cycles through the player colours.
    const hop = Math.abs(Math.sin(time / 350)) * 14;
    const c = Math.floor(time / 1400) % PLAYERS.length;
    if (c !== this.mascotColor) {
      this.mascot.destroy();
      this.mascot = new RiderView(this, { colorIdx: c, outfit: 'classic', boost: 0.9, res: 1.5 });
      this.mascotColor = c;
    }
    this.mascot.set(1010, 140 - hop, -0.15 + Math.sin(time / 350) * 0.08, time / 120, hop > 8 ? 'airborne' : 'riding');
    this.slots.forEach((s, i) => s.view?.set(s.x, 640 + Math.sin(time / 300 + i) * 2, Math.sin(time / 500 + i) * 0.06, time / 200, 'riding'));
  }

  refresh() {
    if (!this.sys.isActive()) return;
    if (room.code) {
      this.codeText.setText(`ROOM ${room.code}`);
      if (this.qrFor !== room.joinUrl) this.loadQr(room.joinUrl);
    }

    // Slot row: one frame per colour, filled by whoever has it
    this.slotLayer.removeAll(true);
    this.slots.forEach((s) => s.view?.destroy());
    this.slots = [];
    const list = [...players.values()];
    const w = 168;
    const x0 = this.scale.width / 2 - ((w + 14) * MAX_PLAYERS - 14) / 2;
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const p = list[i];
      const x = x0 + i * (w + 14);
      const g = this.add.graphics();
      if (p) {
        g.fillStyle(0xffffff, 0.92).fillRoundedRect(x, 572, w, 124, 18).lineStyle(6, Phaser.Display.Color.HexStringToColor(p.color).color, 1).strokeRoundedRect(x, 572, w, 124, 18);
        const tag = p.kind === 'bot' ? ' (BOT)' : p.kind === 'keyboard' ? ' (KEYS)' : '';
        this.slotLayer.add([g, this.add.text(x + w / 2, 690, `${p.name.toUpperCase()}${tag}`, textStyle(15, p.color)).setOrigin(0.5, 1)]);
        // ✕ button: remove this rider (phones are sent back to their join screen)
        const kx = x + w - 6;
        const ky = 578;
        const kick = this.add.circle(kx, ky, 15, 0xff3b5c).setStrokeStyle(4, 0x1e1b2e).setInteractive({ useHandCursor: true });
        const cross = this.add.text(kx, ky - 1, 'X', textStyle(16)).setOrigin(0.5);
        kick.on('pointerover', () => kick.setScale(1.15));
        kick.on('pointerout', () => kick.setScale(1));
        kick.on('pointerup', () => removePlayer(p.id));
        this.slotLayer.add([kick, cross]);
        this.slots.push({ x: x + w / 2, view: new RiderView(this, { colorIdx: p.colorIdx, outfit: 'classic', boost: 0.55, res: 1, depth: 6 }) });
      } else {
        g.fillStyle(0xffffff, 0.4).fillRoundedRect(x, 572, w, 124, 18).lineStyle(4, 0x1e1b2e, 0.35).strokeRoundedRect(x, 572, w, 124, 18);
        this.slotLayer.add([g, this.add.text(x + w / 2, 634, 'SCAN TO\nJOIN!', textStyle(18, '#ffffff', { align: 'center' })).setOrigin(0.5).setAlpha(0.7)]);
      }
    }
    this.startBtn.setAlpha(list.length ? 1 : 0.5);
    for (const p of list) sendToPlayer(p.id, { phase: 'lobby', status: "YOU'RE IN! WAITING FOR THE HOST TO START", color: p.color, colorIdx: p.colorIdx });
  }

  loadQr(url) {
    this.qrFor = url;
    const key = `qr-${room.code}`;
    const place = () => {
      this.qr?.destroy();
      this.qr = this.add.image(206, 250, key).setOrigin(0.5, 0).setDisplaySize(270, 270);
    };
    if (this.textures.exists(key)) return place();
    this.load.svg(key, `/api/qr?text=${encodeURIComponent(url)}`, { width: 540, height: 540 });
    this.load.once('complete', place);
    this.load.start();
  }

  start() {
    if (!players.size) return;
    this.scene.start('race', { mapIndex: 0 });
  }
}
