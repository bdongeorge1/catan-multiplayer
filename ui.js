// ui.js — renders from room state; every tap dispatches an action through net.send.
import { newRoom, GEO, SIZE, COLORS, RESOURCES, COST, LIMITS, owner, roadOwner, legalSettlements, legalRoads, legalCities, ratio, vp, canPlayDev, longest, other } from './game.js';
import { connect } from './net.js';

const $ = id => document.getElementById(id);
const ICON = { Brick: '🧱', Lumber: '🌲', Sheep: '🐑', Hay: '🌾', Rock: '⛰️', Knight: '⚔️', 'Victory Point': '🏆', 'Road Building': '🛣️', 'Year of Plenty': '🎁', Monopoly: '🎩' };
const TERRAIN = { Brick: '#b5431f', Lumber: '#23704a', Sheep: '#9bd66a', Hay: '#ffc83d', Rock: '#5b6779', Desert: '#e8d3a0' };
const zero = () => Object.fromEntries(RESOURCES.map(r => [r, 0]));
const count = h => RESOURCES.reduce((n, r) => n + (h[r] || 0), 0);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const pid = sessionStorage.pid ||= Math.random().toString(36).slice(2, 10);
let net, code = sessionStorage.code || '', S = null, mode = null, lastDice = '';
const me = () => S?.players.findIndex(p => p.id === pid);
const mine = () => S && S.current === me();
const P = i => S.players[i];

// ---------- toast ----------
let toastT;
function toast(msg, err) { const t = $('toast'); t.textContent = msg; t.className = 'show' + (err ? ' err' : ''); clearTimeout(toastT); toastT = setTimeout(() => t.className = '', 2600); }
async function dispatch(a) { try { await net.send(code, { ...a, pid }); } catch (e) { toast(e.message, true); } }

// ---------- lobby ----------
$('color').innerHTML = Object.keys(COLORS).map(c => `<option>${c}</option>`).join('');
$('name').value = localStorage.name || '';
$('room').value = location.hash.slice(1).toUpperCase();
async function enter(c) {
  const name = $('name').value.trim(), color = $('color').value;
  if (!name) return toast('Enter a name', true);
  localStorage.name = name; code = c;
  try { await net.send(code, { type: 'join', pid, name, color }); } catch (e) { code = ''; return toast(e.message, true); }
  sessionStorage.code = code; location.hash = code;
  net.watch(code, s => { S = s; render(); }); net.presence(code, pid);
}
$('create').onclick = async () => {
  const c = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');
  await net.create(newRoom(c)); enter(c);
};
$('join-btn').onclick = async () => {
  const c = $('room').value.trim().toUpperCase();
  if (c.length !== 4) return toast('Room codes are 4 letters', true);
  if (!await net.exists(c)) return toast('No room ' + c, true);
  enter(c);
};
$('start').onclick = () => dispatch({ type: 'start' });
$('leave').onclick = () => { sessionStorage.removeItem('code'); location.hash = ''; location.reload(); };
$('share').onclick = () => { const url = location.href; (navigator.share ? navigator.share({ url }) : navigator.clipboard.writeText(url).then(() => toast('Link copied'))).catch(() => {}); };

