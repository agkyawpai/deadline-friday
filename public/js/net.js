// HTTP sync client: POST /api/sync a few times per second with our position and not-yet-acknowledged actions.
// Works the same against the LAN server and the Vercel deploy.
function newId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export class Net {
  constructor({ onState, onEvent, onError, onTeleport }) {
    Object.assign(this, { onState, onEvent, onError, onTeleport });
    try {
      this.pid = localStorage.getItem('df_pid') || newId();
      localStorage.setItem('df_pid', this.pid);
    } catch { this.pid = newId(); }
    this.seqBase = Date.now() * 100; // keeps seq increasing across page reloads
    this.counter = 0;
    this.pending = [];
    this.code = null;
    this.pos = null;
    this.phase = 'lobby';
    this.inFlight = false;
    this.timer = null;
    this.lastReq = 0;
    this.fails = 0;
  }

  start(code) {
    this.code = code;
    this.lastEv = -1; // first reply: only private events (e.g. "room full"), skip old public history
    this.tpAck = 0;
    this.pending = [];
    this.schedule(0);
  }

  stop() {
    this.code = null;
    this.pending = [];
    clearTimeout(this.timer);
  }

  send(type, data = {}) {
    if (!this.code) return;
    this.pending.push({ ...data, seq: this.seqBase + ++this.counter, type, ct: Date.now() });
    if (this.pending.length > 60) this.pending.shift();
    this.schedule(Math.max(0, 60 - (performance.now() - this.lastReq))); // actions go out quickly
  }

  schedule(ms) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.sync(), ms);
  }

  interval() {
    if (document.hidden) return 1000;
    return this.phase === 'playing' ? 200 : 400;
  }

  async sync() {
    if (!this.code) return;
    if (this.inFlight) { this.again = true; return; }
    this.inFlight = true;
    this.lastReq = performance.now();
    const code = this.code;
    let out = null;
    try {
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, pid: this.pid, pos: this.pos, acts: this.pending, lastEv: Math.max(0, this.lastEv), tpAck: this.tpAck }),
      });
      out = await res.json();
      this.fails = 0;
    } catch {
      this.fails++;
      if (this.fails === 3) this.onError?.('offline');
    }
    this.inFlight = false;
    if (code !== this.code) return; // stopped or switched rooms meanwhile

    if (out?.error) {
      this.stop();
      this.onError?.(out.error);
      return;
    }
    const s = out?.state;
    if (s) {
      this.phase = s.phase;
      this.pending = this.pending.filter((a) => a.seq > s.ackSeq);
      const first = this.lastEv < 0;
      for (const e of s.events) if (!first || e.to) this.onEvent?.(e);
      this.lastEv = s.evSeq;
      if (s.me && s.me.tp > this.tpAck) {
        this.tpAck = s.me.tp;
        this.onTeleport?.(s.me.x, s.me.z);
      }
      this.onState?.(s);
    }
    if (!this.code) return;
    const wait = this.again ? 0 : this.interval() * (this.fails ? Math.min(5, this.fails) : 1);
    this.again = false;
    this.schedule(Math.max(0, wait - (performance.now() - this.lastReq)));
  }
}
