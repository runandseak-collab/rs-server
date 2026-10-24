// MAPS: format, validation and built-in maps. The server is the only authority on whether a map is playable.
//
// A map is a list of text rows (one string per row), all the same width:
//   .  floor            #  coral wall (blocks everyone)     ~  crevice (only the Fish can enter)
//   S  Shark start      F  Fish start                      P  plankton (the Fish must deliver all of them)
//   _  void (outside the hexagon; the board is ALWAYS one big hexagon)
//   H  home tile        V  vortex (teleports to another vortex; use 0 or 2+ of them)
// The board is a HEX grid: every tile touches 6 others, and odd rows sit half a tile to the right.
// Shape: a hexagon of radius n (8..16) stored in a (2n+1) x (2n+1) grid; the cells outside the hexagon are '_'.
// Big boards only: radius 8 = 217 tiles, 10 = 331, 12 = 469, 16 = 817.

export const LIMITS = { minR: 8, maxR: 16, min: 17, max: 33, maxPlankton: 12, maxHome: 12, minFloor: 20 };
const OK = new Set('.#~SFPHV_');
// Hex grid, pointy-top, 'odd-r' offset (odd rows sit half a tile to the right). Same order as rules.mjs.
export const neighbors = (x, y) => (y & 1)
  ? [[x + 1, y], [x - 1, y], [x + 1, y - 1], [x, y - 1], [x + 1, y + 1], [x, y + 1]]
  : [[x + 1, y], [x - 1, y], [x, y - 1], [x - 1, y - 1], [x, y + 1], [x - 1, y + 1]];

export function hexMask(n) {
  const w = 2 * n + 1, g = Array.from({ length: w }, () => Array(w).fill(false));
  for (let y = 0; y < w; y++) { const dy = Math.abs(y - n), L = w - dy, s = (dy + (n & 1) - (y & 1)) / 2; for (let x = s; x < s + L; x++) g[y][x] = true; }
  return g;
}

// Start separation: a wall must block the straight line between the Shark and the Fish, and walking must take at least MIN_WALK steps.
export const MIN_WALK = 14;
const toCube = (x, y) => { const q = x - ((y - (y & 1)) >> 1); return [q, -q - y, y]; };
function cubeRound(a) {
  let rx = Math.round(a[0]), ry = Math.round(a[1]), rz = Math.round(a[2]);
  const dx = Math.abs(rx - a[0]), dy = Math.abs(ry - a[1]), dz = Math.abs(rz - a[2]);
  if (dx > dy && dx > dz) rx = -ry - rz; else if (dy > dz) ry = -rx - rz; else rz = -rx - ry;
  return [rx, ry, rz];
}
export function separation(w, h, t, shark, fish) {
  const a = toCube(...shark), b = toCube(...fish), N = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
  let blocked = false;
  for (let i = 1; i < N && !blocked; i++) {
    const k = i / N, c = cubeRound([a[0] + (b[0] - a[0]) * k + 1e-6, a[1] + (b[1] - a[1]) * k + 2e-6, a[2] + (b[2] - a[2]) * k - 3e-6]);
    const x = c[0] + ((c[2] - (c[2] & 1)) >> 1), y = c[2];
    if (t[y * w + x] === 1) blocked = true;
  }
  const seen = new Map([[shark[1] * w + shark[0], 0]]), q = [shark];
  for (let i = 0; i < q.length; i++) {
    const [x, y] = q[i], d = seen.get(y * w + x);
    for (const [nx, ny] of neighbors(x, y)) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const k = ny * w + nx; if (seen.has(k) || t[k] !== 0) continue;
      seen.set(k, d + 1); q.push([nx, ny]);
    }
  }
  return { blocked, walk: seen.has(fish[1] * w + fish[0]) ? seen.get(fish[1] * w + fish[0]) : null };
}