// ---------- render ----------
function render() {
  const lobby = S.phase === 'lobby';
  $('join').hidden = true; $('wait').hidden = false; $('lobby').hidden = !lobby; $('game').hidden = lobby; $('bar').hidden = lobby;
  if (lobby) {
    $('code').textContent = S.code;
    $('lobby-players').innerHTML = S.players.map((p, i) => `<div class="pl" style="--pc:${COLORS[p.color]}">${esc(p.name)}${i === 0 ? ' 👑' : ''}${p.id === pid ? ' (you)' : ''}</div>`).join('') || '<p class="total">Waiting for players…</p>';
    $('start').hidden = me() !== 0; $('start').disabled = S.players.length < 2;
    return;
  }
  // render owns the mode: forced in setup/robber, chosen via buttons in main, cleared otherwise
  if (S.phase === 'setup' && mine()) mode = S.setup.need;
  else if (S.phase === 'robber' && mine()) mode = 'robber';
  else if (S.phase !== 'main' || !mine() || mode === 'robber') mode = null;
  renderTop(); renderBoard(); renderHand(); renderBar(); renderShelves();
}
function phaseText() {
  const who = P(S.current).name, you = mine();
  switch (S.phase) {
    case 'setup': return (you ? 'Your turn: place a ' : who + ' is placing a ') + S.setup.need;
    case 'roll': return you ? 'Your turn: roll the dice' : who + ' is rolling';
    case 'discard': return 'Waiting for discards: ' + S.discards.map(d => P(d.pi).name).join(', ');
    case 'robber': return you ? 'Tap a hex to move the robber' : who + ' is moving the robber';
    case 'main': return you ? 'Your turn: build, trade, or end' : who + "'s turn";
    case 'over': return `${P(S.winner).name} wins! 🏆`;
  }
}
function renderTop() {
  $('banner').textContent = phaseText(); $('banner').className = mine() ? 'me' : '';
  $('chips').innerHTML = S.players.map((p, i) => `<span class="chip${i === S.current ? ' turn' : ''}${S.online && !S.online[p.id] ? ' off' : ''}" style="--pc:${COLORS[p.color]}">${esc(p.name)} <b>${vp(S, i)}</b>🏆 ${count(p.hand)}🂠 ${p.knights}⚔️${S.largestArmy?.pi === i ? '🏅' : ''} ${longest(S, i)}🛣️${S.longestRoad?.pi === i ? '🏅' : ''}</span>`).join('');
}
function renderBoard() {
  const i = me(), out = [], hexPts = h => Array.from({ length: 6 }, (_, k) => { const a = Math.PI / 180 * (30 + 60 * k); return `${h.x + SIZE * Math.cos(a)},${h.y + SIZE * Math.sin(a)}`; }).join(' ');
  GEO.hexes.forEach((h, hi) => {
    const t = S.board.hexes[hi];
    out.push(`<polygon class="hex" points="${hexPts(h)}" fill="${TERRAIN[t.res]}"/>`);
    if (t.num) out.push(`<circle class="tok" cx="${h.x}" cy="${h.y}" r="3.6"/><text x="${h.x}" y="${h.y}" font-size="4.2" ${t.num === 6 || t.num === 8 ? 'fill="#c1272d"' : ''}>${t.num}</text>`);
    if (hi === S.board.robber) out.push(`<circle cx="${h.x + 4.5}" cy="${h.y - 3.5}" r="2.4" fill="#222" stroke="#fff" stroke-width=".4" pointer-events="none"/>`);
  });
  for (const pt of GEO.ports) {
    out.push(`<line x1="${pt.x}" y1="${pt.y}" x2="${GEO.V[pt.v[0]].x}" y2="${GEO.V[pt.v[0]].y}" stroke="#f6ecd2" stroke-width=".5" stroke-dasharray="1 1"/><line x1="${pt.x}" y1="${pt.y}" x2="${GEO.V[pt.v[1]].x}" y2="${GEO.V[pt.v[1]].y}" stroke="#f6ecd2" stroke-width=".5" stroke-dasharray="1 1"/>`);
    out.push(`<circle cx="${pt.x}" cy="${pt.y}" r="3.2" fill="#f6ecd2"/><text x="${pt.x}" y="${pt.y}" font-size="2.6">${pt.res === 'any' ? '3:1' : ICON[pt.res]}</text>`);
  }
  S.players.forEach(p => {
    const c = COLORS[p.color];
    for (const e of p.roads) { const [a, b] = GEO.E[e].v.map(v => GEO.V[v]); out.push(`<line class="road" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${c}"/>`); }
    for (const v of p.settlements) { const { x, y } = GEO.V[v]; out.push(`<polygon class="bld" points="${x - 2},${y + 2} ${x - 2},${y - .5} ${x},${y - 2.4} ${x + 2},${y - .5} ${x + 2},${y + 2}" fill="${c}"/>`); }
    for (const v of p.cities) { const { x, y } = GEO.V[v]; out.push(`<polygon class="bld" points="${x - 2.6},${y + 2.4} ${x - 2.6},${y - 1} ${x - 1},${y - 3} ${x + .6},${y - 1} ${x + 2.6},${y - 1} ${x + 2.6},${y + 2.4}" fill="${c}"/>`); }
  });
  if (mode === 'robber') GEO.hexes.forEach((h, hi) => hi !== S.board.robber && out.push(`<polygon class="tgt hx" points="${hexPts(h)}" data-h="${hi}"/>`));
  // ponytail: road targets are ~17px wide at phone width, under the 44px guideline; pinch-zoom covers it, widen if people mis-tap
  if (mode === 'road' && i >= 0 && (S.phase === 'setup' || S.phase === 'main')) for (const e of legalRoads(S, i)) {
    const [a, b] = GEO.E[e].v.map(v => GEO.V[v]);
    out.push(`<line class="tgt" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke-width="5" stroke-linecap="round" pointer-events="stroke" data-e="${e}"/>`);
  }
  if ((mode === 'settlement' || mode === 'city') && i >= 0) for (const v of (mode === 'city' ? legalCities : legalSettlements)(S, i)) out.push(`<circle class="tgt" cx="${GEO.V[v].x}" cy="${GEO.V[v].y}" r="3.2" data-v="${v}"/>`);
  $('board').innerHTML = out.join('');
}
$('board').addEventListener('click', async e => {
  const t = e.target.closest('[data-v],[data-e],[data-h]'); if (!t || !mine()) return;
  const id = t.dataset.v ?? t.dataset.e;
  if (t.dataset.h != null) {
    if (mode !== 'robber') return;
    const hex = +t.dataset.h, i = me();
    const victims = [...new Set(GEO.hexes[hex].v.map(v => owner(S, v)?.pi).filter(x => x != null && x !== i && count(P(x).hand) > 0))];
    const victim = victims.length > 1 ? await pick('Steal from', victims.map(v => [P(v).name, v])) : victims[0];
    if (victims.length > 1 && victim == null) return;
    return dispatch({ type: 'moveRobber', hex, victim });
  }
  dispatch(S.phase === 'setup' ? { type: 'place', kind: mode, id } : { type: 'build', kind: mode, id });
});
function renderHand() {
  const i = me(), h = i >= 0 ? P(i).hand : zero();
  $('hand').innerHTML = RESOURCES.map(r => `<div class="card ${r.toLowerCase()}"><span class="icon">${ICON[r]}</span><span class="count" id="c-${r}">${h[r]}</span></div>`).join('');
  $('total').textContent = count(h); $('total-wrap').classList.toggle('over', count(h) > 7);
  const dev = i >= 0 ? P(i).dev.length : 0; $('dev-n').textContent = dev; $('dev-n').hidden = !dev;
}
function renderBar() {
  const i = me(), p = i >= 0 ? P(i) : null, b = [], my = mine();
  const btn = (label, a, cls = '') => b.push(`<button data-a='${JSON.stringify(a)}' class="${cls}">${label}</button>`);
  if (S.dice) { const d = S.dice.join(''); if (d !== lastDice) { lastDice = d; ['d1', 'd2'].forEach(id => { $(id).classList.remove('tumble'); void $(id).offsetWidth; $(id).classList.add('tumble'); }); } $('d1').textContent = S.dice[0]; $('d2').textContent = S.dice[1]; $('sum').textContent = '= ' + (S.dice[0] + S.dice[1]); }
  $('status').textContent = S.phase === 'over' ? phaseText() : my ? '' : phaseText();
  const d = S.discards.find(d => d.pi === i);
  if (S.phase === 'discard' && d) btn(`Discard ${d.n} cards`, { ui: 'discard', n: d.n }, 'primary');
  if (S.trade && p) {
    const t = S.trade, txt = o => RESOURCES.filter(r => o[r]).map(r => o[r] + ICON[r]).join(' ');
    $('status').textContent = `${P(t.pi).name} offers ${txt(t.give)} for ${txt(t.get)}`;
    if (t.pi === i) btn('Cancel offer', { type: 'cancel' }); else btn('Accept trade', { type: 'accept' }, 'primary');
  }
  if (my && S.phase === 'roll') { btn('Roll 🎲', { type: 'roll' }, 'primary'); if (canPlayDev(S, i, 'Knight')) btn('⚔️ Knight first', { type: 'playDev', t: 'Knight' }); }
  if (my && S.phase === 'main') {
    const can = k => Object.entries(COST[k]).every(([r, q]) => p.hand[r] >= q);
    btn(`🛣️ Road${S.freeRoads ? ` (${S.freeRoads} free)` : ''}`, { ui: 'road' }, mode === 'road' ? 'on' : '');
    btn('🏠 Settle', { ui: 'settlement' }, mode === 'settlement' ? 'on' : '');
    btn('🏰 City', { ui: 'city' }, mode === 'city' ? 'on' : '');
    btn('🎴 Dev card', { type: 'buyDev' });
    btn('🔁 Trade', { ui: 'trade' });
    btn('End turn ➡️', { type: 'endTurn' }, 'primary');
    void can;
  }
  $('actions').innerHTML = b.join('');
}
$('actions').onclick = e => {
  const el = e.target.closest('button[data-a]'); if (!el) return;
  const a = JSON.parse(el.dataset.a);
  if (!a.ui) return dispatch(a);
  if (a.ui === 'discard') return cardDialog(`Discard ${a.n} cards`, { give: P(me()).hand, buttons: [{ label: 'Discard', run: g => dispatch({ type: 'discard', cards: g }) }] });
  if (a.ui === 'trade') { const i = me(), h = P(i).hand; return cardDialog('Trade', { give: h, get: true, buttons: [
    { label: 'Offer to players', run: (g, t) => dispatch({ type: 'offer', give: g, get: t }) },
    { label: 'Trade with bank', run: (g, t) => { const give = RESOURCES.filter(r => g[r]), get = RESOURCES.filter(r => t[r]); if (give.length !== 1 || get.length !== 1 || t[get[0]] !== 1 || g[give[0]] !== ratio(S, i, give[0])) return toast(`Bank trades: ${RESOURCES.map(r => ratio(S, i, r) + ICON[r]).join(' ')} for 1 card`, true); dispatch({ type: 'bankTrade', give: give[0], get: get[0] }); } }] }); }
  mode = mode === a.ui ? null : a.ui; renderBoard(); renderBar();
};

