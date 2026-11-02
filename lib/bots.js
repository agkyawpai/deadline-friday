'use strict';
// Server-side bots. They fill the office up to MIN_PLAYERS and play like a sharp teammate:
// grid pathfinding, a priority planner (emergencies → testing others' tickets → coding → boosts),
// a suspicion model fed by #git-log clues / git blame / Slack accusations, and Slack talk.
// A bot can also be the Job Hunter — then it sabotages carefully, frames others and lies.
const MIN_PLAYERS = 4;
const SPEED = 4.2;
const CELL = 0.5;
const BOT_NAMES = ['🤖မောင်မောင်', '🤖စုစု', '🤖ကိုကို', '🤖နီလာ'];
const TK_MM = {
  login: 'Login စာမျက်နှာ', payment: 'ငွေပေးချေမှု', chatbot: 'AI Chatbot', darkmode: 'Dark mode', nft: 'NFT ဆုလာဘ်', map: 'Live မြေပုံ',
  push: 'Push notification', search: 'ရှာဖွေမှု', loyalty: 'Loyalty point', reviews: 'အစားအသောက် review', referral: 'မိတ်ဆက် program', export: 'CSV export',
};
const ACCUSE_WORDS = ['sus', 'hunter', 'job', 'သံသယ', 'လိမ်', 'သစ္စာ', 'မင်းပဲ', 'sabotage', 'သူပဲ', 'ဖောက်'];

