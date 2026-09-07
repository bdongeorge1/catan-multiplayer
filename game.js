// game.js — pure Catan rules. reduce(state, action) -> new state, or throws a readable Error.
// No DOM, no Firebase. Randomness comes from state.seed (mulberry32) so every client agrees.

export const RESOURCES = ['Brick', 'Lumber', 'Sheep', 'Hay', 'Rock'];
export const COST = { road: { Brick: 1, Lumber: 1 }, settlement: { Brick: 1, Lumber: 1, Sheep: 1, Hay: 1 }, city: { Hay: 2, Rock: 3 }, dev: { Sheep: 1, Hay: 1, Rock: 1 } };
export const LIMITS = { road: 15, settlement: 5, city: 4 };
export const COLORS = { Red: '#d0342c', Blue: '#2b5fd9', White: '#f4f4f4', Orange: '#f28c28', Green: '#3f9a4b', Brown: '#7a4b2a' };
export const DEV = { Knight: 14, 'Victory Point': 5, 'Road Building': 2, 'Year of Plenty': 2, Monopoly: 2 };

// ---------- geometry (pointy-top hexes, axial q/r, radius-2 board) ----------
const DIRS = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]]; // neighbours at 0°,60°,…300° (y down)
export const SIZE = 10;
// Rulebook "beginner" layout, rows top→bottom, left→right. Desert num 0.
const LAYOUT = [['Rock', 10], ['Sheep', 2], ['Lumber', 9], ['Hay', 12], ['Brick', 6], ['Sheep', 4], ['Brick', 10], ['Hay', 9], ['Lumber', 11], ['Desert', 0], ['Lumber', 3], ['Rock', 8], ['Lumber', 8], ['Rock', 3], ['Hay', 4], ['Sheep', 5], ['Brick', 5], ['Hay', 6], ['Sheep', 11]];
const PORTS = [[0, -2, 4, 'any'], [1, -2, 5, 'Sheep'], [2, -1, 0, 'any'], [2, 0, 1, 'Rock'], [0, 2, 1, 'Hay'], [-1, 2, 2, 'any'], [-2, 2, 3, 'Brick'], [-2, 0, 3, 'any'], [-1, -1, 4, 'Lumber']];

const hk = (q, r) => q + ',' + r;
const cornerId = (q, r, k) => [hk(q, r), hk(q + DIRS[k][0], r + DIRS[k][1]), hk(q + DIRS[(k + 1) % 6][0], r + DIRS[(k + 1) % 6][1])].sort().join('|');
const edgeId = (q, r, k) => [hk(q, r), hk(q + DIRS[k][0], r + DIRS[k][1])].sort().join('|');

export const GEO = (() => {
  const hexes = [], V = {}, E = {};
  for (let r = -2; r <= 2; r++) for (let q = Math.max(-2, -r - 2); q <= Math.min(2, 2 - r); q++) {
    const i = hexes.length, x = SIZE * Math.sqrt(3) * (q + r / 2), y = SIZE * 1.5 * r, h = { i, q, r, x, y, v: [], e: [] };
    hexes.push(h);
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 180 * (30 + 60 * k), id = cornerId(q, r, k);
      V[id] ||= { id, x: x + SIZE * Math.cos(a), y: y + SIZE * Math.sin(a), hexes: [], edges: [] };
      V[id].hexes.push(i); h.v.push(id);
    }
    for (let k = 0; k < 6; k++) {
      const id = edgeId(q, r, k), v = [h.v[(k + 5) % 6], h.v[k]];
      E[id] ||= { id, v, hexes: [] };
      E[id].hexes.push(i); h.e.push(id);
      v.forEach(vid => V[vid].edges.includes(id) || V[vid].edges.push(id));
    }
  }
  const ports = PORTS.map(([q, r, d, res]) => {
    const e = E[edgeId(q, r, d)], h = hexes.find(h => h.q === q && h.r === r), a = Math.PI / 3 * d;
    return { e: e.id, v: e.v, res, x: h.x + SIZE * 1.6 * Math.cos(a), y: h.y + SIZE * 1.6 * Math.sin(a) };
  });
  return { hexes, V, E, ports };
})();
export const other = (eid, vid) => GEO.E[eid].v.find(v => v !== vid);
export const nbrs = vid => GEO.V[vid].edges.map(e => other(e, vid));

