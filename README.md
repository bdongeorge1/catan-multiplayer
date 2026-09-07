# Catan Multiplayer

Full digital Catan for a few friends: one person creates a room, shares the 4-letter code, everyone plays on their phone. Static site, no accounts, no server. Live sync through Firebase Realtime Database (free Spark tier).

## Files

| File | Role |
|---|---|
| `game.js` | Pure rules engine. `reduce(state, action)` returns the next state or throws a readable error. Runs in Node for tests. |
| `net.js` | Transport. Firebase RTDB when configured, otherwise a same-browser localStorage fallback for local dev. |
| `ui.js` + `index.html` | SVG board, hand, action bar, shelves. Renders from state; every tap dispatches an action. |
| `test.js` | Rules tests. `node test.js` |

## One-time Firebase setup

1. Go to https://console.firebase.google.com and add a project (Analytics off is fine).
2. Build → Realtime Database → Create database → start in **locked mode**.
3. Rules tab → paste the contents of `database.rules.json` → Publish. Rooms are readable by anyone with the code and become read-only 24 hours after creation.
4. Project settings (gear) → Your apps → Web app (`</>`) → register → copy the `firebaseConfig` object.
5. Paste `apiKey`, `authDomain`, `databaseURL`, `projectId` into `FIREBASE` at the top of `net.js`. Commit and push.

Until `databaseURL` is filled in, the app runs in local mode: rooms only sync between tabs of the same browser (useful for development).

## Running locally

```
python3 -m http.server 8765
```
Open http://localhost:8765 in two tabs, create a room in one, join from the other.

## Trust model

No accounts, so hands are technically readable in the database by anyone holding the room code. Fine for a friends game. Firebase config in `net.js` is public by design; the database rules are the protection.

## Rules implemented

Standard 3–4 player board (fixed beginner layout), snake setup with second-settlement payout, dice with bank limits, robber with discard/steal, roads/settlements/cities with piece limits and distance rule, 25-card dev deck (one play per turn, not on the turn bought, VP hidden until win), longest road (≥5, broken by opponent buildings), largest army (≥3), bank trades 4:1 and 3:1 / 2:1 ports, player trade offers, win at 10 VP on your own turn. Up to 6 players.

Not yet: random board, turn timer, spectators, hidden hands via auth.
