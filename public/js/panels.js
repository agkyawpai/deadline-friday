// Phase overlays and panels, rendered from server state. Re-rendered every sync, so each writes HTML only when it changed.
import { t, ROLE_ICON, TICKET_ICON, STAGES } from './i18n.js';
import { escapeHtml } from './scene.js';

const $ = (s) => document.querySelector(s);
const cache = new Map();
export function setHTML(el, html) {
  if (cache.get(el) === html) return;
  cache.set(el, html);
  el.innerHTML = html;
}
export const clearCache = () => cache.clear();
export function show(el, on) { el.classList.toggle('hidden', !on); }
const secs = (ms) => Math.ceil(ms / 1000);
const nameOf = (s, id) => escapeHtml(s.players.find((p) => p.id === id)?.name || '?');
export const tkName = (tk) => `${TICKET_ICON[tk.key] || '🎫'} ${t(`tk_${tk.key}`)}`;

// ---------- Sprint board ----------
function ticketCard(s, tk, myId) {
  const role = s.stageRole[tk.stage];
  const who = role ? `${ROLE_ICON[role]} ${t(`role_${role}`)}` : t('anyone');
  const lines = [];
  if (tk.stage === 'dev') {
    lines.push(`<div class="tk-bar"><div style="width:${(tk.progress / tk.work) * 100}%"></div></div>`);
    lines.push(`<small>${tk.owner ? t('by', { name: nameOf(s, tk.owner) }) : t('unclaimed')}${tk.helpers.length ? ` +${tk.helpers.map(escapeHtml).join(', ')}` : ''}</small>`);
  }
  if (['review', 'qa', 'demo'].includes(tk.stage)) {
    lines.push(tk.open || !role
      ? `<small class="needs open">🔓 ${t('needs', { role: t('anyone') })}</small>`
      : `<small class="needs">⏳ ${t('needs', { role: who })} · ${t('escIn', { s: Math.ceil(tk.escIn / 1000) })}</small>`);
  }
  if (tk.stage === 'done') lines.push(`<small>${['dev', 'review', 'qa', 'demo'].filter((k) => tk.credits[k]).map((k) => `${t(`stage_${k}`)}: ${escapeHtml(tk.credits[k])}`).join(' · ')}</small>`);
  const canClaim = ['morning', 'playing'].includes(s.phase) && (tk.stage === 'todo' || (tk.stage === 'dev' && !tk.owner));
  const overdue = tk.stage !== 'done' && tk.day < s.day ? `<b class="overdue">${t('overdue')}</b>` : '';
  const mine = tk.owner === myId && tk.stage === 'dev' ? ' mine' : '';
  return `<div class="tk${mine}"><div class="tk-name">${tkName(tk)} ${overdue}</div>${lines.join('')}
    ${canClaim ? `<button class="tk-claim" data-claim="${tk.id}">${t('claim')}</button>` : ''}</div>`;
}
export function boardHtml(s, myId) {
  return `<div class="kanban">${STAGES.map((st) => {
    const tks = s.tickets.filter((tk) => tk.stage === st);
    return `<div class="col col-${st}"><h4>${t(`stage_${st}`)} <i>${tks.length}</i></h4>${tks.map((tk) => ticketCard(s, tk, myId)).join('')}</div>`;
  }).join('')}</div>`;
}
export function renderBoard(s, myId, open) {
  const on = open && ['playing', 'deploy'].includes(s.phase);
  show($('#board'), on);
  if (on) setHTML($('#board .board-body'), boardHtml(s, myId));
}

