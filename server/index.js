// Cyclepathic Rodeo server: serves the host + controller pages and relays
// phone inputs to the host screen over Socket.IO. All game logic and
// physics run on the host page; the server is just a room-based relay.

const path = require('path');
const http = require('http');
const https = require('https');
const os = require('os');
const express = require('express');
const QRCode = require('qrcode');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT) || 3000;
const USE_HTTPS = process.argv.includes('--https') || process.env.HTTPS === '1';
const ROOT = path.join(__dirname, '..');

// The six player colours from the art handoff (shared/rig.js PLAYERS); one rider per colour.
const COLORS = ['#FF3B5C', '#00A8FF', '#00E676', '#FFEA00', '#D500F9', '#FF6D00'];

const app = express();
app.use('/vendor', express.static(path.join(ROOT, 'node_modules/phaser/dist')));
// Web app manifest so phones can "Add to Home Screen" and launch with no browser bars.
// Built per room so the installed icon opens straight into that room.
app.get('/play/manifest.webmanifest', (req, res) => {
  const room = String(req.query.room || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  res.type('application/manifest+json').send(
    JSON.stringify({
      name: 'Cyclepathic Rodeo',
      short_name: 'Rodeo',
      start_url: `/play/${room ? `?room=${room}` : ''}`,
      scope: '/play/',
      display: 'fullscreen',
      orientation: 'landscape',
      background_color: '#0b1030',
      theme_color: '#0b1030',
      icons: [
        { src: '/play/icon.svg', sizes: 'any', type: 'image/svg+xml' },
        { src: '/play/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
        { src: '/play/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
    }),
  );
});
// Game code changes a lot during a hackathon: make browsers re-check it on every load
// so phones never keep running an old version.
const fresh = { setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') };
app.use('/host', express.static(path.join(ROOT, 'host'), fresh));
app.use('/shared', express.static(path.join(ROOT, 'shared'), fresh));
app.use('/play', express.static(path.join(ROOT, 'controller'), fresh));
app.get('/', (_req, res) => res.redirect('/host/'));

// LAN address so phones on the same Wi-Fi can reach this machine.
// Prefers home/venue Wi-Fi ranges over VPN ranges (e.g. Tailscale's 100.x).
function lanAddress() {
  const all = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
  const isPrivate = (a) => /^192\.168\./.test(a) || /^10\./.test(a) || /^172\.(1[6-9]|2\d|3[01])\./.test(a);
  return all.find(isPrivate) || all[0] || 'localhost';
}

app.get('/api/info', (_req, res) => {
  const proto = USE_HTTPS ? 'https' : 'http';
  res.json({ lanBase: process.env.PUBLIC_URL || `${proto}://${lanAddress()}:${PORT}` });
});

app.get('/api/qr', async (req, res) => {
  const text = String(req.query.text || '').slice(0, 500);
  if (!text) return res.status(400).end();
  const svg = await QRCode.toString(text, { type: 'svg', margin: 1, color: { dark: '#111', light: '#fff' } });
  res.type('image/svg+xml').send(svg);
});

// ---------------------------------------------------------------- rooms

/** code -> { hostId, players: Map<socketId, {id, name, color}> } */
const rooms = new Map();

function makeCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function attachSockets(server) {
  const io = new Server(server);

  io.on('connection', (socket) => {
    let role = null;
    let code = null;

    socket.on('host:create', (ack) => {
      code = makeCode();
      role = 'host';
      rooms.set(code, { hostId: socket.id, players: new Map() });
      socket.join(code);
      ack?.({ code });
    });

    socket.on('player:join', ({ room, name } = {}, ack) => {
      const r = rooms.get(String(room || '').toUpperCase());
      if (!r) return ack?.({ ok: false, error: 'Room not found' });
      if (r.players.size >= COLORS.length) return ack?.({ ok: false, error: 'Room is full' });
      code = String(room).toUpperCase();
      role = 'player';
      const used = new Set([...r.players.values()].map((p) => p.color));
      const color = COLORS.find((c) => !used.has(c)) || COLORS[0];
      const player = { id: socket.id, name: String(name || 'Rider').slice(0, 12), color };
      r.players.set(socket.id, player);
      socket.join(code);
      io.to(r.hostId).emit('player:joined', player);
      ack?.({ ok: true, ...player });
    });

    // Hot path: ~30 Hz per phone. volatile = drop rather than queue if lagging.
    socket.on('input', (data) => {
      const r = rooms.get(code);
      if (role === 'player' && r) io.to(r.hostId).volatile.emit('input', { id: socket.id, tilt: data?.tilt });
    });

    // Host removes a phone from the lobby: tell it, then drop it (it won't auto-reconnect).
    socket.on('kick', ({ id } = {}) => {
      const r = rooms.get(code);
      if (role !== 'host' || !r || !r.players.has(id)) return;
      r.players.delete(id);
      const target = io.sockets.sockets.get(id);
      target?.emit('state', { phase: 'kicked' });
      target?.disconnect(true);
    });

    // Host -> every phone: rider positions so each phone can render its own view (~20 Hz).
    socket.on('snap', (snap) => {
      if (role === 'host' && rooms.has(code)) socket.to(code).volatile.emit('snap', snap);
    });

    // Host -> one phone (status text, place, etc.)
    socket.on('to-player', ({ id, state } = {}) => {
      const r = rooms.get(code);
      if (role === 'host' && r && r.players.has(id)) io.to(id).emit('state', state);
    });

    socket.on('disconnect', () => {
      const r = rooms.get(code);
      if (!r) return;
      if (role === 'host') {
        io.to(code).emit('state', { status: 'Host left. Rejoin with the new code.', phase: 'gone' });
        rooms.delete(code);
      } else if (role === 'player') {
        r.players.delete(socket.id);
        io.to(r.hostId).emit('player:left', { id: socket.id });
      }
    });
  });
}

async function main() {
  let server;
  if (USE_HTTPS) {
    // Self-signed cert so phones get a secure context (required for motion sensors).
    const selfsigned = require('selfsigned');
    const pems = await selfsigned.generate([{ name: 'commonName', value: 'cyclepathic-rodeo.local' }], { keySize: 2048, algorithm: 'sha256' });
    server = https.createServer({ key: pems.private, cert: pems.cert }, app);
  } else {
    server = http.createServer(app);
  }
  attachSockets(server);
  server.listen(PORT, () => {
    const proto = USE_HTTPS ? 'https' : 'http';
    console.log(`\n  Cyclepathic Rodeo running`);
    console.log(`  Host screen:  ${proto}://localhost:${PORT}/host/`);
    console.log(`  Phones join:  ${process.env.PUBLIC_URL || `${proto}://${lanAddress()}:${PORT}`}/play/\n`);
  });
}

main();
