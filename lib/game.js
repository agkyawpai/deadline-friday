'use strict';
// Pure game rules. A room is a plain JSON object so it can live in memory (LAN) or in Redis (Vercel).
// Everything is driven by step(room, inputs, now): apply each client's queued actions, then advance time.
const WORLD = require('../public/world.json');

const DAY_MS = Number(process.env.DAY_MS) || 90000; // DAY_MS=10000 for quick testing
const BRIEFING_MS = Number(process.env.BRIEFING_MS) || 12000;
const MAX_PLAYERS = 6;
const DAYS = 5;
const STANDUP_MS = 6000;
const RETRO_MS = 25000;
const STALE_MS = 20000; // no sync for this long => player left
const SCOPE_PER_PLAYER = 80;
const CLEAN_BUGS_PER_PLAYER = 3;
const INTERACT_RANGE = 2.4;

const COLORS = ['#ff6b6b', '#4dabf7', '#51cf66', '#fcc419', '#cc5de8', '#ff922b'];
const ROLE_PRIORITY = ['senior', 'junior', 'manager', 'qa', 'sales', 'leader'];
const AGENDAS = ['promotion', 'worklife', 'coffee', 'blame', 'bugs'];
const COOLDOWN = { manager: 45000, leader: 35000, senior: 40000, junior: 20000, qa: 30000, sales: 35000 };
const CODE_MULT = { manager: 0.4, leader: 1.2, senior: 1.6, junior: 0.9, qa: 0.8, sales: 0.6 };
const BUG_CHANCE = { manager: 0.4, leader: 0.2, senior: 0.12, junior: 0.45, qa: 0.2, sales: 0.3 };
const STATION = Object.fromEntries(WORLD.stations.map((s) => [s.id, s]));

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };

function newGame() {
  return {
    phase: 'lobby', day: 0, phaseStart: 0, phaseMs: 0,
    work: 0, scope: 100, bugs: 0, happiness: 70,
    fire: null, phone: null, coffeeBroken: null,
    wifiUntil: 0, ceoUntil: 0, pizzaUntil: 0, pizzaId: 0, reviewUntil: 0,
    nextEventAt: 0, ending: null, results: null,
  };
}

function freshStats() {
  return {
    stress: 10, burnoutUntil: 0, lockedUntil: 0, frozenUntil: 0, cdUntil: 0,
    coffeeToday: 0, coffeeTotal: 0, bugsSquashed: 0, contribution: 0, exitDays: 0, burnouts: 0,
    blameMarks: 0, vote: null, lastTask: 0, lastBugs: 0, lastCoffee: 0, lastFix: 0, lastEmote: 0, pizzaToken: -1,
  };
}

function createRoom(code, now) {
  return { code, lastTick: now, evSeq: 0, events: [], players: {}, lastSeq: {}, g: newGame() };
}

// ---------- Events (delivered to clients by seq) ----------
function push(room, ev) {
  ev.seq = ++room.evSeq;
  room.events.push(ev);
  if (room.events.length > 60) room.events.shift();
}
const fx = (room, key, params = {}, kind = 'info') => push(room, { t: 'fx', key, params, kind });
const tell = (room, pid, t, data) => push(room, { t, to: pid, ...data });

// ---------- Helpers ----------
const list = (room) => Object.values(room.players);
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
  if (room.g.phase === 'retro' && rest.every((q) => q.vote)) finishRetro(room, now);
}

// ---------- Phases ----------
function startGame(room, now) {
  const players = shuffle(list(room));
  const n = players.length;
  room.g = newGame();
  const g = room.g;
  g.scope = SCOPE_PER_PLAYER * n;
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
  setPhase(g, 'briefing', BRIEFING_MS, now);
}

function startDay(room, day, now) {
  const g = room.g;
  g.day = day;
  setPhase(g, 'playing', DAY_MS, now);
  g.nextEventAt = now + (day === 1 ? 14000 : 7000);
}