// ---------- dialogs ----------
function cardDialog(title, o) {
  const d = $('cards'), give = zero(), get = zero();
  const row = (side, r) => `<div class="crow"><span>${ICON[r]} ${r}${side === 'give' ? ` <small>(${o.give[r]})</small>` : ''}</span><button data-s="${side}" data-r="${r}" data-d="-1">−</button><b id="${side}-${r}">0</b><button data-s="${side}" data-r="${r}" data-d="1">+</button></div>`;
  d.innerHTML = `<div class="shelf-head"><h2>${title}</h2><button class="close">✕</button></div><div class="shelf-body">${o.give ? '<h3>Give</h3>' + RESOURCES.map(r => row('give', r)).join('') : ''}${o.get ? '<h3>Get</h3>' + RESOURCES.map(r => row('get', r)).join('') : ''}</div><div class="shelf-foot">${o.buttons.map((b, i) => `<button data-b="${i}" class="primary">${b.label}</button>`).join('')}</div>`;
  d.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.classList.contains('close') || e.target === d) return d.close();
    if (b.dataset.s) { const side = b.dataset.s, r = b.dataset.r, obj = side === 'give' ? give : get, max = side === 'give' ? o.give[r] : 19; obj[r] = Math.min(max, Math.max(0, obj[r] + +b.dataset.d)); $(side + '-' + r).textContent = obj[r]; return; }
    if (b.dataset.b) { d.close(); o.buttons[b.dataset.b].run(give, get); }
  };
  d.showModal();
}
function pick(title, options) { // options: [[label, value]] -> Promise<value|null>
  const d = $('pick');
  d.innerHTML = `<div class="shelf-head"><h2>${title}</h2><button class="close">✕</button></div><div class="shelf-body">${options.map(([l, v], i) => `<button data-i="${i}">${esc(l)}</button>`).join('')}</div>`;
  return new Promise(res => { d.onclick = e => { const b = e.target.closest('button'); if (!b) return; d.close(); res(b.dataset.i ? options[b.dataset.i][1] : null); }; d.onclose = () => res(null); d.showModal(); });
}
function renderShelves() {
  const i = me();
  $('devcards').innerHTML = i < 0 ? '' : P(i).dev.map((c, k) => `<div class="item"><span class="name">${ICON[c.t]} ${c.t}</span>${c.t === 'Victory Point' ? '<small>counts at 10</small>' : `<button data-dev="${k}" ${canPlayDev(S, i, c.t) && mine() && ['roll', 'main'].includes(S.phase) ? '' : 'disabled'}>Play</button>`}</div>`).join('') || '<p class="total">No dev cards yet</p>';
  $('players').innerHTML = S.players.map((p, k) => `<div class="player" style="--pc:${COLORS[p.color]}"><b>${esc(p.name)}</b> · ${vp(S, k)} VP · ${count(p.hand)} cards · ${p.dev.length} dev · ⚔️${p.knights} · 🛣️${longest(S, k)}<br><small>${LIMITS.road - p.roads.length} roads, ${LIMITS.settlement - p.settlements.length} settlements, ${LIMITS.city - p.cities.length} cities left</small></div>`).join('') + `<p class="total">Bank: ${RESOURCES.map(r => S.bank[r] + ICON[r]).join(' ')} · ${S.deck.length - S.deckIdx} dev</p>`;
  $('log').innerHTML = S.log.slice().reverse().map(l => `<li>${esc(l)}</li>`).join('');
}
$('devcards').onclick = async e => {
  const b = e.target.closest('button[data-dev]'); if (!b) return;
  const t = P(me()).dev[b.dataset.dev].t; $('dev-shelf').close();
  if (t === 'Monopoly') { const res = await pick('Take all of which resource?', RESOURCES.map(r => [ICON[r] + ' ' + r, r])); if (res) dispatch({ type: 'playDev', t, res }); }
  else if (t === 'Year of Plenty') cardDialog('Take 2 from the bank', { get: true, buttons: [{ label: 'Take', run: (g, t2) => { const l = RESOURCES.flatMap(r => Array(t2[r]).fill(r)); if (l.length !== 2) return toast('Pick exactly 2', true); dispatch({ type: 'playDev', t, a: l[0], b: l[1] }); } }] });
  else dispatch({ type: 'playDev', t });
};
document.querySelectorAll('.shelf').forEach(d => { d.querySelector('.close').onclick = () => d.close(); d.onclick = e => { if (e.target === d) d.close(); }; });
document.querySelectorAll('.sheet').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));
$('open-dev').onclick = () => $('dev-shelf').showModal();
$('open-log').onclick = () => $('log-shelf').showModal();

// ---------- boot ----------
net = await connect();
$('mode').textContent = net.presence.length ? '' : 'Local mode: no Firebase config yet, rooms only sync between tabs of this browser.';
if (code) {
  if (await net.exists(code)) { net.watch(code, s => { S = s; render(); }); net.presence(code, pid); }
  else { sessionStorage.removeItem('code'); code = ''; }
}
