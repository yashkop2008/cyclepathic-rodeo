// Renders the app icon (same design as controller/icon.svg) to PNGs with no
// dependencies: shapes are signed-distance tests, 4×4 supersampled, written
// with Node's zlib. iPhones need PNGs for "Add to Home Screen" icons.
//
//   npm run icons

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'controller');
const RED = [0xff, 0x3b, 0x5c];
const WHITE = [0xff, 0xff, 0xff];

// Icon space is 100×100. The unicycle is rotated -14° around (50, 54).
const ROT = (-14 * Math.PI) / 180;
const roundRect = (px, py, x, y, w, h, r) => {
  const qx = Math.abs(px - (x + w / 2)) - (w / 2 - r);
  const qy = Math.abs(py - (y + h / 2)) - (h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};

function unicycleAt(x, y) {
  // Undo the rotation, then test the parts in unrotated space.
  const dx = x - 50;
  const dy = y - 54;
  const ux = 50 + dx * Math.cos(-ROT) - dy * Math.sin(-ROT);
  const uy = 54 + dx * Math.sin(-ROT) + dy * Math.cos(-ROT);
  const d = Math.hypot(ux - 50, uy - 66);
  return (
    Math.abs(d - 21) < 5 || // tyre
    d < 5.5 || // hub
    roundRect(ux, uy, 45.5, 24, 9, 42, 4.5) < 0 || // seat post
    roundRect(ux, uy, 32, 16, 36, 12, 6) < 0 // saddle
  );
}

/** @param rounded transparent rounded corners (favicon) vs full-bleed (home-screen icons get masked by the OS) */
function render(size, rounded) {
  const px = Buffer.alloc(size * size * 4);
  const S = 4;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = ((i + (sx + 0.5) / S) / size) * 100;
          const y = ((j + (sy + 0.5) / S) / size) * 100;
          if (rounded && roundRect(x, y, 0, 0, 100, 100, 22) > 0) continue;
          bg += 1;
          if (unicycleAt(x, y)) fg += 1;
        }
      }
      const a = bg / (S * S);
      const k = bg ? fg / bg : 0;
      const o = (j * size + i) * 4;
      for (let c = 0; c < 3; c++) px[o + c] = Math.round(RED[c] * (1 - k) + WHITE[c] * k);
      px[o + 3] = Math.round(a * 255);
    }
  }
  return png(size, size, px);
}

// ---- minimal PNG writer (RGBA, 8-bit) ----
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const rows = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(rows, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const [name, size, rounded] of [['icon-32.png', 32, true], ['icon-180.png', 180, false], ['icon-192.png', 192, false], ['icon-512.png', 512, false]]) {
  fs.writeFileSync(path.join(OUT, name), render(size, rounded));
  console.log(`wrote controller/${name}`);
}
