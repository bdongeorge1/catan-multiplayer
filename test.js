import assert from 'node:assert/strict';
import { reduce, newRoom, GEO, nbrs, other, owner, legalSettlements, legalRoads, longest, vp, RESOURCES, ratio } from './game.js';

const A = 'a', B = 'b';
const act = (s, a) => reduce(s, a);
const fails = (s, a, re) => assert.throws(() => reduce(s, a), re);
const give = (s, pi, h) => { s = structuredClone(s); Object.assign(s.players[pi].hand, h); return s; };
const count = h => RESOURCES.reduce((n, r) => n + h[r], 0);
const conserved = s => s.players.reduce((n, p) => n + count(p.hand), count(s.bank));
// rng lives in state, so tests just search for a seed that rolls n
const seedFor = (s, n) => { for (let seed = 1; ; seed++) { const t = act({ ...s, seed }, { type: 'roll', pid: s.players[s.current].id }); if (t.dice[0] + t.dice[1] === n) return { ...s, seed }; } };
// what pi should receive on roll n
const expected = (s, pi, n) => { const h = {}; s.board.hexes.forEach((x, i) => { if (x.num !== n || i === s.board.robber) return; for (const v of GEO.hexes[i].v) { const o = owner(s, v); if (o?.pi === pi) h[x.res] = (h[x.res] || 0) + (o.kind === 'city' ? 2 : 1); } }); return h; };

// ---- lobby
let s = newRoom('TEST');
s = act(s, { type: 'join', pid: A, name: 'Ann', color: 'Red' });
fails(s, { type: 'join', pid: B, name: 'Bob', color: 'Red' }, /taken/);
s = act(s, { type: 'join', pid: B, name: 'Bob', color: 'Blue' });
fails(s, { type: 'start', pid: B }, /host/);
const start = act(s, { type: 'start', pid: A });
assert.equal(start.phase, 'setup'); assert.equal(start.deck.length, 25); assert.equal(conserved(start), 95);

// ---- setup: snake order A, B, B, A; second settlement pays out; distance rule
const six = GEO.hexes[start.board.hexes.findIndex(h => h.num === 6 && h.res === 'Brick')];
const v1 = six.v[0], e1 = GEO.V[v1].edges[0];
s = act(start, { type: 'place', pid: A, kind: 'settlement', id: v1 });
fails(s, { type: 'place', pid: A, kind: 'settlement', id: v1 }, /road/);
s = act(s, { type: 'place', pid: A, kind: 'road', id: e1 });
assert.equal(s.current, 1);
fails(s, { type: 'place', pid: B, kind: 'settlement', id: nbrs(v1)[0] }, /Too close/);
fails(s, { type: 'place', pid: A, kind: 'settlement', id: 'x' }, /Not your turn/);
const dist = (a, b) => Math.hypot(GEO.V[a].x - GEO.V[b].x, GEO.V[a].y - GEO.V[b].y);
const pick = (s, pi) => legalSettlements(s, pi).filter(v => GEO.V[v].hexes.length === 3).sort((a, b) => dist(b, v1) - dist(a, v1))[0]; // farthest from A's first spot
const settle = (s, pid, pi) => { const v = pick(s, pi); s = act(s, { type: 'place', pid, kind: 'settlement', id: v }); return act(s, { type: 'place', pid, kind: 'road', id: legalRoads(s, pi)[0] }); };
s = settle(s, B, 1);
assert.equal(s.current, 1, 'snake: B goes again');
s = settle(s, B, 1);
assert.equal(count(s.players[1].hand), GEO.V[s.players[1].settlements[1]].hexes.filter(h => s.board.hexes[h].num).length, 'second settlement pays out');
assert.equal(s.current, 0);
s = settle(s, A, 0);
assert.equal(s.phase, 'roll'); assert.equal(s.current, 0); assert.equal(conserved(s), 95);
const game = s;

