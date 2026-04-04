const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../frontend')));

// ── Routes ────────────────────────────────────────────────────────────────────

app.use('/api/posts', require('./routes/posts'));
app.use('/api/simulation', require('./routes/simulation'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ── Init ──────────────────────────────────────────────────────────────────────

// Ensure data directory exists
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

app.listen(PORT, () => {
  console.log('');
  console.log('  ██╗     ██╗     ███╗   ███╗    ██████╗ ███████╗██████╗ ██████╗ ██╗████████╗');
  console.log('  ██║     ██║     ████╗ ████║    ██╔══██╗██╔════╝██╔══██╗██╔══██╗██║╚══██╔══╝');
  console.log('  ██║     ██║     ██╔████╔██║    ██████╔╝█████╗  ██║  ██║██║  ██║██║   ██║   ');
  console.log('  ██║     ██║     ██║╚██╔╝██║    ██╔══██╗██╔══╝  ██║  ██║██║  ██║██║   ██║   ');
  console.log('  ███████╗███████╗██║ ╚═╝ ██║    ██║  ██║███████╗██████╔╝██████╔╝██║   ██║   ');
  console.log('  ╚══════╝╚══════╝╚═╝     ╚═╝    ╚═╝  ╚═╝╚══════╝╚═════╝ ╚═════╝ ╚═╝   ╚═╝   ');
  console.log('');
  console.log(`  🤖 LLM Reddit is running at: http://localhost:${PORT}`);
  console.log(`  📡 Make sure Ollama is running: ollama serve`);
  console.log(`  📖 Docs: see README.md`);
  console.log('');
});