// ---------- state ----------
const zero = () => Object.fromEntries(RESOURCES.map(r => [r, 0]));
export function newRoom(code) {
  return { code, createdAt: Date.now(), seed: Math.floor(Math.random() * 2 ** 31), phase: 'lobby', players: [], log: [], turn: 0 };
}
// Firebase drops empty arrays/objects and nulls; fill defaults after every read.
export function normalize(s) {
  s.players ||= []; s.log ||= []; s.discards ||= []; s.deck ||= []; s.trade ||= null;
  s.longestRoad ||= null; s.largestArmy ||= null; s.dice ||= null; s.turn ||= 0; s.deckIdx ||= 0; s.freeRoads ||= 0;
  for (const p of s.players) { p.roads ||= []; p.settlements ||= []; p.cities ||= []; p.dev ||= []; p.hand = { ...zero(), ...(p.hand || {}) }; p.knights ||= 0; }
  if (s.board) s.board.hexes ||= LAYOUT.map(([res, num]) => ({ res, num }));
  s.bank = { ...zero(), ...(s.bank || {}) };
  return s;
}
function rand(s) { let t = s.seed = (s.seed + 0x6D2B79F5) | 0; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }
const die = s => 1 + Math.floor(rand(s) * 6);
const fail = m => { throw new Error(m); };
const total = h => RESOURCES.reduce((n, r) => n + (h[r] || 0), 0);
const log = (s, m) => { s.log.push(m); if (s.log.length > 60) s.log.shift(); };

// ---------- queries (exported for the UI) ----------
export function owner(s, vid) { // -> {pi, kind} | null
  for (let pi = 0; pi < s.players.length; pi++) {
    const p = s.players[pi];
    if (p.settlements.includes(vid)) return { pi, kind: 'settlement' };
    if (p.cities.includes(vid)) return { pi, kind: 'city' };
  }
  return null;
}
export const roadOwner = (s, eid) => s.players.findIndex(p => p.roads.includes(eid));
export function legalSettlements(s, pi) {
  const p = s.players[pi];
  return Object.keys(GEO.V).filter(v => !owner(s, v) && !nbrs(v).some(n => owner(s, n)) &&
    (s.phase === 'setup' || GEO.V[v].edges.some(e => p.roads.includes(e))));
}
export function legalRoads(s, pi) {
  const p = s.players[pi];
  if (s.phase === 'setup') return GEO.V[s.setup.last].edges.filter(e => roadOwner(s, e) < 0);
  return Object.keys(GEO.E).filter(e => roadOwner(s, e) < 0 && GEO.E[e].v.some(v => {
    const o = owner(s, v);
    return o ? o.pi === pi : GEO.V[v].edges.some(e2 => p.roads.includes(e2));
  }));
}
export const legalCities = (s, pi) => s.players[pi].settlements.slice();
export function ratio(s, pi, res) {
  const mine = v => { const o = owner(s, v); return o && o.pi === pi; };
  const ports = GEO.ports.filter(pt => pt.v.some(mine));
  return ports.some(pt => pt.res === res) ? 2 : ports.some(pt => pt.res === 'any') ? 3 : 4;
}
export function longest(s, pi) { // longest trail over this player's roads; opponent buildings block passage
  const p = s.players[pi], blocked = v => { const o = owner(s, v); return o && o.pi !== pi; };
  const dfs = (v, used) => Math.max(0, ...GEO.V[v].edges.filter(e => p.roads.includes(e) && !used.has(e)).map(e => {
    const w = other(e, v); used.add(e);
    const n = 1 + (blocked(w) ? 0 : dfs(w, used)); used.delete(e); return n;
  }));
  const starts = new Set(p.roads.flatMap(e => GEO.E[e].v));
  return Math.max(0, ...[...starts].map(v => dfs(v, new Set())));
}
export function vp(s, pi, hidden = false) {
  const p = s.players[pi];
  return p.settlements.length + 2 * p.cities.length + (s.longestRoad?.pi === pi ? 2 : 0) + (s.largestArmy?.pi === pi ? 2 : 0) +
    (hidden ? p.dev.filter(d => d.t === 'Victory Point').length : 0);
}
export const canPlayDev = (s, pi, t) => !s.devPlayed && s.players[pi].dev.some(d => d.t === t && d.turn < s.turn);

