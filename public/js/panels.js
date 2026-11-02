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
  const lines = [];
  if (tk.stage === 'dev') {
    lines.push(`<div class="tk-bar"><div style="width:${(tk.progress / tk.work) * 100}%"></div></div>`);
    lines.push(`<small>${tk.owner ? t('by', { name: nameOf(s, tk.owner) }) : t('unclaimed')}</small>`);
  }
  if (tk.stage === 'qa') lines.push(`<small class="needs">⏳ ${t('needs_tester')} · ${t('by', { name: nameOf(s, tk.owner) })}</small>`);
  if (tk.stage === 'done') lines.push(`<small>${escapeHtml(t('credit_line', { code: tk.credits.code || '?', test: tk.credits.test || '?' }))}</small>`);
  const canClaim = ['morning', 'playing'].includes(s.phase) && (tk.stage === 'todo' || (tk.stage === 'dev' && !tk.owner));
  const mine = tk.owner === myId && tk.stage !== 'done' ? ' mine' : '';
  return `<div class="tk${mine}"><div class="tk-name">${tkName(tk)}</div>${lines.join('')}
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
    ${s.players.length < 4 ? `<p class="bots-note">${t('lobby_bots', { n: 4 - s.players.length })}</p>` : ''}
    <p class="muted">${t('recommend')}</p>
    ${mine?.isHost ? `<button class="btn primary" id="btn-start">${t('start')}</button>` : `<p class="waiting">${t('waiting')}</p>`}`);
}

export function renderBriefing(s, joined) {
  const on = s.phase === 'briefing' && joined && s.me?.role;
  show($('#briefing'), !!on);
  if (!on) return;
  const { role, agenda } = s.me;
  const evil = agenda === 'jobhunt';
  setHTML($('#briefing'), `<div class="card wide">
    <p class="mission">${t('brief_mission')}</p>
    <div class="cards">
      <div class="rcard role"><small>${t('brief_role')}</small><div class="big">${ROLE_ICON[role]}</div>
        <h3>${t(`role_${role}`)}</h3><p>${t(`rdesc_${role}`)}</p></div>
      <div class="rcard agenda${evil ? ' evil' : ''}"><small>${t('brief_agenda')}</small>
        <h3>${t(`ag_${agenda}`)}</h3><p>${t(`agd_${agenda}`)}</p></div>
    </div>
    <p class="win-line">${t(evil ? 'brief_win_evil' : 'brief_win_team')}</p>
    <p class="muted">${t('brief_tip')}</p>
    <p class="countdown">${t('brief_starts', { s: secs(s.left) })}</p></div>`);
}

// ---------- Day phases ----------
export function renderMorning(s, joined, myId) {
  const on = s.phase === 'morning' && joined;
  show($('#morning'), on);
  if (!on) return;
  setHTML($('#morning .m-head'), `<h2>${t('morning_title', { day: `@day${s.day}` })}</h2>
    ${s.day === 5 ? `<p class="win-line">${t('day5_note')}</p>` : ''}<p>${t('morning_claim')}</p>`);
  setHTML($('#morning .m-board'), boardHtml(s, myId));
  $('#morning .m-left').textContent = t('morning_starts', { s: secs(s.left) });
}

export function renderEvening(s, joined) {
  const on = s.phase === 'evening' && joined && s.summary;
  show($('#evening'), !!on);
  if (!on) return;
  const sm = s.summary;
  const done = s.tickets.filter((x) => x.stage === 'done').length;
  setHTML($('#evening'), `<div class="card">
    <h2>${t('evening_title', { day: `@day${sm.day}` })}</h2>
    <div class="stats">
      <div><b>✅ ${sm.doneToday}</b><small>${t('evening_done')}</small></div>
      <div><b>🎫 ${done}/${s.tickets.length}</b><small>${t('evening_total')}</small></div>
      <div><b>${s.happiness}</b><small>${t('evening_client')}</small></div>
    </div>
    <h3>${t('evening_next', { day: `@day${sm.day + 1}` })}</h3>
    ${sm.day + 1 === 5 ? `<p class="win-line">${t('day5_note')}</p>` : ''}</div>`);
}

export function renderMeeting(s, joined, myId) {
  const on = s.phase === 'meeting' && joined && s.meeting;
  show($('#meeting'), !!on);
  if (!on) return;
  const m = s.meeting;
  const voted = m.myVote !== null;
  const buttons = s.players.filter((p) => p.id !== myId && !p.caught).map((p) =>
    `<button class="vote${m.myVote === p.id ? ' picked' : ''}" data-mvote="${p.id}" ${voted ? 'disabled' : ''}><i style="background:${p.color}"></i>${ROLE_ICON[p.role] || ''} ${escapeHtml(p.name)}${m.voted.includes(p.id) ? ' <small>✓</small>' : ''}</button>`).join('');
  setHTML($('#meeting .mt-body'), `
    <h2>${t('mt_title')}</h2>
    ${m.by ? `<p class="bad">${t('mt_emergency', { name: escapeHtml(m.by) })}</p>` : ''}
    <p class="muted small">${t('mt_info')}</p>
    <div class="votes">${buttons}<button class="vote skip" data-mvote="skip" ${voted ? 'disabled' : ''}>${t('mt_skip')}</button></div>
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

export function renderResults(s, joined, mine, myId) {
  const on = s.phase === 'results' && joined && s.results;
  show($('#results'), !!on);
  if (!on) return;
  const r = s.results;
  const hunter = r.players.find((p) => p.agenda === 'jobhunt');
  const rows = r.players.map((p) => `<tr${p.id === myId ? ' class="me"' : ''}>
      <td><i style="background:${p.color}"></i>${escapeHtml(p.name)}</td>
      <td>${ROLE_ICON[p.role] || ''} ${t(`role_${p.role}`)}</td>
      <td>${t(`ag_${p.agenda}`)}</td>
      <td>${p.won ? t('res_win') : t('res_lose')}</td></tr>`).join('');
  const log = r.log.length
    ? r.log.map((e) => `<li>${escapeHtml(t('res_log_row', { id: e.id, time: e.time, act: `@gitact_${e.act}`, actor: e.actor }))}</li>`).join('')
    : `<li>${t('res_log_none')}</li>`;
  setHTML($('#results'), `<div class="card wide">
    <h1 class="ending ${r.ending}">${t(`end_${r.ending}`)}</h1>
    <p class="lead">${t(`endd_${r.ending}`, { done: r.done, total: r.total })}</p>
    <p class="team-result ${r.shipped ? 'good' : 'bad'}">${t(r.shipped ? 'res_team_win' : 'res_team_lose')}</p>
    ${hunter ? `<p class="hunter">${escapeHtml(t('res_hunter', { name: hunter.name }))}${t(hunter.caught ? 'res_hunter_caught' : 'res_hunter_free')}</p>` : ''}
    <div class="table-wrap"><table><thead><tr><th>${t('res_player')}</th><th>${t('res_role')}</th><th>${t('res_side')}</th>
      <th>${t('res_result')}</th></tr></thead><tbody>${rows}</tbody></table></div>
    <h3>${t('res_log')}</h3><ul class="gitlog">${log}</ul>
    ${mine?.isHost ? `<button class="btn primary" id="btn-restart">${t('playAgain')}</button>` : `<p class="muted">${t('waitHost')}</p>`}</div>`);
}
