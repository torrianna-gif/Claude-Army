require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;
const COHORT_PASSWORD = process.env.COHORT_PASSWORD;

if (!COHORT_PASSWORD) {
  console.error('ERROR: COHORT_PASSWORD environment variable is not set.');
  process.exit(1);
}

// Middleware
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));
app.use(express.static(path.join(__dirname, 'public')));

// In-memory data store
const checkins = [];

// Persistent digest store
const DIGESTS_FILE = path.join(__dirname, 'digests.json');

function loadDigests() {
  try {
    return JSON.parse(fs.readFileSync(DIGESTS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveDigests(arr) {
  fs.writeFileSync(DIGESTS_FILE, JSON.stringify(arr, null, 2), 'utf8');
}

const digests = loadDigests();

function getWeekOf() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setDate(diff);
  return monday.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function formatCheckinsForDigest(items) {
  return items.map((c, i) => {
    const parts = [`Check-in ${i + 1} — ${c.name} (${c.stageWeek})`];
    if (c.completed)       parts.push(`What they completed: ${c.completed}`);
    if (c.confused)        parts.push(`What confused them: ${c.confused}`);
    if (c.carryingForward) parts.push(`Carrying forward: ${c.carryingForward}`);
    if (c.feeling)         parts.push(`Feeling: ${c.feeling}`);
    return parts.join('\n');
  }).join('\n\n---\n\n');
}

// House data + in-memory store
const HOUSES = {
  lovelace: { name: 'House Lovelace', archetype: 'The Builders',       motto: 'The bug is the lesson.',                                            color: '#E8735A' },
  turing:   { name: 'House Turing',   archetype: 'The Puzzle-Solvers', motto: 'What question are we actually asking?',                              color: '#2A9D8F' },
  hopper:   { name: 'House Hopper',   archetype: 'The Translators',    motto: "The most dangerous phrase is 'we've always done it this way.'",      color: '#E9B44C' }
};
const houseCheckins = [];

// Rotation store (persists to file)
const ROTATIONS_FILE = path.join(__dirname, 'rotations.json');

function loadRotations() {
  try { return JSON.parse(fs.readFileSync(ROTATIONS_FILE, 'utf8')); }
  catch { return []; }
}

function saveRotations(arr) {
  fs.writeFileSync(ROTATIONS_FILE, JSON.stringify(arr, null, 2), 'utf8');
}

const rotations = loadRotations();

// Demo-or-die store (persists to file)
const DEMOS_FILE = path.join(__dirname, 'demos.json');

function loadDemos() {
  try { return JSON.parse(fs.readFileSync(DEMOS_FILE, 'utf8')); }
  catch { return []; }
}

function saveDemos(arr) {
  fs.writeFileSync(DEMOS_FILE, JSON.stringify(arr, null, 2), 'utf8');
}

const demos = loadDemos();

// Cohort stage map (persists to file)
const MAP_FILE = path.join(__dirname, 'map.json');

function loadMap() {
  try { return JSON.parse(fs.readFileSync(MAP_FILE, 'utf8')); }
  catch { return []; }
}

function saveMap(arr) {
  fs.writeFileSync(MAP_FILE, JSON.stringify(arr, null, 2), 'utf8');
}

const mapEntries = loadMap();

// Auth middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  res.redirect('/login');
}

// Routes
app.get('/', (req, res) => {
  if (req.session && req.session.authenticated) {
    return res.redirect('/dashboard');
  }
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  if (req.session && req.session.authenticated) {
    return res.redirect('/dashboard');
  }
  res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === COHORT_PASSWORD) {
    req.session.authenticated = true;
    return res.redirect('/dashboard');
  }
  res.redirect('/login?error=1');
});

app.get('/dashboard', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

app.get('/checkin', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'checkin.html'));
});

app.get('/feynman', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'feynman.html'));
});

app.get('/digest', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'digest.html'));
});

app.get('/houses', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'houses.html'));
});

app.get('/houses/:houseName', requireAuth, (req, res) => {
  if (!HOUSES[req.params.houseName]) return res.redirect('/houses');
  res.sendFile(path.join(__dirname, 'views', 'house.html'));
});

app.get('/meetings', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'meetings.html'));
});

app.get('/demos', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'demos.html'));
});

app.get('/map', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'map.html'));
});

// API
app.get('/api/checkins', requireAuth, (_req, res) => {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const results = checkins
    .filter(c => new Date(c.timestamp) >= cutoff)
    .slice()
    .reverse();
  res.json({ ok: true, checkins: results });
});

app.post('/api/checkins', requireAuth, (req, res) => {
  const { name, stageWeek, house, completed, confused, carryingForward, feeling } = req.body;
  if (!name || !stageWeek) {
    return res.status(400).json({ error: 'name and stageWeek are required' });
  }
  const entry = {
    name: name.trim(),
    stageWeek,
    house: house || '',
    completed: completed?.trim() || '',
    confused: confused?.trim() || '',
    carryingForward: carryingForward?.trim() || '',
    feeling: feeling?.trim() || '',
    timestamp: new Date().toISOString()
  };
  checkins.push(entry);
  res.status(201).json({ ok: true, entry });
});

