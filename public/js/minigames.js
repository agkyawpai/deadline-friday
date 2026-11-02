// DOM-based minigames shown in a modal. Work with keyboard, mouse and touch.
import { t } from './i18n.js';

const ARROW = { U: '▲', D: '▼', L: '◀', R: '▶' };
const KEYMAP = { ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R', w: 'U', s: 'D', a: 'L', d: 'R', W: 'U', S: 'D', A: 'L', D: 'R' };

export class Minigames {
  constructor({ modal, send, sfx, onClose }) {
    this.modal = modal;
    this.send = send;
    this.sfx = sfx;
    this.onClose = onClose;
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
    this.modal.classList.remove('hidden');
    ({ code: () => this.openCode(), bugs: () => this.openBugs(), fire: () => this.openMash('fire'),
      fixCoffee: () => this.openMash('coffee'), phone: () => this.openPhone(), coffee: () => this.openCoffee() })[type]();
    if (window.gsap) window.gsap.fromTo(this.modal.firstElementChild, { scale: 0.85, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.25, ease: 'back.out(1.8)' });
  }

  close(silent = false) {
    if (!this.type) return;
    this.timers.forEach(clearTimeout);
    this.timers.forEach(clearInterval);
    this.timers = [];
    if (window.gsap) window.gsap.killTweensOf('.mg-bug');
    this.type = null;
    this.modal.classList.add('hidden');
    this.modal.innerHTML = '';
    if (!silent) this.onClose?.();
  }

  frame(title, body) {
    this.modal.innerHTML = `<div class="mg-card"><div class="mg-title">${title}</div>${body}
      <button class="mg-close" data-act="close">${t('mg_close')}</button></div>`;
  }

  onAct(act, el) {
    if (act === 'close') return this.close();
    if (act.startsWith('dir:')) return this.codeInput(act.slice(4));
    if (act === 'again') return this.openBugs();
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
    if ((this.type === 'fire' || this.type === 'fixCoffee') && (e.key === ' ' || e.key === 'e' || e.key === 'E') && !e.repeat) {
      this.mash(this.modal.querySelector('.mg-mash'));
      return true;
    }
    if (this.type === 'phone' && ['1', '2', '3'].includes(e.key)) {
      this.onAct(`phone:${Number(e.key) - 1}`);
      return true;
    }
    return ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key);
  }

  // ----- Code: press a random arrow sequence -----
  openCode() {
    this.frame(t('mg_code_title'), `
      <div class="mg-seq"></div>
      <div class="mg-feedback">&nbsp;</div>
      <div class="mg-pad">
        <span></span><button data-act="dir:U">▲</button><span></span>
        <button data-act="dir:L">◀</button><button data-act="dir:D">▼</button><button data-act="dir:R">▶</button>
      </div>`);
    this.newSeq();
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
    if (this.type !== 'code' || this.busy) return;
    if (dir === this.seq[this.idx]) {
      this.idx++;
      this.sfx('tick');
      this.renderSeq();
      if (this.idx >= this.seq.length) {
        this.busy = true;
        this.send('task', { type: 'code', ok: true });
        this.feedback(t('mg_compiling'), '');
        this.timers.push(setTimeout(() => this.type === 'code' && this.newSeq(), 650));
      }
    } else {
      this.idx = 0;
      this.renderSeq();
      this.send('task', { type: 'code', ok: false });
      this.sfx('err');
      this.feedback(t('mg_code_wrong'), 'bad');
      const seq = this.modal.querySelector('.mg-seq');
      if (window.gsap && seq) window.gsap.fromTo(seq, { x: -10 }, { x: 0, duration: 0.4, ease: 'elastic.out(1, 0.3)' });
    }
  }
  codeResult({ amt, bug }) {
    if (this.type !== 'code') return;
    this.feedback(t(bug ? 'mg_code_bug' : 'mg_code_done', { amt }), bug ? 'bad' : 'good');
    this.sfx(bug ? 'bug' : 'ok');
  }
  feedback(text, cls) {
    const el = this.modal.querySelector('.mg-feedback');
    if (!el) return;
    el.textContent = text;
    el.className = `mg-feedback ${cls}`;
  }

  // ----- Bugs: squash moving bugs for 6 seconds -----
  openBugs() {
    this.type = 'bugs';
    this.count = 0;
    this.frame(t('mg_bugs_title', { s: 6 }), '<div class="mg-arena"></div><div class="mg-feedback">&nbsp;</div>');
    const arena = this.modal.querySelector('.mg-arena');
    const spawn = () => {
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
    };
    for (let i = 0; i < 4; i++) spawn();
    let left = 6;
    const iv = setInterval(() => {
      left--;
      if (this.type !== 'bugs') return clearInterval(iv);
      this.modal.querySelector('.mg-title').textContent = t('mg_bugs_title', { s: left });
      if (left > 0) { spawn(); spawn(); return; }
      clearInterval(iv);
      window.gsap.killTweensOf('.mg-bug');
      this.send('task', { type: 'bugs', count: this.count });
      arena.innerHTML = `<div class="mg-result">${t('mg_bugs_wait')}</div>`;
      this.timers.push(setTimeout(() => {
        if (this.type !== 'bugs') return;
        arena.insertAdjacentHTML('beforeend', `<button class="mg-big" data-act="again">${t('mg_again')}</button>`);
      }, 1200));
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
  bugsResult({ squashed }) {
    if (this.type !== 'bugs') return;
    const r = this.modal.querySelector('.mg-result');
    if (r) r.textContent = t('mg_bugs_done', { n: squashed });
  }

  // ----- Mash: fire extinguisher / smack the coffee machine -----
  openMash(target) {
    this.mashTarget = target;
    this.done = false;
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

  // Called on every server state: keep HP bars live, auto-close when no longer valid.
  onState(state, me) {
    if (!this.type) return;
    if (state.phase !== 'playing' || (me && me.frozen)) return this.close();
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
        this.timers.push(setTimeout(() => { this.done = false; this.close(); }, 900));
      } else if (fill) {
        fill.style.width = `${(obj.hp / obj.max) * 100}%`;
      }
    }
    if (this.type === 'phone' && !state.phone) this.close();
  }
}