// ---- roll & distribute; robber blocks
let t = act(seedFor(game, 6), { type: 'roll', pid: A });
assert.equal(t.phase, 'main');
const exp = expected(game, 0, 6);
assert.ok(exp.Brick >= 1);
for (const r of RESOURCES) assert.equal(t.players[0].hand[r], game.players[0].hand[r] + (exp[r] || 0), r);
s = { ...seedFor(game, 6), board: { ...game.board, robber: six.i } };
t = act(s, { type: 'roll', pid: A });
assert.equal(t.players[0].hand.Brick, game.players[0].hand.Brick + (expected(s, 0, 6).Brick || 0), 'robber blocks');
fails(t, { type: 'roll', pid: A }, /now/);

// ---- 7: discard, move robber, steal
s = give(seedFor(game, 7), 1, { Hay: 8 });
t = act(s, { type: 'roll', pid: A });
assert.equal(t.phase, 'discard'); assert.deepEqual(t.discards, [{ pi: 1, n: Math.floor(count(s.players[1].hand) / 2) }]);
const n = t.discards[0].n;
fails(t, { type: 'discard', pid: B, cards: { Hay: n - 1 } }, /exactly/);
t = act(t, { type: 'discard', pid: B, cards: { Hay: n } });
assert.equal(t.phase, 'robber'); assert.equal(conserved(t), conserved(s));
fails(t, { type: 'moveRobber', pid: A, hex: t.board.robber }, /different/);
const bHex = GEO.V[t.players[1].settlements[0]].hexes[0], a0 = count(t.players[0].hand), b0 = count(t.players[1].hand);
t = act(t, { type: 'moveRobber', pid: A, hex: bHex });
assert.equal(t.phase, 'main'); assert.equal(t.board.robber, bHex);
assert.equal(count(t.players[0].hand), a0 + 1, 'stole one card'); assert.equal(count(t.players[1].hand), b0 - 1);

// ---- build: costs, connectivity, longest road, broken road, city
s = act(seedFor(game, 2), { type: 'roll', pid: A });
fails(s, { type: 'build', pid: A, kind: 'city', id: s.players[0].settlements[0] }, /Need/);
s = give(s, 0, { Brick: 10, Lumber: 10, Sheep: 5, Hay: 5, Rock: 5 });
const base = conserved(s);
fails(s, { type: 'build', pid: A, kind: 'road', id: legalRoads(s, 1).find(e => !legalRoads(s, 0).includes(e)) }, /connect/);
let cur = e1, tip = other(e1, v1); // extend a chain from A's first road
for (let i = 0; i < 4; i++) {
  const opts = GEO.V[tip].edges.filter(e => e !== cur && legalRoads(s, 0).includes(e));
  const e = opts.find(e => !owner(s, other(e, tip)) && GEO.V[other(e, tip)].edges.length === 3) || opts[0];
  assert.ok(e, 'chain continues at step ' + i);
  s = act(s, { type: 'build', pid: A, kind: 'road', id: e }); tip = other(e, tip); cur = e;
}
assert.equal(s.players[0].roads.length, 6); assert.equal(conserved(s), base, 'paid resources return to bank');
assert.equal(longest(s, 0), 5); assert.equal(s.longestRoad.pi, 0); assert.equal(vp(s, 0), 4);
const chain = [e1, ...s.players[0].roads.slice(2)], mid = GEO.E[chain[2]].v.find(v => GEO.E[chain[3]].v.includes(v));
let broken = structuredClone(s); broken.players[1].settlements.push(mid);
assert.ok(longest(broken, 0) < 5, 'opponent settlement breaks the road');
broken = act(broken, { type: 'build', pid: A, kind: 'road', id: legalRoads(broken, 0)[0] });
assert.equal(broken.longestRoad, null);
s = act(s, { type: 'build', pid: A, kind: 'city', id: s.players[0].settlements[0] });
assert.equal(s.players[0].cities.length, 1); assert.equal(vp(s, 0), 5);
assert.deepEqual(expected(s, 0, 6).Brick >= 2, true, 'city pays double');