module.exports = function createBots(api) {
  const { WORLD, STATION, COLORS, COLOR_EMOJI, ROLE_ICON, DEPLOY_STATIONS, list, near, applyAction, canTest, isPip, freshStats } = api;
  const B = WORLD.bounds;
  const solid = WORLD.stations.filter((s) => s.solid);

  // ---------- Pathfinding grid ----------
  const COLS = Math.round((B.maxX - B.minX) / CELL) + 1;
  const ROWS = Math.round((B.maxZ - B.minZ) / CELL) + 1;
  const blocked = new Uint8Array(COLS * ROWS);
  const cx = (c) => B.minX + c * CELL;
  const cz = (r) => B.minZ + r * CELL;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      blocked[r * COLS + c] = solid.some((s) => Math.abs(cx(c) - s.x) < s.w / 2 + 0.4 && Math.abs(cz(r) - s.z) < s.d / 2 + 0.4) ? 1 : 0;
    }
  }
  const toCell = (x, z) => [
    Math.max(0, Math.min(COLS - 1, Math.round((x - B.minX) / CELL))),
    Math.max(0, Math.min(ROWS - 1, Math.round((z - B.minZ) / CELL))),
  ];
  const free = (c, r) => c >= 0 && r >= 0 && c < COLS && r < ROWS && !blocked[r * COLS + c];
  function nearestFree(c, r) {
    if (free(c, r)) return [c, r];
    for (let d = 1; d < 8; d++) {
      for (let dc = -d; dc <= d; dc++) for (const dr of [-d, d]) { if (free(c + dc, r + dr)) return [c + dc, r + dr]; if (free(c + dr, r + dc)) return [c + dr, r + dc]; }
    }
    return [c, r];
  }
  function findPath(x0, z0, x1, z1) {
    const [sc, sr] = toCell(x0, z0);
    const [gc, gr] = nearestFree(...toCell(x1, z1));
    const start = sr * COLS + sc;
    const goal = gr * COLS + gc;
    const prev = new Int32Array(COLS * ROWS).fill(-1);
    prev[start] = start;
    const queue = [start];
    for (let qi = 0; qi < queue.length; qi++) {
      const cur = queue[qi];
      if (cur === goal) break;
      const c = cur % COLS;
      const r = (cur - c) / COLS;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nc = c + dc;
        const nr = r + dr;
        if (!free(nc, nr)) continue;
        if (dc && dr && (!free(c + dc, r) || !free(c, r + dr))) continue; // no corner cutting
        const ni = nr * COLS + nc;
        if (prev[ni] !== -1) continue;
        prev[ni] = cur;
        queue.push(ni);
      }
    }
    if (prev[goal] === -1) return [[x1, z1]];
    const cells = [];
    for (let cur = goal; cur !== start; cur = prev[cur]) cells.push(cur);
    cells.reverse();
    const pts = cells.map((i) => [cx(i % COLS), cz(Math.floor(i / COLS))]);
    if (free(...toCell(x1, z1))) pts.push([x1, z1]);
    return pts;
  }

  // Where to stand to use a station (spread several bots with `slot`).
  function standPoint(st, slot = 0) {
    const s = STATION[st];
    const spread = (slot % 3 - 1) * 0.7;
    const cands = [[spread, s.d / 2 + 0.75], [-(s.w / 2 + 0.75), spread], [s.w / 2 + 0.75, spread], [spread, -(s.d / 2 + 0.75)]];
    for (const [dx, dz] of cands) {
      const x = s.x + dx;
      const z = s.z + dz;
      if (x < B.minX || x > B.maxX || z < B.minZ || z > B.maxZ) continue;
      if (Math.hypot(dx, dz) > 2.2 || !free(...toCell(x, z))) continue;
      return { x, z };
    }
    return { x: s.x, z: s.z + s.d / 2 + 0.75 };
  }

  // ---------- Lifecycle ----------
  function fill(room, now) {
    const humans = list(room).filter((p) => !p.bot);
    const need = Math.max(0, MIN_PLAYERS - humans.length);
    for (let i = 0; i < need; i++) {
      const used = new Set(list(room).map((p) => p.color));
      const id = `bot-${Math.random().toString(36).slice(2, 10)}`;
      room.players[id] = {
        id, name: BOT_NAMES[i % BOT_NAMES.length], color: COLORS.find((c) => !used.has(c)) || COLORS[i],
        isHost: false, role: null, agenda: null, x: 0, z: 5, face: 0, moving: false, tp: 1, ...freshStats(),
        bot: { i, nextAt: now, path: null, goalKey: null, task: null, busyUntil: 0, codeAt: 0, chatAt: 0, sus: {}, evSeen: 0, said: [], voteAt: 0, phase: null },
      };
    }
  }
  function removeAll(room) {
    for (const p of list(room)) if (p.bot) delete room.players[p.id];
  }

  // ---------- Movement ----------
  function goTo(p, key, pt) {
    const b = p.bot;
    if (b.goalKey === key && b.path) return;
    b.goalKey = key;
    b.path = findPath(p.x, p.z, pt.x, pt.z);
    b.busyUntil = 0;
  }
  function moveAlong(p, dt) {
    const b = p.bot;
    if (!b.path || !b.path.length) { p.moving = false; return; }
    let step = SPEED * dt;
    while (step > 0 && b.path.length) {
      const [tx, tz] = b.path[0];
      const dx = tx - p.x;
      const dz = tz - p.z;
      const d = Math.hypot(dx, dz);
      if (d <= step) { p.x = tx; p.z = tz; b.path.shift(); step -= d; }
      else { p.x += (dx / d) * step; p.z += (dz / d) * step; p.face = Math.atan2(dx, dz); step = 0; }
    }
    p.moving = b.path.length > 0;
  }
  const arrived = (p) => !p.bot.path || !p.bot.path.length;
  const act = (room, p, type, data, now) => applyAction(room, p.id, { ...data, type, ct: now }, now);

  // ---------- Talking ----------
  function say(room, p, text, now, force = false) {
    if (!force && (now - p.bot.chatAt < 9000 || now - (room.botChatAt || 0) < 3000)) return;
    p.bot.chatAt = now;
    room.botChatAt = now;
    act(room, p, 'chat', { text }, now);
  }

  // ---------- Suspicion (only from public info — what a careful human would notice) ----------
  function observe(room, p, now) {
    const b = p.bot;
    for (const e of room.events) {
      if (e.seq <= b.evSeen) continue;
      if (e.t === 'chat' && e.ch === 'git' && e.key === 'git_sus') {
        const clue = e.params.clue;
        const byColor = list(room).find((q) => COLOR_EMOJI[q.color] === clue);
        const byRole = list(room).filter((q) => ROLE_ICON[q.role] === clue);
        if (byColor && byColor.id !== p.id) {
          b.sus[byColor.id] = (b.sus[byColor.id] || 0) + 3;
          if (Math.random() < 0.45) say(room, p, `${clue} ဆိုတော့… ${byColor.name} လား? 🤔`, now);
        } else if (byRole.length) {
          for (const q of byRole) if (q.id !== p.id) b.sus[q.id] = (b.sus[q.id] || 0) + 3 / byRole.length;
          if (byRole.length === 1 && byRole[0].id !== p.id && Math.random() < 0.45) say(room, p, `${clue} role က ${byRole[0].name} တစ်ယောက်ပဲ ရှိတယ်နော် 👀`, now);
        }
      } else if (e.t === 'chat' && e.ch === 'git' && e.key === 'git_blame' && e.to === p.id) {
        const culprit = list(room).find((q) => q.name === e.params.name);
        if (p.agenda === 'jobhunt') {
          // Lie: point at whoever the room already suspects.
          const scapegoat = list(room).filter((q) => q.id !== p.id).sort((a, c) => (b.sus[c.id] || 0) - (b.sus[a.id] || 0))[0];
          if (scapegoat) say(room, p, `🔎 git blame #${e.params.id} လုပ်ကြည့်တာ ${scapegoat.name} ပဲ!! 😡`, now, true);
        } else if (culprit && culprit.id !== p.id) {
          b.sus[culprit.id] = (b.sus[culprit.id] || 0) + 10;
          say(room, p, `🔎 git blame #${e.params.id} လုပ်ကြည့်တာ ${culprit.name} ပဲ!! 😡`, now, true);
        }
      } else if (e.t === 'chat' && !e.ch && e.from !== p.id && !e.to) {
        const text = String(e.text || '').toLowerCase();
        if (text.includes('git blame')) {
          const named = list(room).find((q) => q.id !== e.from && text.includes(q.name.toLowerCase()));
          if (named && named.id !== p.id) b.sus[named.id] = (b.sus[named.id] || 0) + 4; // trust a blame claim, a bit
          continue;
        }
        if (!ACCUSE_WORDS.some((w) => text.includes(w))) continue;
        for (const q of list(room)) {
          if (!text.includes(q.name.replace('🤖', '').toLowerCase())) continue;
          if (q.id === p.id) {
            const target = topSuspect(room, p);
            if (p.agenda === 'jobhunt' && target) say(room, p, `ငါ့ကို မစွပ်စွဲနဲ့၊ ${target.name} ကို ကြည့်ပါဦး 🤨`, now, true);
            else say(room, p, 'ငါမဟုတ်ဘူး 🙅 #git-log ကို ပြန်ကြည့်ပါ', now, true);
          } else {
            b.sus[q.id] = (b.sus[q.id] || 0) + 0.7; // humans can sway bots — and manipulate them
          }
        }
      }
    }
    b.evSeen = room.evSeq;
  }
  function topSuspect(room, p, min = 0) {
    let best = null;
    let bestS = min;
    for (const q of list(room)) {
      if (q.id === p.id || q.caught) continue;
      const s = p.bot.sus[q.id] || 0;
      if (s > bestS) { best = q; bestS = s; }
    }
    return best;
  }

  // ---------- Planner ----------
  const reserved = (room, p, key) => list(room).some((q) => q.bot && q.id !== p.id && q.bot.task === key);
  function closest(st, pool) {
    const s = STATION[st];
    return pool.slice().sort((a, c) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(c.x - s.x, c.z - s.z));
  }
  function freeDesk(room, p) {
    const desks = WORLD.stations.filter((s) => s.type === 'desk')
      .sort((a, c) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(c.x - p.x, c.z - p.z));
    for (const d of desks) {
      const pt = standPoint(d.id);
      const taken = list(room).some((q) => q.id !== p.id && Math.hypot(q.x - pt.x, q.z - pt.z) < 0.9);
      if (!taken && !reserved(room, p, `desk:${d.id}`)) return d.id;
    }
    return desks[0].id;
  }

  function plan(room, p, now) {
    const g = room.g;
    const everyone = list(room);
    if (g.fire && closest('server', everyone).slice(0, 2).includes(p)) return { key: 'fire', st: 'server', kind: 'fire' };
    if (g.phone && closest('phone', everyone)[0] === p) return { key: 'phone', st: 'phone', kind: 'phone' };
    if (g.pizzaUntil > now && p.pizzaToken !== g.pizzaId) return { key: `pizza:${p.id}`, st: 'meeting', kind: 'pizza' };
    if (g.ceoUntil > now) {
      const desk = p.bot.task?.startsWith('desk:') ? p.bot.task.slice(5) : freeDesk(room, p);
      const t = g.tickets.find((x) => x.stage === 'dev');
      return { key: `desk:${desk}`, st: desk, kind: t ? 'code' : 'idle', ticket: t?.id };
    }
    // Test other people's tickets first — that's what blocks the team. QA is twice as good at it.
    const testable = g.tickets.filter((t) => t.stage === 'qa' && canTest(p, t) && !reserved(room, p, `qa:${t.id}`));
    if (testable.length && (p.role === 'qa' || !list(room).some((q) => q.role === 'qa' && q.bot && q.id !== p.id))) {
      return { key: `qa:${testable[0].id}`, st: 'qa', kind: 'qa', ticket: testable[0].id };
    }
    if (p.boostUntil <= now && now - p.lastCoffee > 30000 && Math.random() < 0.15) return { key: `coffee:${p.id}`, st: 'coffee', kind: 'coffee' };
    // Code: my ticket, else claim one, else help the one furthest from done.
    let t = g.tickets.find((x) => x.stage === 'dev' && x.owner === p.id);
    if (!t) {
      const todo = g.tickets.find((x) => x.stage === 'todo');
      if (todo) { act(room, p, 'claim', { ticket: todo.id }, now); t = todo; }
    }
    if (!t) t = g.tickets.filter((x) => x.stage === 'dev').sort((a, c) => (c.work - c.progress) - (a.work - a.progress))[0];
    if (t) {
      const desk = p.bot.task?.startsWith('desk:') ? p.bot.task.slice(5) : freeDesk(room, p);
      return { key: `desk:${desk}`, st: desk, kind: 'code', ticket: t.id };
    }
    if (testable.length) return { key: `qa:${testable[0].id}`, st: 'qa', kind: 'qa', ticket: testable[0].id };
    return { key: `idle:${p.id}`, st: freeDesk(room, p), kind: 'idle' };
  }

  function execute(room, p, task, now) {
    const g = room.g;
    const b = p.bot;
    b.task = task.key;
    goTo(p, task.key, standPoint(task.st, b.i));
    if (!arrived(p) || !near(p, task.st)) return;
    switch (task.kind) {
      case 'fire':
        for (let k = 0; k < 4; k++) act(room, p, 'task', { kind: 'fix', ct: now + k * 110 }, now);
        return;
      case 'code':
        if (now - b.codeAt < 1700) return;
        b.codeAt = now;
        act(room, p, 'task', { kind: 'code', ticket: task.ticket, ok: Math.random() > 0.05 }, now);
        return;
      case 'idle':
        return;
      default:
    }
    // Test / phone / food take a moment, like a human doing the minigame.
    const dur = { qa: 3500, phone: 1500, coffee: 1300, pizza: 600 }[task.kind] || 1000;
    if (!b.busyUntil) { b.busyUntil = now + dur * (0.8 + Math.random() * 0.4); return; }
    if (now < b.busyUntil) return;
    b.busyUntil = 0;
    if (task.kind === 'qa') {
      const t = g.tickets.find((x) => x.id === task.ticket);
      act(room, p, 'task', { kind: 'qa', ticket: task.ticket, count: t ? t.bugs : 0 }, now);
    } else if (task.kind === 'phone') {
      act(room, p, 'task', { kind: 'phone', choice: g.happiness < 60 ? 0 : 1 }, now);
    } else {
      act(room, p, 'task', { kind: task.kind }, now);
    }
  }

  // Nudge the human whose turn it is to test a ticket I wrote (a nudge, not spam).
  function nudge(room, p, now) {
    const g = room.g;
    const t = g.tickets.find((x) => x.stage === 'qa' && x.owner === p.id);
    if (!t || p.bot.said.includes(`ask:${t.id}`)) return;
    const qa = list(room).find((q) => q.role === 'qa' && !q.bot);
    if (!qa) return;
    p.bot.said.push(`ask:${t.id}`);
    say(room, p, `${qa.name} ရေ “${TK_MM[t.key] || t.key}” ကို test လုပ်ပေးပါဦး 🙏`, now);
  }

  function useAbility(room, p, now) {
    const g = room.g;
    if (p.cdUntil > now || isPip(room, p) || p.caught) return;
    const want = {
      senior: () => g.tickets.filter((t) => t.stage === 'dev' || t.stage === 'qa').length >= 2,
      junior: () => g.tickets.some((t) => t.stage === 'dev' && t.owner === p.id && t.progress < t.work * 0.5) && Math.random() < 0.4,
      qa: () => g.log.some((e) => !e.blamed),
      leader: () => g.phase === 'playing' && g.emergencyDay !== g.day && g.middayDone && !!topSuspect(room, p, 6),
    }[p.role];
    if (want && want()) act(room, p, 'ability', {}, now);
  }

  function useSecret(room, p, now) {
    const g = room.g;
    if (p.agenda !== 'jobhunt' || p.caught || p.secretUntil > now || isPip(room, p)) return;
    if (g.phase === 'deploy') {
      if (near(p, 'server') && g.deploy && g.deploy.progress > 30 && g.deploy.progress < 85 && Math.random() < 0.5) act(room, p, 'secret', {}, now);
      return;
    }
    const witnesses = list(room).filter((q) => q.id !== p.id && Math.hypot(q.x - p.x, q.z - p.z) < 4).length;
    if (g.day >= 2 && witnesses <= 1 && Math.random() < 0.3) act(room, p, 'secret', {}, now); // lie low on Monday
  }

  function meeting(room, p, now) {
    const g = room.g;
    const m = g.meeting;
    const b = p.bot;
    if (!m || m.votes[p.id] !== undefined) return;
    if (!b.voteAt) { b.voteAt = now + 4000 + Math.random() * 8000; return; } // let humans talk first
    if (now < b.voteAt) return;
    b.voteAt = 0;
    const suspect = p.agenda === 'jobhunt' ? topSuspect(room, p, 1) : topSuspect(room, p, 3);
    if (suspect) {
      say(room, p, `${suspect.name} ကို မဲပေးမယ် — #git-log သဲလွန်စတွေ သူ့ဘက် ညွှန်နေတယ် 🫵`, now, true);
      act(room, p, 'vote', { target: suspect.id }, now);
    } else {
      say(room, p, 'သဲလွန်စ မလုံလောက်သေးဘူး၊ ကျော်မယ် 🤷', now, true);
      act(room, p, 'vote', { target: 'skip' }, now);
    }
  }

  function deploy(room, p, now) {
    const g = room.g;
    const b = p.bot;
    if (g.fire && closest('server', list(room)).slice(0, 1).includes(p)) {
      execute(room, p, { key: 'fire', st: 'server', kind: 'fire' }, now);
      p.hold = 'server';
      return;
    }
    // Job Hunter guards the server so it can pull the plug; everyone else takes a station nobody holds.
    const taken = new Set(list(room).filter((q) => q.id !== p.id).map((q) => q.hold || (q.bot?.task?.startsWith('hold:') ? q.bot.task.slice(5) : null)).filter(Boolean));
    let st = b.task?.startsWith('hold:') ? b.task.slice(5) : null;
    if (!st) st = p.agenda === 'jobhunt' && !p.caught && !taken.has('server') ? 'server' : DEPLOY_STATIONS.find((s) => !taken.has(s)) || DEPLOY_STATIONS[b.i % 4];
    b.task = `hold:${st}`;
    goTo(p, b.task, standPoint(st, 0));
    // A caught Job Hunter still walks to a station… but never actually holds it.
    p.hold = arrived(p) && !(p.agenda === 'jobhunt' && p.caught) ? st : null;
    if (b.i === 0 && !b.said.includes('deploy')) { b.said.push('deploy'); say(room, p, 'Deploy! လင်းနေတဲ့ နေရာ ၄ ခုကို တစ်ယောက်တစ်နေရာ ယူကြ 🚀', now, true); }
  }

  // ---------- Main tick ----------
  function tick(room, dt, now) {
    const g = room.g;
    for (const p of list(room)) {
      if (!p.bot) continue;
      const b = p.bot;
      if (b.phase !== g.phase) { b.phase = g.phase; b.path = null; b.goalKey = null; b.task = null; b.busyUntil = 0; b.voteAt = 0; p.hold = null; }
      if (g.phase === 'playing' || g.phase === 'deploy') moveAlong(p, dt);
      else p.moving = false;
      if (now < b.nextAt) continue;
      b.nextAt = now + 300 + Math.random() * 200;
      observe(room, p, now);
      switch (g.phase) {
        case 'morning':
          // Let humans pick first, then grab a leftover ticket.
          if (now - g.phaseStart > 5000 && !g.tickets.some((t) => t.owner === p.id && t.stage === 'dev')) {
            const todo = g.tickets.find((t) => t.stage === 'todo');
            if (todo) act(room, p, 'claim', { ticket: todo.id }, now);
          }
          break;
        case 'playing':
          execute(room, p, plan(room, p, now), now);
          useAbility(room, p, now);
          useSecret(room, p, now);
          nudge(room, p, now);
          break;
        case 'deploy':
          deploy(room, p, now);
          useSecret(room, p, now);
          break;
        case 'meeting':
          meeting(room, p, now);
          break;
        default:
      }
    }
  }

  return { fill, removeAll, tick };
};
