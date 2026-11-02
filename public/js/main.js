import { Office, escapeHtml } from './scene.js';
import { t, ROLE_ICON } from './i18n.js';
import { Minigames } from './minigames.js';
import { Net } from './net.js';
import { Chat } from './chat.js';
import * as P from './panels.js';

const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const { show, setHTML, tkName } = P;
const DEPLOY_STATIONS = ['server', 'board', 'qa', 'phone'];

let world = null;
let office = null;
let state = null;
let joined = false;
let lastPhase = null;
let action = null;
let moveTarget = null;
let boardOpen = false;
let holding = false;
let typing = false;
const me = { x: 2, z: 5, face: 0, moving: false };
const keys = new Set();

// ---------- Sound (tiny WebAudio beeps, no audio files) ----------
let actx = null;
let muted = false;
const SFX = {
  tick: [[880, 0.04]], ok: [[660, 0.07], [990, 0.09]], err: [[160, 0.18, 'sawtooth']],
  pop: [[1200, 0.05]], mash: [[240, 0.05, 'square']], slurp: [[420, 0.1], [300, 0.15]],
  win: [[523, 0.1], [659, 0.1], [784, 0.18]], good: [[523, 0.08], [784, 0.12]], bad: [[392, 0.1], [262, 0.18]],
  alarm: [[880, 0.18, 'square'], [660, 0.18, 'square'], [880, 0.18, 'square'], [660, 0.18, 'square']],
  ring: [[1300, 0.07], [1550, 0.07], [1300, 0.07], [1550, 0.07]], toast: [[700, 0.05]], chat: [[1000, 0.03], [1400, 0.04]],
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

const mg = new Minigames({ modal: $('#modal'), send: emit, sfx, onOpenBoard: () => setBoard(true) });
const chat = new Chat($('#chat'), {
  send: (text, to) => net.send('chat', { text, to }),
  onFocusChange: (on) => { typing = on; if (on) keys.clear(); },
});

// ---------- Helpers ----------
function toast(text, kind = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  const box = $('#toasts');
  box.prepend(el);
  while (box.children.length > 4) box.lastChild.remove();
  window.gsap.fromTo(el, { y: -16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3 });
  setTimeout(() => window.gsap.to(el, { opacity: 0, duration: 0.4, onComplete: () => el.remove() }), 4500);
}
function applyStaticText() {
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  document.title = t('title');
}
const myState = () => state && state.players.find((p) => p.id === net.pid);
const secs = (ms) => Math.ceil(ms / 1000);
function setBoard(on) { boardOpen = on; if (state) P.renderBoard(state, net.pid, boardOpen); }
// A ticket in Test can be tested by anyone except the person who wrote it.
const testable = (s) => s.tickets.find((x) => x.stage === 'qa' && x.owner !== net.pid);

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
      case 'chat': chat.add(e); if (e.from !== net.pid) sfx('chat'); return;
      case 'emote': office?.showEmote(e.id, t(`emote${e.i}`)); return sfx('toast');
      case 'codeResult': return mg.codeResult(e);
      case 'qaResult': return mg.qaResult(e);
      case 'denied': return leaveRoom(t(e.key));
      default:
    }
  },
  onError: (err) => {
    if (err === 'offline') return toast(t('offline'), 'bad');
    leaveRoom(t(err === 'noRoom' ? 'noRoom' : 'syncError'));
  },
});

// Actions from UI / minigames. 'task' payloads use `type` for the task kind on the client side.
function emit(ev, data) {
  if (ev === 'task') {
    const { type, ...rest } = data;
    net.send('task', { kind: type, ...rest });
  } else if (ev === 'emote') net.send('emote', { i: data });
  else net.send(ev, data);
}

function onFx({ key, params, kind }) {
  toast(t(key, params), kind);
  if (key === 'ev_fire' || key === 'ev_deploy' || key === 'ev_emergency' || key === 'ev_meeting') { sfx('alarm'); office?.shake(0.9); }
  else if (key === 'ev_phone') sfx('ring');
  else if (key === 'mt_caught') { sfx('win'); office?.shake(0.5); }
  else if (key === 'mt_innocent') { sfx('bad'); office?.shake(0.6); }
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
  chat.clear();
  net.start(code);
  net.send('join', { name, create });
}
function leaveRoom(message = '') {
  net.stop();
  joined = false;
  state = null;
  lastPhase = null;
  mg.close();
  try { sessionStorage.removeItem('df_room'); } catch { /* storage unavailable */ }
  $('#join-err').textContent = message;
  show($('#join'), true);
  for (const id of ['#lobby-panel', '#topbar', '#players', '#bottombar', '#help', '#briefing', '#morning', '#evening', '#meeting', '#results', '#board', '#deploy-hud', '#hint']) show($(id), false);
  chat.setVisible(false);
  office?.syncPlayers([], net.pid, null);
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
  if (s.phase !== lastPhase) onPhaseChange(s.phase);
  if (!office) return;

  office.syncPlayers(s.players, net.pid, joined && mine ? me : null);
  office.setFire(s.fire);
  office.setPhone(s.phone);
  office.setPizza(s.pizza > 0);
  office.setCEO(s.ceo);
  office.setBoard(s.tickets);
  office.setDeploy(s.deploy);
  office.setClock(s.clock);
  chat.setVisible(joined);
  chat.setPlayers(s.players, net.pid);

  const myId = net.pid;
  P.renderLobby(s, mine, joined, myId);
  P.renderBriefing(s, joined);
  P.renderMorning(s, joined, myId);
  P.renderEvening(s, joined);
  P.renderMeeting(s, joined, myId);
  P.renderDeploy(s, joined);
  P.renderResults(s, joined, mine, myId);
  P.renderBoard(s, myId, boardOpen);
  renderHUD(s, mine);
  mg.onState(s, mine);
}

