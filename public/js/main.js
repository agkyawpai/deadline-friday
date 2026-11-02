import { Office, escapeHtml } from './scene.js';
import { t, setLang, getLang, ROLE_ICON } from './i18n.js';
import { Minigames } from './minigames.js';
import { Net } from './net.js';

const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

let myId = null;
let world = null;
let office = null;
let state = null;
let priv = null;
let joined = false;
let lastPhase = null;
let action = null;
let moveTarget = null;
const me = { x: 2, z: 5, face: 0, moving: false };
const keys = new Set();

// ---------- Sound (tiny WebAudio beeps, no audio files) ----------
let actx = null;
let muted = false;
const SFX = {
  tick: [[880, 0.04]], ok: [[660, 0.07], [990, 0.09]], err: [[160, 0.18, 'sawtooth']], bug: [[300, 0.08], [200, 0.12]],
  pop: [[1200, 0.05]], mash: [[240, 0.05, 'square']], slurp: [[420, 0.1], [300, 0.15]],
  win: [[523, 0.1], [659, 0.1], [784, 0.18]], good: [[523, 0.08], [784, 0.12]], bad: [[392, 0.1], [262, 0.18]],
  alarm: [[880, 0.18, 'square'], [660, 0.18, 'square'], [880, 0.18, 'square'], [660, 0.18, 'square']],
  ring: [[1300, 0.07], [1550, 0.07], [1300, 0.07], [1550, 0.07]], toast: [[700, 0.05]],
};
function sfx(name) {
  if (muted || !actx) return;
  let at = actx.currentTime;
  for (const [f, d, type = 'sine'] of SFX[name] || []) {
    const o = actx.createOscillator();
    const gn = actx.createGain();
    o.type = type;
    o.frequency.value = f;
    gn.gain.setValueAtTime(0.1, at);
    gn.gain.exponentialRampToValueAtTime(0.001, at + d);
    o.connect(gn).connect(actx.destination);
    o.start(at);
    o.stop(at + d + 0.02);
    at += d;
  }
}

const mg = new Minigames({ modal: $('#modal'), send: emit, sfx });

// ---------- Helpers ----------
const cache = new Map();
function setHTML(el, html) {
  if (cache.get(el) === html) return;
  cache.set(el, html);
  el.innerHTML = html;
}
function show(el, on) { el.classList.toggle('hidden', !on); }
function toast(text, kind = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  const box = $('#toasts');
  box.prepend(el);
  while (box.children.length > 5) box.lastChild.remove();
  window.gsap.fromTo(el, { y: -16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3 });
  setTimeout(() => window.gsap.to(el, { opacity: 0, duration: 0.4, onComplete: () => el.remove() }), 4500);
}
function applyStaticText() {
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  $('#btn-lang').textContent = t('langBtn');
  document.title = t('title');
  cache.clear();
}
const myState = () => state && state.players.find((p) => p.id === myId);
const secs = (ms) => Math.ceil(ms / 1000);

// ---------- Networking ----------
const net = new Net({
  onState,
  onTeleport: (x, z) => {
    me.x = x;
    me.z = z;
    moveTarget = null;
    net.pos = { x, z, face: me.face, moving: false };
  },
  onEvent: (e) => {
    switch (e.t) {
      case 'fx': return onFx(e);
      case 'emote': office?.showEmote(e.id, t(`emote${e.i}`)); return sfx('toast');
      case 'codeResult': return mg.codeResult(e);
      case 'bugsResult': return mg.bugsResult(e);
      case 'denied': return leaveRoom(t(e.key));
      default:
    }
  },
  onError: (err) => {
    if (err === 'offline') return toast(t('offline'), 'bad');
    leaveRoom(t(err === 'noRoom' ? 'noRoom' : 'syncError'));
  },
});
myId = net.pid;

// Actions from UI / minigames. 'task' payloads use `type` for the task kind on the client side.
function emit(ev, data) {
  if (ev === 'task') {
    const { type, ...rest } = data;
    net.send('task', { kind: type, ...rest });
  } else if (ev === 'emote') net.send('emote', { i: data });
  else if (ev === 'vote') net.send('vote', { target: data });
  else net.send(ev, data);
}

