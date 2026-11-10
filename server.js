#!/usr/bin/env node
// Pack Pal server. No dependencies: just run `node server.js`.
//
// Settings (environment variables):
//   PORT           port to listen on (default 3000)
//   HOST           address to bind (default 0.0.0.0, so phones on your Wi-Fi can connect)
//   PACK_PASSWORD  if set, everyone must enter this password once per device
//   PACK_DATA_DIR  where the data file lives (default ./data)

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const seed = require('./seed');
const NEED_IDS = require('./public/engine.js').NEEDS.map((n) => n.id);

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PASSWORD = process.env.PACK_PASSWORD || '';
const DATA_DIR = path.resolve(process.env.PACK_DATA_DIR || path.join(__dirname, 'data'));
const DATA_FILE = path.join(DATA_DIR, 'packing-data.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- storage ----------

function freshDb() {
  return {
    version: 1,
    seedVersion: SEED_VERSION,
    rev: 1,
    secret: crypto.randomBytes(24).toString('hex'),
    members: [],
    types: [clone(seed.core), ...seed.types.map(clone)],
    trips: [],
  };
}
const clone = (o) => JSON.parse(JSON.stringify(o));

function load() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    const db = freshDb();
    writeFile(db);
    console.log('  Created a new data file with 13 trip types.');
    return db;
  }
  const db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  db.secret = db.secret || crypto.randomBytes(24).toString('hex');
  if (migrate(db)) writeFile(db);
  return db;
}

// Bring an existing data file up to date with new built-in questions,
// without touching anything the family added or edited themselves.
const SEED_VERSION = 3;
function migrate(db) {
  const from = db.seedVersion || 1;
  if (from >= SEED_VERSION) return false;
  if (from < 2) {
    // v2: "easy-to-forget" questions are asked on every trip, so a few trip types
    // lost their own copies of those questions.
    const ess = db.types.find((t) => t.essentials);
    if (ess) {
      const qIds = new Set(ess.questions.map((q) => q.id));
      seed.core.questions.forEach((q) => { if (!qIds.has(q.id)) ess.questions.push(clone(q)); });
      const iIds = new Set(ess.items.map((i) => i.id));
      seed.core.items.forEach((i) => { if (!iIds.has(i.id)) ess.items.push(clone(i)); });
    }
    const coreQ = new Set(seed.core.questions.map((q) => q.id));
    const moved = { beach: ['dinners'], ski: ['hottub'], business: ['events', 'workout'], city: ['dinners'], roadtrip: ['pet'], cruise: ['pool'] };
    for (const [typeId, qids] of Object.entries(moved)) {
      const t = db.types.find((x) => x.id === typeId);
      if (!t) continue;
      t.questions = t.questions.filter((q) => !qids.includes(q.id));
      const gone = qids.filter((q) => !coreQ.has(q));
      t.items = t.items.filter((i) => !Object.keys(i.when || {}).some((q) => gone.includes(q)));
    }
    const intl = db.types.find((x) => x.id === 'international');
    if (intl) intl.defaults = Object.assign({ flying: 'yes' }, intl.defaults);
    console.log('  Updated your trip types with the new easy-to-forget questions.');
  }
  if (from < 3) {
    // v3: glasses, medication and pets come from family profiles instead of trip questions,
    // and laundry is asked next to the trip dates.
    const usesOld = (i) => Object.keys(i.when || {}).some((q) => ['eyes', 'pet', 'dog'].includes(q));
    const ess = db.types.find((t) => t.essentials);
    if (ess) {
      ess.questions = ess.questions.filter((q) => !['eyes', 'pet'].includes(q.id));
      const laundry = ess.questions.find((q) => q.id === 'laundry');
      const seedLaundry = seed.core.questions.find((q) => q.id === 'laundry');
      if (laundry && laundry.text === 'Will you be able to do laundry?') Object.assign(laundry, clone(seedLaundry));
      ess.items = ess.items.filter((i) => !usesOld(i) && i.id !== 'prescription-medications');
      const iIds = new Set(ess.items.map((i) => i.id));
      seed.core.items.forEach((i) => { if (!iIds.has(i.id)) ess.items.push(clone(i)); });
    }
    for (const t of db.types) {
      if (t.essentials || !seed.types.some((s) => s.id === t.id)) continue;
      t.questions = t.questions.filter((q) => !(t.id === 'paddleboard' && q.id === 'dog'));
      t.items = t.items.filter((i) => !usesOld(i));
      const s = seed.types.find((x) => x.id === t.id);
      const iIds = new Set(t.items.map((i) => i.id));
      s.items.filter((i) => i.who && i.who.includes('pet')).forEach((i) => { if (!iIds.has(i.id)) t.items.push(clone(i)); });
    }
    console.log('  Updated your trip types to use family profiles (medication, glasses, pets).');
  }
  db.seedVersion = SEED_VERSION;
  return true;
}