function endDay(room, now) {
  const g = room.g;
  for (const p of list(room)) {
    if (g.day < DAYS && near(p, 'exit', 2.6)) {
      p.exitDays++;
      fx(room, 'ev_home', { name: p.name }, 'info');
    }
    p.coffeeToday = 0;
  }
  // Overnight the ops team cleans up whatever chaos is left.
  g.fire = null; g.phone = null; g.coffeeBroken = null;
  g.wifiUntil = 0; g.ceoUntil = 0; g.pizzaUntil = 0; g.reviewUntil = 0;
  if (g.day >= DAYS) return endSprint(room, now);
  setPhase(g, 'standup', STANDUP_MS, now);
}

function endSprint(room, now) {
  const g = room.g;
  g.ending = computeEnding(room);
  for (const p of list(room)) { p.vote = null; p.burnoutUntil = 0; p.lockedUntil = 0; p.frozenUntil = 0; }
  setPhase(g, 'retro', list(room).length > 1 ? RETRO_MS : 5000, now);
}

function computeEnding(room) {
  const g = room.g;
  const players = list(room);
  const n = Math.max(1, players.length);
  const burn = players.reduce((s, p) => s + p.burnouts, 0);
  if (g.happiness <= 0) return 'cancelled';
  if (burn >= Math.max(2, 2 * n)) return 'resign';
  if (g.work >= g.scope && g.bugs <= CLEAN_BUGS_PER_PLAYER * n) return 'shipped';
  if (g.work >= g.scope) return 'onfire';
  return 'missed';
}

