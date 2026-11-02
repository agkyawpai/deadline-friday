'use strict';
// Pure game rules (Simple version). A room is a plain JSON object so it can live in memory (LAN) or in Redis (Vercel).
// Everything is driven by step(room, inputs, now): apply each client's queued actions, run bots, then advance time.
//
// Rules in one breath: tickets go Code → Test (not by its author) → Done. Friday afternoon everyone holds a station
// to deploy. One Job Hunter secretly sabotages; each midday the team votes on who it is.
// Team wins if it ships (deploy succeeds + ≥40% tickets done). The Job Hunter wins if it doesn't.
const WORLD = require('../public/world.json');

const env = (k, d) => Number(process.env[k]) || d;
const HALF_MS = env('HALF_MS', 45000); // one half of a work day; HALF_MS=10000 for quick testing
const BRIEFING_MS = env('BRIEFING_MS', 12000);
const MORNING_MS = env('MORNING_MS', 10000);
const MEETING_MS = env('MEETING_MS', 25000);
const DEPLOY_MS = env('DEPLOY_MS', 50000);
const EVENING_MS = 6000;
const STALE_MS = 20000; // no sync for this long => player left
const MAX_PLAYERS = 6;
const DAYS = 5;
const INTERACT_RANGE = 2.4;

const COLORS = ['#ff6b6b', '#4dabf7', '#51cf66', '#fcc419', '#cc5de8', '#ff922b'];
const ROLE_ORDER = ['senior', 'qa', 'junior', 'leader', 'junior', 'senior'];
const COOLDOWN = { senior: 40000, junior: 20000, qa: 30000, leader: 60000 };
const SECRET_CD = 30000;
const CODE_MULT = { senior: 1.5, junior: 1, qa: 0.8, leader: 1.1 };
const BUG_CHANCE = { senior: 0.12, junior: 0.4, qa: 0.2, leader: 0.2 };
const TICKET_POOL = ['login', 'payment', 'chatbot', 'darkmode', 'nft', 'map', 'push', 'search', 'loyalty', 'reviews', 'referral', 'export'];
const NEW_TICKETS = { 1: 3, 2: 2, 3: 2, 4: 1, 5: 0 };
const DEPLOY_STATIONS = ['server', 'board', 'qa', 'phone'];
const BOOST_COFFEE_MS = 20000;
const BOOST_PIZZA_MS = 30000;
const STATION = Object.fromEntries(WORLD.stations.map((s) => [s.id, s]));

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function newGame() {
  return {
    phase: 'lobby', day: 0, phaseStart: 0, phaseMs: 0,
    happiness: 70, tickets: [], nextTicket: 1, pool: [],
    fire: null, phone: null, ceoUntil: 0, pizzaUntil: 0, pizzaId: 0, nextEventAt: 0,
    middayDone: false, meeting: null, resume: null, deploy: null, deployed: false, emergencyDay: 0,
    log: [], doneToday: 0, summary: null, ending: null, results: null,
  };
}

function freshStats() {
  return {
    cdUntil: 0, secretUntil: 0, pipDay: 0, pipNext: false, caught: false, boostUntil: 0,
    contribution: 0, hold: null, lastTask: 0, lastQa: 0, lastCoffee: 0, lastFix: 0, lastEmote: 0, lastChat: 0, pizzaToken: -1,
  };
}

function createRoom(code, now) {
  return { code, lastTick: now, evSeq: 0, events: [], players: {}, lastSeq: {}, g: newGame() };
}

// ---------- Events (delivered to clients by seq) ----------
function push(room, ev) {
  ev.seq = ++room.evSeq;
  room.events.push(ev);
  if (room.events.length > 150) room.events.shift();
}
const fx = (room, key, params = {}, kind = 'info') => push(room, { t: 'fx', key, params, kind });
const tell = (room, pid, t, data) => push(room, { t, to: pid, ...data });
const gitBot = (room, key, params = {}, to) => push(room, { t: 'chat', ch: 'git', key, params, ...(to ? { to } : {}) });

