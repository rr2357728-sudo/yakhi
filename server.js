// Yakshi - Kerala Horror Co-op | server
const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 3000;

const srv = http.createServer((q, r) => {
  fs.readFile(path.join(__dirname, 'public', 'index.html'), (e, d) => {
    if (e) { r.writeHead(500); return r.end('missing public/index.html'); }
    r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(d);
  });
});
const wss = new WebSocketServer({ server: srv });
const rooms = {};
let nextId = 1;

const rng = s => () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
function newGame(room) {
  room.seed = (Math.random() * 1e9) | 0;
  const r = rng(room.seed);
  room.lamps = Array.from({ length: 5 }, (_, i) => {
    const a = r() * 6.283, d = 25 + r() * 45;
    return { id: i, x: Math.cos(a) * d, z: Math.sin(a) * d, on: false };
  });
  room.ghost = { x: 0, z: -75 };
  room.over = false;
}
const send = (ws, m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
const bcast = (room, m) => room.players.forEach(p => send(p.ws, m));
const welcome = (room, p) => send(p.ws, { t: 'w', id: p.id, seed: room.seed, lamps: room.lamps });

wss.on('connection', ws => {
  let room = null, me = null;
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'join') {
      const code = String(m.room || 'KERALA').toUpperCase().slice(0, 12);
      room = rooms[code] || (rooms[code] = { players: new Map() });
      if (!room.seed) newGame(room);
      me = { id: nextId++, ws, name: String(m.name || 'Player').slice(0, 14), x: 0, z: 18, ry: 0 };
      room.players.set(me.id, me);
      welcome(room, me);
    } else if (m.t === 'm' && me) {
      me.x = +m.x || 0; me.z = +m.z || 0; me.ry = +m.ry || 0;
    } else if (m.t === 'lamp' && me && !room.over) {
      const l = room.lamps[m.id];
      if (l && !l.on && Math.hypot(l.x - me.x, l.z - me.z) < 5) {
        l.on = true;
        bcast(room, { t: 'lamps', on: room.lamps.map(a => a.on), by: me.name });
        if (room.lamps.every(a => a.on)) {
          room.over = true; bcast(room, { t: 'win' });
          setTimeout(() => { newGame(room); room.players.forEach(p => { p.x = 0; p.z = 18; welcome(room, p); }); }, 12000);
        }
      }
    }
  });
  ws.on('close', () => {
    if (!room || !me) return;
    room.players.delete(me.id);
    if (!room.players.size) delete rooms[Object.keys(rooms).find(k => rooms[k] === room)];
  });
});

// Ghost AI + state broadcast (10 Hz)
setInterval(() => {
  for (const room of Object.values(rooms)) {
    if (!room.players.size || room.over) continue;
    const g = room.ghost, lit = room.lamps.filter(l => l.on).length;
    let best = null, bd = 1e9;
    room.players.forEach(p => { const d = Math.hypot(p.x - g.x, p.z - g.z); if (d < bd) { bd = d; best = p; } });
    const speed = (2.6 + lit * 0.5) * (bd > 45 ? 0.6 : 1) * 0.1;
    if (best && bd > 0.01) { g.x += (best.x - g.x) / bd * speed; g.z += (best.z - g.z) / bd * speed; }
    if (best && bd < 1.5) {
      bcast(room, { t: 'caught', id: best.id });
      best.x = 0; best.z = 18;
      const a = Math.random() * 6.283; g.x = Math.cos(a) * 50; g.z = Math.sin(a) * 50;
    }
    bcast(room, { t: 's', g: [g.x, g.z], p: [...room.players.values()].map(p => [p.id, p.x, p.z, p.ry, p.name]) });
  }
}, 100);

srv.listen(PORT, () => console.log('Yakshi running on http://localhost:' + PORT));