function writeFile(db) {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
  fs.renameSync(tmp, DATA_FILE);
}

let db = load();
let saveTimer = null;
function save() {
  db.rev++;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    writeFile(db);
    dailyBackup();
  }, 150);
  broadcast({ rev: db.rev });
}

function dailyBackup() {
  const name = 'packing-data-' + new Date().toISOString().slice(0, 10) + '.json';
  const file = path.join(BACKUP_DIR, name);
  if (fs.existsSync(file)) return;
  fs.copyFileSync(DATA_FILE, file);
  const old = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.json')).sort().slice(0, -14);
  old.forEach((f) => fs.unlinkSync(path.join(BACKUP_DIR, f)));
}

// ---------- live updates (Server-Sent Events) ----------

const listeners = new Set();
function broadcast(msg) {
  const line = 'data: ' + JSON.stringify(msg) + '\n\n';
  for (const res of listeners) res.write(line);
}
setInterval(() => { for (const res of listeners) res.write(': ping\n\n'); }, 25000);

// ---------- auth ----------

function token() {
  return crypto.createHmac('sha256', db.secret).update('pack:' + PASSWORD).digest('hex');
}
function authed(req) {
  if (!PASSWORD) return true;
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')));
  const given = cookies.packpal || '';
  const want = token();
  return given.length === want.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(want));
}

// ---------- helpers ----------

const id = () => crypto.randomBytes(6).toString('base64url');

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers));
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 2_000_000) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const find = (list, key, what) => {
  const x = list.find((i) => i.id === key);
  if (!x) throw new HttpError(404, what + ' not found');
  return x;
};
const str = (v, max = 200) => String(v ?? '').slice(0, max);

function cleanType(t) {
  if (!t || !str(t.name).trim()) throw new HttpError(400, 'A trip type needs a name');
  return {
    id: t.id,
    name: str(t.name, 60).trim(),
    icon: str(t.icon || '🧳', 16),
    color: /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : '#64748b',
    description: str(t.description, 200),
    essentials: !!t.essentials,
    defaults: t.defaults && typeof t.defaults === 'object' ? t.defaults : {},
    questions: Array.isArray(t.questions) ? t.questions.slice(0, 30) : [],
    items: Array.isArray(t.items) ? t.items.slice(0, 500) : [],
    updatedAt: new Date().toISOString(),
  };
}

function cleanItem(i) {
  return {
    id: str(i.id || id(), 120),
    name: str(i.name, 120).trim() || 'Item',
    category: str(i.category || 'misc', 30),
    qty: Math.max(1, Math.min(999, Number(i.qty) || 1)),
    owner: i.owner ? str(i.owner, 40) : null,
    note: str(i.note, 300),
    rule: i.rule ? str(i.rule, 120) : null,
    from: i.from ? str(i.from, 60) : null,
    checked: !!i.checked,
    checkedBy: i.checkedBy ? str(i.checkedBy, 40) : null,
    skipped: !!i.skipped,
    custom: !!i.custom,
  };
}

// ---------- API ----------