const DIGEST_SYSTEM = `You are synthesizing weekly learning check-ins from a cohort of human-centered design practitioners going through an AI literacy program. Your job is to find the themes, name the shared confusions, surface the questions people are carrying, and celebrate something real. Be warm and specific. Avoid generic summaries. Write as if you genuinely care about this cohort's progress. Structure your response with these exact lowercase markdown headers: what the cohort worked on this week, common confusions or sticking points, questions the cohort is carrying forward, one thing worth celebrating.`;

app.get('/api/checkins/count', requireAuth, (_req, res) => {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const count = checkins.filter(c => new Date(c.timestamp) >= cutoff).length;
  res.json({ ok: true, count });
});

app.get('/api/digests', requireAuth, (_req, res) => {
  res.json({ ok: true, digests });
});

app.post('/api/digest/generate', requireAuth, async (_req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured' });
  }
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const weekCheckins = checkins.filter(c => new Date(c.timestamp) >= cutoff);
  if (weekCheckins.length === 0) {
    return res.status(400).json({ error: 'no check-ins this week yet — nothing to digest' });
  }
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: DIGEST_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Here are this week's check-ins from the cohort:\n\n${formatCheckinsForDigest(weekCheckins)}`
        }
      ]
    });
    const digest = {
      content: message.content[0].text,
      generatedAt: new Date().toISOString(),
      weekOf: getWeekOf()
    };
    digests.unshift(digest);
    saveDigests(digests);
    res.json({ ok: true, digest, count: weekCheckins.length });
  } catch (err) {
    console.error('Anthropic API error:', err.message);
    res.status(500).json({ error: 'failed to generate digest — please try again' });
  }
});

const FEYNMAN_SYSTEM = `You are a supportive AI learning coach for a cohort of human-centered design practitioners learning AI literacy. Your job is to give warm, specific, constructive feedback on their plain-language explanations of technical concepts. You are not grading them — you are helping them find the gaps in their own understanding so they can fill them. Always be encouraging. Never be condescending. Structure your response in exactly three sections using these exact headers: what landed clearly, where the gaps are, one question to push your thinking. Use lowercase headers.`;

app.post('/api/feynman', requireAuth, async (req, res) => {
  const { topic, explanation } = req.body;
  if (!explanation || !explanation.trim()) {
    return res.status(400).json({ error: 'explanation is required' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured' });
  }
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: FEYNMAN_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `The concept I'm explaining: ${topic ? topic.trim() : '(not specified)'}\n\nMy explanation: ${explanation.trim()}`
        }
      ]
    });
    res.json({ ok: true, feedback: message.content[0].text });
  } catch (err) {
    console.error('Anthropic API error:', err.message);
    res.status(500).json({ error: 'failed to get feedback — please try again' });
  }
});

app.post('/api/house-checkins', requireAuth, (req, res) => {
  const { name, house, didThisWeek, stuckOn, commitment, needsEncouragement } = req.body;
  if (!name || !house || !HOUSES[house]) {
    return res.status(400).json({ error: 'name and a valid house are required' });
  }
  const entry = {
    name: name.trim(),
    house,
    didThisWeek: didThisWeek?.trim() || '',
    stuckOn: stuckOn?.trim() || '',
    commitment: commitment?.trim() || '',
    needsEncouragement: !!needsEncouragement,
    timestamp: new Date().toISOString()
  };
  houseCheckins.push(entry);
  res.status(201).json({ ok: true, entry });
});

app.get('/api/house-checkins/:houseName', requireAuth, (req, res) => {
  if (!HOUSES[req.params.houseName]) {
    return res.status(400).json({ error: 'unknown house' });
  }
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const results = houseCheckins
    .filter(c => c.house === req.params.houseName && new Date(c.timestamp) >= cutoff)
    .slice()
    .reverse();
  res.json({ ok: true, checkins: results });
});

app.get('/api/rotations', requireAuth, (_req, res) => {
  res.json({ ok: true, rotations });
});

