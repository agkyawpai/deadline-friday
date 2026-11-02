'use strict';
// Room storage. Both stores expose the same two calls:
//   sync(code, pid, input, now) -> { room, ver, inputs, canTick }  (records this client's input, reads everything)
//   save(code, room, ver)       -> true if saved (false if someone else saved first)
// canTick is a 100 ms lock, so only one request per room advances the game at a time.
const TICK_MS = 100;
const ROOM_TTL_S = 7200;

function memoryStore() {
  const rooms = new Map();
  const inputs = new Map();
  const locks = new Map();
  return {
    async sync(code, pid, input, now) {
      if (!inputs.has(code)) inputs.set(code, {});
      inputs.get(code)[pid] = input;
      const canTick = now >= (locks.get(code) || 0);
      if (canTick) locks.set(code, now + TICK_MS);
      const saved = rooms.get(code);
      return { room: saved ? saved.room : null, ver: saved ? saved.ver : 0, inputs: inputs.get(code), canTick };
    },
    async save(code, room, ver) {
      const cur = rooms.get(code);
      if ((cur ? cur.ver : 0) !== ver) return false;
      rooms.set(code, { room, ver: ver + 1 });
      if (!Object.keys(room.players).length) { rooms.delete(code); inputs.delete(code); }
      return true;
    },
  };
}

// Stored value is "<version>|<room json>"; the Lua script only writes if the version still matches.
const CAS_SCRIPT = `
local cur = redis.call('GET', KEYS[1])
local v = 0
if cur then v = tonumber(string.match(cur, '^(%d+)|')) or 0 end
if v ~= tonumber(ARGV[1]) then return 0 end
redis.call('SET', KEYS[1], (v + 1) .. '|' .. ARGV[2], 'EX', tonumber(ARGV[3]))
redis.call('EXPIRE', KEYS[2], tonumber(ARGV[3]))
return 1`;

function redisStore() {
  const { Redis } = require('@upstash/redis');
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('Missing UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN');
  const redis = new Redis({ url, token, automaticDeserialization: false });
  const k = (code) => ({ room: `df:room:${code}`, inp: `df:in:${code}`, tick: `df:tick:${code}` });

  return {
    async sync(code, pid, input, now) {
      const key = k(code);
      const p = redis.pipeline();
      p.hset(key.inp, { [pid]: JSON.stringify(input) });
      p.set(key.tick, String(now), { nx: true, px: TICK_MS }); // lock before reading, so a winner reads fresh state
      p.get(key.room);
      p.hgetall(key.inp);
      const [, lock, raw, rawInputs] = await p.exec();
      let room = null;
      let ver = 0;
      if (raw) {
        const bar = raw.indexOf('|');
        ver = Number(raw.slice(0, bar));
        room = JSON.parse(raw.slice(bar + 1));
      }
      // Without automatic deserialization, HGETALL comes back as a flat [field, value, field, value, ...] array.
      let pairs = Object.entries(rawInputs || {});
      if (Array.isArray(rawInputs)) {
        pairs = [];
        for (let i = 0; i + 1 < rawInputs.length; i += 2) pairs.push([rawInputs[i], rawInputs[i + 1]]);
      }
      const inputs = {};
      for (const [id, v] of pairs) {
        try { inputs[id] = typeof v === 'string' ? JSON.parse(v) : v; } catch { /* skip bad entry */ }
      }
      return { room, ver, inputs, canTick: lock === 'OK' };
    },
    async save(code, room, ver) {
      const key = k(code);
      const ok = await redis.eval(CAS_SCRIPT, [key.room, key.inp], [String(ver), JSON.stringify(room), String(ROOM_TTL_S)]);
      return Number(ok) === 1;
    },
  };
}

module.exports = { memoryStore, redisStore };