function finishRetro(room, now) {
  const g = room.g;
  const players = list(room);
  const score = {};
  for (const p of players) score[p.id] = p.blameMarks * 0.5;
  for (const p of players) if (p.vote && score[p.vote] !== undefined) score[p.vote] += 1;
  const maxScore = Math.max(0, ...Object.values(score));
  const blamed = maxScore > 0 ? players.filter((p) => score[p.id] === maxScore).map((p) => p.id) : [];
  const maxContrib = Math.max(0, ...players.map((p) => p.contribution));
  const shipped = g.ending === 'shipped' || g.ending === 'onfire';

  const agendaWon = (p) => {
    switch (p.agenda) {
      case 'promotion': return p.contribution > 0 && p.contribution >= maxContrib;
      case 'worklife': return p.exitDays >= 3;
      case 'coffee': return p.coffeeTotal >= 8;
      case 'blame': return !!p.vote && blamed.includes(p.vote) && !blamed.includes(p.id);
      case 'bugs': return p.bugsSquashed >= 15;
      case 'jobhunt': return !shipped;
      default: return false;
    }
  };

  g.results = {
    ending: g.ending,
    pct: Math.round((g.work / g.scope) * 100),
    bugs: g.bugs,
    burnouts: players.reduce((s, p) => s + p.burnouts, 0),
    blamed,
    players: players.map((p) => ({
      id: p.id, name: p.name, color: p.color, role: p.role, agenda: p.agenda,
      won: agendaWon(p), contribution: Math.round(p.contribution * 10) / 10,
      votes: players.filter((q) => q.vote === p.id).length, coffee: p.coffeeTotal, bugs: p.bugsSquashed,
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
  if (!g.phone) pool.push(['phone', 4]);
  pool.push(['osupdate', 2]);
  if (g.wifiUntil < now) pool.push(['wifi', 1.5]);
  if (!g.ceoUntil) pool.push(['ceo', 2]);
  if (g.pizzaUntil < now) pool.push(['pizza', 1.5]);
  if (!g.coffeeBroken) pool.push(['coffeebroken', 2]);
  pool.push(['forcepush', 1.5]);
  const total = pool.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  let type = pool[0][0];
  for (const [t, w] of pool) { if ((r -= w) <= 0) { type = t; break; } }

  switch (type) {
    case 'fire': {
      const hp = 25 + 10 * n;
      g.fire = { hp, max: hp };
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
      const p = candidates[Math.floor(Math.random() * candidates.length)];
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
      const culprit = players.find((p) => p.role === 'junior') || players[Math.floor(Math.random() * n)];
      g.work = Math.max(0, g.work - (4 + 2 * n));
      g.bugs += 3;
      fx(room, 'ev_forcepush', { name: culprit.name }, 'chaos');
      break;
    }
  }
}

function updatePlaying(room, dt, now) {
  const g = room.g;
  const players = list(room);
  const n = Math.max(1, players.length);

  for (const p of players) {
    if (p.burnoutUntil && now >= p.burnoutUntil) { p.burnoutUntil = 0; p.stress = 45; }
    if (!frozenReason(p, now)) addStress(room, p, 0.25 * dt, now);
  }

  if (g.fire) {
    g.work = Math.max(0, g.work - 0.004 * g.scope * dt);
    g.happiness -= 0.4 * dt;
  }
  g.happiness -= 0.1 * dt;
  if (g.bugs > 4 * n) g.happiness -= 0.15 * dt;

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
  if (g.happiness <= 0) return endSprint(room, now);

  if (now >= g.nextEventAt) {
    triggerEvent(room, now);
    g.nextEventAt = now + rand(16000, 26000) * (n <= 2 ? 1.25 : 1);
  }
  if (now >= g.phaseStart + g.phaseMs) endDay(room, now);
}

// ---------- Player actions ----------
// `ct` is the client's Date.now() when it queued the action; actions arrive in batches, so rate limits use it.
function handleTask(room, p, m, now) {
  const g = room.g;
  const ct = Number(m.ct) || now;
  switch (m.kind) {
    case 'code': {
      if (!nearAnyDesk(p) || ct - p.lastTask < 600) return;
      p.lastTask = ct;
      if (m.ok === false) { addStress(room, p, 3, now); return; }
      let amt = CODE_MULT[p.role] ?? 1;
      if (p.role === 'senior' && p.coffeeToday === 0) amt = 0.6;
      if (p.stress >= 80) amt *= 0.7;
      g.work = Math.min(g.scope * 1.5, g.work + amt);
      p.contribution += amt;
      addStress(room, p, 1.2, now);
      const bug = g.reviewUntil <= now && Math.random() < (BUG_CHANCE[p.role] ?? 0.25);
      if (bug) g.bugs++;
      tell(room, p.id, 'codeResult', { amt: Math.round(amt * 10) / 10, bug });
      break;
    }
    case 'bugs': {
      if (!near(p, 'bugs') || ct - p.lastBugs < 5000) return;
      p.lastBugs = ct;
      const count = clamp(Math.floor(Number(m.count) || 0), 0, 12);
      const squashed = Math.min(g.bugs, count * (p.role === 'qa' ? 2 : 1));
      g.bugs -= squashed;
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
      if (m.choice === 0) { g.happiness += 15 * mult; g.scope *= 1.08; fx(room, 'ev_phoneYes', { name: p.name }, 'info'); }
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
  }
}

function handleAbility(room, p, now) {
  const g = room.g;
  if (p.cdUntil > now) return;
  p.cdUntil = now + (COOLDOWN[p.role] || 30000);
  p.contribution += 2;
  const players = list(room);
  switch (p.role) {
    case 'manager': {
      const m = STATION.meeting;
      players.forEach((q, i) => {
        const a = (i / players.length) * Math.PI * 2;
        teleport(q, m.x + Math.cos(a) * 2.3, m.z + Math.sin(a) * 1.6);
        q.frozenUntil = now + 5000;
        q.stress = clamp(q.stress - 20, 0, 100);
      });
      g.happiness = clamp(g.happiness + 5, 0, 100);
      g.work = Math.max(0, g.work - players.length);
      fx(room, 'ab_used_manager', { name: p.name }, 'info');
      break;
    }
    case 'leader':
      g.reviewUntil = now + 15000;
      fx(room, 'ab_used_leader', { name: p.name }, 'good');
      break;
    case 'senior': {
      const removed = Math.ceil(g.bugs * 0.4);
      g.bugs -= removed;
      addStress(room, p, 10, now);
      fx(room, 'ab_used_senior', { name: p.name, n: removed }, 'good');
      break;
    }
    case 'junior':
      if (Math.random() < 0.5) {
        g.work = Math.min(g.scope * 1.5, g.work + 3 + players.length);
        fx(room, 'ab_used_junior_good', { name: p.name }, 'good');
      } else {
        g.bugs += 5;
        fx(room, 'ab_used_junior_bad', { name: p.name }, 'bad');
      }
      break;
    case 'qa': {
      const others = players.filter((q) => q.id !== p.id);
      if (!others.length) { p.cdUntil = 0; return; }
      others.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
      const target = others[0];
      addStress(room, target, 15, now);
      target.blameMarks++;
      fx(room, 'ab_used_qa', { name: p.name, target: target.name }, 'bad');
      break;
    }
    case 'sales':
      g.happiness = clamp(g.happiness + 18, 0, 100);
      g.scope *= 1.07;
      fx(room, 'ab_used_sales', { name: p.name }, 'info');
      break;
  }
}

function applyAction(room, pid, a, now) {
  const g = room.g;
  if (a.type === 'join') return addPlayer(room, pid, a.name);
  const p = room.players[pid];
  if (!p) return;
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
    case 'task':
      if (g.phase === 'playing' && !frozenReason(p, now)) handleTask(room, p, a, now);
      return;
    case 'ability':
      if (g.phase === 'playing' && !frozenReason(p, now)) handleAbility(room, p, now);
      return;
    case 'emote': {
      const ct = Number(a.ct) || now;
      if (!Number.isInteger(a.i) || a.i < 0 || a.i > 4 || ct - p.lastEmote < 1500) return;
      if (g.wifiUntil > now) return tell(room, pid, 'fx', { key: 'wifiNoEmote', params: {}, kind: 'bad' });
      p.lastEmote = ct;
      return push(room, { t: 'emote', id: pid, i: a.i });
    }
    case 'vote':
      if (g.phase !== 'retro' || a.target === pid || !room.players[a.target]) return;
      p.vote = a.target;
      if (list(room).every((q) => q.vote)) finishRetro(room, now);
      return;
    default:
  }
}

// ---------- Main entry ----------
// inputs: { [pid]: { t, pos, acts: [{seq, type, ...}], tpAck } } — the latest message from every client.
function step(room, inputs, now) {
  const b = WORLD.bounds;
  // Positions first, so proximity checks in actions use where players stand now.
  for (const [pid, inp] of Object.entries(inputs)) {
    const p = room.players[pid];
    if (!p || !inp || now - inp.t > STALE_MS || !inp.pos) continue;
    if ((inp.tpAck || 0) < (p.tp || 0)) continue; // client hasn't adopted a teleport yet
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
  if (g.phase === 'playing') updatePlaying(room, dt, now);
  else if ((g.phase === 'briefing' || g.phase === 'standup') && now >= g.phaseStart + g.phaseMs) startDay(room, g.day + 1, now);
  else if (g.phase === 'retro' && now >= g.phaseStart + g.phaseMs) finishRetro(room, now);
}

function snapshot(room, inputs, pid, lastEv, now) {
  const g = room.g;
  const me = room.players[pid];
  return {
    code: room.code,
    phase: g.phase, day: g.day,
    left: Math.max(0, g.phaseStart + g.phaseMs - now), total: g.phaseMs,
    work: Math.round(g.work * 100) / 100, scope: Math.round(g.scope * 100) / 100,
    bugs: g.bugs, happiness: Math.round(g.happiness),
    fire: g.fire && { hp: g.fire.hp, max: g.fire.max },
    phone: g.phone ? { left: Math.max(0, g.phone.until - now), q: g.phone.q } : null,
    coffeeBroken: g.coffeeBroken && { hp: g.coffeeBroken.hp, max: g.coffeeBroken.max },
    wifi: Math.max(0, g.wifiUntil - now), ceo: Math.max(0, g.ceoUntil - now),
    pizza: Math.max(0, g.pizzaUntil - now), pizzaId: g.pizzaId,
    review: Math.max(0, g.reviewUntil - now),
    cleanBugs: CLEAN_BUGS_PER_PLAYER * Math.max(1, list(room).length),
    results: g.results,
    me: me ? { role: me.role, agenda: me.agenda, tp: me.tp, x: me.x, z: me.z } : null,
    ackSeq: room.lastSeq[pid] || 0,
    events: room.events.filter((e) => e.seq > lastEv && (!e.to || e.to === pid)),
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
        cd: Math.max(0, p.cdUntil - now), cdMax: COOLDOWN[p.role] || 1,
        coffee: p.coffeeTotal, coffeeToday: p.coffeeToday, voted: !!p.vote, ateP: p.pizzaToken === g.pizzaId,
      };
    }),
  };
}

module.exports = { WORLD, createRoom, step, snapshot };