app.post('/api/rotations', requireAuth, (req, res) => {
  const { facilitatorPassword, action, name, type, indexA, indexB } = req.body;
  if (!facilitatorPassword || facilitatorPassword !== process.env.FACILITATOR_PASSWORD) {
    return res.status(403).json({ error: "that's not the facilitator password — ask your cohort lead if you need it." });
  }
  const VALID_TYPES = ['concept-discussion', 'demo-or-die'];

  if (action === 'validate') {
    return res.json({ ok: true });
  }

  if (action === 'add') {
    if (!name?.trim() || !VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: 'name and valid type are required' });
    }
    rotations.push({ name: name.trim(), type, date: null, completed: false });
    saveRotations(rotations);
    return res.json({ ok: true, rotations });
  }

  if (action === 'remove') {
    const idx = rotations.findIndex(r => r.name === name && r.type === type);
    if (idx === -1) return res.status(404).json({ error: 'entry not found' });
    rotations.splice(idx, 1);
    saveRotations(rotations);
    return res.json({ ok: true, rotations });
  }

  if (action === 'complete') {
    const entry = rotations.find(r => r.name === name && r.type === type);
    if (!entry) return res.status(404).json({ error: 'entry not found' });
    entry.completed = true;
    entry.date = new Date().toISOString();
    saveRotations(rotations);
    return res.json({ ok: true, rotations });
  }

  if (action === 'swap') {
    const iA = parseInt(indexA, 10);
    const iB = parseInt(indexB, 10);
    const typeIndices = [];
    for (let i = 0; i < rotations.length; i++) {
      if (rotations[i].type === type) typeIndices.push(i);
    }
    if (isNaN(iA) || isNaN(iB) || iA < 0 || iA >= typeIndices.length ||
        iB < 0 || iB >= typeIndices.length || iA === iB) {
      return res.status(400).json({ error: 'invalid swap indices' });
    }
    [rotations[typeIndices[iA]], rotations[typeIndices[iB]]] =
    [rotations[typeIndices[iB]], rotations[typeIndices[iA]]];
    saveRotations(rotations);
    return res.json({ ok: true, rotations });
  }

  return res.status(400).json({ error: 'unknown action' });
});

app.get('/api/demos', requireAuth, (req, res) => {
  const { house, type } = req.query;
  let results = [...demos];
  if (house) results = results.filter(d => d.house === house);
  if (type)  results = results.filter(d => d.demoType === type);
  res.json({ ok: true, demos: results });
});

app.post('/api/demos', requireAuth, (req, res) => {
  const { name, house, demoType, description, link } = req.body;
  if (!name?.trim() || !description?.trim()) {
    return res.status(400).json({ error: 'name and description are required' });
  }
  if (house && !['lovelace', 'turing', 'hopper'].includes(house)) {
    return res.status(400).json({ error: 'invalid house' });
  }
  const VALID_TYPES = ['prototype', 'experiment', 'failed attempt', 'work in progress', 'concept demo', 'tool exploration', 'mini project'];
  if (demoType && !VALID_TYPES.includes(demoType)) {
    return res.status(400).json({ error: 'invalid demo type' });
  }
  if (link?.trim() && !/^https?:\/\//.test(link.trim())) {
    return res.status(400).json({ error: 'link must start with http:// or https://' });
  }
  const entry = {
    name: name.trim(),
    house: house || '',
    demoType: demoType || '',
    description: description.trim(),
    link: link?.trim() || '',
    timestamp: new Date().toISOString()
  };
  demos.unshift(entry);
  saveDemos(demos);
  res.status(201).json({ ok: true, entry });
});

app.get('/api/map', requireAuth, (_req, res) => {
  res.json({ ok: true, entries: mapEntries });
});

app.post('/api/map', requireAuth, (req, res) => {
  const { name, house, stage, track } = req.body;
  if (!name?.trim() || !stage) {
    return res.status(400).json({ error: 'name and stage are required' });
  }
  const VALID_STAGES = ['stage1', 'stage2', 'stage3', 'stage4', 'stage5'];
  if (!VALID_STAGES.includes(stage)) {
    return res.status(400).json({ error: 'invalid stage' });
  }
  if (house && !['lovelace', 'turing', 'hopper'].includes(house)) {
    return res.status(400).json({ error: 'invalid house' });
  }
  const ALL_TRACKS = [
    'Track A — AI-Accelerated', 'Track B — Deep Foundations',
    'Policy Intelligence', 'Research & Synthesis', 'Service Design',
    'Capstone 1 — Map a Real AI System', 'Capstone 2 — Grant Brief',
    'Capstone 3 — Procurement Critique', 'Capstone 4 — Build a RAG/Agent',
    'Capstone 5 — Natural Intelligence Design', 'Capstone 6 — Equitable AI Product',
  ];
  if (track && !ALL_TRACKS.includes(track)) {
    return res.status(400).json({ error: 'invalid track' });
  }
  const entry = {
    name: name.trim(),
    house: house || '',
    stage,
    track: track || '',
    updatedAt: new Date().toISOString()
  };
  const idx = mapEntries.findIndex(
    e => e.name.toLowerCase() === entry.name.toLowerCase()
  );
  let updated = false;
  if (idx !== -1) {
    mapEntries[idx] = entry;
    updated = true;
  } else {
    mapEntries.push(entry);
  }
  saveMap(mapEntries);
  res.json({ ok: true, entry, updated });
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

app.listen(PORT, () => {
  console.log(`claude's army running on http://localhost:${PORT}`);
});