// ---------- Helpers ----------
const list = (room) => Object.values(room.players);
const frozenReason = () => null; // kept for the bot API; nothing freezes players in the simple rules
function near(p, station, range = INTERACT_RANGE) {
  const s = STATION[station];
  return Math.hypot(p.x - s.x, p.z - s.z) <= range;
}
const nearAnyDesk = (p) => WORLD.stations.some((s) => s.type === 'desk' && Math.hypot(p.x - s.x, p.z - s.z) <= INTERACT_RANGE);
function nearestPlace(p) {
  let best = 'desk';
  let bestD = Infinity;
  for (const s of WORLD.stations) {
    const d = Math.hypot(p.x - s.x, p.z - s.z);
    if (d < bestD) { bestD = d; best = s.type; }
  }
  return best;
}
function teleport(p, x, z) {
  p.x = x;
  p.z = z;
  p.tp = (p.tp || 0) + 1; // client adopts this position once it sees a new tp number
}
function setPhase(g, phase, ms, now) {
  g.phase = phase;
  g.phaseStart = now;
  g.phaseMs = ms;
}
const isPip = (room, p) => p.pipDay === room.g.day;
const canTest = (p, t) => t.owner !== p.id; // someone else has to test your code
function clockHours(g, now) {
  const span = g.day === DAYS ? 8 : 9;
  let frac = 0;
  if (g.phase === 'playing') frac = (now - g.phaseStart) / (2 * HALF_MS);
  else if (g.phase === 'meeting' && g.resume) frac = g.resume.elapsed / (2 * HALF_MS);
  else if (g.phase === 'deploy') frac = 0.5 + ((now - g.phaseStart) / DEPLOY_MS) * 0.5;
  else if (g.phase === 'evening' || g.phase === 'results') frac = 1;
  return 9 + clamp(frac, 0, 1) * span;
}
const clockStr = (g, now) => {
  const h = clockHours(g, now);
  return `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
};

// ---------- Tickets ----------
function addTicket(room) {
  const g = room.g;
  if (!g.pool.length) g.pool = shuffle(TICKET_POOL.slice());
  const n = Math.max(1, list(room).length);
  const t = { id: g.nextTicket++, key: g.pool.pop(), stage: 'todo', work: Math.round(5 + 1.5 * n), progress: 0, bugs: 0, owner: null, credits: {}, day: g.day };
  g.tickets.push(t);
  return t;
}
const findTicket = (g, id) => g.tickets.find((t) => t.id === Number(id));
function advance(room, t, stage, p) {
  t.stage = stage;
  gitBot(room, 'git_stage', { ticket: `@tk_${t.key}`, stage: `@stage_${stage}`, name: p.name });
}

// ---------- Players ----------
function addPlayer(room, pid, name) {
  if (room.players[pid]) return;
  const g = room.g;
  if (list(room).length >= MAX_PLAYERS) return tell(room, pid, 'denied', { key: 'full' });
  if (g.phase !== 'lobby') return tell(room, pid, 'denied', { key: 'inProgress' });
  const used = new Set(list(room).map((p) => p.color));
  const clean = String(name || '').replace(/[<>]/g, '').trim().slice(0, 14) || `Player ${list(room).length + 1}`;
  room.players[pid] = {
    id: pid, name: clean, color: COLORS.find((c) => !used.has(c)) || COLORS[0],
    isHost: list(room).length === 0, role: null, agenda: null,
    x: rand(0, 4), z: rand(3.5, 6), face: 0, moving: false, tp: 1,
    ...freshStats(),
  };
}

function removePlayer(room, pid, now) {
  const p = room.players[pid];
  if (!p) return;
  delete room.players[pid];
  delete room.lastSeq[pid];
  const humans = list(room).filter((q) => !q.bot);
  if (p.isHost && humans.length) humans[0].isHost = true;
  if (!humans.length) { room.players = {}; room.g = newGame(); return; } // bots don't play alone
  for (const t of room.g.tickets) if (t.owner === pid) t.owner = null;
  if (room.g.phase === 'meeting' && list(room).every((q) => room.g.meeting.votes[q.id] !== undefined)) finishMeeting(room, now);
}

// ---------- Phases ----------
function startGame(room, now) {
  bots.fill(room, now); // fewer than 4 people → bots join (and one of them may be the Job Hunter)
  const players = shuffle(list(room));
  const n = players.length;
  room.g = newGame();
  const roles = shuffle(ROLE_ORDER.slice(0, n));
  const jobHunter = n >= 3 ? Math.floor(Math.random() * n) : -1;
  players.forEach((p, i) => {
    Object.assign(p, freshStats());
    p.role = roles[i];
    p.agenda = i === jobHunter ? 'jobhunt' : 'team';
    const a = (i / n) * Math.PI * 2;
    teleport(p, 2 + Math.cos(a) * 1.6, 4.5 + Math.sin(a) * 1.2);
  });
  setPhase(room.g, 'briefing', BRIEFING_MS, now);
}

function startMorning(room, day, now) {
  const g = room.g;
  g.day = day;
  g.doneToday = 0;
  g.middayDone = false;
  for (let i = 0; i < NEW_TICKETS[day]; i++) addTicket(room);
  setPhase(g, 'morning', MORNING_MS, now);
}

function startWork(room, now) {
  const g = room.g;
  setPhase(g, 'playing', g.day === DAYS ? HALF_MS : 2 * HALF_MS, now);
  g.nextEventAt = now + (g.day === 1 ? 15000 : 8000);
}

function seatAtMeeting(room) {
  const m = STATION.meeting;
  const players = list(room);
  players.forEach((q, i) => {
    const a = (i / players.length) * Math.PI * 2;
    teleport(q, m.x + Math.cos(a) * 2.3, m.z + Math.sin(a) * 1.6);
  });
}

// "Who is the Job Hunter?" vote. Called at midday (Mon–Thu) or by the Team Leader's emergency ability.
function startMeeting(room, now, by) {
  const g = room.g;
  g.resume = { elapsed: now - g.phaseStart, phaseMs: g.phaseMs, at: now };
  g.meeting = { by: by || null, votes: {} };
  seatAtMeeting(room);
  setPhase(g, 'meeting', MEETING_MS, now);
  fx(room, by ? 'ev_emergency' : 'ev_meeting', { name: by || '' }, 'chaos');
}

function finishMeeting(room, now) {
  const g = room.g;
  const m = g.meeting;
  const players = list(room);
  const counts = {};
  for (const p of players) {
    const v = m.votes[p.id];
    if (v && v !== 'skip' && room.players[v]) counts[v] = (counts[v] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (sorted.length && sorted[0][1] >= 2 && (!sorted[1] || sorted[1][1] < sorted[0][1])) {
    const target = room.players[sorted[0][0]];
    if (target.agenda === 'jobhunt') {
      target.caught = true; // no more sabotage, no more ability
      g.happiness = clamp(g.happiness + 10, 0, 100);
      fx(room, 'mt_caught', { name: target.name, n: sorted[0][1] }, 'good');
    } else {
      target.pipDay = g.day;
      target.pipNext = true; // rest of today and all of tomorrow
      fx(room, 'mt_innocent', { name: target.name, n: sorted[0][1] }, 'bad');
    }
  } else {
    fx(room, 'mt_nobody', {}, 'info');
  }
  // Resume the work day where it paused, and shift timers so the meeting didn't eat into them.
  const shift = now - g.resume.at;
  for (const k of ['ceoUntil', 'pizzaUntil', 'nextEventAt']) if (g[k]) g[k] += shift;
  if (g.phone) g.phone.until += shift;
  setPhase(g, 'playing', g.resume.phaseMs, now - g.resume.elapsed);
  g.meeting = null;
  g.resume = null;
}

function startDeploy(room, now) {
  const g = room.g;
  g.deploy = { progress: 0, occupied: [], need: Math.min(list(room).length, DEPLOY_STATIONS.length) };
  setPhase(g, 'deploy', DEPLOY_MS, now);
  fx(room, 'ev_deploy', {}, 'chaos');
}

function endDay(room, now) {
  const g = room.g;
  for (const p of list(room)) if (p.pipNext) { p.pipDay = g.day + 1; p.pipNext = false; }
  g.summary = { day: g.day, doneToday: g.doneToday };
  g.fire = null; g.phone = null; g.ceoUntil = 0; g.pizzaUntil = 0; // overnight the ops team cleans up
  setPhase(g, 'evening', EVENING_MS, now);
}

function computeEnding(room) {
  const g = room.g;
  const done = g.tickets.filter((t) => t.stage === 'done').length;
  const ratio = g.tickets.length ? done / g.tickets.length : 0;
  if (g.happiness <= 0) return 'cancelled';
  if (!g.deployed) return 'deployfail';
  if (ratio >= 0.7) return 'shipped';
  if (ratio >= 0.4) return 'onfire';
  return 'missed';
}

function endGame(room, now) {
  const g = room.g;
  g.ending = computeEnding(room);
  const shipped = g.ending === 'shipped' || g.ending === 'onfire';
  const players = list(room);
  g.results = {
    ending: g.ending, shipped, done: g.tickets.filter((t) => t.stage === 'done').length, total: g.tickets.length,
    log: g.log.map((e) => ({ id: e.id, time: e.time, act: e.act, actor: room.players[e.actor]?.name || '?' })),
    players: players.map((p) => ({
      id: p.id, name: p.name, color: p.color, role: p.role, agenda: p.agenda, bot: !!p.bot, caught: p.caught,
      won: p.agenda === 'jobhunt' ? !shipped : shipped, contribution: Math.round(p.contribution * 10) / 10,
    })),
  };
  g.deploy = null;
  setPhase(g, 'results', 0, now);
}

// ---------- Chaos events ----------
function triggerEvent(room, now) {
  const g = room.g;
  const players = list(room);
  const pool = [];
  if (!g.fire) pool.push(['fire', 3]);
  if (!g.phone && g.phase === 'playing') pool.push(['phone', 4]);
  if (!g.ceoUntil && g.phase === 'playing') pool.push(['ceo', 2]);
  if (g.pizzaUntil < now && g.phase === 'playing') pool.push(['pizza', 2]);
  if (!pool.length) return;
  const total = pool.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  let type = pool[0][0];
  for (const [t, w] of pool) { if ((r -= w) <= 0) { type = t; break; } }

  switch (type) {
    case 'fire': {
      const hp = 20 + 8 * players.length;
      g.fire = { hp, max: hp };
      fx(room, 'ev_fire', {}, 'chaos');
      break;
    }
    case 'phone':
      g.phone = { until: now + 15000, q: Math.floor(Math.random() * 4) };
      fx(room, 'ev_phone', {}, 'chaos');
      break;
    case 'ceo':
      g.ceoUntil = now + 12000;
      fx(room, 'ev_ceo', {}, 'chaos');
      break;
    case 'pizza':
      g.pizzaUntil = now + 15000;
      g.pizzaId++;
      fx(room, 'ev_pizza', {}, 'good');
      break;
  }
}

function chaosTick(room, dt, now) {
  const g = room.g;
  const players = list(room);
  if (g.fire) {
    g.happiness -= 0.5 * dt;
    if (g.deploy) g.deploy.progress = Math.max(0, g.deploy.progress - dt);
  }
  g.happiness -= 0.1 * dt;
  if (g.phone && now >= g.phone.until) {
    g.phone = null;
    g.happiness -= 10;
    fx(room, 'ev_phoneMissed', {}, 'bad');
  }
  if (g.ceoUntil && now >= g.ceoUntil) {
    g.ceoUntil = 0;
    const slackers = players.filter((p) => !nearAnyDesk(p));
    g.happiness -= 5 * slackers.length;
    if (slackers.length) fx(room, 'ev_ceoEnd', { names: slackers.map((p) => p.name).join(', ') }, 'bad');
    else fx(room, 'ev_ceoGood', {}, 'good');
  }
  g.happiness = clamp(g.happiness, 0, 100);
  if (now >= g.nextEventAt) {
    triggerEvent(room, now);
    g.nextEventAt = now + rand(15000, 25000);
  }
}

function updatePlaying(room, dt, now) {
  const g = room.g;
  chaosTick(room, dt, now);
  if (g.happiness <= 0) return endGame(room, now);
  const elapsed = now - g.phaseStart;
  if (g.day < DAYS && !g.middayDone && elapsed >= HALF_MS) {
    g.middayDone = true;
    return startMeeting(room, now);
  }
  if (g.day === DAYS && elapsed >= HALF_MS) return startDeploy(room, now);
  if (elapsed >= g.phaseMs) endDay(room, now);
}

function updateDeploy(room, dt, now) {
  const g = room.g;
  chaosTick(room, dt, now);
  if (g.happiness <= 0) return endGame(room, now);
  const players = list(room);
  const occupied = DEPLOY_STATIONS.filter((st) => players.some((p) => p.hold === st && near(p, st)));
  const need = g.deploy.need;
  // All stations held ≈ 22s; one missing still makes it (≈ 30s of 50, plus walking); two missing usually doesn't.
  const rate = 4.5 * Math.min(1, occupied.length / need);
  g.deploy.progress = clamp(g.deploy.progress + rate * dt, 0, 100);
  g.deploy.occupied = occupied;
  if (g.deploy.progress >= 100) {
    g.deployed = true;
    fx(room, 'ev_deployed', {}, 'good');
    return endGame(room, now);
  }
  if (now >= g.phaseStart + g.phaseMs) {
    fx(room, 'ev_deployFailed', {}, 'bad');
    endGame(room, now);
  }
}

// ---------- Sabotage & evidence ----------
const COLOR_EMOJI = { '#ff6b6b': '🔴', '#4dabf7': '🔵', '#51cf66': '🟢', '#fcc419': '🟡', '#cc5de8': '🟣', '#ff922b': '🟠' };
const ROLE_ICON = { leader: '🧭', senior: '🧙', junior: '🐣', qa: '🔍' };

// Every sabotage leaves a partial clue in #git-log: usually the saboteur's colour, sometimes their role, sometimes nothing.
function logSabotage(room, actor, act, place) {
  const g = room.g;
  const r = Math.random();
  const clue = r < 0.5 ? COLOR_EMOJI[actor.color] || '❓' : r < 0.8 ? ROLE_ICON[actor.role] || '❓' : '❓';
  const entry = { id: g.log.length + 1, time: clockStr(g, Date.now()), act, actor: actor.id, blamed: false };
  g.log.push(entry);
  gitBot(room, 'git_sus', { id: entry.id, time: entry.time, act: `@gitact_${act}`, place: `@place_${place}`, clue });
}

function handleSecret(room, p, now) {
  const g = room.g;
  if (p.agenda !== 'jobhunt' || p.caught || p.secretUntil > now || isPip(room, p)) return;
  if (g.phase === 'deploy') {
    if (!near(p, 'server')) return tell(room, p.id, 'fx', { key: 'sec_needServer', params: {}, kind: 'info' });
    g.deploy.progress = Math.max(0, g.deploy.progress - 15);
    logSabotage(room, p, 'unplug', 'server');
  } else {
    const targets = g.tickets.filter((t) => t.stage === 'dev' || t.stage === 'qa');
    if (!targets.length) return tell(room, p.id, 'fx', { key: 'sec_nothing', params: {}, kind: 'info' });
    pick(targets).bugs += 3;
    logSabotage(room, p, 'inject', nearestPlace(p));
  }
  p.secretUntil = now + SECRET_CD;
  tell(room, p.id, 'fx', { key: 'sec_done', params: {}, kind: 'info' });
}

// ---------- Player actions ----------
// `ct` is the client's Date.now() when it queued the action; actions arrive in batches, so rate limits use it.
function handleTask(room, p, m, now) {
  const g = room.g;
  const ct = Number(m.ct) || now;
  switch (m.kind) {
    case 'code': {
      const t = findTicket(g, m.ticket);
      if (!t || t.stage !== 'dev' || !nearAnyDesk(p) || ct - p.lastTask < 600) return;
      p.lastTask = ct;
      if (m.ok === false) return;
      let amt = CODE_MULT[p.role] ?? 1;
      if (p.boostUntil > now) amt *= 1.5;
      if (isPip(room, p)) amt *= 0.7;
      if (!t.owner) t.owner = p.id;
      t.progress = Math.min(t.work, t.progress + amt);
      p.contribution += amt;
      if (Math.random() < (BUG_CHANCE[p.role] ?? 0.25)) t.bugs++; // hidden until someone tests it
      tell(room, p.id, 'codeResult', { amt: Math.round(amt * 10) / 10 });
      if (t.progress >= t.work) {
        t.credits.code = room.players[t.owner]?.name || p.name;
        advance(room, t, 'qa', p);
      }
      break;
    }
    case 'qa': {
      const t = findTicket(g, m.ticket);
      if (!t || t.stage !== 'qa' || !near(p, 'qa') || !canTest(p, t) || ct - p.lastQa < 3000) return;
      p.lastQa = ct;
      const per = p.role === 'qa' ? 2 : 1;
      const squashed = Math.min(t.bugs, clamp(Math.floor(Number(m.count) || 0), 0, 20) * per);
      t.bugs -= squashed;
      p.contribution += squashed * 0.5 + 1;
      tell(room, p.id, 'qaResult', { squashed, left: t.bugs });
      if (t.bugs === 0) {
        t.credits.test = p.name;
        g.doneToday++;
        g.happiness = clamp(g.happiness + 6, 0, 100);
        advance(room, t, 'done', p);
        fx(room, 'ev_ticketDone', { ticket: `@tk_${t.key}` }, 'good');
      }
      break;
    }
    case 'coffee': {
      if (!near(p, 'coffee') || ct - p.lastCoffee < 30000) return;
      p.lastCoffee = ct;
      p.boostUntil = Math.max(p.boostUntil, now + BOOST_COFFEE_MS);
      break;
    }
    case 'pizza': {
      if (g.pizzaUntil <= now || p.pizzaToken === g.pizzaId || !near(p, 'meeting', 3)) return;
      p.pizzaToken = g.pizzaId;
      p.boostUntil = Math.max(p.boostUntil, now + BOOST_PIZZA_MS);
      break;
    }
    case 'fix': {
      if (ct - p.lastFix < 80 || !g.fire || !near(p, 'server')) return;
      p.lastFix = ct;
      g.fire.hp--;
      p.contribution += 0.15;
      if (g.fire.hp <= 0) { g.fire = null; fx(room, 'ev_fireout', { name: p.name }, 'good'); }
      break;
    }
    case 'phone': {
      if (!g.phone || !near(p, 'phone')) return;
      if (m.choice === 0) { g.happiness += 12; addTicket(room); fx(room, 'ev_phoneYes', { name: p.name }, 'info'); }
      else { g.happiness += 5; fx(room, 'ev_phoneCheck', { name: p.name }, 'good'); }
      g.happiness = clamp(g.happiness, 0, 100);
      g.phone = null;
      p.contribution += 2;
      break;
    }
    default:
  }
}

function handleAbility(room, p, now) {
  const g = room.g;
  if (p.cdUntil > now || isPip(room, p) || p.caught) return;
  const players = list(room);
  switch (p.role) {
    case 'leader':
      if (g.emergencyDay === g.day || g.phase !== 'playing') return;
      g.emergencyDay = g.day;
      p.cdUntil = now + COOLDOWN.leader;
      startMeeting(room, now, p.name);
      return;
    case 'senior': {
      for (const t of g.tickets) if (t.stage === 'dev' || t.stage === 'qa') t.bugs = Math.floor(t.bugs / 2);
      fx(room, 'ab_used_senior', { name: p.name }, 'good');
      break;
    }
    case 'junior': {
      const dev = g.tickets.filter((t) => t.stage === 'dev');
      const t = dev.find((x) => x.owner === p.id) || dev[0];
      if (!t) return tell(room, p.id, 'fx', { key: 'ab_noTicket', params: {}, kind: 'info' });
      if (Math.random() < 0.5) {
        t.progress = Math.min(t.work, t.progress + 3 + players.length);
        fx(room, 'ab_used_junior_good', { name: p.name }, 'good');
        if (t.progress >= t.work) { t.credits.code = room.players[t.owner]?.name || p.name; advance(room, t, 'qa', p); }
      } else {
        t.bugs += 3; // silently — the tester will find out
        fx(room, 'ab_used_junior', { name: p.name }, 'info');
      }
      break;
    }
    case 'qa': {
      const entry = [...g.log].reverse().find((e) => !e.blamed);
      if (!entry) { tell(room, p.id, 'fx', { key: 'git_blame_none', params: {}, kind: 'info' }); break; }
      entry.blamed = true;
      gitBot(room, 'git_blame', { id: entry.id, name: room.players[entry.actor]?.name || '?' }, p.id);
      fx(room, 'ab_used_qa', { name: p.name, id: entry.id }, 'info');
      break;
    }
    default:
      return;
  }
  p.cdUntil = now + (COOLDOWN[p.role] || 30000);
  p.contribution += 2;
}

function applyAction(room, pid, a, now) {
  const g = room.g;
  if (a.type === 'join') return addPlayer(room, pid, a.name);
  const p = room.players[pid];
  if (!p) return;
  const working = g.phase === 'playing' || g.phase === 'deploy';
  switch (a.type) {
    case 'leave':
      return removePlayer(room, pid, now);
    case 'start':
      if (p.isHost && g.phase === 'lobby') startGame(room, now);
      return;
    case 'restart':
      if (!p.isHost || g.phase !== 'results') return;
      bots.removeAll(room);
      room.g = newGame();
      for (const q of list(room)) { q.role = null; q.agenda = null; Object.assign(q, freshStats()); }
      return;
    case 'claim': {
      const t = findTicket(g, a.ticket);
      if (!t || !['morning', 'playing'].includes(g.phase)) return;
      if (t.stage === 'todo' || (t.stage === 'dev' && !t.owner)) { t.stage = 'dev'; t.owner = pid; }
      return;
    }
    case 'task':
      if (working) handleTask(room, p, a, now);
      return;
    case 'ability':
      if (working) handleAbility(room, p, now);
      return;
    case 'secret':
      if (working) handleSecret(room, p, now);
      return;
    case 'vote': {
      if (g.phase !== 'meeting' || g.meeting.votes[pid] !== undefined) return;
      const v = String(a.target || '');
      if (v !== 'skip' && (!room.players[v] || v === pid)) return;
      g.meeting.votes[pid] = v;
      if (list(room).every((q) => g.meeting.votes[q.id] !== undefined)) finishMeeting(room, now);
      return;
    }
    case 'chat': {
      const ct = Number(a.ct) || now;
      const text = String(a.text || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 140);
      if (!text || ct - p.lastChat < 600) return;
      p.lastChat = ct;
      const to = a.to && room.players[a.to] && a.to !== pid ? a.to : null;
      return push(room, { t: 'chat', from: pid, name: p.name, color: p.color, text, ...(to ? { to } : {}) });
    }
    case 'emote': {
      const ct = Number(a.ct) || now;
      if (!Number.isInteger(a.i) || a.i < 0 || a.i > 4 || ct - p.lastEmote < 1500) return;
      p.lastEmote = ct;
      return push(room, { t: 'emote', id: pid, i: a.i });
    }
    default:
  }
}

// ---------- Main entry ----------
// inputs: { [pid]: { t, pos, hold, acts: [{seq, type, ...}], tpAck } } — the latest message from every client.
function step(room, inputs, now) {
  const b = WORLD.bounds;
  // Positions first, so proximity checks in actions use where players stand now.
  for (const [pid, inp] of Object.entries(inputs)) {
    const p = room.players[pid];
    if (!p || p.bot || !inp || now - inp.t > STALE_MS) continue;
    p.hold = typeof inp.hold === 'string' ? inp.hold : null;
    if (!inp.pos || (inp.tpAck || 0) < (p.tp || 0)) continue; // client hasn't adopted a teleport yet
    p.x = clamp(Number(inp.pos.x) || 0, b.minX, b.maxX);
    p.z = clamp(Number(inp.pos.z) || 0, b.minZ, b.maxZ);
    p.face = Number(inp.pos.face) || 0;
    p.moving = !!inp.pos.moving;
  }
  for (const [pid, inp] of Object.entries(inputs)) {
    if (!inp || now - inp.t > STALE_MS) continue;
    const acts = (inp.acts || []).filter((a) => a.seq > (room.lastSeq[pid] || 0)).sort((x, y) => x.seq - y.seq);
    for (const a of acts) {
      room.lastSeq[pid] = a.seq;
      applyAction(room, pid, a, now);
    }
  }
  for (const pid of Object.keys(room.players)) {
    if (!room.players[pid] || room.players[pid].bot) continue;
    const inp = inputs[pid];
    if (!inp || now - inp.t > STALE_MS) removePlayer(room, pid, now);
  }

  const g = room.g;
  const dt = clamp((now - room.lastTick) / 1000, 0, 1);
  room.lastTick = now;
  bots.tick(room, dt, now);
  if (room.g !== g) return;
  const over = now >= g.phaseStart + g.phaseMs;
  switch (g.phase) {
    case 'playing': return updatePlaying(room, dt, now);
    case 'deploy': return updateDeploy(room, dt, now);
    case 'briefing': if (over) startMorning(room, 1, now); return;
    case 'morning': if (over) startWork(room, now); return;
    case 'meeting': if (over) finishMeeting(room, now); return;
    case 'evening': if (over) startMorning(room, g.day + 1, now); return;
    default:
  }
}

function snapshot(room, inputs, pid, lastEv, now) {
  const g = room.g;
  const me = room.players[pid];
  const m = g.meeting;
  return {
    code: room.code,
    phase: g.phase, day: g.day, clock: clockHours(g, now),
    left: Math.max(0, g.phaseStart + g.phaseMs - now), total: g.phaseMs,
    happiness: Math.round(g.happiness),
    tickets: g.tickets.map((t) => ({
      id: t.id, key: t.key, stage: t.stage, work: t.work, progress: Math.round(t.progress * 10) / 10,
      owner: t.owner, credits: t.credits, day: t.day,
      bugs: t.stage === 'qa' ? t.bugs : undefined, // hidden until it's being tested
    })),
    fire: g.fire && { hp: g.fire.hp, max: g.fire.max },
    phone: g.phone ? { left: Math.max(0, g.phone.until - now), q: g.phone.q } : null,
    ceo: Math.max(0, g.ceoUntil - now),
    pizza: Math.max(0, g.pizzaUntil - now), pizzaId: g.pizzaId,
    meeting: m && { by: m.by, myVote: m.votes[pid] ?? null, voted: Object.keys(m.votes) },
    deploy: g.deploy && { progress: Math.round(g.deploy.progress), occupied: g.deploy.occupied, need: g.deploy.need },
    summary: g.summary, emergencyUsed: g.emergencyDay === g.day,
    results: g.results,
    me: me ? {
      role: me.role, agenda: me.agenda, tp: me.tp, x: me.x, z: me.z,
      secret: me.agenda === 'jobhunt' && !me.caught ? Math.max(0, me.secretUntil - now) : null, secretMax: SECRET_CD,
      pip: isPip(room, me), caught: me.caught, boost: Math.max(0, me.boostUntil - now),
    } : null,
    ackSeq: room.lastSeq[pid] || 0,
    events: room.events.filter((e) => e.seq > lastEv && (!e.to || e.to === pid || e.from === pid)),
    evSeq: room.evSeq,
    players: list(room).map((p) => {
      // Between ticks, other players' freshest positions are in their latest inputs.
      const inp = inputs[p.id];
      const live = !p.bot && inp && inp.pos && (inp.tpAck || 0) >= (p.tp || 0) && now - inp.t < STALE_MS;
      return {
        id: p.id, name: p.name, color: p.color, isHost: p.isHost, role: p.role, bot: !!p.bot,
        x: live ? Number(inp.pos.x) || 0 : p.x, z: live ? Number(inp.pos.z) || 0 : p.z,
        face: live ? Number(inp.pos.face) || 0 : p.face, moving: live ? !!inp.pos.moving : p.moving,
        cd: Math.max(0, p.cdUntil - now), cdMax: COOLDOWN[p.role] || 1,
        pip: isPip(room, p), caught: p.caught, boost: p.boostUntil > now, ateP: p.pizzaToken === g.pizzaId,
      };
    }),
  };
}

const bots = require('./bots')({
  WORLD, STATION, COLORS, COLOR_EMOJI, ROLE_ICON, DEPLOY_STATIONS, list, near, applyAction, canTest, isPip, freshStats,
});

module.exports = { WORLD, createRoom, step, snapshot };
