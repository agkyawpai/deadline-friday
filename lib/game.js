'use strict';
// Pure game rules. A room is a plain JSON object so it can live in memory (LAN) or in Redis (Vercel).
// Everything is driven by step(room, inputs, now): apply each client's queued actions, then advance time.
//
// Day flow (Mon–Thu): morning standup -> work -> midday meeting -> work -> evening review
// Friday:             morning standup -> work -> DEPLOY (everyone holds a station) -> retro (peer review) -> results
const WORLD = require('../public/world.json');

const env = (k, d) => Number(process.env[k]) || d;
const HALF_MS = env('HALF_MS', 50000); // one half of a work day; HALF_MS=10000 for quick testing
const BRIEFING_MS = env('BRIEFING_MS', 12000);
const MORNING_MS = env('MORNING_MS', 12000);
const MEETING_MS = env('MEETING_MS', 25000);
const DEPLOY_MS = env('DEPLOY_MS', 45000);
const EVENING_MS = 7000;
const RETRO_MS = 40000;
const STALE_MS = 20000; // no sync for this long => player left
const ESCALATE_MS = 20000; // a ticket stuck this long in review/qa/demo can be done by anyone
const MAX_PLAYERS = 6;
const DAYS = 5;
const INTERACT_RANGE = 2.4;

const COLORS = ['#ff6b6b', '#4dabf7', '#51cf66', '#fcc419', '#cc5de8', '#ff922b'];
const ROLE_PRIORITY = ['senior', 'qa', 'junior', 'leader', 'sales', 'manager'];
const AGENDAS = ['promotion', 'worklife', 'coffee', 'blame', 'bugs'];
const COOLDOWN = { manager: 60000, leader: 35000, senior: 40000, junior: 20000, qa: 30000, sales: 40000 };
const SECRET_CD = { jobhunt: 35000, promotion: 45000, blame: 40000 };
const CODE_MULT = { manager: 0.4, leader: 1.2, senior: 1.6, junior: 0.9, qa: 0.8, sales: 0.6 };
const BUG_CHANCE = { manager: 0.4, leader: 0.2, senior: 0.12, junior: 0.45, qa: 0.2, sales: 0.3 };
const TICKET_POOL = ['login', 'payment', 'chatbot', 'darkmode', 'nft', 'map', 'push', 'search', 'loyalty', 'reviews', 'referral', 'export'];
const NEW_TICKETS = { 1: 2, 2: 2, 3: 2, 4: 0, 5: 0 }; // Thursday = code freeze
const MEETINGS = { 1: { kind: 'decision', key: 'extraTicket' }, 2: { kind: 'pip' }, 3: { kind: 'decision', key: 'aiFeature' }, 4: { kind: 'pip' } };
const STAGE_ROLES = { review: ['leader', 'manager'], qa: ['qa'], demo: ['sales', 'manager'] };
const DEPLOY_STATIONS = ['server', 'board', 'qa', 'phone'];
const STATION = Object.fromEntries(WORLD.stations.map((s) => [s.id, s]));

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function newGame() {
  return {
    phase: 'lobby', day: 0, phaseStart: 0, phaseMs: 0,
    happiness: 70, prodBugs: 0, tickets: [], nextTicket: 1, pool: [],
    fire: null, phone: null, coffeeBroken: null,
    wifiUntil: 0, ceoUntil: 0, pizzaUntil: 0, pizzaId: 0, reviewUntil: 0, nextEventAt: 0,
    middayDone: false, meeting: null, resume: null, deploy: null, deployed: false, emergencyDay: 0,
    log: [], doneToday: 0, summary: null, ending: null, results: null,
  };
}

