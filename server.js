'use strict';
// LAN mode: same game and same /api/sync as the Vercel deploy, but rooms live in this process's memory.
// Set UPSTASH_REDIS_REST_URL/TOKEN to make this local server use Redis instead (handy for testing).
const path = require('path');
const os = require('os');
const express = require('express');
const { handleSync } = require('./lib/handler');
const { memoryStore, redisStore } = require('./lib/store');

const PORT = Number(process.env.PORT) || 3000;
const useRedis = !!(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL);
const store = useRedis ? redisStore() : memoryStore();

const app = express();
app.use(express.json({ limit: '32kb' }));
app.use(express.text({ limit: '32kb' })); // navigator.sendBeacon posts text/plain
app.use(express.static(path.join(__dirname, 'public')));
app.post('/api/sync', async (req, res) => {
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    res.set('Cache-Control', 'no-store').json(await handleSync(store, body, Date.now()));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Deadline: Friday 5PM is running! (store: ${useRedis ? 'Upstash Redis' : 'memory'})\n`);
  console.log(`  Local:   http://localhost:${PORT}`);
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`  LAN:     http://${a.address}:${PORT}`);
    }
  }
  console.log('');
});
