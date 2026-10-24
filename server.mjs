// RUN and SEAk game server: authoritative rules, rooms, quick-match, hidden hands.
import http from 'http';
import { WebSocketServer } from 'ws';
import { newGame, act, NM, pendOpts, dashOpts, sealOpts } from './rules.mjs';
import { parseMap, builtinById, randomBuiltin, publicList, DEFAULT_MAP } from './maps.mjs';

const PORT = process.env.PORT || 8080;
const rooms = new Map();
let queue = null;

const server = http.createServer((q, r) => {
  r.writeHead(200, { 'content-type': 'text/plain' });
  r.end(`RUN and SEAk server OK | online: ${wss.clients.size} | rooms: ${rooms.size}`);
});
const wss = new WebSocketServer({ server, maxPayload: 4096 });

const send = (ws, o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
const count = R => R.seats.filter(Boolean).length;
// never reveal the opponent's hand or the deck order
const mask = (S, seat) => {
  const c = structuredClone(S);
  c.hand[1 - seat] = c.hand[1 - seat].map(() => '?');
  c.deck = c.deck.map(() => '?');
  return c;
};
// legal tiles for this seat, so the client can highlight them
const opts = (S, seat) => {
  if (S.win >= 0) return {};
  const who = S.pend[0] ? S.pend[0].who : S.turn;
  if (who !== seat) return {};
  if (S.pend.length) return { pick: pendOpts(S) };
  return seat === 0 ? { dash: dashOpts(S), seal: sealOpts(S) } : {};
};
const push = R => R.seats.forEach((w, i) => w && send(w, { t: 'state', S: mask(R.S, i), opts: opts(R.S, i), players: count(R) }));
const newCode = () => { let c; do c = Math.random().toString(36).slice(2, 6).toUpperCase(); while (rooms.has(c)); return c; };
const mkRoom = (map) => { const R = { code: newCode(), map, S: newGame(map), seats: [null, null], logged: false }; rooms.set(R.code, R); return R; };
// pick the map for a new room: a custom map from the client (validated!), a built-in id, or the default
const resolveMap = (m) => {
  if (m.map) return parseMap(m.map);
  if (m.mapId) { const b = builtinById(String(m.mapId)); return b ? { map: b.map } : { error: 'Unknown map' }; }
  return { map: DEFAULT_MAP };
};
function seat(R, ws, i) { R.seats[i] = ws; ws.room = R; ws.seat = i; send(ws, { t: 'room', code: R.code, seat: i, players: count(R) }); }
function leave(ws) {
  if (queue === ws) queue = null;
  const R = ws.room; if (!R) return;
  ws.room = null; R.seats[ws.seat] = null;
  const o = R.seats[1 - ws.seat];
  if (o) { if (R.S.win < 0) { R.S.win = 1 - ws.seat; R.S.log.push(NM[ws.seat] + ' left the game'); } send(o, { t: 'left' }); push(R); }
  else rooms.delete(R.code);
}
async function logResult(R) { // optional: store finished matches in Supabase
  const u = process.env.SUPABASE_URL, k = process.env.SUPABASE_SERVICE_KEY; if (!u || !k) return;
  try {
    await fetch(u + '/rest/v1/results', { method: 'POST',
      headers: { apikey: k, Authorization: 'Bearer ' + k, 'content-type': 'application/json' },
      body: JSON.stringify({ code: R.code, winner: NM[R.S.win], rounds: R.S.round }) });
  } catch {}
}
const bc = () => wss.clients.forEach(c => send(c, { t: 'online', n: wss.clients.size }));

wss.on('connection', ws => {
  ws.alive = true; ws.last = 0; ws.on('pong', () => (ws.alive = true)); bc();
  send(ws, { t: 'maps', list: publicList() }); // built-in maps for the map picker
  ws.on('message', d => {
    let m; try { m = JSON.parse(d); } catch { return; }
    const now = Date.now(); if (now - ws.last < 80) return; ws.last = now; // flood guard
    switch (m.t) {
      case 'quick': {
        leave(ws);
        ws.wantMap = String(m.mapId || 'random').slice(0, 20);
        if (queue && queue !== ws && queue.readyState === 1) {
          const a = queue; queue = null;
          const b = builtinById(a.wantMap) || randomBuiltin(); // the player who waited picks the map
          const R = mkRoom(b.map); seat(R, a, 0); seat(R, ws, 1); push(R);
        } else { queue = ws; send(ws, { t: 'wait' }); }
        break;
      }
      case 'create': {
        leave(ws);
        const r = resolveMap(m); if (r.error) return send(ws, { t: 'err', m: r.error });
        const R = mkRoom(r.map); seat(R, ws, 0); push(R); break;
      }
      case 'checkmap': {
        const r = parseMap(m.map);
        if (r.error) send(ws, { t: 'mapcheck', ok: false, error: r.error });
        else send(ws, { t: 'mapcheck', ok: true, info: { w: r.map.w, h: r.map.h, plankton: r.map.plankton.length, home: r.map.home.length, vortex: r.map.vortex.length } });
        break;
      }
      case 'join': {
        leave(ws);
        const R = rooms.get(String(m.code || '').toUpperCase().slice(0, 4));
        if (!R) return send(ws, { t: 'err', m: 'Room not found' });
        const i = R.seats.findIndex(x => !x); if (i < 0) return send(ws, { t: 'err', m: 'Room is full' });
        if (R.S.win >= 0) { R.S = newGame(R.map); R.logged = false; }
        seat(R, ws, i); push(R); break;
      }
      case 'act': {
        const R = ws.room; if (!R || count(R) < 2 || !m.a || typeof m.a !== 'object') return;
        const a = { t: String(m.a.t) };
        if (Array.isArray(m.a.p)) a.p = [Math.trunc(+m.a.p[0]), Math.trunc(+m.a.p[1])];
        if (m.a.id) a.id = String(m.a.id);
        const e = act(R.S, ws.seat, a);
        if (e) return send(ws, { t: 'err', m: e });
        push(R);
        if (R.S.win >= 0 && !R.logged) { R.logged = true; logResult(R); }
        break;
      }
      case 'restart': { const R = ws.room; if (R && count(R) === 2 && R.S.win >= 0) { R.S = newGame(R.map); R.logged = false; push(R); } break; }
      case 'leave': leave(ws);
    }
  });
  ws.on('close', () => { leave(ws); bc(); });
});
setInterval(() => wss.clients.forEach(c => { if (!c.alive) return c.terminate(); c.alive = false; c.ping(); }), 30000);
server.listen(PORT, () => console.log('RUN and SEAk server listening on', PORT));