function onFx({ key, params, kind }) {
  toast(t(key, params), kind);
  if (key === 'ev_fire') { sfx('alarm'); office?.shake(0.9); }
  else if (key === 'ev_phone') sfx('ring');
  else if (key === 'ab_used_manager' || key === 'ev_forcepush') { sfx('bad'); office?.shake(0.6); }
  else if (kind === 'chaos') { sfx('bad'); office?.shake(0.35); }
  else if (kind === 'good') sfx('good');
  else if (kind === 'bad') sfx('bad');
  else sfx('toast');
}

function enterRoom(code, create) {
  if (!actx) {
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { actx = null; }
  }
  $('#join-err').textContent = '';
  const name = $('#join-name').value;
  try {
    localStorage.setItem('df_name', name);
    sessionStorage.setItem('df_room', code);
  } catch { /* storage unavailable */ }
  net.start(code);
  net.send('join', { name, create });
}
function leaveRoom(message = '') {
  net.stop();
  joined = false;
  state = null;
  priv = null;
  lastPhase = null;
  mg.close(true);
  try { sessionStorage.removeItem('df_room'); } catch { /* storage unavailable */ }
  $('#join-err').textContent = message;
  show($('#join'), true);
  for (const id of ['#lobby-panel', '#topbar', '#players', '#bottombar', '#help', '#briefing', '#standup', '#retro', '#results', '#frozen']) show($(id), false);
  office?.syncPlayers([], myId, null);
}
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function createRoom() {
  const code = Array.from({ length: 4 }, () => ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)]).join('');
  enterRoom(code, true);
}
function joinRoom() {
  const code = $('#join-code').value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,6}$/.test(code)) { $('#join-err').textContent = t('noRoom'); return; }
  enterRoom(code, false);
}

// ---------- State → UI ----------
function onState(s) {
  state = s;
  const mine = myState();
  if (mine && !joined) show($('#join'), false);
  joined = !!mine;
  priv = s.me && s.me.role ? { role: s.me.role, agenda: s.me.agenda } : null;
  if (s.phase !== lastPhase) onPhaseChange(s.phase);
  if (!office) return;

  office.syncPlayers(s.players, myId, joined && mine ? me : null);
  office.setFire(s.fire);
  office.setPhone(s.phone);
  office.setPizza(s.pizza > 0);
  office.setCoffeeBroken(s.coffeeBroken);
  office.setCEO(s.ceo);
  office.setBugs(s.bugs);
  const dayHours = s.day === 5 ? 8 : 9;
  const hours = s.phase === 'playing' ? 9 + (1 - s.left / s.total) * dayHours
    : s.phase === 'standup' ? 18 : s.phase === 'retro' || s.phase === 'results' ? 17 : 9;
  office.setClock(hours);

  renderLobby(s, mine);
  renderHUD(s, mine, hours);
  renderBriefing(s);
  renderStandup(s);
  renderRetro(s, mine);
  renderResults(s, mine);
  renderFrozen(mine);
  mg.onState(s, mine);
}

function onPhaseChange(phase) {
  lastPhase = phase;
  mg.close(true);
  moveTarget = null;
  if (phase === 'briefing') sfx('win');
  if (phase === 'retro') sfx('alarm');
  if (phase === 'results') sfx(['shipped', 'onfire'].includes(state.results?.ending) ? 'win' : 'bad');
}

function renderLobby(s, mine) {
  const on = joined && s.phase === 'lobby';
  show($('#lobby-panel'), on);
  if (!on) return;
  const list = s.players.map((p) => `<li><i style="background:${p.color}"></i>${escapeHtml(p.name)}${p.isHost ? ` <b class="host">${t('host')}</b>` : ''}${p.id === myId ? ' 👈' : ''}</li>`).join('');
  setHTML($('#lobby-panel'), `
    <div class="room-code"><small>${t('roomCode')}</small><b>${escapeHtml(s.code)}</b>
      <button class="copy" id="btn-copy">${t('copyLink')}</button></div>
    <h2>${t('lobbyPlayers', { n: s.players.length })}</h2>
    <ul class="plist">${list}</ul>
    <p class="muted">${t('recommend')}</p>
    ${mine?.isHost ? `<button class="btn primary" id="btn-start">${t('start')}</button>` : `<p class="waiting">${t('waiting')}</p>`}`);
}

