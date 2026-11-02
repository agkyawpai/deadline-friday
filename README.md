# 🔥 Deadline: Friday 5PM

A lightweight multiplayer **IT corporate chaos** game for 1–6 players (3D in the browser). Play online or on a LAN.
Ship the "AI-powered Blockchain Food Delivery Super-App" by Friday 5PM while the office falls apart.

**▶ Play: https://deadline-friday.vercel.app** — create an office, share the room code, and press Start Sprint.

Every push to `main` auto-deploys to Vercel.

## Run (LAN)

```bash
npm install
npm start
```

The server prints the URLs:

```
Local:   http://localhost:3000
LAN:     http://192.168.x.x:3000   <- teammates open this one
```

- Teammates on the same WiFi/LAN open the `LAN` URL in a browser (PC or phone).
- The first player to join is the **HOST** and presses **Start Sprint**.
- On first run, Windows Firewall may ask for permission. Allow **Private networks**.
- Change the port with `PORT=4000 npm start` (PowerShell: `$env:PORT=4000; npm start`).
- Quick test (short days): `DAY_MS=15000 npm start`.

## Deploy online (Vercel + Upstash Redis)

```bash
vercel login
vercel --yes                 # first deploy, creates the project
# Vercel dashboard -> project -> Storage -> Create Database -> Upstash for Redis
#   region: Singapore (ap-southeast-1), connect to the project (all environments)
vercel deploy --prod --yes   # redeploy so the env vars are picked up
```

- `public/` is served as static files, and `api/sync.js` (a Vercel Function, region `sin1`) is the only API.
- Room state is stored in Redis as `df:room:<CODE>` (`<version>|<json>`), player inputs as `df:in:<CODE>` (hash), and the tick lock as `df:tick:<CODE>` (100 ms). Keys expire after 2 hours.
- Accepted env vars: `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`, or `KV_REST_API_URL` + `KV_REST_API_TOKEN` (the names the Vercel Marketplace integration sets).
- To test locally against the same Redis: `vercel env pull .env.local`, then start `npm start` with those env vars.
- Cost estimate: each client syncs 5 times/s during play, with about 4–5 Redis commands per sync, so one 6-player match is roughly 60–90K commands. Check the Upstash free-tier limit.

## How to play

| Control | PC | Phone |
|---|---|---|
| Move | WASD / arrow keys / click the floor | Tap the floor |
| Interact (yellow ring) | `E` / `Space` | Big yellow button |
| Role ability | `Q` | Blue button |
| Secret action (agenda) | `F` | Purple button |
| Sprint Board | `B` | 📋 Board (top right) |
| Slack chat | `Enter` | 💬 (top right) |
| Emote | `1`–`5` | Bottom buttons |

**1 match ≈ 12 minutes.** The yellow hint bar at the top always tells you what to do next.

### A day in the office
| Phase | What happens |
|---|---|
| 🌅 Morning standup | Today's theme and new tickets. Claim one |
| 💻 Work | Tickets move through **Dev → Review → QA → Demo → Done** (desk → Sprint Board → QA lab → sales desk) |
| 🗳️ Midday meeting | Mon/Wed: a client decision vote. Tue/Thu: a **PIP vote** (the most-voted player loses their ability, secret action and coding speed until tomorrow) |
| 🌙 Evening | Tickets shipped today, overdue penalties, and on Wednesday the client demo result |

| Day | Theme |
|---|---|
| Mon | 📋 Planning: 2 tickets, bonus-feature decision |
| Tue | 💻 Build: 2 tickets, PIP vote |
| Wed | 🎤 Client Demo: ship at least one ticket today or lose client −15. "AI everything?" decision |
| Thu | 🧊 Code Freeze: no new tickets, PIP vote |
| Fri | 🚀 Deploy: in the afternoon everyone must **hold** the glowing stations (server, board, QA, phone) at the same time |

Then comes the 💰 **Peer Review**: everyone gives 10 bonus points to teammates and blames one person. The results screen reveals the **true git log**.

### Roles (random; with fewer players the stage falls back to "anyone")
| Role | Job in the pipeline | Ability (Q) |
|---|---|---|
| 🧙 Senior Dev | Codes ×1.6 (only after coffee) | Refactor: halves bugs on open tickets, −40% prod bugs |
| 🐣 Junior Dev | Codes ×0.9, many hidden bugs | Ask AI: 50% big progress / 50% secretly adds bugs |
| 🔍 QA Tester | Tests tickets (squash every 🐛, avoid 🦋) | Git Blame: privately reveals who did the latest suspicious action |
| 🧭 Team Leader | Reviews tickets (spot the buggy line) | Review Mode: no new bugs for 15s |
| 💼 Sales | Demos tickets to the client (timing game) | Promise Feature: client +18, +1 ticket |
| 👔 Manager | Backup reviewer/demoer | Emergency All-hands: instant PIP vote (once a day) |

A ticket left waiting **20s** in Review/QA/Demo escalates, and then **anyone** can do that step. Stalling is suspicious!

### Secret agendas and sabotage
| Agenda | Win | Secret action (F) |
|---|---|---|
| 🕵️ Job Hunter (4+ players, max 1) | The project does NOT ship | Inject hidden bugs, or unplug the server during the deploy |
| Promotion Hunter | Most peer-review bonus points | Steal the dev credit of a finished ticket |
| Blame Master | The person you blame ends up most blamed (not you) | Plant fake evidence on the nearest teammate |
| Work-Life / Coffee / Bug Collector | Exit door on 3 days / 8 coffees / 15 bugs | — |

Every sabotage posts a partial clue (time, place, and a colour or role a witness saw) in **#git-log**. Frames look exactly like real sabotage.

### Chaos events
🔥 Production Down (server on fire), 📞 client call, 🪟 forced OS update, 📶 WiFi down (Slack offline!), 👴 CEO visit, 🍕 free pizza, ☕💥 coffee machine broken, 💥 `git push --force`.

### Endings
🏆 Shipped · 🔥 Shipped half-baked · 📉 Not enough features · 💥 Deploy failed · ❌ Project cancelled · 🚪 Mass resignation

## Tech
- **Three.js** (low-poly, all procedural geometry, no model files) + **GSAP** for UI animation (both vendored in `public/vendor/`)
- **HTTP sync**: each client POSTs `/api/sync` about 5 times/s with its position and unacknowledged actions. Whichever request holds the 100 ms lock advances the game (`step`) and saves it with a compare-and-set
- Movement is client-predicted. Rooms use 4-letter codes, and reloading the page rejoins the same room (player id is kept in localStorage)
- Tiny WebAudio beeps instead of audio files. Total client download ≈ 800 KB
- UI language: English / မြန်မာ toggle (top right)

## Files
```
lib/game.js          game rules, events, phases (pure; tuning constants at the top)
lib/store.js         room storage: memory (LAN) or Upstash Redis (lock + Lua CAS)
lib/handler.js       /api/sync request handling (shared by LAN and Vercel)
api/sync.js          Vercel Function entry
server.js            LAN server (Express, memory store)
public/world.json    office layout shared by server and client
public/js/net.js     client sync loop
public/js/main.js    client: input, movement, HUD, phase screens, sound
public/js/scene.js   Three.js office, characters, effects
public/js/minigames.js  code / bug hunt / mash / phone / coffee minigames
public/js/i18n.js    EN + MM text
```
