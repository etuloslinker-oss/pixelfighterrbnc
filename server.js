// Pixel Fighter relay server (for Render).
// The game uses rollback netcode: both browsers run the whole simulation and only exchange inputs, so this server never
// looks at gameplay. It only (1) creates/joins 4-letter rooms and (2) forwards messages between the two players in a room.
const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
// Optional: comma separated list of page origins that may connect, e.g. "https://my-game.vercel.app".
// Leave empty to allow any origin (fine for a hobby game, but set it once you know your Vercel URL).
const ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
const MAX_ROOMS = +process.env.MAX_ROOMS || 1000;
const RELAY = new Set(['p', 'q', 's', 'r', 'c', 'g', 'i', 'h']);   // message types forwarded verbatim to the opponent
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';                        // no I / O, easier to read out loud

const rooms = new Map();   // code -> { host: ws, guest: ws|null }

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
    res.end('pixel-fighter relay ok\nrooms: ' + rooms.size + '\n');
  } else { res.writeHead(404); res.end(); }
});

const wss = new WebSocketServer({
  server, path: '/ws', maxPayload: 4096, perMessageDeflate: false,   // tiny messages: compression would only add latency
  verifyClient: ({ origin }) => !ORIGINS.length || (origin && ORIGINS.includes(origin.replace(/\/$/, ''))),
});

const send = (ws, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
function newCode() {
  for (let n = 0; n < 50; n++) {
    let c = ''; for (let i = 0; i < 4; i++) c += LETTERS[Math.random() * LETTERS.length | 0];
    if (!rooms.has(c)) return c;
  }
  return null;
}
function leave(ws) {
  const r = ws.room && rooms.get(ws.room);
  ws.room = null;
  if (!r) return;
  if (r.host === ws) {                       // host left: the room is gone
    rooms.delete(r.code);
    if (r.guest) { const g = r.guest; r.guest = null; g.room = null; send(g, { t: 'closed' }); g.close(1000, 'host left'); }
  } else if (r.guest === ws) {               // guest left: the room stays open for someone else
    r.guest = null; send(r.host, { t: 'left' });
  }
}

wss.on('connection', (ws) => {
  if (ws._socket) ws._socket.setNoDelay(true);   // no Nagle: input packets must leave immediately
  ws.alive = true; ws.room = null; ws.tokens = 400; ws.tokT = Date.now();
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    const now = Date.now();                       // token bucket: ~200 msgs/s sustained (a match needs ~60/s)
    ws.tokens = Math.min(400, ws.tokens + (now - ws.tokT) * 0.2); ws.tokT = now;
    if (--ws.tokens < 0) return ws.close(1008, 'rate limit');
    const raw = data.toString();
    let m; try { m = JSON.parse(raw); } catch (_) { return; }
    if (!m || typeof m.t !== 'string') return;

    if (m.t === 'host') {
      if (ws.room) return;
      if (rooms.size >= MAX_ROOMS) return send(ws, { t: 'err', msg: 'The server is full, try again later.' });
      const code = newCode(); if (!code) return send(ws, { t: 'err', msg: 'Could not create a room.' });
      rooms.set(code, { code, host: ws, guest: null }); ws.room = code;
      send(ws, { t: 'hosted', c: code });
    } else if (m.t === 'join') {
      if (ws.room) return;
      const code = String(m.c || '').toUpperCase().slice(0, 4), r = rooms.get(code);
      if (!r) return send(ws, { t: 'err', msg: 'Room ' + code + ' not found.' });
      if (r.guest) return send(ws, { t: 'err', msg: 'Room ' + code + ' is full.' });
      r.guest = ws; ws.room = code;
      send(ws, { t: 'joined', c: code }); send(r.host, { t: 'peer' });
    } else if (RELAY.has(m.t)) {
      const r = ws.room && rooms.get(ws.room); if (!r) return;
      const other = r.host === ws ? r.guest : r.host;
      if (other && other.readyState === 1) other.send(raw);
    }
  });
  ws.on('close', () => leave(ws));
  ws.on('error', () => {});
});

// keep connections alive through Render's proxy and drop dead ones
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.alive) return ws.terminate();
    ws.alive = false; ws.ping();
  });
}, 20000);

function shutdown() {                            // Render sends SIGTERM on every deploy
  wss.clients.forEach((ws) => ws.close(1001, 'server restarting'));
  server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);

server.listen(PORT, () => console.log('pixel-fighter relay listening on :' + PORT + (ORIGINS.length ? ' (origins: ' + ORIGINS.join(', ') + ')' : ' (any origin)')));