function renderHUD(s, mine, hours) {
  const playing = s.phase === 'playing' && joined;
  show($('#topbar'), playing || s.phase === 'standup');
  show($('#players'), playing);
  show($('#bottombar'), playing || (joined && s.phase === 'lobby'));
  show($('#help'), joined && (s.phase === 'lobby' || s.phase === 'playing'));
  if (!(playing || s.phase === 'standup')) return;

  const hh = Math.floor(hours);
  const mm = Math.floor((hours % 1) * 60);
  $('#hud-day').textContent = t(`day${s.day}`);
  $('#hud-clock').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  $('#hud-clock').classList.toggle('late', s.day === 5 && hours >= 16);
  const pct = Math.round((s.work / s.scope) * 100);
  $('#hud-progress').style.width = `${clamp(pct, 0, 100)}%`;
  $('#hud-progress-t').textContent = `${pct}%`;
  $('#hud-bugs').textContent = `${s.bugs}`;
  $('#hud-bugs').parentElement.classList.toggle('danger', s.bugs > s.cleanBugs);
  $('#hud-client').style.width = `${s.happiness}%`;
  $('#hud-client').classList.toggle('low', s.happiness < 30);
  $('#hud-client-t').textContent = s.happiness < 30 ? '😡' : s.happiness < 60 ? '😐' : '😊';
  const chips = [];
  if (s.fire) chips.push(`<span class="chip red">${t('hud_fire')}</span>`);
  if (s.coffeeBroken) chips.push(`<span class="chip">${t('hud_coffee')}</span>`);
  if (s.review) chips.push(`<span class="chip green">${t('hud_review', { s: secs(s.review) })}</span>`);
  if (s.wifi) chips.push(`<span class="chip">${t('hud_wifi', { s: secs(s.wifi) })}</span>`);
  if (s.ceo) chips.push(`<span class="chip gold">${t('hud_ceo', { s: secs(s.ceo) })}</span>`);
  setHTML($('#hud-chips'), chips.join(''));

  setHTML($('#players'), s.players.map((p) => {
    const st = p.frozen ? t(`st_${p.frozen}`) : '';
    const col = p.stress >= 80 ? '#ff6b6b' : p.stress >= 50 ? '#fcc419' : '#51cf66';
    return `<div class="pl${p.id === myId ? ' me' : ''}"><i style="background:${p.color}"></i>
      <span class="pl-name">${p.role ? ROLE_ICON[p.role] : ''} ${escapeHtml(p.name)} ${st}</span>
      <div class="stress"><div style="width:${p.stress}%;background:${col}"></div></div></div>`;
  }).join(''));

  const ab = $('#btn-ability');
  show(ab, playing && !!mine?.role);
  if (mine?.role) {
    ab.querySelector('.lbl').textContent = `Q · ${t(`ab_${mine.role}`)}${mine.cd ? ` (${secs(mine.cd)})` : ''}`;
    ab.querySelector('.cd').style.width = `${(mine.cd / mine.cdMax) * 100}%`;
    ab.classList.toggle('ready', !mine.cd && !mine.frozen);
  }
}

function renderBriefing(s) {
  const on = s.phase === 'briefing' && joined;
  show($('#briefing'), on);
  if (!on || !priv) return;
  setHTML($('#briefing'), `<div class="card wide">
    <p class="mission">${t('brief_mission')}</p>
    <div class="cards">
      <div class="rcard role"><small>${t('brief_role')}</small><div class="big">${ROLE_ICON[priv.role]}</div>
        <h3>${t(`role_${priv.role}`)}</h3><p>${t(`rdesc_${priv.role}`)}</p></div>
      <div class="rcard agenda${priv.agenda === 'jobhunt' ? ' evil' : ''}"><small>${t('brief_agenda')}</small><div class="big">🤫</div>
        <h3>${t(`ag_${priv.agenda}`)}</h3><p>${t(`agd_${priv.agenda}`)}</p></div>
    </div>
    <p class="countdown">${t('brief_starts', { s: secs(s.left) })}</p></div>`);
}