// ---------- Lobby / briefing ----------
export function renderLobby(s, mine, joined, myId) {
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

export function renderBriefing(s, joined) {
  const on = s.phase === 'briefing' && joined && s.me?.role;
  show($('#briefing'), !!on);
  if (!on) return;
  const { role, agenda } = s.me;
  setHTML($('#briefing'), `<div class="card wide">
    <p class="mission">${t('brief_mission')}</p>
    <div class="cards">
      <div class="rcard role"><small>${t('brief_role')}</small><div class="big">${ROLE_ICON[role]}</div>
        <h3>${t(`role_${role}`)}</h3><p>${t(`rdesc_${role}`)}</p></div>
      <div class="rcard agenda${agenda === 'jobhunt' ? ' evil' : ''}"><small>${t('brief_agenda')}</small><div class="big">🤫</div>
        <h3>${t(`ag_${agenda}`)}</h3><p>${t(`agd_${agenda}`)}</p></div>
    </div>
    <p class="countdown">${t('brief_starts', { s: secs(s.left) })}</p></div>`);
}

// ---------- Day phases ----------
export function renderMorning(s, joined, myId) {
  const on = s.phase === 'morning' && joined;
  show($('#morning'), on);
  if (!on) return;
  setHTML($('#morning .m-head'), `<h2>${t('morning_title', { day: `@day${s.day}`, theme: `@theme${s.day}` })}</h2>
    <p class="muted">${t(`themed${s.day}`)}</p><p>${t('morning_claim')}</p>`);
  setHTML($('#morning .m-board'), boardHtml(s, myId));
  $('#morning .m-left').textContent = t('morning_starts', { s: secs(s.left) });
}

export function renderEvening(s, joined) {
  const on = s.phase === 'evening' && joined && s.summary;
  show($('#evening'), !!on);
  if (!on) return;
  const sm = s.summary;
  setHTML($('#evening'), `<div class="card">
    <h2>${t('evening_title', { day: `@day${sm.day}` })}</h2>
    <div class="stats">
      <div><b>✅ ${sm.doneToday}</b><small>${t('evening_done')}</small></div>
      <div><b>⏰ ${sm.overdue}</b><small>${t('evening_overdue')}</small></div>
      <div><b>${s.happiness}</b><small>${t('evening_client')}</small></div>
    </div>
    ${sm.demo ? `<p class="${sm.demo > 0 ? 'good' : 'bad'}">${t(sm.demo > 0 ? 'evening_demo_good' : 'evening_demo_bad')}</p>` : ''}
    <h3>${t('morning_title', { day: `@day${sm.day + 1}`, theme: `@theme${sm.day + 1}` })}</h3>
    <p class="muted">${t(`themed${sm.day + 1}`)}</p></div>`);
}

export function renderMeeting(s, joined, myId) {
  const on = s.phase === 'meeting' && joined && s.meeting;
  show($('#meeting'), !!on);
  if (!on) return;
  const m = s.meeting;
  const voted = m.myVote !== null;
  let options;
  if (m.kind === 'decision') {
    options = `<p class="question">${t(`mt_q_${m.key}`)}</p>
      <div class="votes"><button class="vote" data-mvote="yes" ${voted ? 'disabled' : ''}>${t('mt_yes')}</button>
      <button class="vote" data-mvote="no" ${voted ? 'disabled' : ''}>${t('mt_no')}</button></div>`;
  } else {
    options = `<p class="muted small">${t('mt_pipInfo')}</p><div class="votes">${s.players.filter((p) => p.id !== myId).map((p) =>
      `<button class="vote${m.myVote === p.id ? ' picked' : ''}" data-mvote="${p.id}" ${voted ? 'disabled' : ''}><i style="background:${p.color}"></i>${ROLE_ICON[p.role] || ''} ${escapeHtml(p.name)}${m.voted.includes(p.id) ? ' <small>✓</small>' : ''}</button>`).join('')}
      <button class="vote skip" data-mvote="skip" ${voted ? 'disabled' : ''}>${t('mt_skip')}</button></div>`;
  }
  setHTML($('#meeting .mt-body'), `
    <h2>${t(m.kind === 'decision' ? 'mt_title_decision' : 'mt_title_pip')}</h2>
    ${m.by ? `<p class="bad">${t('mt_emergency', { name: escapeHtml(m.by) })}</p>` : ''}
    ${options}
    <p class="muted">${t('mt_voted', { n: m.voted.length, total: s.players.length })}${voted ? ` · ${t('mt_myVote')}` : ''}</p>`);
  $('#meeting .mt-left').textContent = t('mt_left', { s: secs(s.left) });
}

export function renderDeploy(s, joined) {
  const on = s.phase === 'deploy' && joined && s.deploy;
  show($('#deploy-hud'), !!on);
  if (!on) return;
  const d = s.deploy;
  const icons = { server: '🖥️', board: '📋', qa: '🔍', phone: '📞' };
  setHTML($('#deploy-hud'), `<div class="dp-title">${t('deploy_title', { p: d.progress })} · ${secs(s.left)}s</div>
    <div class="dp-bar"><div style="width:${d.progress}%"></div></div>
    <div class="dp-st">${Object.entries(icons).map(([k, ic]) => `<span class="${d.occupied.includes(k) ? 'on' : ''}">${ic}</span>`).join('')}
    <small>${t('deploy_need', { o: d.occupied.length, n: d.need })}</small></div>`);
}

// ---------- Retro: peer review ----------
let peer = { points: {}, blame: null };
export function resetPeer() { peer = { points: {}, blame: null }; }
export function peerAction(kind, id) {
  const used = Object.values(peer.points).reduce((a, b) => a + b, 0);
  if (kind === 'plus' && used < 10) peer.points[id] = (peer.points[id] || 0) + 1;
  if (kind === 'minus' && peer.points[id]) peer.points[id]--;
  if (kind === 'blame') peer.blame = id;
}
export const peerPayload = () => ({ points: { ...peer.points }, target: peer.blame || undefined });

export function renderRetro(s, joined, myId) {
  const on = s.phase === 'retro' && joined;
  show($('#retro'), on);
  if (!on) return;
  const others = s.players.filter((p) => p.id !== myId);
  const used = Object.values(peer.points).reduce((a, b) => a + b, 0);
  const done = s.me?.peerDone;
  const rows = others.length ? others.map((p) => `<div class="peer-row">
      <span class="pr-name"><i style="background:${p.color}"></i>${ROLE_ICON[p.role] || ''} ${escapeHtml(p.name)}${p.voted ? ' <small>✓</small>' : ''}</span>
      <span class="pr-pts"><button data-peer="minus:${p.id}" ${done ? 'disabled' : ''}>−</button><b>${peer.points[p.id] || 0}</b><button data-peer="plus:${p.id}" ${done ? 'disabled' : ''}>+</button></span>
      <button class="pr-blame${peer.blame === p.id ? ' on' : ''}" data-peer="blame:${p.id}" ${done ? 'disabled' : ''}>${t('retro_blame')}</button>
    </div>`).join('') : `<p>${t('retro_solo')}</p>`;
  setHTML($('#retro .retro-body'), `<h2>${t('retro_title')}</h2><p>${t('retro_sub')}</p>
    <p class="pts-left">${t('retro_points', { n: 10 - used })}</p>
    <div class="peer">${rows}</div>
    ${done ? `<p class="muted">${t('retro_submitted')}</p>` : `<button class="btn primary" data-peer="submit:">${t('retro_submit')}</button>`}`);
  $('#retro .retro-left').textContent = t('retro_left', { s: secs(s.left) });
}

export function renderResults(s, joined, mine, myId) {
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
      <td>💰 ${p.bonus}</td><td>🫵 ${p.votes}</td></tr>`).join('');
  const log = r.log.length
    ? r.log.map((e) => `<li>${escapeHtml(t('res_log_row', { id: e.id, time: e.time, act: `@gitact_${e.act}`, actor: e.actor }))}${e.framed ? `<b class="bad">${escapeHtml(t('res_log_framed', { name: e.framed }))}</b>` : ''}</li>`).join('')
    : `<li>${t('res_log_none')}</li>`;
  setHTML($('#results'), `<div class="card wide">
    <h1 class="ending ${r.ending}">${t(`end_${r.ending}`)}</h1>
    <p class="lead">${t(`endd_${r.ending}`, { done: r.done, total: r.total, bugs: r.prodBugs, burn: r.burnouts })}</p>
    <p>${blamed ? t('res_mostBlamed', { name: blamed }) : t('res_noBlame')}</p>
    <div class="table-wrap"><table><thead><tr><th>${t('res_player')}</th><th>${t('res_role')}</th><th>${t('res_agenda')}</th>
      <th>${t('res_result')}</th><th>${t('res_bonus')}</th><th>${t('res_votes')}</th></tr></thead><tbody>${rows}</tbody></table></div>
    <h3>${t('res_log')}</h3><ul class="gitlog">${log}</ul>
    ${mine?.isHost ? `<button class="btn primary" id="btn-restart">${t('playAgain')}</button>` : `<p class="muted">${t('waitHost')}</p>`}</div>`);
}

export function renderFrozen(s, joined, mine) {
  const el = $('#frozen');
  const f = joined && ['playing', 'deploy'].includes(s.phase) && mine?.frozen;
  el.className = f ? `frozen ${f}` : 'hidden';
  if (!f) return;
  const sec = secs(mine.frozenLeft);
  if (f === 'locked') {
    const p = Math.min(99, Math.round((1 - mine.frozenLeft / 10000) * 100));
    setHTML(el, `<div class="spinner"></div><h2>${t('frz_locked', { p })}</h2><p>${t('frz_locked2', { s: sec })}</p>`);
  } else {
    setHTML(el, `<h2>${t(`frz_${f}`, { s: sec })}</h2>`);
  }
}
