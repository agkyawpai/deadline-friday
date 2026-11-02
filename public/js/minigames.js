// DOM-based minigames shown in a modal. Work with keyboard, mouse and touch.
import { t, TICKET_ICON } from './i18n.js';

const ARROW = { U: '▲', D: '▼', L: '◀', R: '▶' };
const KEYMAP = { ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R', w: 'U', s: 'D', a: 'L', d: 'R', W: 'U', S: 'D', A: 'L', D: 'R' };
const CLEAN_LINES = [
  'const total = price * qty;', 'if (user.isAdmin) {', 'return items.filter((i) => i.active);', 'await db.save(order);',
  'let retries = 0;', 'for (const x of list) sum += x;', 'res.status(200).json(data);', 'const id = crypto.randomUUID();',
];
const BUGGY_LINES = [
  'if (user = admin) {', 'for (let i = 0; i <= arr.length; i++)', 'const tax = price * 1.0.7;', 'password = "1234"; // TODO remove',
  'while (true) { retry(); }', 'deleteAll(users); // test only', 'return await await fetch(url);', 'if (balance > 0 || true) pay();',
];
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
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
    this.close(true);
    this.type = type;
    this.ctx = ctx;
    this.done = false;
    this.modal.classList.remove('hidden');
    ({
      code: () => this.openCode(), review: () => this.openReview(), qa: () => this.openQa(), demo: () => this.openDemo(),
      bugsProd: () => this.openBugs(), fire: () => this.openMash('fire'), fixCoffee: () => this.openMash('coffee'),
      phone: () => this.openPhone(), coffee: () => this.openCoffee(),
    })[type]();
    if (window.gsap) window.gsap.fromTo(this.modal.firstElementChild, { scale: 0.85, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.25, ease: 'back.out(1.8)' });
  }

  close() {
    if (!this.type) return;
    this.timers.forEach(clearTimeout);
    this.timers.forEach(clearInterval);
    this.timers = [];
    if (window.gsap) window.gsap.killTweensOf('.mg-bug, .mg-marker');
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
    if (act.startsWith('line:')) return this.reviewPick(Number(act.slice(5)));
    if (act === 'again') return this.type === 'qa' ? this.openQa() : this.openBugs();
    if (act === 'mash') return this.mash(el);
    if (act === 'pitch') return this.pitch();
    if (act.startsWith('phone:')) {
      this.send('task', { type: 'phone', choice: Number(act.slice(6)) });
      this.sfx('ok');
      return this.close();
    }
    if (act === 'squash') return this.squash(el);
    if (act === 'feature') return this.touchFeature(el);
  }

  handleKey(e) {
    if (e.key === 'Escape') { this.close(); return true; }
    if (this.type === 'code' && KEYMAP[e.key]) { this.codeInput(KEYMAP[e.key]); return true; }
    if ((this.type === 'fire' || this.type === 'fixCoffee') && (e.key === ' ' || e.key === 'e' || e.key === 'E') && !e.repeat) {
      this.mash(this.modal.querySelector('.mg-mash'));
      return true;
    }
    if (this.type === 'demo' && (e.key === ' ' || e.key === 'e' || e.key === 'E') && !e.repeat) { this.pitch(); return true; }
    if (this.type === 'review' && ['1', '2', '3', '4'].includes(e.key)) { this.reviewPick(Number(e.key) - 1); return true; }
    if (this.type === 'phone' && ['1', '2', '3'].includes(e.key)) { this.onAct(`phone:${Number(e.key) - 1}`); return true; }
    return ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key);
  }

  // ----- Code: pick a Dev ticket, then press random arrow sequences -----
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
      this.send('task', { type: 'code', ok: false, ticket: this.ticketId });
      this.sfx('err');
      this.feedback(t('mg_code_wrong'), 'bad');
      const seq = this.modal.querySelector('.mg-seq');
      if (window.gsap && seq) window.gsap.fromTo(seq, { x: -10 }, { x: 0, duration: 0.4, ease: 'elastic.out(1, 0.3)' });
    }
  }
  codeResult({ amt, pair }) {
    if (this.type !== 'code') return;
    this.feedback(t(pair ? 'mg_code_pair' : 'mg_code_done', { amt }), 'good');
    this.sfx('ok');
  }

  // ----- Review: spot the buggy line -----
  openReview() {
    const tk = this.ctx.ticket;
    this.lines = shuffle([...shuffle(CLEAN_LINES.slice()).slice(0, 3), BUGGY_LINES[Math.floor(Math.random() * BUGGY_LINES.length)]]);
    this.frame(t('mg_review_title', { ticket: tkName(tk) }), `
      <div class="mg-code">${this.lines.map((l, i) => `<button data-act="line:${i}"><i>${i + 1}</i> ${l.replace(/</g, '&lt;')}</button>`).join('')}</div>
      <div class="mg-feedback">&nbsp;</div>`);
  }
  reviewPick(i) {
    if (this.type !== 'review' || this.done) return;
    const ok = BUGGY_LINES.includes(this.lines[i]);
    this.send('task', { type: 'review', ticket: this.ctx.ticket.id, ok });
    if (ok) {
      this.done = true;
      this.sfx('win');
      this.feedback(t('mg_review_ok'), 'good');
      this.timers.push(setTimeout(() => this.close(), 900));
    } else {
      this.sfx('err');
      this.feedback(t('mg_review_bad'), 'bad');
      this.timers.push(setTimeout(() => this.type === 'review' && !this.done && this.openReview(), 900));
    }
  }

  // ----- QA: squash exactly the ticket's bugs; butterflies are features -----
  openQa() {
    this.type = 'qa';
    const tk = this.ctx.ticket;
    this.runArena({
      title: (s) => t('mg_qa_title', { ticket: tkName(tk), s }),
      bugs: tk.bugs ?? 0, features: 2, seconds: 8, spawnMore: false,
      finish: (count, features) => {
        this.send('task', { type: 'qa', ticket: tk.id, count, features });
        return t('mg_qa_wait');
      },
    });
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

  // ----- Prod bugs: classic squash -----
  openBugs() {
    this.type = 'bugsProd';
    this.runArena({
      title: (s) => t('mg_bugs_title', { s }), bugs: 4, features: 0, seconds: 6, spawnMore: true,
      finish: (count) => {
        this.send('task', { type: 'bugs', count });
        this.timers.push(setTimeout(() => {
          if (this.type === 'bugsProd') this.modal.querySelector('.mg-arena')?.insertAdjacentHTML('beforeend', `<button class="mg-big" data-act="again">${t('mg_again')}</button>`);
        }, 1200));
        return t('mg_bugs_wait');
      },
    });
  }
  bugsResult({ squashed }) {
    if (this.type !== 'bugsProd') return;
    const r = this.modal.querySelector('.mg-result');
    if (r) r.textContent = t('mg_bugs_done', { n: squashed });
  }

  runArena({ title, bugs, features, seconds, spawnMore, finish }) {
    this.count = 0;
    this.features = 0;
    this.frame(title(seconds), '<div class="mg-arena"></div>');
    const arena = this.modal.querySelector('.mg-arena');
    const spawn = (emoji, act) => {
      const b = document.createElement('div');
      b.className = 'mg-bug';
      b.dataset.act = act;
      b.textContent = emoji;
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
    };
    for (let i = 0; i < bugs; i++) spawn('🐛', 'squash');
    for (let i = 0; i < features; i++) spawn('🦋', 'feature');
    let left = seconds;
    const end = () => {
      window.gsap.killTweensOf('.mg-bug');
      arena.innerHTML = `<div class="mg-result">${finish(this.count, this.features)}</div>`;
    };
    if (!bugs && !spawnMore) { this.timers.push(setTimeout(end, 600)); return; }
    const iv = setInterval(() => {
      left--;
      if (!this.type) return clearInterval(iv);
      this.setTitle(title(left));
      const remaining = arena.querySelectorAll('[data-act="squash"]:not([data-dead])').length;
      if (left > 0 && (spawnMore || remaining > 0)) { if (spawnMore) { spawn('🐛', 'squash'); spawn('🐛', 'squash'); } return; }
      clearInterval(iv);
      end();
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
  touchFeature(el) {
    if (el.dataset.dead) return;
    el.dataset.dead = '1';
    this.features++;
    this.sfx('err');
    el.textContent = '🐛';
    el.dataset.act = 'squash';
    delete el.dataset.dead; // "it's not a bug, it's a feature"… now it is a bug
  }

  // ----- Demo: timing bar, 3 pitches -----
  openDemo() {
    const tk = this.ctx.ticket;
    this.hits = 0;
    this.tries = 0;
    this.frame(t('mg_demo_title', { ticket: tkName(tk), n: 0 }), `
      <div class="mg-timing"><div class="mg-zone"></div><div class="mg-marker"></div></div>
      <div class="mg-feedback">&nbsp;</div>
      <button class="mg-big" data-act="pitch">${t('mg_demo_btn')}</button>`);
    this.newZone();
  }
  newZone() {
    const zone = this.modal.querySelector('.mg-zone');
    const marker = this.modal.querySelector('.mg-marker');
    if (!zone || !marker) return;
    this.zoneStart = 15 + Math.random() * 60;
    zone.style.left = `${this.zoneStart}%`;
    window.gsap.killTweensOf(marker);
    window.gsap.fromTo(marker, { left: '0%' }, { left: '97%', duration: 0.9 - this.tries * 0.15, ease: 'sine.inOut', repeat: -1, yoyo: true });
  }
  pitch() {
    if (this.type !== 'demo' || this.done) return;
    const marker = this.modal.querySelector('.mg-marker');
    const pos = parseFloat(marker.style.left) || 0;
    const hit = pos >= this.zoneStart - 2 && pos <= this.zoneStart + 20;
    this.tries++;
    if (hit) this.hits++;
    this.sfx(hit ? 'ok' : 'err');
    this.feedback(hit ? '✅' : '❌', hit ? 'good' : 'bad');
    this.setTitle(t('mg_demo_title', { ticket: tkName(this.ctx.ticket), n: this.hits }));
    if (this.tries >= 3) {
      this.done = true;
      window.gsap.killTweensOf(marker);
      this.send('task', { type: 'demo', ticket: this.ctx.ticket.id, score: this.hits });
      this.feedback(t('mg_demo_done', { n: this.hits }), 'good');
      this.sfx('win');
      this.timers.push(setTimeout(() => this.close(), 1300));
    } else {
      this.newZone();
    }
  }

  // ----- Mash: fire extinguisher / smack the coffee machine -----
  openMash(target) {
    this.mashTarget = target;
    const fire = target === 'fire';
    this.frame(t(fire ? 'mg_fire_title' : 'mg_fixcoffee_title'), `
      <div class="mg-hp"><div class="mg-hp-fill"></div></div>
      <div class="mg-emoji">${fire ? '🔥🖥️🔥' : '☕💥'}</div>
      <button class="mg-big mg-mash" data-act="mash">${t(fire ? 'mg_spray' : 'mg_smack')}</button>`);
  }
  mash(el) {
    if (!el || this.done) return;
    this.send('task', { type: 'fix', target: this.mashTarget });
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
        <button data-act="phone:2">3. ${t('phone_a2')}</button>
      </div>`);
  }

  // ----- Coffee: brew and drink -----
  openCoffee() {
    this.frame(t('mg_coffee'), '<div class="mg-emoji">☕</div><div class="mg-hp"><div class="mg-hp-fill brew"></div></div>');
    const fill = this.modal.querySelector('.mg-hp-fill');
    fill.style.width = '0%';
    window.gsap.to(fill, { width: '100%', duration: 1.2, ease: 'power1.in' });
    this.timers.push(setTimeout(() => {
      this.send('task', { type: 'coffee' });
      this.sfx('slurp');
      this.close();
    }, 1250));
  }

  // Called on every server state: keep HP bars / ticket lists live, auto-close when no longer valid.
  onState(state, me) {
    if (!this.type) return;
    if (!['playing', 'deploy'].includes(state.phase) || (me && me.frozen)) return this.close();
    const stageOf = (id) => state.tickets.find((tk) => tk.id === id)?.stage;
    if (this.type === 'code') {
      this.ctx.tickets = state.tickets.filter((tk) => tk.stage === 'dev');
      if (this.ticketId && stageOf(this.ticketId) !== 'dev') this.ticketId = this.ctx.tickets[0]?.id;
      if (!this.ctx.tickets.length && this.seq) return this.close();
      this.renderTicketPick();
    }
    if (this.type === 'review' && !this.done && stageOf(this.ctx.ticket.id) !== 'review') this.close();
    if (this.type === 'demo' && !this.done && stageOf(this.ctx.ticket.id) !== 'demo') this.close();
    if (this.type === 'fire' || this.type === 'fixCoffee') {
      const obj = this.type === 'fire' ? state.fire : state.coffeeBroken;
      const fill = this.modal.querySelector('.mg-hp-fill');
      if (!obj) {
        if (this.done) return;
        this.done = true;
        const em = this.modal.querySelector('.mg-emoji');
        if (em) em.textContent = t('mg_fixed');
        if (fill) fill.style.width = '0%';
        this.sfx('win');
        this.timers.push(setTimeout(() => this.close(), 900));
      } else if (fill) {
        fill.style.width = `${(obj.hp / obj.max) * 100}%`;
      }
    }
    if (this.type === 'phone' && !state.phone) this.close();
  }
}
