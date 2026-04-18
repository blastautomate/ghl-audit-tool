require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const BASE = 'https://services.leadconnectorhq.com';
const VER  = '2021-07-28';

async function ghlGet(token, endpoint) {
  const res = await fetch(`${BASE}${endpoint}`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Version': VER, 'Accept': 'application/json' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${endpoint}`);
  return res.json();
}

async function safeGet(token, endpoint) {
  try { return { ok: true, d: await ghlGet(token, endpoint) }; }
  catch (e) { return { ok: false, err: e.message }; }
}

app.post('/api/audit', async (req, res) => {
  const { token, locationId } = req.body;
  if (!token || !locationId) return res.status(400).json({ error: 'token and locationId required' });

  const [location, contacts, pipelines, opps, funnels, workflows, calendars, forms, customVals, customFields, tags, users, conversations] = await Promise.all([
    safeGet(token, `/locations/${locationId}`),
    safeGet(token, `/contacts/?locationId=${locationId}&limit=100`),
    safeGet(token, `/opportunities/pipelines/?locationId=${locationId}`),
    safeGet(token, `/opportunities/search?location_id=${locationId}&limit=100`),
    safeGet(token, `/funnels/?locationId=${locationId}&limit=50`),
    safeGet(token, `/workflows/?locationId=${locationId}`),
    safeGet(token, `/calendars/?locationId=${locationId}`),
    safeGet(token, `/forms/?locationId=${locationId}&limit=50`),
    safeGet(token, `/locations/${locationId}/customValues`),
    safeGet(token, `/locations/${locationId}/customFields`),
    safeGet(token, `/locations/${locationId}/tags`),
    safeGet(token, `/users/?locationId=${locationId}`),
    safeGet(token, `/conversations/search?locationId=${locationId}&limit=20`),
  ]);

  res.json({ location, contacts, pipelines, opps, funnels, workflows, calendars, forms, customVals, customFields, tags, users, conversations });
});

app.get('/health', (_, res) => res.json({ status: 'ok' }));
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`GHL Expert Audit running → http://localhost:${PORT}`));
