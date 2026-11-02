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
| Sabotage (Job Hunter only) | `F` | Purple button |
| Sprint Board | `B` | 📋 Board (top right) |
| Slack chat | `Enter` | 💬 (top right) |
| Emote | `1`–`5` | Bottom buttons |

The game UI is in Myanmar only. The in-game **📖 ကစားနည်း** page is the rule book.
**1 match ≈ 10 minutes.** The yellow hint bar at the top always tells you what to do next.

### The 3 rules
1. **A ticket is done when it's coded, then tested by someone other than its author.**
2. **On Friday afternoon everyone deploys together** (hold the 4 glowing stations: server, board, QA, phone).
3. **One player is a secret Job Hunter. Find them and vote.**

### Winning
| You are | You win if |
|---|---|
| 👷 Employee | The team **ships**: Friday deploy succeeds and ≥40% of tickets are done |
| 🕵️ Job Hunter (always one, could be a bot) | The team does **not** ship |

The project is cancelled immediately if client happiness hits 0.

### A day
🌅 Morning: claim tickets → 💻 work → 🗳️ midday vote "who is the Job Hunter?" → 💻 work → 🌙 evening summary.
In the vote, a player with **2+ votes** is caught. If they are the Job Hunter, they can no longer sabotage 🎉. If they are innocent, they get a PIP (ability off until tomorrow) 😬.

### Roles (Q)
| Role | Ability |
|---|---|
| 🧙 Senior Dev | Codes fast. Refactor: halves hidden bugs on open tickets |
| 🐣 Junior Dev | Ask AI: 50% big progress / 50% extra hidden bugs |
| 🔍 QA Tester | Tests ×2. Git Blame: privately reveals who did the latest sabotage |
| 🧭 Team Leader | Emergency Meeting: instant vote (once a day) |

### Sabotage and clues
The Job Hunter (`F`) injects hidden bugs into tickets, or unplugs the server during the deploy. Each sabotage posts a clue in **#git-log**: the saboteur's colour, their role, or nothing. The results screen reveals the true git log.

### Events
🔥 Server fire (put it out) · 📞 Client call (answer it) · 👴 CEO visit (be at a desk) · ☕ coffee / 🍕 pizza = ⚡ a short speed boost.

### Bots
With fewer than 4 people, smart bots fill the team. They path around the office, test other people's tickets, track suspicion from #git-log clues, Git Blame results and Slack accusations, talk in Slack, and vote. A bot can be the Job Hunter, in which case it sabotages when nobody is near and lies about it.

### Endings
🏆 Shipped · 🔥 Shipped half-baked · 📉 Not enough features · 💥 Deploy failed · ❌ Project cancelled

The previous "advanced" ruleset (v0.3: review/demo stages, 6 agendas, peer review…) is in git history at `802b851`.

## Tech
- **Three.js** (low-poly, all procedural geometry, no model files) + **GSAP** for UI animation (both vendored in `public/vendor/`)
- **HTTP sync**: each client POSTs `/api/sync` about 5 times/s with its position and unacknowledged actions. Whichever request holds the 100 ms lock advances the game (`step`) and saves it with a compare-and-set
- Movement is client-predicted. Rooms use 4-letter codes, and reloading the page rejoins the same room (player id is kept in localStorage)
- Tiny WebAudio beeps instead of audio files. Total client download ≈ 800 KB
- UI language: English / မြန်မာ toggle (top right)

## Files
```
lib/game.js          game rules, events, phases (pure; tuning constants at the top)
lib/bots.js          server-side bots: pathfinding, planner, suspicion model, Slack talk
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