const cleanName = (n) => String(n ?? '').replace(/[\u0000-\u001f<>&"'`\\]/g, '').trim().slice(0, 24) || 'Custom map';

/** Turn {name, rows} into a validated map, or {error}. Never trust a client map without calling this. */
export function parseMap(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.rows)) return { error: 'No map data' };
  const rows = input.rows, h = rows.length;
  if (rows.some((r) => typeof r !== 'string')) return { error: 'Rows must be text' };
  const w = h ? rows[0].length : 0, n = (h - 1) / 2;
  if (!Number.isInteger(n) || n < LIMITS.minR || n > LIMITS.maxR) return { error: `The board must be a hexagon of radius ${LIMITS.minR}-${LIMITS.maxR} (${2 * LIMITS.minR + 1}-${2 * LIMITS.maxR + 1} rows)` };
  if (rows.some((r) => r.length !== w) || w !== h) return { error: 'The board must be a hexagon (as many columns as rows)' };
  const mask = hexMask(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((rows[y][x] === '_') === mask[y][x]) return { error: 'The board must be a perfect hexagon' };

  const t = [], plankton = [], home = [], vortex = [];
  let shark = null, fish = null, floors = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = rows[y][x];
      if (!OK.has(c)) return { error: `Unknown tile "${c}" at column ${x + 1}, row ${y + 1}` };
      t.push(c === '#' ? 1 : c === '~' ? 2 : c === '_' ? 4 : 0);
      if (c === '.') floors++;
      if (c === 'S') { if (shark) return { error: 'Only one Shark start (S) is allowed' }; shark = [x, y]; }
      else if (c === 'F') { if (fish) return { error: 'Only one Fish start (F) is allowed' }; fish = [x, y]; }
      else if (c === 'P') plankton.push([x, y]);
      else if (c === 'H') home.push([x, y]);
      else if (c === 'V') vortex.push([x, y]);
    }
  }
  if (!shark) return { error: 'Place the Shark start (S)' };
  if (!fish) return { error: 'Place the Fish start (F)' };
  if (plankton.length < 1) return { error: 'Add at least 1 plankton (P)' };
  if (plankton.length > LIMITS.maxPlankton) return { error: `At most ${LIMITS.maxPlankton} plankton` };
  if (home.length < 1) return { error: 'Add at least 1 home tile (H)' };
  if (home.length > LIMITS.maxHome) return { error: `At most ${LIMITS.maxHome} home tiles` };
  if (vortex.length === 1) return { error: 'Use 0 vortexes or 2 or more (one vortex has nowhere to go)' };
  if (floors + plankton.length + home.length + vortex.length < LIMITS.minFloor) return { error: 'Not enough open floor — the map is too cramped' };

  // The Fish must be able to reach every plankton and at least one home tile.
  const fishSeen = flood(w, h, t, fish, (c) => { const v = t[c[1] * w + c[0]]; return v !== 1 && v !== 4; }, null);
  for (const p of plankton) if (!fishSeen.has(p[1] * w + p[0])) return { error: `The Fish can't reach the plankton at column ${p[0] + 1}, row ${p[1] + 1}` };
  if (!home.some((p) => fishSeen.has(p[1] * w + p[0]))) return { error: "The Fish can't reach any home tile" };

  // The Shark (floor only; vortexes link together) must be able to contest the goals.
  const sharkSeen = flood(w, h, t, shark, (c) => t[c[1] * w + c[0]] === 0, vortex);
  if (!plankton.some((p) => sharkSeen.has(p[1] * w + p[0]))) return { error: "The Shark can't reach any plankton" };
  if (!home.some((p) => sharkSeen.has(p[1] * w + p[0]))) return { error: "The Shark can't reach any home tile" };

  const sp = separation(w, h, t, shark, fish);
  if (!sp.blocked) return { error: 'Put a wall between the Shark (S) and the Fish (F) so they cannot see each other' };
  if (sp.walk !== null && sp.walk < MIN_WALK) return { error: `The Shark and the Fish must start at least ${MIN_WALK} steps apart` };

  return { map: { name: cleanName(input.name), w, h, t, shark, fish, plankton, home, vortex } };
}

function flood(w, h, t, start, passable, vortex) {
  const seen = new Set([start[1] * w + start[0]]), q = [start];
  const vk = vortex && vortex.length ? new Set(vortex.map((v) => v[1] * w + v[0])) : null;
  for (let i = 0; i < q.length; i++) {
    const [cx, cy] = q[i], next = neighbors(cx, cy);
    if (vk && vk.has(cy * w + cx)) for (const v of vortex) next.push(v);
    for (const n of next) {
      if (n[0] < 0 || n[1] < 0 || n[0] >= w || n[1] >= h) continue;
      const k = n[1] * w + n[0];
      if (seen.has(k) || !passable(n)) continue;
      seen.add(k); q.push(n);
    }
  }
  return seen;
}

