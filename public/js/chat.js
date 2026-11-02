// In-game "Slack": #general (public + DMs) and #git-log (bot posts: ticket moves, suspicious activity, git blame).
import { t } from './i18n.js';
import { escapeHtml } from './scene.js';

export class Chat {
  constructor(root, { send, onFocusChange }) {
    this.root = root;
    this.send = send;
    this.onFocusChange = onFocusChange;
    this.msgs = [];
    this.seen = new Set();
    this.tab = 'general';
    this.unread = { general: 0, git: 0 };
    this.open = window.innerWidth > 900;
    this.players = [];
    this.myId = null;
    root.innerHTML = `
      <button class="chat-toggle">💬 <span class="badge hidden"></span></button>
      <div class="chat-panel">
        <div class="chat-tabs"><button data-tab="general"></button><button data-tab="git"></button></div>
        <div class="chat-list"></div>
        <form class="chat-input"><select class="chat-to"></select><input maxlength="140" autocomplete="off"><button>➤</button></form>
      </div>`;
    this.list = root.querySelector('.chat-list');
    this.input = root.querySelector('input');
    this.toSel = root.querySelector('.chat-to');
    root.querySelector('.chat-toggle').addEventListener('click', () => this.setOpen(!this.open));
    root.querySelector('.chat-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (b) { this.tab = b.dataset.tab; this.render(); }
    });
    root.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.input.value.trim();
      if (!text) return;
      this.send(text, this.toSel.value || undefined);
      this.input.value = '';
    });
    this.input.addEventListener('focus', () => this.onFocusChange?.(true));
    this.input.addEventListener('blur', () => this.onFocusChange?.(false));
    this.input.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.input.blur(); });
    this.setOpen(this.open);
  }

  setVisible(on) { this.root.classList.toggle('hidden', !on); }
  setOpen(on) {
    this.open = on;
    this.root.classList.toggle('open', on);
    if (on) this.unread[this.tab] = 0;
    this.render();
  }
  focus() {
    this.setOpen(true);
    if (this.tab !== 'general') { this.tab = 'general'; this.render(); }
    this.input.focus();
  }
  clear() { this.msgs = []; this.seen.clear(); this.unread = { general: 0, git: 0 }; this.render(); }

  setPlayers(players, myId) {
    this.myId = myId;
    const key = players.map((p) => p.id + p.name).join('|') + myId;
    if (key === this.playersKey) return;
    this.playersKey = key;
    this.players = players;
    const cur = this.toSel.value;
    this.toSel.innerHTML = `<option value="">${t('chat_everyone')}</option>`
      + players.filter((p) => p.id !== myId).map((p) => `<option value="${p.id}">${t('chat_dm')}: ${escapeHtml(p.name)}</option>`).join('');
    if ([...this.toSel.options].some((o) => o.value === cur)) this.toSel.value = cur;
  }

  add(e) {
    if (this.seen.has(e.seq)) return;
    this.seen.add(e.seq);
    const ch = e.ch === 'git' ? 'git' : 'general';
    this.msgs.push({ ...e, ch });
    if (this.msgs.length > 200) this.msgs.shift();
    if (!this.open || this.tab !== ch) this.unread[ch]++;
    this.render();
  }

  lineHtml(m) {
    if (m.ch === 'git') return `<div class="msg bot${m.to ? ' dm' : ''}"><b>🤖 git-bot</b> ${escapeHtml(t(m.key, m.params))}</div>`;
    const toName = m.to ? this.players.find((p) => p.id === m.to)?.name || '?' : null;
    const dm = m.to ? `<span class="dm-tag">${escapeHtml(m.from === this.myId ? t('chat_dm_to', { name: toName }) : t('chat_dm_from'))}</span>` : '';
    return `<div class="msg${m.to ? ' dm' : ''}"><b style="color:${m.color}">${escapeHtml(m.name)}</b>${dm} ${escapeHtml(m.text)}</div>`;
  }

  render() {
    if (this.open) this.unread[this.tab] = 0;
    const tabs = this.root.querySelectorAll('[data-tab]');
    tabs.forEach((b) => {
      const k = b.dataset.tab;
      b.classList.toggle('active', k === this.tab);
      b.innerHTML = `${t(`ch_${k}`)}${this.unread[k] ? ` <i>${this.unread[k]}</i>` : ''}`;
    });
    const total = this.unread.general + this.unread.git;
    const badge = this.root.querySelector('.badge');
    badge.textContent = total;
    badge.classList.toggle('hidden', !total || this.open);
    this.input.placeholder = t('chat_ph');
    const atBottom = this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight < 40;
    this.list.innerHTML = this.msgs.filter((m) => m.ch === this.tab).slice(-80).map((m) => this.lineHtml(m)).join('');
    if (atBottom) this.list.scrollTop = this.list.scrollHeight;
  }
}
