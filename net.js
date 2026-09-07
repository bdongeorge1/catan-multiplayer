// net.js — room transport. Firebase Realtime Database when configured, else a same-browser
// localStorage fallback (handy for local dev with two tabs).
import { reduce, normalize } from './game.js';

// Paste your Firebase web-app config here (Console → Project settings → Your apps → SDK setup).
// It is public by design; the database rules are what protect the data.
export const FIREBASE = { apiKey: '', authDomain: '', databaseURL: '', projectId: '' };

export async function connect() { return FIREBASE.databaseURL ? firebase() : local(); }

async function firebase() {
  const V = '10.12.5';
  const { initializeApp } = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`);
  const { getDatabase, ref, set, get, onValue, runTransaction, onDisconnect } = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-database.js`);
  const db = getDatabase(initializeApp(FIREBASE)), room = code => ref(db, 'rooms/' + code);
  return {
    create: s => set(room(s.code), s),
    exists: async code => (await get(room(code))).exists(),
    watch: (code, cb) => onValue(room(code), snap => snap.exists() && cb(normalize(snap.val()))),
    async send(code, action) {
      let err; // reduce() throws readable rule errors; surface them instead of letting the SDK swallow them
      await runTransaction(room(code), cur => { if (cur == null) return cur; try { return reduce(cur, action); } catch (e) { err = e; } }, { applyLocally: false });
      if (err) throw err;
    },
    presence(code, pid) { const r = ref(db, `rooms/${code}/online/${pid}`); set(r, true); onDisconnect(r).remove(); },
  };
}

function local() {
  const key = c => 'room:' + c, read = c => JSON.parse(localStorage.getItem(key(c)) || 'null');
  let cb; // storage events fire in other tabs with the new value attached (a BroadcastChannel can beat the storage cache)
  const write = (c, s) => { localStorage.setItem(key(c), JSON.stringify(s)); cb?.(normalize(structuredClone(s))); };
  return {
    create: async s => write(s.code, s),
    exists: async c => !!read(c),
    watch(c, f) { cb = f; addEventListener('storage', e => e.key === key(c) && e.newValue && cb(normalize(JSON.parse(e.newValue)))); const s = read(c); if (s) cb(normalize(s)); },
    send: async (c, a) => write(c, reduce(read(c), a)),
    presence() {},
  };
}