function renderStandup(s) {
  const on = s.phase === 'standup' && joined;
  show($('#standup'), on);
  if (!on) return;
  setHTML($('#standup'), `<div class="card">
    <h2>${t('standup_title', { day: `@day${s.day}` })}</h2>
    <div class="stats">
      <div><b>${Math.round((s.work / s.scope) * 100)}%</b><small>${t('hud_progress')}</small></div>
      <div><b>🐛 ${s.bugs}</b><small>${t('hud_bugs')}</small></div>
      <div><b>${s.happiness}</b><small>${t('hud_client')}</small></div>
    </div>
    <h3>${t('standup_next', { day: `@day${s.day + 1}` })} · ${secs(s.left)}s</h3>
    <p class="muted">${s.day + 1 === 5 ? t('deadline') : t('standup_tip')}</p></div>`);
}

function renderRetro(s, mine) {
  const on = s.phase === 'retro' && joined;
  show($('#retro'), on);
  if (!on) return;
  const others = s.players.filter((p) => p.id !== myId);
  const myVote = mine?.voted;
  const buttons = others.length
    ? others.map((p) => `<button class="vote" data-vote="${p.id}" ${myVote ? 'disabled' : ''}>
        <i style="background:${p.color}"></i>${ROLE_ICON[p.role] || ''} ${escapeHtml(p.name)}${p.voted ? ' <small>✓</small>' : ''}</button>`).join('')
    : `<p>${t('retro_solo')}</p>`;
  setHTML($('#retro .retro-body'), `<h2>${t('retro_title')}</h2><p>${t('retro_sub')}</p>
    <div class="votes">${buttons}</div>${myVote ? `<p class="muted">${t('retro_voted')}</p>` : ''}`);
  $('#retro .retro-left').textContent = t('retro_left', { s: secs(s.left) });
}

function renderResults(s, mine) {
  const on = s.phase === 'results' && joined && s.results;
  show($('#results'), !!on);
  if (!on) return;
  const r = s.results;
  const blamed = r.blamed.map((id) => r.players.find((p) => p.id === id)?.name).filter(Boolean).map(escapeHtml).join(', ');
  const rows = r.players.map((p) => `<tr${p.id === myId ? ' class="me"' : ''}>
      <td><i style="background:${p.color}"></i>${escapeHtml(p.name)}</td>
      <td>${ROLE_ICON[p.role]} ${t(`role_${p.role}`)}</td>
      <td>${t(`ag_${p.agenda}`)}</td>
      <td>${p.won ? t('res_win') : t('res_lose')}</td>
      <td>${p.contribution}</td></tr>`).join('');
  setHTML($('#results'), `<div class="card wide">
    <h1 class="ending ${r.ending}">${t(`end_${r.ending}`)}</h1>
    <p class="lead">${t(`endd_${r.ending}`, { bugs: r.bugs, pct: r.pct, burn: r.burnouts })}</p>
    <p>${blamed ? t('res_mostBlamed', { name: blamed }) : t('res_noBlame')}</p>
    <div class="table-wrap"><table><thead><tr><th>${t('res_player')}</th><th>${t('res_role')}</th><th>${t('res_agenda')}</th>
      <th>${t('res_result')}</th><th>${t('res_contrib')}</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${mine?.isHost ? `<button class="btn primary" id="btn-restart">${t('playAgain')}</button>` : `<p class="muted">${t('waitHost')}</p>`}</div>`);
}

function renderFrozen(mine) {
  const el = $('#frozen');
  const f = joined && state.phase === 'playing' && mine?.frozen;
  show(el, !!f);
  el.className = f ? `frozen ${f}` : 'hidden';
  if (!f) return;
  const s = secs(mine.frozenLeft);
  if (f === 'locked') {
    const p = Math.min(99, Math.round((1 - mine.frozenLeft / 10000) * 100));
    setHTML(el, `<div class="spinner"></div><h2>${t('frz_locked', { p })}</h2><p>${t('frz_locked2', { s })}</p>`);
  } else {
    setHTML(el, `<h2>${t(`frz_${f}`, { s })}</h2>`);
  }
}

