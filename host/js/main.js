/* global Phaser */
import { LobbyScene } from './scenes/LobbyScene.js';
import { RaceScene } from './scenes/RaceScene.js';
import { ResultsScene } from './scenes/ResultsScene.js';

// Add ?debug=1 to the host URL to see Matter physics bodies.
const debug = new URLSearchParams(location.search).has('debug');

// Phaser draws text to canvas, so the fonts must be loaded first.
await Promise.race([
  Promise.all([document.fonts.load('32px "Lilita One"'), document.fonts.load('900 16px Nunito')]),
  new Promise((r) => setTimeout(r, 3000)),
]).catch(() => {});

// Exposed for poking at from the browser console while developing.
window.game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 1280,
  height: 720,
  backgroundColor: '#56CFE1',
  antialias: true,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  physics: {
    default: 'matter',
    matter: {
      gravity: { x: 0, y: 0 }, // gravity is applied per rider from phone tilt
      positionIterations: 8,
      velocityIterations: 6,
      debug,
    },
  },
  scene: [LobbyScene, RaceScene, ResultsScene],
});