// ---------- helpers ----------
function pay(s, p, cost) {
  const missing = Object.entries(cost).filter(([r, q]) => p.hand[r] < q).map(([r, q]) => `${q - p.hand[r]} ${r}`);
  if (missing.length) fail('Need ' + missing.join(', '));
  for (const [r, q] of Object.entries(cost)) { p.hand[r] -= q; s.bank[r] += q; }
}
function updateLongest(s) { // ponytail: ties after a break go to nobody; official rule keeps the previous holder on ties only if still >=5, close enough
  const lens = s.players.map((_, i) => longest(s, i)), best = Math.max(...lens), h = s.longestRoad;
  if (h && lens[h.pi] >= 5 && lens[h.pi] >= best) { h.len = lens[h.pi]; return; }
  const top = lens.map((l, i) => i).filter(i => lens[i] >= 5 && lens[i] === best);
  s.longestRoad = top.length === 1 ? { pi: top[0], len: best } : null;
}
function distribute(s, n) {
  const need = {}; // res -> {pi: count}
  s.board.hexes.forEach((h, i) => {
    if (h.num !== n || i === s.board.robber) return;
    for (const v of GEO.hexes[i].v) { const o = owner(s, v); if (o) (need[h.res] ||= {})[o.pi] = ((need[h.res] || {})[o.pi] || 0) + (o.kind === 'city' ? 2 : 1); }
  });
  for (const [res, by] of Object.entries(need)) {
    const want = Object.values(by).reduce((a, b) => a + b, 0), who = Object.keys(by);
    if (want > s.bank[res] && who.length > 1) { log(s, `Bank is out of ${res}; nobody gets any`); continue; } // official shortage rule
    for (const pi of who) { const q = Math.min(by[pi], s.bank[res]); s.players[pi].hand[res] += q; s.bank[res] -= q; }
  }
}
function steal(s, pi, victim) {
  const v = s.players[victim], cards = RESOURCES.flatMap(r => Array(v.hand[r]).fill(r));
  if (!cards.length) return log(s, `${s.players[pi].name} found ${v.name}'s hand empty`);
  const r = cards[Math.floor(rand(s) * cards.length)];
  v.hand[r]--; s.players[pi].hand[r]++; log(s, `${s.players[pi].name} stole a card from ${v.name}`);
}
function placeBuilding(s, pi, kind, v) {
  const p = s.players[pi];
  if (kind === 'city') {
    if (!p.settlements.includes(v)) fail('Cities go on your own settlements');
    if (p.cities.length >= LIMITS.city) fail('No cities left');
    p.settlements.splice(p.settlements.indexOf(v), 1); p.cities.push(v);
  } else {
    if (p.settlements.length >= LIMITS.settlement) fail('No settlements left');
    if (!legalSettlements(s, pi).includes(v)) fail(owner(s, v) || nbrs(v).some(n => owner(s, n)) ? 'Too close to another building' : 'Must touch one of your roads');
    p.settlements.push(v);
  }
  log(s, `${p.name} built a ${kind}`);
}
function placeRoad(s, pi, e) {
  const p = s.players[pi];
  if (p.roads.length >= LIMITS.road) fail('No roads left');
  if (!legalRoads(s, pi).includes(e)) fail(roadOwner(s, e) >= 0 ? 'Already a road there' : 'Road must connect to your roads or buildings');
  p.roads.push(e); log(s, `${p.name} built a road`);
}
const setupPlayer = s => { const n = s.players.length, i = s.setup.step; return i < n ? i : 2 * n - 1 - i; };

