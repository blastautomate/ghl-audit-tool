require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VER  = '2021-07-28';

// ─── Helper: single GHL API call ─────────────────────────────
async function ghlGet(token, endpoint) {
  const url = `${GHL_BASE}${endpoint}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Version':       GHL_VER,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

// ─── Main audit endpoint ──────────────────────────────────────
app.post('/api/audit', async (req, res) => {
  const { token, locationId } = req.body;

  if (!token || !locationId) {
    return res.status(400).json({ error: 'token and locationId are required' });
  }

  const steps = [
    { id: 'location',   url: `/locations/${locationId}` },
    { id: 'contacts',   url: `/contacts/?locationId=${locationId}&limit=100` },
    { id: 'pipelines',  url: `/opportunities/pipelines/?locationId=${locationId}` },
    { id: 'opps',       url: `/opportunities/search?location_id=${locationId}&limit=50` },
    { id: 'funnels',    url: `/funnels/?locationId=${locationId}` },
    { id: 'workflows',  url: `/workflows/?locationId=${locationId}` },
    { id: 'calendars',  url: `/calendars/?locationId=${locationId}` },
    { id: 'forms',      url: `/forms/?locationId=${locationId}&limit=50` },
    { id: 'customVals', url: `/locations/${locationId}/customValues` },
  ];

  const results = {};

  for (const step of steps) {
    try {
      const data = await ghlGet(token, step.url);
      results[step.id] = { ok: true, d: data };
    } catch (err) {
      results[step.id] = { ok: false, err: err.message };
    }
  }

  return res.json(results);
});

// ─── Health check (Render uses this) ─────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ─── Catch-all: serve index.html ─────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start server ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ GHL Audit Tool running → http://localhost:${PORT}`);
});