function freshStats() {
  return {
    stress: 10, burnoutUntil: 0, lockedUntil: 0, frozenUntil: 0, cdUntil: 0, secretUntil: 0, pipDay: 0, pipNext: false,
    coffeeToday: 0, coffeeTotal: 0, bugsSquashed: 0, contribution: 0, exitDays: 0, burnouts: 0,
    vote: null, peer: null, hold: null,
    lastTask: 0, lastQa: 0, lastBugs: 0, lastReview: 0, lastCoffee: 0, lastFix: 0, lastEmote: 0, lastChat: 0, pizzaToken: -1,
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
const hasRole = (room, role) => list(room).some((p) => p.role === role);
function frozenReason(p, now) {
  if (p.burnoutUntil > now) return 'burnout';
  if (p.lockedUntil > now) return 'locked';
  if (p.frozenUntil > now) return 'meeting';
  return null;
}
const frozenLeft = (p, now) => Math.max(0, p.burnoutUntil - now, p.lockedUntil - now, p.frozenUntil - now);
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
function addStress(room, p, amount, now) {
  if (p.burnoutUntil > now) return;
  p.stress = clamp(p.stress + amount, 0, 100);
  if (p.stress >= 100) {
    p.burnoutUntil = now + 12000;
    p.burnouts++;
    fx(room, 'ev_burnout', { name: p.name }, 'bad');
  }
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
// Who may do a ticket stage: the first listed role present in the team, or anyone if none is present.
// If the ticket has waited too long (AFK or someone stalling on purpose), it escalates to anyone.
const escalated = (t, now) => !!t.stageAt && now - t.stageAt > ESCALATE_MS;
function canDo(room, p, stage, t, now) {
  const role = STAGE_ROLES[stage].find((r) => hasRole(room, r));
  return !role || p.role === role || escalated(t, now);
}
const isPip = (room, p) => p.pipDay === room.g.day;
function clockHours(g, now) {
  const span = g.day === DAYS ? 8 : 9;
  let frac = 0;
  if (g.phase === 'playing') frac = (now - g.phaseStart) / (2 * HALF_MS);
  else if (g.phase === 'meeting' && g.resume) frac = g.resume.elapsed / (2 * HALF_MS);
  else if (g.phase === 'deploy') frac = 0.5 + ((now - g.phaseStart) / DEPLOY_MS) * 0.5;
  else if (g.phase === 'evening') frac = 1;
  else if (['retro', 'results'].includes(g.phase)) frac = 1;
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
  const work = Math.round(4 + 1.5 * n);
  const t = { id: g.nextTicket++, key: g.pool.pop(), stage: 'todo', work, progress: 0, bugs: 0, owner: null, credits: {}, helpers: [], day: g.day, lastCoder: null, lastCodeAt: 0 };
  g.tickets.push(t);
  return t;
}
const findTicket = (g, id) => g.tickets.find((t) => t.id === Number(id));
function advance(room, t, stage, p) {
  t.stage = stage;
  t.stageAt = Date.now();
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
  const rest = list(room);
  if (p.isHost && rest.length) rest[0].isHost = true;
  if (!rest.length) { room.g = newGame(); return; }
  for (const t of room.g.tickets) if (t.owner === pid) t.owner = null;
  if (room.g.phase === 'retro' && rest.every((q) => q.peer)) finishRetro(room, now);
  if (room.g.phase === 'meeting' && rest.every((q) => room.g.meeting.votes[q.id] !== undefined)) finishMeeting(room, now);
}

// ---------- Phases ----------
function startGame(room, now) {
  const players = shuffle(list(room));
  const n = players.length;
  room.g = newGame();
  const roles = shuffle(ROLE_PRIORITY.slice(0, n));
  const agendas = shuffle(AGENDAS.slice());
  const jobHunter = n >= 4 ? Math.floor(Math.random() * n) : -1;
  players.forEach((p, i) => {
    Object.assign(p, freshStats());
    p.role = roles[i];
    p.agenda = i === jobHunter ? 'jobhunt' : agendas[i % agendas.length];
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
  g.nextEventAt = now + (g.day === 1 ? 14000 : 7000);
}

function seatAtMeeting(room, now) {
  const m = STATION.meeting;
  const players = list(room);
  players.forEach((q, i) => {
    const a = (i / players.length) * Math.PI * 2;
    teleport(q, m.x + Math.cos(a) * 2.3, m.z + Math.sin(a) * 1.6);
  });
}

function startMeeting(room, spec, now, by) {
  const g = room.g;
  g.resume = { elapsed: now - g.phaseStart, phaseMs: g.phaseMs, at: now };
  g.meeting = { kind: spec.kind, key: spec.key || null, by: by || null, votes: {} };
  seatAtMeeting(room, now);
  setPhase(g, 'meeting', MEETING_MS, now);
  fx(room, by ? 'ev_emergency' : 'ev_meeting', { name: by || '' }, 'chaos');
}

function finishMeeting(room, now) {
  const g = room.g;
  const m = g.meeting;
  const players = list(room);
  if (m.kind === 'decision') {
    const yes = players.filter((p) => m.votes[p.id] === 'yes').length;
    const no = players.filter((p) => m.votes[p.id] === 'no').length;
    const accepted = yes > no;
    if (m.key === 'extraTicket' && accepted) { addTicket(room); g.happiness = clamp(g.happiness + 12, 0, 100); }
    if (m.key === 'aiFeature') {
      if (accepted) { addTicket(room); addTicket(room); g.happiness = clamp(g.happiness + 20, 0, 100); }
      else g.happiness = clamp(g.happiness - 10, 0, 100);
    }
    fx(room, accepted ? 'mt_accepted' : 'mt_declined', { yes, no }, accepted ? 'good' : 'info');
  } else {
    const counts = {};
    for (const p of players) {
      const v = m.votes[p.id];
      if (v && v !== 'skip' && room.players[v]) counts[v] = (counts[v] || 0) + 1;
    }
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const need = players.length <= 2 ? 1 : 2;
    if (sorted.length && sorted[0][1] >= need && (!sorted[1] || sorted[1][1] < sorted[0][1])) {
      // PIP: ability, secret action and coding speed are cut for the rest of today and all of tomorrow.
      const target = room.players[sorted[0][0]];
      target.pipDay = g.day;
      target.pipNext = true;
      fx(room, 'mt_pip', { name: target.name, n: sorted[0][1] }, 'bad');
    } else {
      fx(room, 'mt_nopip', {}, 'info');
    }
  }
  // Resume the work day where it paused, and shift timers so the meeting didn't eat into them.
  const shift = now - g.resume.at;
  for (const k of ['ceoUntil', 'pizzaUntil', 'wifiUntil', 'reviewUntil', 'nextEventAt']) if (g[k]) g[k] += shift;
  if (g.phone) g.phone.until += shift;
  for (const t of g.tickets) if (t.stageAt) t.stageAt += shift;
  setPhase(g, 'playing', g.resume.phaseMs, now - g.resume.elapsed);
  g.meeting = null;
  g.resume = null;
}

function startDeploy(room, now) {
  const g = room.g;
  g.deploy = { progress: 0, occupied: [] };
  setPhase(g, 'deploy', DEPLOY_MS, now);
  fx(room, 'ev_deploy', {}, 'chaos');
}

function endDay(room, now) {
  const g = room.g;
  for (const p of list(room)) {
    if (near(p, 'exit', 2.6)) {
      p.exitDays++;
      fx(room, 'ev_home', { name: p.name }, 'info');
    }
    p.coffeeToday = 0;
    if (p.pipNext) { p.pipDay = g.day + 1; p.pipNext = false; }
  }
  const overdue = g.tickets.filter((t) => t.stage !== 'done' && t.day < g.day).length;
  g.happiness = clamp(g.happiness - overdue * 5, 0, 100);
  let demo = 0;
  if (g.day === 3) {
    demo = g.doneToday > 0 ? 15 : -15;
    g.happiness = clamp(g.happiness + demo, 0, 100);
  }
  g.summary = { day: g.day, doneToday: g.doneToday, overdue, demo };
  // Overnight the ops team cleans up whatever chaos is left.
  g.fire = null; g.phone = null; g.coffeeBroken = null;
  g.wifiUntil = 0; g.ceoUntil = 0; g.pizzaUntil = 0; g.reviewUntil = 0;
  if (g.happiness <= 0) return endSprint(room, now);
  setPhase(g, 'evening', EVENING_MS, now);
}

function endSprint(room, now) {
  const g = room.g;
  g.ending = computeEnding(room);
  for (const p of list(room)) { p.vote = null; p.peer = null; p.burnoutUntil = 0; p.lockedUntil = 0; p.frozenUntil = 0; }
  seatAtMeeting(room, now);
  setPhase(g, 'retro', list(room).length > 1 ? RETRO_MS : 5000, now);
}

function computeEnding(room) {
  const g = room.g;
  const players = list(room);
  const n = Math.max(1, players.length);
  const burn = players.reduce((s, p) => s + p.burnouts, 0);
  const done = g.tickets.filter((t) => t.stage === 'done').length;
  const ratio = g.tickets.length ? done / g.tickets.length : 0;
  if (g.happiness <= 0) return 'cancelled';
  if (burn >= Math.max(2, 2 * n)) return 'resign';
  if (!g.deployed) return 'deployfail';
  if (ratio >= 0.7 && g.prodBugs <= n) return 'shipped';
  if (ratio >= 0.4) return 'onfire';
  return 'missed';
}

function finishRetro(room, now) {
  const g = room.g;
  const players = list(room);
  const bonus = {};
  const votes = {};
  for (const p of players) { bonus[p.id] = 0; votes[p.id] = 0; }
  for (const p of players) {
    for (const [id, n] of Object.entries((p.peer && p.peer.points) || {})) if (bonus[id] !== undefined && id !== p.id) bonus[id] += n;
    if (p.vote && votes[p.vote] !== undefined) votes[p.vote]++;
  }
  const maxVotes = Math.max(0, ...Object.values(votes));
  const blamed = maxVotes > 0 ? players.filter((p) => votes[p.id] === maxVotes).map((p) => p.id) : [];
  const maxBonus = Math.max(0, ...Object.values(bonus));
  const shipped = g.ending === 'shipped' || g.ending === 'onfire';
  const done = g.tickets.filter((t) => t.stage === 'done').length;

  const agendaWon = (p) => {
    switch (p.agenda) {
      case 'promotion': return bonus[p.id] > 0 && bonus[p.id] >= maxBonus;
      case 'worklife': return p.exitDays >= 3;
      case 'coffee': return p.coffeeTotal >= 8;
      case 'blame': return !!p.vote && blamed.includes(p.vote) && !blamed.includes(p.id);
      case 'bugs': return p.bugsSquashed >= 15;
      case 'jobhunt': return !shipped;
      default: return false;
    }
  };

  g.results = {
    ending: g.ending, done, total: g.tickets.length, prodBugs: g.prodBugs,
    burnouts: players.reduce((s, p) => s + p.burnouts, 0), blamed,
    log: g.log.map((e) => ({ id: e.id, time: e.time, act: e.act, actor: room.players[e.actor]?.name || '?', framed: e.framed ? room.players[e.framed]?.name || '?' : null })),
    players: players.map((p) => ({
      id: p.id, name: p.name, color: p.color, role: p.role, agenda: p.agenda,
      won: agendaWon(p), bonus: bonus[p.id], votes: votes[p.id], contribution: Math.round(p.contribution * 10) / 10,
    })),
  };
  setPhase(g, 'results', 0, now);
}

// ---------- Chaos events ----------
function triggerEvent(room, now) {
  const g = room.g;
  const players = list(room);
  const n = players.length;
  const pool = [];
  if (!g.fire) pool.push(['fire', 3]);
  if (!g.phone && g.phase === 'playing') pool.push(['phone', 4]);
  pool.push(['osupdate', 2]);
  if (g.wifiUntil < now) pool.push(['wifi', 1.5]);
  if (!g.ceoUntil && g.phase === 'playing') pool.push(['ceo', 2]);
  if (g.pizzaUntil < now && g.phase === 'playing') pool.push(['pizza', 1.5]);
  if (!g.coffeeBroken) pool.push(['coffeebroken', 2]);
  pool.push(['forcepush', g.day === 4 ? 3 : 1.5]);
  const total = pool.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  let type = pool[0][0];
  for (const [t, w] of pool) { if ((r -= w) <= 0) { type = t; break; } }

  switch (type) {
    case 'fire': {
      const hp = 25 + 10 * n;
      g.fire = { hp, max: hp, acc: 0 };
      fx(room, 'ev_fire', {}, 'chaos');
      break;
    }
    case 'phone':
      g.phone = { until: now + 15000, q: Math.floor(Math.random() * 4) };
      fx(room, 'ev_phone', {}, 'chaos');
      break;
    case 'osupdate': {
      const candidates = players.filter((p) => !frozenReason(p, now));
      if (!candidates.length) break;
      const p = pick(candidates);
      p.lockedUntil = now + 10000;
      fx(room, 'ev_osupdate', { name: p.name }, 'chaos');
      break;
    }
    case 'wifi':
      g.wifiUntil = now + 20000;
      fx(room, 'ev_wifi', {}, 'chaos');
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
    case 'coffeebroken':
      g.coffeeBroken = { hp: 15, max: 15 };
      fx(room, 'ev_coffeebroken', {}, 'chaos');
      break;
    case 'forcepush': {
      const culprit = players.find((p) => p.role === 'junior') || pick(players);
      const victims = g.tickets.filter((t) => t.stage === 'dev' && t.progress > 0);
      if (victims.length) { const t = pick(victims); t.progress = Math.max(0, t.progress - t.work * 0.3); }
      g.prodBugs += 2;
      fx(room, 'ev_forcepush', { name: culprit.name }, 'chaos');
      break;
    }
  }
}

// Shared per-tick pressure: stress, fire, client mood, timed events. Runs during work and deploy.
function chaosTick(room, dt, now) {
  const g = room.g;
  const players = list(room);
  const n = Math.max(1, players.length);

  for (const p of players) {
    if (p.burnoutUntil && now >= p.burnoutUntil) { p.burnoutUntil = 0; p.stress = 45; }
    if (!frozenReason(p, now)) addStress(room, p, 0.25 * dt, now);
  }
  if (g.fire) {
    g.happiness -= 0.4 * dt;
    g.fire.acc += dt;
    if (g.fire.acc >= 5) { g.fire.acc = 0; g.prodBugs++; }
    if (g.deploy) g.deploy.progress = Math.max(0, g.deploy.progress - dt);
  }
  g.happiness -= 0.1 * dt;
  if (g.prodBugs > 2 * n) g.happiness -= 0.15 * dt;

  if (g.phone && now >= g.phone.until) {
    g.phone = null;
    g.happiness -= 12;
    fx(room, 'ev_phoneMissed', {}, 'bad');
  }
  if (g.ceoUntil && now >= g.ceoUntil) {
    g.ceoUntil = 0;
    const slackers = players.filter((p) => !nearAnyDesk(p));
    for (const p of players) {
      if (slackers.includes(p)) addStress(room, p, 12, now);
      else p.contribution += 1;
    }
    g.happiness -= 4 * slackers.length;
    if (slackers.length) fx(room, 'ev_ceoEnd', { names: slackers.map((p) => p.name).join(', ') }, 'bad');
    else fx(room, 'ev_ceoGood', {}, 'good');
  }
  g.happiness = clamp(g.happiness, 0, 100);
  if (now >= g.nextEventAt) {
    triggerEvent(room, now);
    g.nextEventAt = now + rand(16000, 26000) * (n <= 2 ? 1.25 : 1);
  }
}

function updatePlaying(room, dt, now) {
  const g = room.g;
  chaosTick(room, dt, now);
  if (g.happiness <= 0) return endSprint(room, now);
  const elapsed = now - g.phaseStart;
  if (g.day < DAYS && !g.middayDone && elapsed >= HALF_MS && MEETINGS[g.day]) {
    g.middayDone = true;
    return startMeeting(room, MEETINGS[g.day], now);
  }
  if (g.day === DAYS && elapsed >= HALF_MS) return startDeploy(room, now);
  if (elapsed >= g.phaseMs) endDay(room, now);
}

function updateDeploy(room, dt, now) {
  const g = room.g;
  chaosTick(room, dt, now);
  if (g.happiness <= 0) return endSprint(room, now);
  const players = list(room);
  const occupied = DEPLOY_STATIONS.filter((st) => players.some((p) => p.hold === st && near(p, st) && !frozenReason(p, now)));
  const need = Math.min(players.length, DEPLOY_STATIONS.length);
  let rate = occupied.length >= need ? 4.5 : (occupied.length / need) * 1.5;
  rate = occupied.length ? Math.max(0.3, rate - g.prodBugs * 0.08) : 0;
  g.deploy.progress = clamp(g.deploy.progress + rate * dt, 0, 100);
  g.deploy.occupied = occupied;
  g.deploy.need = need;
  if (g.deploy.progress >= 100) {
    g.deployed = true;
    fx(room, 'ev_deployed', {}, 'good');
    return endSprint(room, now);
  }
  if (now >= g.phaseStart + g.phaseMs) {
    fx(room, 'ev_deployFailed', {}, 'bad');
    endSprint(room, now);
  }
}

// ---------- Sabotage & evidence ----------
const COLOR_EMOJI = { '#ff6b6b': '🔴', '#4dabf7': '🔵', '#51cf66': '🟢', '#fcc419': '🟡', '#cc5de8': '🟣', '#ff922b': '🟠' };
const ROLE_ICON = { manager: '👔', leader: '🧭', senior: '🧙', junior: '🐣', qa: '🔍', sales: '💼' };

// Record a sabotage in the git log with a partial clue. Framing plants the victim's clue instead of the actor's.
function logSabotage(room, actor, act, place, framed) {
  const g = room.g;
  const suspect = framed || actor;
  const r = Math.random();
  const clue = framed || r < 0.55 ? COLOR_EMOJI[suspect.color] || '❓' : r < 0.8 ? ROLE_ICON[suspect.role] || '❓' : '❓';
  const entry = { id: g.log.length + 1, time: clockStr(g, Date.now()), act, actor: actor.id, framed: framed ? framed.id : null, blamed: false };
  g.log.push(entry);
  gitBot(room, 'git_sus', { id: entry.id, time: entry.time, act: `@gitact_${act}`, place: `@place_${place}`, clue });
}

function handleSecret(room, p, now) {
  const g = room.g;
  if (!SECRET_CD[p.agenda] || p.secretUntil > now || isPip(room, p)) return;
  const players = list(room);
  switch (p.agenda) {
    case 'jobhunt': {
      if (g.phase === 'deploy' && near(p, 'server')) {
        g.deploy.progress = Math.max(0, g.deploy.progress - 15);
        logSabotage(room, p, 'unplug', 'server');
        break;
      }
      const targets = g.tickets.filter((t) => ['dev', 'review', 'qa'].includes(t.stage));
      if (targets.length) pick(targets).bugs += 2;
      else g.prodBugs += 2;
      logSabotage(room, p, 'inject', nearestPlace(p));
      break;
    }
    case 'promotion': {
      const credited = g.tickets.filter((t) => t.credits.dev && t.credits.dev !== p.name);
      if (!credited.length) return tell(room, p.id, 'fx', { key: 'sec_nothing', params: {}, kind: 'info' });
      const t = credited[credited.length - 1];
      t.credits.dev = p.name;
      p.contribution += 3;
      logSabotage(room, p, 'steal', nearestPlace(p));
      break;
    }
    case 'blame': {
      const others = players.filter((q) => q.id !== p.id);
      if (!others.length) return;
      others.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
      logSabotage(room, p, 'inject', nearestPlace(others[0]), others[0]); // looks exactly like a real sabotage
      break;
    }
  }
  p.secretUntil = now + SECRET_CD[p.agenda];
  tell(room, p.id, 'fx', { key: `sec_done_${p.agenda}`, params: {}, kind: 'info' });
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
      if (m.ok === false) { addStress(room, p, 3, now); return; }
      let amt = CODE_MULT[p.role] ?? 1;
      if (p.role === 'senior' && p.coffeeToday === 0) amt = 0.6;
      if (p.stress >= 80) amt *= 0.7;
      if (isPip(room, p)) amt *= 0.7;
      const pair = t.lastCoder && t.lastCoder !== p.id && now - t.lastCodeAt < 3000;
      if (pair) amt *= 1.4;
      t.lastCoder = p.id;
      t.lastCodeAt = now;
      if (!t.owner) t.owner = p.id;
      if (t.owner !== p.id && !t.helpers.includes(p.name)) t.helpers.push(p.name);
      t.progress = Math.min(t.work, t.progress + amt);
      p.contribution += amt;
      addStress(room, p, 1.2, now);
      const bug = g.reviewUntil <= now && Math.random() < (BUG_CHANCE[p.role] ?? 0.25);
      if (bug) t.bugs++;
      tell(room, p.id, 'codeResult', { amt: Math.round(amt * 10) / 10, pair: !!pair });
      if (t.progress >= t.work) {
        t.credits.dev = room.players[t.owner]?.name || p.name;
        advance(room, t, 'review', p);
      }
      break;
    }
    case 'review': {
      const t = findTicket(g, m.ticket);
      if (!t || t.stage !== 'review' || !near(p, 'board') || !canDo(room, p, 'review', t, now) || ct - p.lastReview < 1200) return;
      p.lastReview = ct;
      if (!m.ok) { addStress(room, p, 3, now); return; }
      t.bugs = Math.max(0, t.bugs - 1);
      t.credits.review = p.name;
      p.contribution += 2;
      advance(room, t, 'qa', p);
      break;
    }
    case 'qa': {
      const t = findTicket(g, m.ticket);
      if (!t || t.stage !== 'qa' || !near(p, 'qa') || !canDo(room, p, 'qa', t, now) || ct - p.lastQa < 3000) return;
      p.lastQa = ct;
      const squashed = Math.min(t.bugs, clamp(Math.floor(Number(m.count) || 0), 0, 20));
      t.bugs -= squashed;
      t.bugs += clamp(Math.floor(Number(m.features) || 0), 0, 5); // "it's not a bug, it's a feature" clicks
      p.bugsSquashed += squashed;
      p.contribution += squashed * 0.5 + 1;
      tell(room, p.id, 'qaResult', { squashed, left: t.bugs });
      if (t.bugs === 0) {
        t.credits.qa = p.name;
        advance(room, t, 'demo', p);
      }
      break;
    }
    case 'demo': {
      const t = findTicket(g, m.ticket);
      if (!t || t.stage !== 'demo' || !near(p, 'phone') || !canDo(room, p, 'demo', t, now)) return;
      const score = clamp(Math.floor(Number(m.score) || 0), 0, 3);
      const gain = (4 + score * 3) * (p.role === 'sales' ? 1.5 : 1);
      g.happiness = clamp(g.happiness + gain, 0, 100);
      t.credits.demo = p.name;
      g.doneToday++;
      p.contribution += 2 + score;
      advance(room, t, 'done', p);
      fx(room, 'ev_ticketDone', { ticket: `@tk_${t.key}`, gain: Math.round(gain) }, 'good');
      break;
    }
    case 'bugs': {
      if (!near(p, 'qa') || ct - p.lastBugs < 4000) return;
      p.lastBugs = ct;
      const count = clamp(Math.floor(Number(m.count) || 0), 0, 12);
      const squashed = Math.min(g.prodBugs, count * (p.role === 'qa' ? 2 : 1));
      g.prodBugs -= squashed;
      p.bugsSquashed += squashed;
      p.contribution += squashed * 0.5;
      tell(room, p.id, 'bugsResult', { squashed });
      break;
    }
    case 'coffee': {
      if (!near(p, 'coffee') || g.coffeeBroken || ct - p.lastCoffee < 2500) return;
      p.lastCoffee = ct;
      p.coffeeToday++;
      p.coffeeTotal++;
      p.stress = clamp(p.stress - 30, 0, 100);
      break;
    }
    case 'fix': {
      if (ct - p.lastFix < 80) return;
      p.lastFix = ct;
      if (m.target === 'fire' && g.fire && near(p, 'server')) {
        g.fire.hp--;
        p.contribution += 0.15;
        if (g.fire.hp <= 0) { g.fire = null; fx(room, 'ev_fireout', { name: p.name }, 'good'); }
      } else if (m.target === 'coffee' && g.coffeeBroken && near(p, 'coffee')) {
        g.coffeeBroken.hp--;
        p.contribution += 0.1;
        if (g.coffeeBroken.hp <= 0) { g.coffeeBroken = null; fx(room, 'ev_coffeefixed', { name: p.name }, 'good'); }
      }
      break;
    }
    case 'phone': {
      if (!g.phone || !near(p, 'phone')) return;
      const mult = p.role === 'sales' ? 2 : 1;
      if (m.choice === 0) { g.happiness += 15 * mult; addTicket(room); fx(room, 'ev_phoneYes', { name: p.name }, 'info'); }
      else if (m.choice === 1) { g.happiness += 5 * mult; fx(room, 'ev_phoneCheck', { name: p.name }, 'good'); }
      else { g.happiness -= 6; p.stress = clamp(p.stress - 10, 0, 100); fx(room, 'ev_phoneNo', { name: p.name }, 'info'); }
      g.happiness = clamp(g.happiness, 0, 100);
      g.phone = null;
      p.contribution += 2;
      break;
    }
    case 'pizza': {
      if (g.pizzaUntil <= now || p.pizzaToken === g.pizzaId || !near(p, 'meeting', 3)) return;
      p.pizzaToken = g.pizzaId;
      p.stress = clamp(p.stress - 35, 0, 100);
      break;
    }
    default:
  }
}

function handleAbility(room, p, now) {
  const g = room.g;
  if (p.cdUntil > now || isPip(room, p)) return;
  const players = list(room);
  switch (p.role) {
    case 'manager':
      if (g.emergencyDay === g.day || g.phase !== 'playing') return;
      g.emergencyDay = g.day;
      p.cdUntil = now + COOLDOWN.manager;
      startMeeting(room, { kind: 'pip' }, now, p.name);
      return;
    case 'leader':
      g.reviewUntil = now + 15000;
      fx(room, 'ab_used_leader', { name: p.name }, 'good');
      break;
    case 'senior': {
      let removed = 0;
      for (const t of g.tickets) if (['dev', 'review', 'qa'].includes(t.stage)) { const r = Math.ceil(t.bugs / 2); t.bugs -= r; removed += r; }
      const pr = Math.ceil(g.prodBugs * 0.4);
      g.prodBugs -= pr;
      addStress(room, p, 10, now);
      fx(room, 'ab_used_senior', { name: p.name, n: pr }, 'good');
      break;
    }
    case 'junior': {
      const mine = g.tickets.filter((t) => t.stage === 'dev');
      const t = mine.find((x) => x.owner === p.id) || mine[0];
      if (!t) return tell(room, p.id, 'fx', { key: 'ab_noTicket', params: {}, kind: 'info' });
      if (Math.random() < 0.5) {
        t.progress = Math.min(t.work, t.progress + 3 + players.length);
        fx(room, 'ab_used_junior_good', { name: p.name }, 'good');
        if (t.progress >= t.work) { t.credits.dev = room.players[t.owner]?.name || p.name; advance(room, t, 'review', p); }
      } else {
        t.bugs += 4; // silently — QA will find out later
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
    case 'sales':
      g.happiness = clamp(g.happiness + 18, 0, 100);
      addTicket(room);
      fx(room, 'ab_used_sales', { name: p.name }, 'info');
      break;
  }
  p.cdUntil = now + (COOLDOWN[p.role] || 30000);
  p.contribution += 2;
}

function handlePeer(room, p, a, now) {
  const g = room.g;
  if (g.phase !== 'retro' || p.peer) return;
  const points = {};
  let sum = 0;
  for (const [id, raw] of Object.entries(a.points || {})) {
    const n = clamp(Math.floor(Number(raw) || 0), 0, 10);
    if (!n || id === p.id || !room.players[id]) continue;
    if (sum + n > 10) break;
    points[id] = n;
    sum += n;
  }
  p.peer = { points };
  p.vote = a.target && a.target !== p.id && room.players[a.target] ? a.target : null;
  if (list(room).every((q) => q.peer)) finishRetro(room, now);
}

function applyAction(room, pid, a, now) {
  const g = room.g;
  if (a.type === 'join') return addPlayer(room, pid, a.name);
  const p = room.players[pid];
  if (!p) return;
  const working = (g.phase === 'playing' || g.phase === 'deploy') && !frozenReason(p, now);
  switch (a.type) {
    case 'leave':
      return removePlayer(room, pid, now);
    case 'start':
      if (p.isHost && g.phase === 'lobby') startGame(room, now);
      return;
    case 'restart':
      if (!p.isHost || g.phase !== 'results') return;
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
      const ok = g.meeting.kind === 'decision' ? ['yes', 'no'].includes(v) : v === 'skip' || (room.players[v] && v !== pid);
      if (!ok) return;
      g.meeting.votes[pid] = v;
      if (list(room).every((q) => g.meeting.votes[q.id] !== undefined)) finishMeeting(room, now);
      return;
    }
    case 'peer':
      return handlePeer(room, p, a, now);
    case 'chat': {
      const ct = Number(a.ct) || now;
      const text = String(a.text || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 140);
      if (!text || ct - p.lastChat < 600) return;
      if (g.wifiUntil > now) return tell(room, pid, 'fx', { key: 'wifiNoChat', params: {}, kind: 'bad' });
      p.lastChat = ct;
      const to = a.to && room.players[a.to] && a.to !== pid ? a.to : null;
      return push(room, { t: 'chat', from: pid, name: p.name, color: p.color, text, ...(to ? { to } : {}) });
    }
    case 'emote': {
      const ct = Number(a.ct) || now;
      if (!Number.isInteger(a.i) || a.i < 0 || a.i > 4 || ct - p.lastEmote < 1500) return;
      if (g.wifiUntil > now) return tell(room, pid, 'fx', { key: 'wifiNoEmote', params: {}, kind: 'bad' });
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
    if (!p || !inp || now - inp.t > STALE_MS) continue;
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
    const inp = inputs[pid];
    if (!inp || now - inp.t > STALE_MS) removePlayer(room, pid, now);
  }

  const g = room.g;
  const dt = clamp((now - room.lastTick) / 1000, 0, 1);
  room.lastTick = now;
  const over = now >= g.phaseStart + g.phaseMs;
  switch (g.phase) {
    case 'playing': return updatePlaying(room, dt, now);
    case 'deploy': return updateDeploy(room, dt, now);
    case 'briefing': if (over) startMorning(room, 1, now); return;
    case 'morning': if (over) startWork(room, now); return;
    case 'meeting': if (over) finishMeeting(room, now); return;
    case 'evening': if (over) startMorning(room, g.day + 1, now); return;
    case 'retro': if (over) finishRetro(room, now); return;
    default:
  }
}

function snapshot(room, inputs, pid, lastEv, now) {
  const g = room.g;
  const me = room.players[pid];
  const team = new Set(list(room).map((p) => p.role));
  const m = g.meeting;
  return {
    code: room.code,
    phase: g.phase, day: g.day, clock: clockHours(g, now),
    left: Math.max(0, g.phaseStart + g.phaseMs - now), total: g.phaseMs,
    happiness: Math.round(g.happiness), prodBugs: g.prodBugs,
    tickets: g.tickets.map((t) => ({
      id: t.id, key: t.key, stage: t.stage, work: t.work, progress: Math.round(t.progress * 10) / 10,
      owner: t.owner, credits: t.credits, helpers: t.helpers, day: t.day,
      bugs: t.stage === 'qa' ? t.bugs : undefined, // hidden until QA tests it
      open: STAGE_ROLES[t.stage] ? escalated(t, now) : false,
      escIn: STAGE_ROLES[t.stage] && t.stageAt ? Math.max(0, t.stageAt + ESCALATE_MS - now) : 0,
    })),
    stageRole: Object.fromEntries(Object.entries(STAGE_ROLES).map(([s, roles]) => [s, roles.find((r) => team.has(r)) || null])),
    fire: g.fire && { hp: g.fire.hp, max: g.fire.max },
    phone: g.phone ? { left: Math.max(0, g.phone.until - now), q: g.phone.q } : null,
    coffeeBroken: g.coffeeBroken && { hp: g.coffeeBroken.hp, max: g.coffeeBroken.max },
    wifi: Math.max(0, g.wifiUntil - now), ceo: Math.max(0, g.ceoUntil - now),
    pizza: Math.max(0, g.pizzaUntil - now), pizzaId: g.pizzaId,
    review: Math.max(0, g.reviewUntil - now),
    meeting: m && { kind: m.kind, key: m.key, by: m.by, myVote: m.votes[pid] ?? null, voted: Object.keys(m.votes) },
    deploy: g.deploy && { progress: Math.round(g.deploy.progress), occupied: g.deploy.occupied, need: g.deploy.need || Math.min(list(room).length, 4) },
    summary: g.summary, emergencyUsed: g.emergencyDay === g.day,
    results: g.results,
    me: me ? {
      role: me.role, agenda: me.agenda, tp: me.tp, x: me.x, z: me.z,
      secret: SECRET_CD[me.agenda] ? Math.max(0, me.secretUntil - now) : null, secretMax: SECRET_CD[me.agenda] || 1,
      pip: isPip(room, me), peerDone: !!me.peer,
    } : null,
    ackSeq: room.lastSeq[pid] || 0,
    events: room.events.filter((e) => e.seq > lastEv && (!e.to || e.to === pid || e.from === pid)),
    evSeq: room.evSeq,
    players: list(room).map((p) => {
      // Between ticks, other players' freshest positions are in their latest inputs.
      const inp = inputs[p.id];
      const live = inp && inp.pos && (inp.tpAck || 0) >= (p.tp || 0) && now - inp.t < STALE_MS;
      return {
        id: p.id, name: p.name, color: p.color, isHost: p.isHost, role: p.role,
        x: live ? Number(inp.pos.x) || 0 : p.x, z: live ? Number(inp.pos.z) || 0 : p.z,
        face: live ? Number(inp.pos.face) || 0 : p.face, moving: live ? !!inp.pos.moving : p.moving,
        stress: Math.round(p.stress), frozen: frozenReason(p, now), frozenLeft: frozenLeft(p, now),
        cd: Math.max(0, p.cdUntil - now), cdMax: COOLDOWN[p.role] || 1, pip: isPip(room, p),
        coffee: p.coffeeTotal, coffeeToday: p.coffeeToday, ateP: p.pizzaToken === g.pizzaId,
        voted: g.phase === 'retro' ? !!p.peer : false,
      };
    }),
  };
}

module.exports = { WORLD, createRoom, step, snapshot };