// ---------- reducer ----------
export function reduce(prev, a) {
  const s = normalize(structuredClone(prev));
  const pi = s.players.findIndex(p => p.id === a.pid), p = s.players[pi];
  const me = () => { if (pi < 0) fail('You are not in this game'); return p; };
  const myTurn = (...phases) => { me(); if (s.current !== pi) fail('Not your turn'); if (phases.length && !phases.includes(s.phase)) fail(`Can't do that now`); return p; };
  const winCheck = () => { if (s.phase !== 'over' && s.current != null && vp(s, s.current, true) >= 10) { s.phase = 'over'; s.winner = s.current; log(s, `${s.players[s.current].name} wins!`); } };

  switch (a.type) {
    case 'join': {
      if (s.phase !== 'lobby') fail('Game already started');
      const name = String(a.name || '').trim().slice(0, 16);
      if (!name) fail('Enter a name');
      if (!COLORS[a.color]) fail('Pick a color');
      if (s.players.some(q => q.id !== a.pid && q.color === a.color)) fail(`${a.color} is taken`);
      if (pi >= 0) { p.name = name; p.color = a.color; break; }
      if (s.players.length >= 6) fail('Room is full');
      s.players.push({ id: a.pid, name, color: a.color, hand: zero(), dev: [], roads: [], settlements: [], cities: [], knights: 0 });
      break;
    }
    case 'start': {
      if (s.phase !== 'lobby') fail('Already started');
      if (pi !== 0) fail('Only the host can start');
      if (s.players.length < 2) fail('Need at least 2 players');
      s.board = { hexes: LAYOUT.map(([res, num]) => ({ res, num })), robber: LAYOUT.findIndex(([r]) => r === 'Desert') };
      s.bank = Object.fromEntries(RESOURCES.map(r => [r, 19]));
      s.deck = Object.entries(DEV).flatMap(([t, n]) => Array(n).fill(t));
      for (let i = s.deck.length - 1; i > 0; i--) { const j = Math.floor(rand(s) * (i + 1)); [s.deck[i], s.deck[j]] = [s.deck[j], s.deck[i]]; }
      s.phase = 'setup'; s.setup = { step: 0, need: 'settlement', last: '' }; s.current = 0; s.turn = 1;
      log(s, 'Game started. Place your first settlement.');
      break;
    }
    case 'place': { // setup: settlement then road, snake order
      myTurn('setup');
      if (s.setup.need === 'settlement') {
        if (a.kind !== 'settlement') fail('Place a settlement first');
        placeBuilding(s, pi, 'settlement', a.id);
        if (s.setup.step >= s.players.length) for (const hi of GEO.V[a.id].hexes) { const h = s.board.hexes[hi]; if (h.num) { p.hand[h.res]++; s.bank[h.res]--; } }
        s.setup.need = 'road'; s.setup.last = a.id;
      } else {
        if (a.kind !== 'road') fail('Place a road next to your settlement');
        placeRoad(s, pi, a.id);
        s.setup.step++;
        if (s.setup.step === 2 * s.players.length) { s.phase = 'roll'; s.current = 0; log(s, `${s.players[0].name}, roll the dice`); }
        else { s.setup.need = 'settlement'; s.current = setupPlayer(s); }
      }
      break;
    }
    case 'roll': {
      myTurn('roll');
      s.dice = [die(s), die(s)];
      const n = s.dice[0] + s.dice[1];
      log(s, `${p.name} rolled ${n}`);
      if (n === 7) {
        s.discards = s.players.map((q, i) => ({ pi: i, n: Math.floor(total(q.hand) / 2) })).filter(d => total(s.players[d.pi].hand) > 7);
        s.phase = s.discards.length ? 'discard' : 'robber'; s.robberFrom = 'main';
      } else { distribute(s, n); s.phase = 'main'; }
      break;
    }
    case 'discard': {
      me();
      const d = s.discards.find(d => d.pi === pi);
      if (s.phase !== 'discard' || !d) fail('Nothing to discard');
      if (total(a.cards) !== d.n) fail(`Discard exactly ${d.n} cards`);
      for (const r of RESOURCES) if ((a.cards[r] || 0) > p.hand[r]) fail(`You don't have ${a.cards[r]} ${r}`);
      for (const r of RESOURCES) { p.hand[r] -= a.cards[r] || 0; s.bank[r] += a.cards[r] || 0; }
      s.discards = s.discards.filter(x => x.pi !== pi);
      log(s, `${p.name} discarded ${d.n} cards`);
      if (!s.discards.length) s.phase = 'robber';
      break;
    }
    case 'moveRobber': {
      myTurn('robber');
      if (a.hex === s.board.robber || !GEO.hexes[a.hex]) fail('Move the robber to a different hex');
      s.board.robber = a.hex;
      const victims = [...new Set(GEO.hexes[a.hex].v.map(v => owner(s, v)?.pi).filter(x => x != null && x !== pi && total(s.players[x].hand) > 0))];
      if (victims.length) {
        const victim = victims.length === 1 ? victims[0] : a.victim;
        if (!victims.includes(victim)) fail('Choose a player to steal from');
        steal(s, pi, victim);
      }
      s.phase = s.robberFrom || 'main'; s.robberFrom = null;
      break;
    }
    case 'build': {
      myTurn('main');
      if (a.kind === 'road') {
        if (s.freeRoads) s.freeRoads--; else pay(s, p, COST.road);
        placeRoad(s, pi, a.id);
      } else { pay(s, p, COST[a.kind]); placeBuilding(s, pi, a.kind, a.id); }
      updateLongest(s);
      break;
    }
    case 'buyDev': {
      myTurn('main');
      if (s.deckIdx >= s.deck.length) fail('No dev cards left');
      pay(s, p, COST.dev);
      p.dev.push({ t: s.deck[s.deckIdx++], turn: s.turn }); log(s, `${p.name} bought a dev card`);
      break;
    }
    case 'playDev': {
      myTurn('roll', 'main');
      if (a.t === 'Victory Point') fail('Victory points count automatically');
      if (s.devPlayed) fail('One dev card per turn');
      const i = p.dev.findIndex(d => d.t === a.t && d.turn < s.turn);
      if (i < 0) fail(p.dev.some(d => d.t === a.t) ? `Can't play a card the turn you bought it` : `You don't have a ${a.t}`);
      p.dev.splice(i, 1); s.devPlayed = true; log(s, `${p.name} played ${a.t}`);
      if (a.t === 'Knight') {
        p.knights++;
        if (p.knights >= 3 && (!s.largestArmy || p.knights > s.largestArmy.n || s.largestArmy.pi === pi)) s.largestArmy = { pi, n: p.knights };
        s.robberFrom = s.phase; s.phase = 'robber';
      } else if (a.t === 'Road Building') {
        if (s.phase !== 'main') fail('Roll first');
        s.freeRoads = Math.min(2, LIMITS.road - p.roads.length);
      } else if (a.t === 'Year of Plenty') {
        if (s.phase !== 'main') fail('Roll first');
        for (const r of [a.a, a.b]) { if (!RESOURCES.includes(r)) fail('Pick two resources'); if (s.bank[r] < 1) fail(`Bank is out of ${r}`); p.hand[r]++; s.bank[r]--; }
      } else if (a.t === 'Monopoly') {
        if (s.phase !== 'main') fail('Roll first');
        if (!RESOURCES.includes(a.res)) fail('Pick a resource');
        let n = 0;
        for (const q of s.players) if (q !== p) { n += q.hand[a.res]; p.hand[a.res] += q.hand[a.res]; q.hand[a.res] = 0; }
        log(s, `${p.name} took ${n} ${a.res}`);
      }
      break;
    }
    case 'bankTrade': {
      myTurn('main');
      const k = ratio(s, pi, a.give);
      if (!RESOURCES.includes(a.give) || !RESOURCES.includes(a.get) || a.give === a.get) fail('Pick what to give and get');
      if (p.hand[a.give] < k) fail(`Need ${k} ${a.give} for that trade`);
      if (s.bank[a.get] < 1) fail(`Bank is out of ${a.get}`);
      p.hand[a.give] -= k; s.bank[a.give] += k; p.hand[a.get]++; s.bank[a.get]--;
      log(s, `${p.name} traded ${k} ${a.give} for 1 ${a.get}`);
      break;
    }
    case 'offer': {
      myTurn('main');
      if (!total(a.give) || !total(a.get)) fail('Offer must give and get something');
      for (const r of RESOURCES) if ((a.give[r] || 0) > p.hand[r]) fail(`You don't have ${a.give[r]} ${r}`);
      s.trade = { pi, give: { ...zero(), ...a.give }, get: { ...zero(), ...a.get } };
      log(s, `${p.name} offers a trade`);
      break;
    }
    case 'accept': {
      me();
      const t = s.trade; if (!t || t.pi === pi) fail('No trade to accept');
      const o = s.players[t.pi];
      for (const r of RESOURCES) { if (p.hand[r] < t.get[r]) fail(`You don't have enough ${r}`); if (o.hand[r] < t.give[r]) fail(`${o.name} no longer has enough ${r}`); }
      for (const r of RESOURCES) { p.hand[r] += t.give[r] - t.get[r]; o.hand[r] += t.get[r] - t.give[r]; }
      log(s, `${p.name} accepted ${o.name}'s trade`); s.trade = null;
      break;
    }
    case 'cancel': { myTurn(); s.trade = null; break; }
    case 'endTurn': {
      myTurn('main');
      s.current = (pi + 1) % s.players.length; s.phase = 'roll'; s.turn++; s.devPlayed = false; s.freeRoads = 0; s.trade = null;
      log(s, `${s.players[s.current].name}'s turn`);
      break;
    }
    default: fail('Unknown action ' + a.type);
  }
  winCheck();
  return s;
}
