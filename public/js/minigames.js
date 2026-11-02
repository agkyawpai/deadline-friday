// DOM-based minigames shown in a modal. Work with keyboard, mouse and touch.
import { t, TICKET_ICON } from './i18n.js';

const ARROW = { U: '▲', D: '▼', L: '◀', R: '▶' };
const KEYMAP = { ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R', w: 'U', s: 'D', a: 'L', d: 'R', W: 'U', S: 'D', A: 'L', D: 'R' };
const tkName = (tk) => `${TICKET_ICON[tk.key] || '🎫'} ${t(`tk_${tk.key}`)}`;

export class Minigames {
  constructor({ modal, send, sfx, onOpenBoard }) {
    this.modal = modal;
    this.send = send;
    this.sfx = sfx;
    this.onOpenBoard = onOpenBoard;
    this.type = null;
    this.timers = [];
    modal.addEventListener('pointerdown', (e) => {
      const el = e.target.closest('[data-act]');
      if (!el) return;
      e.preventDefault();
      this.onAct(el.dataset.act, el);
    });
  }

  isOpen() { return !!this.type; }

  open(type, ctx = {}) {
    this.close();
    this.type = type;
    this.ctx = ctx;
    this.done = false;
    this.modal.classList.remove('hidden');
    ({ code: () => this.openCode(), qa: () => this.openQa(), fire: () => this.openFire(), phone: () => this.openPhone(), coffee: () => this.openCoffee() })[type]();
    if (window.gsap) window.gsap.fromTo(this.modal.firstElementChild, { scale: 0.85, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.25, ease: 'back.out(1.8)' });
  }

  close() {
    if (!this.type) return;
    this.timers.forEach(clearTimeout);
    this.timers.forEach(clearInterval);
    this.timers = [];
    if (window.gsap) window.gsap.killTweensOf('.mg-bug');
    this.type = null;
    this.modal.classList.add('hidden');
    this.modal.innerHTML = '';
  }

  frame(title, body) {
    this.modal.innerHTML = `<div class="mg-card"><div class="mg-title">${title}</div>${body}
      <button class="mg-close" data-act="close">${t('mg_close')}</button></div>`;
  }
  setTitle(text) { const el = this.modal.querySelector('.mg-title'); if (el) el.textContent = text; }
  feedback(text, cls = '') {
    const el = this.modal.querySelector('.mg-feedback');
    if (!el) return;
    el.textContent = text;
    el.className = `mg-feedback ${cls}`;
  }

  onAct(act, el) {
    if (act === 'close') return this.close();
    if (act === 'board') { this.close(); return this.onOpenBoard?.(); }
    if (act.startsWith('dir:')) return this.codeInput(act.slice(4));
    if (act.startsWith('tk:')) { this.ticketId = Number(act.slice(3)); return this.renderTicketPick(); }
    if (act === 'again') return this.openQa();
    if (act === 'mash') return this.mash(el);
    if (act.startsWith('phone:')) {
      this.send('task', { type: 'phone', choice: Number(act.slice(6)) });
      this.sfx('ok');
      return this.close();
    }
    if (act === 'squash') return this.squash(el);
  }

  handleKey(e) {
    if (e.key === 'Escape') { this.close(); return true; }
    if (this.type === 'code' && KEYMAP[e.key]) { this.codeInput(KEYMAP[e.key]); return true; }
    if (this.type === 'fire' && (e.key === ' ' || e.key === 'e' || e.key === 'E') && !e.repeat) {
      this.mash(this.modal.querySelector('.mg-mash'));
      return true;
    }
    if (this.type === 'phone' && ['1', '2'].includes(e.key)) { this.onAct(`phone:${Number(e.key) - 1}`); return true; }
    return ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key);
  }

  // ----- Code: pick a ticket, then press random arrow sequences -----
  openCode() {
    const tickets = this.ctx.tickets || [];
    if (!tickets.length) {
      this.frame(t('mg_code_title'), `<p class="mg-feedback bad">${t('mg_no_ticket')}</p><button class="mg-big" data-act="board">${t('mg_open_board')}</button>`);
      return;
    }
    this.ticketId = this.ctx.preferred && tickets.some((tk) => tk.id === this.ctx.preferred) ? this.ctx.preferred : tickets[0].id;
    this.frame(t('mg_code_title'), `
      <div class="mg-tickets"></div>
      <div class="mg-seq"></div>
      <div class="mg-feedback">&nbsp;</div>
      <div class="mg-pad">
        <span></span><button data-act="dir:U">▲</button><span></span>
        <button data-act="dir:L">◀</button><button data-act="dir:D">▼</button><button data-act="dir:R">▶</button>
      </div>`);
    this.renderTicketPick();
    this.newSeq();
  }
  renderTicketPick() {
    const el = this.modal.querySelector('.mg-tickets');
    if (!el) return;
    const html = `<small>${t('mg_pick_ticket')}</small>` + (this.ctx.tickets || []).map((tk) =>
      `<button data-act="tk:${tk.id}" class="${tk.id === this.ticketId ? 'sel' : ''}">${tkName(tk)} <i>${tk.progress}/${tk.work}</i></button>`).join('');
    if (el.dataset.k !== html) { el.innerHTML = html; el.dataset.k = html; } // don't eat clicks on every sync
  }
  newSeq() {
    const dirs = Object.keys(ARROW);
    this.seq = Array.from({ length: 6 }, () => dirs[Math.floor(Math.random() * 4)]);
    this.idx = 0;
    this.busy = false;
    this.renderSeq();
  }
  renderSeq() {
    const el = this.modal.querySelector('.mg-seq');
    if (el) el.innerHTML = this.seq.map((d, i) => `<span class="${i < this.idx ? 'done' : i === this.idx ? 'cur' : ''}">${ARROW[d]}</span>`).join('');
  }
  codeInput(dir) {
    if (this.type !== 'code' || this.busy || !this.seq) return;
    if (dir === this.seq[this.idx]) {
      this.idx++;
      this.sfx('tick');
      this.renderSeq();
      if (this.idx >= this.seq.length) {
        this.busy = true;
        this.send('task', { type: 'code', ok: true, ticket: this.ticketId });
        this.feedback(t('mg_compiling'));
        this.timers.push(setTimeout(() => this.type === 'code' && this.newSeq(), 650));
      }
    } else {
      this.idx = 0;
      this.renderSeq();
      this.sfx('err');
      this.feedback(t('mg_code_wrong'), 'bad');
      const seq = this.modal.querySelector('.mg-seq');
      if (window.gsap && seq) window.gsap.fromTo(seq, { x: -10 }, { x: 0, duration: 0.4, ease: 'elastic.out(1, 0.3)' });
    }
  }
  codeResult({ amt }) {
    if (this.type !== 'code') return;
    this.feedback(t('mg_code_done', { amt }), 'good');
    this.sfx('ok');
  }

  // ----- Test: squash the ticket's hidden bugs before time runs out -----
  openQa() {
    this.type = 'qa';
    const tk = this.ctx.ticket;
    const bugs = tk.bugs ?? 0;
    const seconds = 8;
    this.count = 0;
    this.frame(t('mg_qa_title', { ticket: tkName(tk), s: seconds }), '<div class="mg-arena"></div>');
    const arena = this.modal.querySelector('.mg-arena');
    for (let i = 0; i < bugs; i++) {
      const b = document.createElement('div');
      b.className = 'mg-bug';
      b.dataset.act = 'squash';
      b.textContent = '🐛';
      arena.appendChild(b);
      const wander = () => {
        if (!b.isConnected || b.dataset.dead) return;
        window.gsap.to(b, {
          left: `${5 + Math.random() * 85}%`, top: `${5 + Math.random() * 80}%`,
          rotation: Math.random() * 360, duration: 0.5 + Math.random() * 0.6, ease: 'none', onComplete: wander,
        });
      };
      window.gsap.set(b, { left: `${Math.random() * 85}%`, top: `${Math.random() * 80}%` });
      wander();
    }
    const finish = () => {
      window.gsap.killTweensOf('.mg-bug');
      arena.innerHTML = `<div class="mg-result">${t('mg_qa_wait')}</div>`;
      this.send('task', { type: 'qa', ticket: tk.id, count: this.count });
    };
    if (!bugs) { this.timers.push(setTimeout(finish, 600)); return; }
    let left = seconds;
    const iv = setInterval(() => {
      left--;
      if (this.type !== 'qa') return clearInterval(iv);
      this.setTitle(t('mg_qa_title', { ticket: tkName(tk), s: left }));
      if (left > 0 && arena.querySelector('[data-act="squash"]:not([data-dead])')) return;
      clearInterval(iv);
      finish();
    }, 1000);
    this.timers.push(iv);
  }
  squash(el) {
    if (el.dataset.dead) return;
    el.dataset.dead = '1';
    window.gsap.killTweensOf(el);
    el.textContent = '💥';
    this.count++;
    this.sfx('pop');
    window.gsap.to(el, { scale: 1.8, opacity: 0, duration: 0.35, onComplete: () => el.remove() });
  }
  qaResult({ left }) {
    if (this.type !== 'qa') return;
    const r = this.modal.querySelector('.mg-result');
    if (left === 0) {
      if (r) r.textContent = t('mg_qa_pass');
      this.sfx('win');
      this.timers.push(setTimeout(() => this.close(), 1100));
    } else {
      this.ctx.ticket = { ...this.ctx.ticket, bugs: left };
      if (r) r.textContent = t('mg_qa_left', { n: left });
      this.modal.querySelector('.mg-arena')?.insertAdjacentHTML('beforeend', `<button class="mg-big" data-act="again">${t('mg_again')}</button>`);
    }
  }

  // ----- Fire: mash the extinguisher -----
  openFire() {
    this.frame(t('mg_fire_title'), `
      <div class="mg-hp"><div class="mg-hp-fill"></div></div>
      <div class="mg-emoji">🔥🖥️🔥</div>
      <button class="mg-big mg-mash" data-act="mash">${t('mg_spray')}</button>`);
  }
  mash(el) {
    if (!el || this.done) return;
    this.send('task', { type: 'fix' });
    this.sfx('mash');
    if (window.gsap) window.gsap.fromTo(el, { scale: 0.9 }, { scale: 1, duration: 0.15 });
  }

  // ----- Phone: answer the client -----
  openPhone() {
    const q = this.ctx.q ?? 0;
    this.frame(t('phone_title'), `
      <div class="mg-quote">${t(`phone_q${q}`)}</div>
      <div class="mg-choices">
        <button data-act="phone:0">1. ${t('phone_a0')}</button>
        <button data-act="phone:1">2. ${t('phone_a1')}</button>
      </div>`);
  }

  // ----- Coffee: brew, drink, ⚡ -----
  openCoffee() {
    this.frame(t('mg_coffee'), '<div class="mg-emoji">☕</div><div class="mg-hp"><div class="mg-hp-fill brew"></div></div>');
    const fill = this.modal.querySelector('.mg-hp-fill');
    fill.style.width = '0%';
    window.gsap.to(fill, { width: '100%', duration: 1.2, ease: 'power1.in' });
    this.timers.push(setTimeout(() => {
      this.send('task', { type: 'coffee' });
      this.sfx('slurp');
      this.ctx.onDone?.();
      this.close();
    }, 1250));
  }

  // Called on every server state: keep HP bars / ticket lists live, auto-close when no longer valid.
  onState(state) {
    if (!this.type) return;
    if (!['playing', 'deploy'].includes(state.phase)) return this.close();
    const stageOf = (id) => state.tickets.find((tk) => tk.id === id)?.stage;
    if (this.type === 'code') {
      this.ctx.tickets = state.tickets.filter((tk) => tk.stage === 'dev');
      if (this.ticketId && stageOf(this.ticketId) !== 'dev') this.ticketId = this.ctx.tickets[0]?.id;
      if (!this.ctx.tickets.length && this.seq) return this.close();
      this.renderTicketPick();
    }
    if (this.type === 'qa' && stageOf(this.ctx.ticket.id) !== 'qa' && !this.modal.querySelector('.mg-result')) this.close();
    if (this.type === 'fire') {
      const fill = this.modal.querySelector('.mg-hp-fill');
      if (!state.fire) {
        if (this.done) return;
        this.done = true;
        const em = this.modal.querySelector('.mg-emoji');
        if (em) em.textContent = t('mg_fixed');
        if (fill) fill.style.width = '0%';
        this.sfx('win');
        this.timers.push(setTimeout(() => this.close(), 900));
      } else if (fill) {
        fill.style.width = `${(state.fire.hp / state.fire.max) * 100}%`;
      }
    }
    if (this.type === 'phone' && !state.phone) this.close();
  }
}
