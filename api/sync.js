'use strict';
// Vercel Function: POST /api/sync, backed by Upstash Redis.
const { handleSync } = require('../lib/handler');
const { redisStore } = require('../lib/store');

let store = null;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  try {
    store = store || redisStore();
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const out = await handleSync(store, body, Date.now());
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(out);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server' });
  }
};