// ---- dev cards: not the turn bought, one per turn, knight -> largest army
s = act(s, { type: 'buyDev', pid: A });
assert.equal(s.players[0].dev.length, 1);
fails(s, { type: 'playDev', pid: A, t: s.players[0].dev[0].t }, /turn you bought|Victory/);
s.players[0].dev = [{ t: 'Knight', turn: 0 }, { t: 'Monopoly', turn: 0 }]; s.players[0].knights = 2;
s = act(s, { type: 'playDev', pid: A, t: 'Knight' });
assert.equal(s.phase, 'robber'); assert.equal(s.largestArmy.pi, 0);
s = act(s, { type: 'moveRobber', pid: A, hex: (s.board.robber + 1) % 19 });
assert.equal(s.phase, 'main'); assert.equal(vp(s, 0), 7);
fails(s, { type: 'playDev', pid: A, t: 'Monopoly', res: 'Hay' }, /per turn/);
s = act(s, { type: 'endTurn', pid: A });
assert.equal(s.current, 1); assert.equal(s.phase, 'roll');
fails(s, { type: 'endTurn', pid: B }, /now/);
// knight before rolling, then monopoly after
let k = give(s, 1, {}); k.players[1].dev = [{ t: 'Knight', turn: 0 }];
k = act(k, { type: 'playDev', pid: B, t: 'Knight' });
assert.equal(k.phase, 'robber'); k = act(k, { type: 'moveRobber', pid: B, hex: (k.board.robber + 1) % 19 });
assert.equal(k.phase, 'roll');

// ---- trades
let u = act(seedFor(s, 3), { type: 'roll', pid: B });
u = give(u, 1, { Sheep: 4, Rock: 0 });
assert.equal(ratio(u, 1, 'Sheep'), 4);
fails(u, { type: 'bankTrade', pid: B, give: 'Sheep', get: 'Sheep' }, /Pick/);
u = act(u, { type: 'bankTrade', pid: B, give: 'Sheep', get: 'Rock' });
assert.equal(u.players[1].hand.Rock, 1); assert.equal(u.players[1].hand.Sheep, 0);
u = act(u, { type: 'offer', pid: B, give: { Rock: 1 }, get: { Brick: 1 } });
fails(u, { type: 'accept', pid: B }, /No trade/);
const ab = u.players[0].hand.Brick, ar = u.players[0].hand.Rock;
u = act(u, { type: 'accept', pid: A });
assert.equal(u.players[0].hand.Brick, ab - 1); assert.equal(u.players[0].hand.Rock, ar + 1); assert.equal(u.trade, null);
assert.equal(ratio({ ...u, players: [{ ...u.players[0], settlements: [GEO.ports.find(p => p.res === 'Sheep').v[0]] }, u.players[1]] }, 0, 'Sheep'), 2, 'port ratio');

// ---- win at 10 on own turn (hidden VP count)
let w = structuredClone(s); w.current = 0; w.phase = 'main';
w.players[0].dev.push({ t: 'Victory Point', turn: 0 }, { t: 'Victory Point', turn: 0 }, { t: 'Victory Point', turn: 0 });
assert.equal(vp(w, 0), 7); assert.equal(vp(w, 0, true), 10);
w = act(w, { type: 'build', pid: A, kind: 'road', id: legalRoads(w, 0)[0] });
assert.equal(w.phase, 'over'); assert.equal(w.winner, 0);
fails(w, { type: 'endTurn', pid: A }, /now/);

// ---- Firebase round-trip: dropped empty arrays must not break reduce
const stripped = JSON.parse(JSON.stringify(game, (k, v) => Array.isArray(v) && !v.length ? undefined : v));
act(seedFor(stripped, 4), { type: 'roll', pid: A });

console.log('all tests passed');