// ---------- Interaction ----------
function actionFor(st, mine) {
  switch (st.type) {
    case 'desk': return 'code';
    case 'bugs': return 'bugs';
    case 'coffee': return state.coffeeBroken ? 'fixCoffee' : 'coffee';
    case 'server': return state.fire ? 'fire' : null;
    case 'phone': return state.phone ? 'phone' : null;
    case 'meeting': return state.pizza > 0 && !mine.ateP ? 'pizza' : null;
    case 'exit': return 'exit';
    default: return null;
  }
}
function detectAction(mine) {
  if (!state || state.phase !== 'playing' || !mine || !joined) return null;
  let best = null;
  let bestD = Infinity;
  for (const st of world.stations) {
    const d = Math.hypot(me.x - st.x, me.z - st.z);
    const range = st.type === 'meeting' ? 2.8 : 2.2;
    if (d > range || d >= bestD) continue;
    const act = actionFor(st, mine);
    if (act) { best = { st, act }; bestD = d; }
  }
  return best;
}
const ACT_LABEL = { code: 'act_code', bugs: 'act_bugs', coffee: 'act_coffee', fixCoffee: 'act_fixCoffee', fire: 'act_fire', phone: 'act_phone', pizza: 'act_pizza', exit: 'hint_exit' };
function renderAction(mine) {
  const btn = $('#btn-action');
  const on = !!action && !mine?.frozen && !mg.isOpen();
  show(btn, on);
  if (!on) return;
  const label = action.act === 'exit' ? t('hint_exit') : `${t(ACT_LABEL[action.act])}  [E]`;
  if (btn.textContent !== label) btn.textContent = label;
  btn.classList.toggle('hint', action.act === 'exit');
  btn.classList.toggle('urgent', ['fire', 'phone', 'fixCoffee', 'pizza'].includes(action.act));
}
function interact() {
  const mine = myState();
  if (!action || !mine || mine.frozen || mg.isOpen()) return;
  keys.clear();
  moveTarget = null;
  me.moving = false;
  switch (action.act) {
    case 'exit': return;
    case 'pizza':
      emit('task', { type: 'pizza' });
      toast(t('pizzaYum'), 'good');
      sfx('good');
      return;
    default:
      mg.open(action.act, { q: state.phone?.q });
  }
}
function useAbility() {
  const mine = myState();
  if (!mine || !mine.role || mine.cd || mine.frozen || state.phase !== 'playing') return;
  emit('ability');
}

// ---------- Movement ----------
function collide(x, z) {
  const r = 0.35;
  const b = world.bounds;
  x = clamp(x, b.minX, b.maxX);
  z = clamp(z, b.minZ, b.maxZ);
  for (const st of world.stations) {
    if (!st.solid) continue;
    const hw = st.w / 2;
    const hd = st.d / 2;
    const cx = clamp(x, st.x - hw, st.x + hw);
    const cz = clamp(z, st.z - hd, st.z + hd);
    const dx = x - cx;
    const dz = z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-6) {
      const d = Math.sqrt(d2);
      x = cx + (dx / d) * r;
      z = cz + (dz / d) * r;
    } else if (hw - Math.abs(x - st.x) < hd - Math.abs(z - st.z)) {
      x = st.x + Math.sign(x - st.x || 1) * (hw + r);
    } else {
      z = st.z + Math.sign(z - st.z || 1) * (hd + r);
    }
  }
  return [x, z];
}
function updateMovement(dt, mine) {
  const canMove = joined && mine && !mine.frozen && !mg.isOpen() && (state.phase === 'lobby' || state.phase === 'playing');
  let dx = 0;
  let dz = 0;
  if (canMove) {
    // Isometric camera: screen-up is world (-1,-1), screen-right is world (1,-1)
    if (keys.has('w') || keys.has('arrowup')) { dx -= 1; dz -= 1; }
    if (keys.has('s') || keys.has('arrowdown')) { dx += 1; dz += 1; }
    if (keys.has('a') || keys.has('arrowleft')) { dx -= 1; dz += 1; }
    if (keys.has('d') || keys.has('arrowright')) { dx += 1; dz -= 1; }
    if (dx || dz) moveTarget = null;
    else if (moveTarget) {
      dx = moveTarget.x - me.x;
      dz = moveTarget.z - me.z;
      if (Math.hypot(dx, dz) < 0.15) { moveTarget = null; dx = dz = 0; }
    }
  } else {
    moveTarget = null;
  }
  const len = Math.hypot(dx, dz);
  me.moving = len > 0;
  if (me.moving) {
    const speed = mine.stress >= 80 ? 3.4 : 4.6;
    const step = Math.min(speed * dt, moveTarget ? len : Infinity);
    const [nx, nz] = collide(me.x + (dx / len) * step, me.z + (dz / len) * step);
    if (moveTarget && Math.hypot(nx - me.x, nz - me.z) < step * 0.2) moveTarget = null; // blocked by furniture
    me.x = nx;
    me.z = nz;
    me.face = Math.atan2(dx, dz);
  }
  if (joined) net.pos = { x: me.x, z: me.z, face: me.face, moving: me.moving }; // sent with the next sync
}