function onPhaseChange(phase) {
  lastPhase = phase;
  mg.close();
  moveTarget = null;
  holding = false;
  if (phase !== 'playing' && phase !== 'deploy') boardOpen = false;
  if (phase === 'briefing') sfx('win');
  if (phase === 'results') { $('#toasts').innerHTML = ''; sfx(state.results?.shipped ? 'win' : 'bad'); }
}

// What should *I* do next? The answer to "I don't know what to do".
function myHint(s, mine) {
  if (s.phase === 'deploy') return t('hint_deploy');
  if (s.me?.caught) return t('hint_caught');
  const test = testable(s);
  if (test) return t('hint_qa', { ticket: tkName(test) });
  const own = s.tickets.find((x) => x.stage === 'dev' && x.owner === mine.id);
  if (own) return t('hint_code', { ticket: tkName(own), p: own.progress, w: own.work });
  if (s.tickets.some((x) => x.stage === 'todo')) return t('hint_claim');
  const dev = s.tickets.find((x) => x.stage === 'dev');
  if (dev) return t('hint_help', { ticket: tkName(dev) });
  const waiting = s.tickets.find((x) => x.stage === 'qa' && x.owner === mine.id);
  if (waiting) return t('hint_wait', { ticket: tkName(waiting) });
  return t('hint_idle');
}

function renderHUD(s, mine) {
  const working = joined && (s.phase === 'playing' || s.phase === 'deploy');
  show($('#topbar'), working || (joined && ['morning', 'meeting', 'evening'].includes(s.phase)));
  show($('#players'), working || (joined && s.phase === 'meeting'));
  show($('#bottombar'), working || (joined && s.phase === 'lobby'));
  show($('#help'), joined && (s.phase === 'lobby' || s.phase === 'playing'));
  show($('#hint'), working && !!mine);
  show($('#btn-board'), working);
  if (!joined || s.phase === 'lobby') return;

  const hh = Math.floor(s.clock);
  const mm = Math.floor((s.clock % 1) * 60);
  $('#hud-day').textContent = s.day ? t(`day${s.day}`) : '';
  $('#hud-clock').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  $('#hud-clock').classList.toggle('late', s.day === 5 && s.clock >= 15);
  const done = s.tickets.filter((x) => x.stage === 'done').length;
  $('#hud-tickets').textContent = `${done}/${s.tickets.length}`;
  $('#hud-client').style.width = `${s.happiness}%`;
  $('#hud-client').classList.toggle('low', s.happiness < 30);
  $('#hud-client-t').textContent = s.happiness < 30 ? '😡' : s.happiness < 60 ? '😐' : '😊';
  const chips = [];
  if (s.me?.boost) chips.push(`<span class="chip green">${t('hud_boost', { s: secs(s.me.boost) })}</span>`);
  if (s.me?.pip) chips.push(`<span class="chip red">${t('hud_pip')}</span>`);
  if (s.me?.caught) chips.push(`<span class="chip red">${t('hud_caught')}</span>`);
  if (s.fire) chips.push(`<span class="chip red">${t('hud_fire')}</span>`);
  if (s.ceo) chips.push(`<span class="chip gold">${t('hud_ceo', { s: secs(s.ceo) })}</span>`);
  setHTML($('#hud-chips'), chips.join(''));
  if (mine) $('#hint').textContent = myHint(s, mine);

  setHTML($('#players'), s.players.map((p) => `<div class="pl${p.id === net.pid ? ' me' : ''}"><i style="background:${p.color}"></i>
      <span class="pl-name">${p.role ? ROLE_ICON[p.role] : ''} ${escapeHtml(p.name)}${p.boost ? ' ⚡' : ''}${p.pip ? ' 📉' : ''}${p.caught ? ' 🚔' : ''}</span></div>`).join(''));

  const ab = $('#btn-ability');
  show(ab, working && !!mine?.role);
  if (mine?.role) {
    const blocked = s.me?.pip || s.me?.caught || (mine.role === 'leader' && s.emergencyUsed);
    ab.querySelector('.lbl').textContent = `Q · ${t(`ab_${mine.role}`)}${mine.cd ? ` (${secs(mine.cd)})` : ''}`;
    ab.querySelector('.cd').style.width = blocked ? '100%' : `${(mine.cd / mine.cdMax) * 100}%`;
    ab.classList.toggle('ready', !mine.cd && !blocked);
  }
  const sec = $('#btn-secret');
  const hasSecret = s.me && s.me.secret !== null && s.me.secret !== undefined;
  show(sec, working && hasSecret);
  if (hasSecret) {
    sec.querySelector('.lbl').textContent = `${t('sec_btn')}${s.me.secret ? ` (${secs(s.me.secret)})` : ''}`;
    sec.querySelector('.cd').style.width = s.me.pip ? '100%' : `${(s.me.secret / s.me.secretMax) * 100}%`;
    sec.classList.toggle('ready', !s.me.secret && !s.me.pip);
  }
}

