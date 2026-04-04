const express = require('express');
const router = express.Router();
const scheduler = require('../llm/scheduler');
const { checkBackend, BACKENDS } = require('../llm/llmClient');

/** POST /api/simulation/start */
router.post('/start', (req, res) => {
  const { intervalMs, backend } = req.body;
  scheduler.start({ intervalMs, backend });
  res.json({ success: true, status: scheduler.getStatus() });
});

/** POST /api/simulation/stop */
router.post('/stop', (req, res) => {
  scheduler.stop();
  res.json({ success: true, status: scheduler.getStatus() });
});

/** GET /api/simulation/status */
router.get('/status', (req, res) => {
  res.json(scheduler.getStatus());
});

/** POST /api/simulation/settings — update settings without full restart */
router.post('/settings', (req, res) => {
  const { intervalMs, backend } = req.body;
  scheduler.updateSettings({ intervalMs, backend });
  res.json({ success: true, status: scheduler.getStatus() });
});

/** GET /api/simulation/check-backend — test if LLM backend is reachable */
router.get('/check-backend', async (req, res) => {
  const { backend = 'ollama' } = req.query;
  const ok = await checkBackend(backend);
  res.json({
    backend,
    reachable: ok,
    url: backend === 'ollama' ? BACKENDS.ollama : BACKENDS.lmstudio,
  });
});

module.exports = router;