// ---------- Main loop ----------
let lastT = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  if (office && state && world) {
    const mine = myState();
    updateMovement(dt, mine);
    const ch = office.chars.get(myId);
    if (ch && joined) {
      ch.x = ch.tx = me.x;
      ch.z = ch.tz = me.z;
      ch.face = me.face;
      ch.moving = me.moving;
    }
    action = detectAction(mine);
    renderAction(mine);
    office.setHighlight(action && action.act !== 'exit' ? action.st : null);
    if (joined && mine) office.setFocus(me.x, me.z, office.portrait ? 1 : 0.12);
    else office.setFocus(0, 0, 0);
  }
  if (office) office.frame(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---------- Input wiring ----------
const MOVE_KEYS = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'];
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') {
    if (e.key === 'Enter') { if (e.target.id === 'join-code' && e.target.value) joinRoom(); else createRoom(); }
    return;
  }
  if (mg.isOpen()) {
    if (mg.handleKey(e)) e.preventDefault();
    return;
  }
  const k = e.key.toLowerCase();
  if (MOVE_KEYS.includes(k)) { keys.add(k); e.preventDefault(); }
  else if (k === 'e' || k === ' ') { e.preventDefault(); if (!e.repeat) interact(); }
  else if (k === 'q') useAbility();
  else if (/^[1-5]$/.test(k) && joined) emit('emote', Number(k) - 1);
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());

$('#game').addEventListener('pointerdown', (e) => {
  if (!office || !joined || !state || !['lobby', 'playing'].includes(state.phase)) return;
  const hit = office.pickFloor(e.clientX, e.clientY);
  if (hit) moveTarget = { x: hit.x, z: hit.z };
});

document.addEventListener('click', (e) => {
  const vote = e.target.closest('[data-vote]');
  if (vote) { emit('vote', vote.dataset.vote); sfx('ok'); return; }
  if (e.target.closest('#btn-start')) emit('start');
  if (e.target.closest('#btn-restart')) emit('restart');
  if (e.target.closest('#btn-copy')) {
    const link = `${location.origin}${location.pathname}?room=${state?.code || ''}`;
    navigator.clipboard?.writeText(link).then(() => toast(t('copied'), 'good'), () => toast(link));
  }
});
$('#btn-create').addEventListener('click', createRoom);
$('#btn-join').addEventListener('click', joinRoom);
$('#btn-action').addEventListener('click', interact);
$('#btn-ability').addEventListener('click', useAbility);
$('#btn-lang').addEventListener('click', () => {
  setLang(getLang() === 'en' ? 'mm' : 'en');
  applyStaticText();
  renderEmotes();
});
$('#btn-mute').addEventListener('click', () => {
  muted = !muted;
  $('#btn-mute').textContent = muted ? '🔇' : '🔊';
});

function renderEmotes() {
  $('#emotes').innerHTML = [0, 1, 2, 3, 4].map((i) => `<button data-emote="${i}" title="${escapeHtml(t(`emote${i}`))}">${i + 1}<span>${t(`emote${i}`)}</span></button>`).join('');
}
$('#emotes').addEventListener('click', (e) => {
  const b = e.target.closest('[data-emote]');
  if (b) emit('emote', Number(b.dataset.emote));
});

// ---------- Boot ----------
try { $('#join-name').value = localStorage.getItem('df_name') || ''; } catch { /* storage unavailable */ }
const roomParam = new URLSearchParams(location.search).get('room');
if (roomParam) $('#join-code').value = roomParam.toUpperCase();
setLang(getLang());
applyStaticText();
renderEmotes();

fetch('/world.json').then((r) => r.json()).then((w) => {
  world = w;
  office = new Office($('#game'), world);
  // Page reload mid-game: rejoin the same room with the same player id.
  let saved = null;
  try { saved = sessionStorage.getItem('df_room'); } catch { /* storage unavailable */ }
  if (saved) { $('#join-code').value = saved; enterRoom(saved, false); }
});