async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // drop "api"
  const m = req.method;

  if (parts[0] === 'login' && m === 'POST') {
    const body = await readBody(req);
    if (!PASSWORD || body.password === PASSWORD) {
      return send(res, 200, { ok: true }, { 'Set-Cookie': `packpal=${token()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000` });
    }
    await new Promise((r) => setTimeout(r, 800)); // slow down guessing
    return send(res, 401, { error: 'Wrong password' });
  }
  if (!authed(req)) return send(res, 401, { error: 'login', passwordRequired: true });

  if (parts[0] === 'events' && m === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('data: ' + JSON.stringify({ rev: db.rev }) + '\n\n');
    listeners.add(res);
    req.on('close', () => listeners.delete(res));
    return;
  }

  if (parts[0] === 'state' && m === 'GET') {
    const { secret, ...pub } = db;
    return send(res, 200, Object.assign(pub, { passwordEnabled: !!PASSWORD }));
  }

  if (parts[0] === 'export' && m === 'GET') {
    const { secret, ...pub } = db;
    return send(res, 200, JSON.stringify(pub, null, 2), {
      'Content-Disposition': `attachment; filename="pack-pal-backup-${new Date().toISOString().slice(0, 10)}.json"`,
    });
  }

  // Family members
  if (parts[0] === 'members' && m === 'PUT') {
    const body = await readBody(req);
    if (!Array.isArray(body.members)) throw new HttpError(400, 'members must be a list');
    db.members = body.members.slice(0, 30).map((p) => ({
      id: str(p.id || id(), 40),
      name: str(p.name, 40).trim() || 'Someone',
      kind: ['adult', 'kid', 'baby', 'pet'].includes(p.kind) ? p.kind : 'adult',
      species: p.kind === 'pet' && ['dog', 'cat', 'other'].includes(p.species) ? p.species : undefined,
      emoji: str(p.emoji || '🙂', 16),
      color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#0ea5e9',
      needs: Array.isArray(p.needs) ? p.needs.filter((n) => NEED_IDS.includes(n)) : [],
      always: Array.isArray(p.always) ? p.always.map((a) => str(a, 80).trim()).filter(Boolean).slice(0, 40) : [],
    }));
    save();
    return send(res, 200, { members: db.members });
  }

  // Trip types
  if (parts[0] === 'types') {
    if (parts.length === 1 && m === 'POST') {
      const t = cleanType(await readBody(req));
      t.id = id();
      t.essentials = false;
      db.types.push(t);
      save();
      return send(res, 201, t);
    }
    if (parts[1] === 'restore' && m === 'POST') {
      const { id: typeId } = await readBody(req);
      const orig = [seed.core, ...seed.types].find((t) => t.id === typeId);
      if (!orig) throw new HttpError(404, 'That trip type has no defaults to restore');
      const idx = db.types.findIndex((t) => t.id === typeId);
      if (idx === -1) db.types.push(clone(orig)); else db.types[idx] = clone(orig);
      save();
      return send(res, 200, clone(orig));
    }
    const t = find(db.types, parts[1], 'Trip type');
    if (m === 'PUT') {
      const next = cleanType(Object.assign({}, await readBody(req), { id: t.id }));
      next.essentials = t.essentials;
      Object.assign(t, next);
      save();
      return send(res, 200, t);
    }
    if (m === 'DELETE') {
      if (t.essentials) throw new HttpError(400, 'Everyday essentials can be edited but not deleted');
      db.types = db.types.filter((x) => x !== t);
      save();
      return send(res, 200, { ok: true });
    }
  }

  // Trips
  if (parts[0] === 'trips') {
    if (parts.length === 1 && m === 'POST') {
      const b = await readBody(req);
      const trip = {
        id: id(),
        name: str(b.name, 80).trim() || 'My trip',
        typeId: str(b.typeId, 40),
        start: str(b.start, 10),
        end: str(b.end, 10),
        nights: Math.max(0, Math.min(365, Number(b.nights) || 0)),
        travelers: Array.isArray(b.travelers) ? b.travelers.map((x) => str(x, 40)) : [],
        answers: b.answers && typeof b.answers === 'object' ? b.answers : {},
        includeEssentials: b.includeEssentials !== false,
        items: Array.isArray(b.items) ? b.items.map(cleanItem) : [],
        createdAt: new Date().toISOString(),
        archived: false,
        reviewed: false,
      };
      db.trips.unshift(trip);
      save();
      return send(res, 201, trip);
    }
    const trip = find(db.trips, parts[1], 'Trip');
    if (parts[2] === 'ops' && m === 'POST') {
      // Small operations so two people ticking items at once don't overwrite each other.
      const { ops } = await readBody(req);
      for (const op of Array.isArray(ops) ? ops : []) {
        const item = op.itemId ? trip.items.find((i) => i.id === op.itemId) : null;
        if (op.op === 'check' && item) { item.checked = !!op.checked; item.checkedBy = op.checked ? str(op.by, 40) || null : null; }
        else if (op.op === 'skip' && item) { item.skipped = !!op.skipped; }
        else if (op.op === 'update' && item) { Object.assign(item, cleanItem(Object.assign({}, item, op.fields, { id: item.id }))); }
        else if (op.op === 'remove') { trip.items = trip.items.filter((i) => i.id !== op.itemId); }
        else if (op.op === 'add' && op.item) {
          const it = cleanItem(Object.assign({ custom: true }, op.item));
          if (trip.items.some((i) => i.id === it.id)) it.id += '-' + id();
          trip.items.push(it);
        }
        else if (op.op === 'uncheckAll') { trip.items.forEach((i) => { i.checked = false; i.checkedBy = null; }); }
      }
      save();
      return send(res, 200, trip);
    }
    if (m === 'PUT') {
      const b = await readBody(req);
      for (const k of ['name', 'start', 'end']) if (b[k] !== undefined) trip[k] = str(b[k], 80);
      if (b.nights !== undefined) trip.nights = Math.max(0, Math.min(365, Number(b.nights) || 0));
      if (Array.isArray(b.travelers)) trip.travelers = b.travelers.map((x) => str(x, 40));
      if (b.answers && typeof b.answers === 'object') trip.answers = b.answers;
      if (b.archived !== undefined) trip.archived = !!b.archived;
      if (b.reviewed !== undefined) trip.reviewed = !!b.reviewed;
      if (Array.isArray(b.items)) trip.items = b.items.map(cleanItem);
      save();
      return send(res, 200, trip);
    }
    if (m === 'DELETE') {
      db.trips = db.trips.filter((x) => x !== trip);
      save();
      return send(res, 200, { ok: true });
    }
  }

  throw new HttpError(404, 'Not found');
}

