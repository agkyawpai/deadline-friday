'use strict';
// POST /api/sync — the only endpoint. Each client calls it ~5x/s with its position and unacknowledged actions,
// and gets back the room snapshot plus any events it hasn't seen yet.
const game = require('./game');

const CODE_RE = /^[A-Z0-9]{4,6}$/;
const PID_RE = /^[A-Za-z0-9_-]{8,40}$/;
const ACT_TYPES = new Set(['join', 'leave', 'start', 'restart', 'task', 'ability', 'emote', 'vote']);

function cleanInput(body, now) {
  const pos = body.pos && typeof body.pos === 'object'
    ? { x: Number(body.pos.x) || 0, z: Number(body.pos.z) || 0, face: Number(body.pos.face) || 0, moving: !!body.pos.moving }
    : null;
  const acts = (Array.isArray(body.acts) ? body.acts : [])
    .filter((a) => a && typeof a === 'object' && Number.isFinite(a.seq) && ACT_TYPES.has(a.type))
    .slice(-60)
    .map((a) => {
      const out = { seq: a.seq, type: a.type, ct: Number(a.ct) || 0 };
      for (const f of ['name', 'kind', 'target']) if (typeof a[f] === 'string') out[f] = a[f].slice(0, 40);
      for (const f of ['ok', 'create']) if (typeof a[f] === 'boolean') out[f] = a[f];
      for (const f of ['count', 'choice', 'i']) if (Number.isFinite(a[f])) out[f] = a[f];
      return out;
    });
  return { t: now, pos, acts, tpAck: Number(body.tpAck) || 0 };
}

async function handleSync(store, body, now) {
  const code = String(body.code || '').toUpperCase();
  const pid = String(body.pid || '');
  if (!CODE_RE.test(code) || !PID_RE.test(pid)) return { error: 'bad' };
  const input = cleanInput(body, now);
  const wantsCreate = input.acts.some((a) => a.type === 'join' && a.create);

  const { room: loaded, ver, inputs, canTick } = await store.sync(code, pid, input, now);
  let room = loaded;
  if (!room && !wantsCreate) return { error: 'noRoom' };
  if (canTick) {
    room = room || game.createRoom(code, now);
    game.step(room, inputs, now);
    if (!(await store.save(code, room, ver))) room = loaded; // lost the race; client resends its actions
  }
  if (!room) return { wait: true };
  return { state: game.snapshot(room, inputs, pid, Number(body.lastEv) || 0, now) };
}

module.exports = { handleSync };