// ---------- Interaction ----------
function actionFor(st) {
  const s = state;
  if (s.phase === 'deploy') {
    if (st.type === 'server' && s.fire) return 'fire';
    return DEPLOY_STATIONS.includes(st.id) ? 'hold' : null;
  }
  switch (st.type) {
    case 'desk': return 'code';
    case 'board': return 'board';
    case 'qa': return testable(s) ? 'qa' : null;
    case 'coffee': return 'coffee';
    case 'server': return s.fire ? 'fire' : null;
    case 'phone': return s.phone ? 'phone' : null;
    case 'meeting': return s.pizza > 0 && !myState()?.ateP ? 'pizza' : null;
    default: return null;
  }
}
function detectAction(mine) {
  if (!state || !['playing', 'deploy'].includes(state.phase) || !mine || !joined) return null;
  let best = null;
  let bestD = Infinity;
  for (const st of world.stations) {
    const d = Math.hypot(me.x - st.x, me.z - st.z);
    const range = st.type === 'meeting' ? 2.8 : 2.2;
    if (d > range || d >= bestD) continue;
    const act = actionFor(st);
    if (act) { best = { st, act }; bestD = d; }
  }
  return best;
}
const ACT_LABEL = {
  code: 'act_code', qa: 'act_qa', board: 'act_board', hold: 'act_hold',
  coffee: 'act_coffee', fire: 'act_fire', phone: 'act_phone', pizza: 'act_pizza',
};
function renderAction() {
  const btn = $('#btn-action');
  const on = !!action && !mg.isOpen();
  show(btn, on);
  if (!on) { holding = false; return; }
  const label = `${t(ACT_LABEL[action.act])}  [E]`;
  if (btn.textContent !== label) btn.textContent = label;
  btn.classList.toggle('urgent', ['fire', 'phone', 'pizza', 'qa'].includes(action.act));
  btn.classList.toggle('holding', action.act === 'hold' && holding);
}
function interact() {
  const mine = myState();
  if (!action || !mine || mg.isOpen()) return;
  keys.clear();
  moveTarget = null;
  me.moving = false;
  const s = state;
  switch (action.act) {
    case 'hold': return;
    case 'board': return setBoard(!boardOpen);
    case 'pizza':
      emit('task', { type: 'pizza' });
      toast(t('boostOn'), 'good');
      return sfx('good');
    case 'code': {
      const devs = s.tickets.filter((x) => x.stage === 'dev');
      return mg.open('code', { tickets: devs, preferred: devs.find((x) => x.owner === net.pid)?.id });
    }
    case 'qa': return mg.open('qa', { ticket: testable(s) });
    case 'coffee': return mg.open('coffee', { onDone: () => toast(t('boostOn'), 'good') });
    default: return mg.open(action.act, { q: s.phone?.q });
  }
}
function useAbility() {
  const mine = myState();
  if (!mine || !mine.role || mine.cd || !['playing', 'deploy'].includes(state.phase)) return;
  emit('ability');
}
function useSecret() {
  if (!state?.me || state.me.secret === null || state.me.secret) return;
  emit('secret');
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
  const canMove = joined && mine && !mg.isOpen() && !typing && ['lobby', 'playing', 'deploy'].includes(state.phase);
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
    holding = false;
    const step = Math.min(4.6 * dt, moveTarget ? len : Infinity);
    const [nx, nz] = collide(me.x + (dx / len) * step, me.z + (dz / len) * step);
    if (moveTarget && Math.hypot(nx - me.x, nz - me.z) < step * 0.2) moveTarget = null; // blocked by furniture
    me.x = nx;
    me.z = nz;
    me.face = Math.atan2(dx, dz);
  }
  if (joined) net.pos = { x: me.x, z: me.z, face: me.face, moving: me.moving }; // sent with the next sync
  net.hold = holding && action?.act === 'hold' ? action.st.id : null;
}