/* ---------------- built-in maps (all hexagon-shaped: '_' = no tile) ---------------- */
const SOURCE = [
  { id: 'open', name: 'Open Ocean', rows: [
    '_____.#..~..##H____',
    '____V.........H____',
    '____.#......#...___',
    '___..#~.....V#P.___',
    '___.......#...P.~__',
    '__...#..#.....#..__',
    '__......#~....#S.#_',
    '_.........#......._',
    '_.#.#..~.###..#...#',
    '....#..##.##..#....',
    '_#..F#......~..#.#.',
    '_.......#........._',
    '__#..#....~#......_',
    '__..#.....#..#...__',
    '___~.P...#.......__',
    '___.P#V.....~#..___',
    '____...#......#.___',
    '____H.........V____',
    '_____H##..~..#.____',
  ] },
  { id: 'classic', name: 'Classic Reef', rows: [
    '_____....#.#.V.._____',
    '____......~....._____',
    '____......P......____',
    '___..##~~#####.HH____',
    '___...#.......##..___',
    '__.~.#.####~#.#.#.___',
    '__#..#.#.......#V..__',
    '_...#.#..#..##.#...__',
    '_.....#.........#..P_',
    '...#.#........#.#..._',
    '...~..#.......#.S~...',
    '...#.#..###...#.#..._',
    '_P.F#.........#....._',
    '_...#.##..#..#.#...__',
    '__..V#.......#.#..#__',
    '__.#.#.#~####.#.~.___',
    '___..##.......#...___',
    '___HH.#####~~##..____',
    '____......P......____',
    '____.....~......_____',
    '_____..V.#.#...._____',
  ] },
  { id: 'corridor', name: 'Sunken Corridor', rows: [
    '______..#.#...~H#._____',
    '_____...~.#...#H#._____',
    '_____.............V____',
    '____.#...#.~...#.#P____',
    '____#.#...#.~..S#.#.___',
    '___.................___',
    '___..#.~...~.#...#.#.__',
    '__...#.#...#.#...#.#.__',
    '__................V..._',
    '_.#...#.#..##.~...#P#._',
    '_#.#...#.#.#.#.#...#.#.',
    '..........#............',
    '_.#.#...#.#...#.#...#.#',
    '_.#P#...~.#...#.#...#._',
    '__...V................_',
    '__.#.#...#.#...#.#...__',
    '___.#.#F..#.~...~.#..__',
    '___.................___',
    '____.#.#...~.#...#.#___',
    '____P#.#...~.#...#.____',
    '_____V.............____',
    '_____.#H#...#.~..._____',
    '______.#H~...#.#.._____',
  ] },
  { id: 'atolls', name: 'Twin Atolls', rows: [
    '______........#..HH______',
    '_____.~#.......#...______',
    '_____.V.#PP.V.....#._____',
    '____#...##.#........_____',
    '____...#.............____',
    '___.#.###..#....F....____',
    '___.....#..#....###...___',
    '__.......#.....#...#..___',
    '__##.....~..~#.#..#.#..__',
    '_..#....#.~...#..#..#..__',
    '_...#..##.#..#........##_',
    '.P...####......~........_',
    '.....#.~#...##..#~.#.....',
    '........~..#...####...P._',
    '_##........#..#.##..#..._',
    '_..#..#..#...~.#....#..__',
    '__..#.#..#.#~..~.....##__',
    '__..#...#.....#.......___',
    '___...###....#..#.....___',
    '___.........#..###.#.____',
    '____....S........#...____',
    '____........#.##...#_____',
    '_____.#.....V.PP#.V._____',
    '_____...#.......#~.______',
    '______HH..#........______',
  ] },
  { id: 'coral', name: 'Coral Caves', rows: [
    '_______##############______',
    '______###############______',
    '______################_____',
    '_____#################_____',
    '_____###############.##____',
    '____##############..HH#____',
    '____##############.....#___',
    '___##.####.#.###..V..V.#___',
    '___#....~......~~......~#__',
    '__#~P....#.............##__',
    '__#~.....~...............#_',
    '_##....~###...........FP.#_',
    '_##~P...###......~#.#....##',
    '##.....#####..######.....##',
    '_##....#.#~..##..###...P~##',
    '_#.P............###~....##_',
    '__#...S...........~.....~#_',
    '__##.............#....P~#__',
    '___#~......~~......~....#__',
    '___#.V..V..###.#.####.##___',
    '____#.....##############___',
    '____#HH..##############____',
    '_____##.###############____',
    '_____#################_____',
    '______################_____',
    '______###############______',
    '_______##############______',
  ] },
  { id: 'grand', name: 'Grand Ocean', rows: [
    '________....#...#......._______',
    '_______P................_______',
    '_______..................______',
    '______.V....#............______',
    '______.............#......_____',
    '_____.P...#~~#F######...V._____',
    '_____.....#P......#..#...#.____',
    '____HH#..#..#..#.....~.....____',
    '____.....#..#.#.......###...___',
    '___.#..##.............#.....___',
    '___..........##.####.V.#..#..__',
    '__....#~#...#.....~.....#....__',
    '__.....#~...~......#..#.#....._',
    '_....##....#............#....._',
    '_....#~....#........#..~.~.....',
    '...#.#....#...###...#....#.#...',
    '_.....~.~..#...#....#....~#....',
    '_.....#........#...#....##...._',
    '__.....#.#..#......~...~#....._',
    '__....#.....~.....#...#~#....__',
    '___..#..#.V.####.##..........__',
    '___.....#.............##..#.___',
    '____...###.......#.#..#.....___',
    '____.....~.....#..#..#..#HH____',
    '_____.#...#..#......P#.....____',
    '_____.V...######.#~~#...P._____',
    '______......#...S........._____',
    '______............#....V.______',
    '_______..................______',
    '_______................P_______',
    '________.......#...#...._______',
  ] },
];

export const BUILTINS = SOURCE.map((b) => {
  const r = parseMap(b);
  if (r.error) throw new Error(`Built-in map "${b.name}" is invalid: ${r.error}`);
  return { id: b.id, name: b.name, rows: b.rows, map: r.map };
});
export const DEFAULT_MAP = BUILTINS.find((b) => b.id === 'classic').map;
export const builtinById = (id) => BUILTINS.find((b) => b.id === id);
export const randomBuiltin = () => BUILTINS[(Math.random() * BUILTINS.length) | 0];
// what the client needs to draw the map picker
export const publicList = () => BUILTINS.map((b) => ({ id: b.id, name: b.name, w: b.map.w, h: b.map.h, rows: b.rows }));