// ---------- static files ----------

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain' });
  fs.readFile(file, (err, data) => {
    if (err) {
      // Unknown paths fall back to the app so links keep working.
      return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) =>
        e2 ? send(res, 404, 'Not found', { 'Content-Type': 'text/plain' }) : send(res, 200, html, { 'Content-Type': MIME['.html'] }));
    }
    send(res, 200, data, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  });
}

// ---------- server ----------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
    serveStatic(req, res, url);
  } catch (e) {
    const status = e.status || 400;
    if (!e.status) console.error(e);
    send(res, status, { error: e.message || 'Something went wrong' });
  }
});

function flushAndExit() {
  clearTimeout(saveTimer);
  try { writeFile(db); } catch (e) { console.error(e); }
  process.exit(0);
}
process.on('SIGINT', flushAndExit);
process.on('SIGTERM', flushAndExit);

server.listen(PORT, HOST, () => {
  const lan = Object.values(os.networkInterfaces()).flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n.address);
  console.log('\n  🧳 Pack Pal is running!\n');
  console.log(`     On this computer:  http://localhost:${PORT}`);
  lan.forEach((ip) => console.log(`     On your Wi-Fi:     http://${ip}:${PORT}`));
  console.log(`\n     Data file: ${DATA_FILE}`);
  console.log(PASSWORD ? '     Password: ON' : '     Password: off (set PACK_PASSWORD to turn it on before exposing this to the internet)');
  console.log('\n  Press Ctrl+C to stop.\n');
  if (process.env.PACK_OPEN_BROWSER) {
    const url = `http://localhost:${PORT}`;
    const cmd = process.platform === 'win32' ? `start "" ${url}` : process.platform === 'darwin' ? `open ${url}` : `xdg-open ${url}`;
    require('child_process').exec(cmd, () => {});
  }
});

module.exports = server;