// ---------- Main loop ----------
let lastT = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  if (office && state && world) {
    const mine = myState();
    updateMovement(dt, mine);
    const ch = office.chars.get(net.pid);
    if (ch && joined) {
      ch.x = ch.tx = me.x;
      ch.z = ch.tz = me.z;
      ch.face = me.face;
      ch.moving = me.moving;
    }
    action = detectAction(mine);
    renderAction();
    office.setHighlight(action ? action.st : null);
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
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') {
    if (e.key === 'Enter' && e.target.closest('#join')) { if (e.target.id === 'join-code' && e.target.value) joinRoom(); else createRoom(); }
    return;
  }
  if (mg.isOpen()) {
    if (mg.handleKey(e)) e.preventDefault();
    return;
  }
  const k = e.key.toLowerCase();
  if (k === 'escape' && !$('#rules').classList.contains('hidden')) return show($('#rules'), false);
  if (k === 'enter' && joined) { e.preventDefault(); chat.focus(); return; }
  if (k === 'escape' && boardOpen) return setBoard(false);
  if (MOVE_KEYS.includes(k)) { keys.add(k); e.preventDefault(); }
  else if (k === 'e' || k === ' ') {
    e.preventDefault();
    if (action?.act === 'hold') holding = true;
    else if (!e.repeat) interact();
  }
  else if (k === 'q') useAbility();
  else if (k === 'f') useSecret();
  else if (k === 'b' && joined && ['playing', 'deploy'].includes(state?.phase)) setBoard(!boardOpen);
  else if (/^[1-5]$/.test(k) && joined) emit('emote', Number(k) - 1);
});
window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  keys.delete(k);
  if (k === 'e' || k === ' ') holding = false;
});
window.addEventListener('blur', () => { keys.clear(); holding = false; });

$('#game').addEventListener('pointerdown', (e) => {
  if (!office || !joined || !state || !['lobby', 'playing', 'deploy'].includes(state.phase)) return;
  const hit = office.pickFloor(e.clientX, e.clientY);
  if (hit) moveTarget = { x: hit.x, z: hit.z };
});

// Deploy: press-and-hold the action button
const actionBtn = $('#btn-action');
actionBtn.addEventListener('pointerdown', (e) => {
  if (action?.act === 'hold') { e.preventDefault(); holding = true; }
});
for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) actionBtn.addEventListener(ev, () => { holding = false; });
actionBtn.addEventListener('click', () => { if (action?.act !== 'hold') interact(); });

// Board cards re-render with live progress, so claim on pointerdown rather than click.
document.addEventListener('pointerdown', (e) => {
  const claim = e.target.closest('[data-claim]');
  if (claim) { e.preventDefault(); emit('claim', { ticket: Number(claim.dataset.claim) }); sfx('ok'); }
});
document.addEventListener('click', (e) => {
  const mvote = e.target.closest('[data-mvote]');
  if (mvote && !mvote.disabled) { emit('vote', { target: mvote.dataset.mvote }); sfx('ok'); return; }
  if (e.target.closest('#btn-start')) emit('start');
  if (e.target.closest('#btn-restart')) emit('restart');
  if (e.target.closest('#btn-board') || e.target.closest('#board .board-close')) setBoard(!boardOpen);
  if (e.target.closest('#btn-copy')) {
    const link = `${location.origin}${location.pathname}?room=${state?.code || ''}`;
    navigator.clipboard?.writeText(link).then(() => toast(t('copied'), 'good'), () => toast(link));
  }
});
$('#btn-create').addEventListener('click', createRoom);
$('#btn-join').addEventListener('click', joinRoom);
$('#btn-ability').addEventListener('click', useAbility);
$('#btn-secret').addEventListener('click', useSecret);
for (const b of document.querySelectorAll('[data-rules]')) b.addEventListener('click', () => show($('#rules'), true));
$('#rules').addEventListener('click', (e) => { if (e.target.id === 'rules' || e.target.closest('.rules-close')) show($('#rules'), false); });
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
applyStaticText();
renderEmotes();
chat.setVisible(false);

fetch('/world.json').then((r) => r.json()).then((w) => {
  world = w;
  office = new Office($('#game'), world);
  // Page reload mid-game: rejoin the same room with the same player id.
  let saved = null;
  try { saved = sessionStorage.getItem('df_room'); } catch { /* storage unavailable */ }
  if (saved) { $('#join-code').value = saved; enterRoom(saved, false); }
});
