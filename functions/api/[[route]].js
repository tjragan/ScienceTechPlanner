// functions/api/[[route]].js
// Science Tech Planner – Cloudflare Pages Functions API
// All routes live under /api/…

// ─────────────────────────────────────────────────────────
// Crypto utilities (Web Crypto API – no external deps)
// ─────────────────────────────────────────────────────────

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

async function signJWT(payload, secret) {
  const enc = s => new TextEncoder().encode(s);
  const header  = b64url(enc(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body    = b64url(enc(JSON.stringify(payload)));
  const message = `${header}.${body}`;
  const key = await crypto.subtle.importKey(
    'raw', enc(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc(message));
  return `${message}.${b64url(sig)}`;
}

async function verifyJWT(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [h, p, s] = parts;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify(
      'HMAC', key, b64urlDecode(s), enc.encode(`${h}.${p}`));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function hashPassword(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key  = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  const toHex = a => Array.from(a).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${toHex(salt)}:${toHex(new Uint8Array(bits))}`;
}

async function verifyPassword(pw, stored) {
  const [saltHex, hashHex] = stored.split(':');
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map(b => parseInt(b, 16)));
  const key  = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  const toHex = a => Array.from(a).map(b => b.toString(16).padStart(2, '0')).join('');
  return toHex(new Uint8Array(bits)) === hashHex;
}

// ─────────────────────────────────────────────────────────
// Response helpers
// ─────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

const ok  = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const err = (msg, status = 400) =>
  new Response(JSON.stringify({ error: msg }), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function requireAuth(req, env) {
  const auth  = req.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const secret = env.JWT_SECRET || 'dev-secret-change-in-production';
  return verifyJWT(token, secret);
}

// ─────────────────────────────────────────────────────────
// Database initialisation (idempotent – safe to call on every cold start)
// ─────────────────────────────────────────────────────────

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY CHECK(id=1),
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS teachers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  email      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS rooms (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS room_equipment (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id  INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name     TEXT    NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS schedule_slots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id    INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  room_id       INTEGER NOT NULL REFERENCES rooms(id)    ON DELETE CASCADE,
  day           TEXT    NOT NULL,
  period        INTEGER NOT NULL,
  class_name    TEXT    NOT NULL,
  student_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(teacher_id, day, period),
  UNIQUE(room_id,    day, period)
);
CREATE TABLE IF NOT EXISTS experiments (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  equipment   TEXT NOT NULL DEFAULT '[]',
  reagents    TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS experiment_variances (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  experiment_id TEXT    NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  teacher_id    INTEGER NOT NULL REFERENCES teachers(id)    ON DELETE CASCADE,
  equipment     TEXT,
  reagents      TEXT,
  notes         TEXT,
  UNIQUE(experiment_id, teacher_id)
);
CREATE TABLE IF NOT EXISTS experiment_notes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  experiment_id TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  note          TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS practical_requests (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  experiment_id    TEXT    NOT NULL REFERENCES experiments(id),
  schedule_slot_id INTEGER NOT NULL REFERENCES schedule_slots(id),
  date             TEXT    NOT NULL,
  notes            TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS experiment_overrides (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  practical_request_id INTEGER NOT NULL REFERENCES practical_requests(id) ON DELETE CASCADE,
  equipment            TEXT,
  reagents             TEXT,
  notes                TEXT,
  UNIQUE(practical_request_id)
);`;

async function initDB(db) {
  // Split the schema into individual statements and run as a batch.
  // Using batch() rather than exec() avoids Miniflare's line-based SQL splitting.
  const stmts = SCHEMA
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .map(s => db.prepare(s));
  await db.batch(stmts);
}

// ─────────────────────────────────────────────────────────
// Auth handlers
// ─────────────────────────────────────────────────────────

async function handleAuthStatus(db) {
  const row = await db.prepare('SELECT id FROM users WHERE id=1').first();
  return ok({ setup: !!row });
}

async function handleSetup(req, env) {
  const db = env.DB;
  const existing = await db.prepare('SELECT id FROM users WHERE id=1').first();
  if (existing) return err('Already configured', 409);
  const body = await req.json();
  const { password } = body;
  if (!password || password.length < 6) return err('Password must be at least 6 characters');
  const hash  = await hashPassword(password);
  await db.prepare('INSERT INTO users (id, password_hash) VALUES (1,?)').bind(hash).run();
  const secret = env.JWT_SECRET || 'dev-secret-change-in-production';
  const token  = await signJWT(
    { sub: '1', exp: Math.floor(Date.now() / 1000) + 86400 * 30 }, secret);
  return ok({ token });
}

async function handleLogin(req, env) {
  const db  = env.DB;
  const { password } = await req.json();
  const row = await db.prepare('SELECT password_hash FROM users WHERE id=1').first();
  if (!row) return err('Not configured – please set up a password first', 404);
  const valid = await verifyPassword(password, row.password_hash);
  if (!valid) return err('Invalid password', 401);
  const secret = env.JWT_SECRET || 'dev-secret-change-in-production';
  const token  = await signJWT(
    { sub: '1', exp: Math.floor(Date.now() / 1000) + 86400 * 30 }, secret);
  return ok({ token });
}

// ─────────────────────────────────────────────────────────
// Teachers
// ─────────────────────────────────────────────────────────

async function getTeachers(db) {
  const { results } = await db.prepare('SELECT * FROM teachers ORDER BY name').all();
  return ok(results);
}

async function createTeacher(req, db) {
  const { name, email } = await req.json();
  if (!name?.trim()) return err('name is required');
  const row = await db.prepare(
    'INSERT INTO teachers (name,email) VALUES (?,?) RETURNING *')
    .bind(name.trim(), email || null).first();
  return ok(row, 201);
}

async function updateTeacher(req, db, id) {
  const { name, email } = await req.json();
  if (!name?.trim()) return err('name is required');
  const row = await db.prepare(
    'UPDATE teachers SET name=?,email=? WHERE id=? RETURNING *')
    .bind(name.trim(), email || null, id).first();
  if (!row) return err('Not found', 404);
  return ok(row);
}

async function deleteTeacher(db, id) {
  await db.prepare('DELETE FROM teachers WHERE id=?').bind(id).run();
  return ok({ deleted: true });
}

// ─────────────────────────────────────────────────────────
// Rooms
// ─────────────────────────────────────────────────────────

async function getRooms(db) {
  const { results } = await db.prepare('SELECT * FROM rooms ORDER BY name').all();
  return ok(results);
}

async function createRoom(req, db) {
  const { name, description } = await req.json();
  if (!name?.trim()) return err('name is required');
  const row = await db.prepare(
    'INSERT INTO rooms (name,description) VALUES (?,?) RETURNING *')
    .bind(name.trim(), description || null).first();
  return ok(row, 201);
}

async function updateRoom(req, db, id) {
  const { name, description } = await req.json();
  if (!name?.trim()) return err('name is required');
  const row = await db.prepare(
    'UPDATE rooms SET name=?,description=? WHERE id=? RETURNING *')
    .bind(name.trim(), description || null, id).first();
  if (!row) return err('Not found', 404);
  return ok(row);
}

async function deleteRoom(db, id) {
  await db.prepare('DELETE FROM rooms WHERE id=?').bind(id).run();
  return ok({ deleted: true });
}

async function getRoomEquipment(db, roomId) {
  const { results } = await db.prepare(
    'SELECT * FROM room_equipment WHERE room_id=? ORDER BY name').bind(roomId).all();
  return ok(results);
}

async function addRoomEquipment(req, db, roomId) {
  const { name, quantity } = await req.json();
  if (!name?.trim()) return err('name is required');
  const row = await db.prepare(
    'INSERT INTO room_equipment (room_id,name,quantity) VALUES (?,?,?) RETURNING *')
    .bind(roomId, name.trim(), quantity || 1).first();
  return ok(row, 201);
}

async function updateRoomEquipment(req, db, roomId, eqId) {
  const { name, quantity } = await req.json();
  if (!name?.trim()) return err('name is required');
  const row = await db.prepare(
    'UPDATE room_equipment SET name=?,quantity=? WHERE id=? AND room_id=? RETURNING *')
    .bind(name.trim(), quantity || 1, eqId, roomId).first();
  if (!row) return err('Not found', 404);
  return ok(row);
}

async function deleteRoomEquipment(db, roomId, eqId) {
  await db.prepare('DELETE FROM room_equipment WHERE id=? AND room_id=?').bind(eqId, roomId).run();
  return ok({ deleted: true });
}

// ─────────────────────────────────────────────────────────
// Schedule slots
// ─────────────────────────────────────────────────────────

async function getSchedule(db) {
  const { results } = await db.prepare(`
    SELECT ss.*, t.name AS teacher_name, r.name AS room_name
    FROM   schedule_slots ss
    JOIN   teachers t ON t.id = ss.teacher_id
    JOIN   rooms    r ON r.id = ss.room_id
    ORDER  BY ss.day, ss.period, t.name`).all();
  return ok(results);
}

async function createScheduleSlot(req, db) {
  const { teacher_id, room_id, day, period, class_name, student_count } = await req.json();
  if (!teacher_id || !room_id || !day || !period || !class_name?.trim())
    return err('teacher_id, room_id, day, period and class_name are required');
  try {
    const row = await db.prepare(`
      INSERT INTO schedule_slots (teacher_id,room_id,day,period,class_name,student_count)
      VALUES (?,?,?,?,?,?) RETURNING *`)
      .bind(teacher_id, room_id, day, Number(period), class_name.trim(), student_count || 0).first();
    return ok(row, 201);
  } catch (e) {
    if (e.message?.includes('UNIQUE'))
      return err('Schedule conflict – teacher or room already assigned for that day/period');
    throw e;
  }
}

async function updateScheduleSlot(req, db, id) {
  const { teacher_id, room_id, day, period, class_name, student_count } = await req.json();
  if (!teacher_id || !room_id || !day || !period || !class_name?.trim())
    return err('teacher_id, room_id, day, period and class_name are required');
  try {
    const row = await db.prepare(`
      UPDATE schedule_slots
      SET teacher_id=?,room_id=?,day=?,period=?,class_name=?,student_count=?
      WHERE id=? RETURNING *`)
      .bind(teacher_id, room_id, day, Number(period), class_name.trim(), student_count || 0, id).first();
    if (!row) return err('Not found', 404);
    return ok(row);
  } catch (e) {
    if (e.message?.includes('UNIQUE'))
      return err('Schedule conflict – teacher or room already assigned for that day/period');
    throw e;
  }
}

async function deleteScheduleSlot(db, id) {
  await db.prepare('DELETE FROM schedule_slots WHERE id=?').bind(id).run();
  return ok({ deleted: true });
}

// ─────────────────────────────────────────────────────────
// Experiments
// ─────────────────────────────────────────────────────────

function parseExp(e) {
  return {
    ...e,
    equipment: typeof e.equipment === 'string' ? JSON.parse(e.equipment) : (e.equipment ?? []),
    reagents:  typeof e.reagents  === 'string' ? JSON.parse(e.reagents)  : (e.reagents  ?? []),
  };
}

async function getExperiments(db) {
  const { results } = await db.prepare('SELECT * FROM experiments ORDER BY id').all();
  return ok(results.map(parseExp));
}

async function getExperiment(db, id) {
  const row = await db.prepare('SELECT * FROM experiments WHERE id=?').bind(id).first();
  if (!row) return err('Not found', 404);
  return ok(parseExp(row));
}

async function createExperiment(req, db) {
  const { id, name, description, equipment, reagents } = await req.json();
  if (!id?.trim() || !name?.trim()) return err('id and name are required');
  const exists = await db.prepare('SELECT id FROM experiments WHERE id=?').bind(id.trim()).first();
  if (exists) return err(`Experiment '${id.trim()}' already exists`, 409);
  const row = await db.prepare(`
    INSERT INTO experiments (id,name,description,equipment,reagents) VALUES (?,?,?,?,?) RETURNING *`)
    .bind(id.trim(), name.trim(), description || null,
          JSON.stringify(equipment || []), JSON.stringify(reagents || [])).first();
  return ok(parseExp(row), 201);
}

async function updateExperiment(req, db, id) {
  const { name, description, equipment, reagents } = await req.json();
  if (!name?.trim()) return err('name is required');
  const row = await db.prepare(`
    UPDATE experiments SET name=?,description=?,equipment=?,reagents=? WHERE id=? RETURNING *`)
    .bind(name.trim(), description || null,
          JSON.stringify(equipment || []), JSON.stringify(reagents || []), id).first();
  if (!row) return err('Not found', 404);
  return ok(parseExp(row));
}

async function deleteExperiment(db, id) {
  await db.prepare('DELETE FROM experiments WHERE id=?').bind(id).run();
  return ok({ deleted: true });
}

// ─────────────────────────────────────────────────────────
// Experiment variances
// ─────────────────────────────────────────────────────────

function parseVariance(v) {
  return {
    ...v,
    equipment: v.equipment ? JSON.parse(v.equipment) : null,
    reagents:  v.reagents  ? JSON.parse(v.reagents)  : null,
  };
}

async function getVariances(db, experimentId) {
  const { results } = await db.prepare(`
    SELECT ev.*, t.name AS teacher_name
    FROM   experiment_variances ev
    JOIN   teachers t ON t.id = ev.teacher_id
    WHERE  ev.experiment_id=?`).bind(experimentId).all();
  return ok(results.map(parseVariance));
}

async function createVariance(req, db, experimentId) {
  const { teacher_id, equipment, reagents, notes } = await req.json();
  if (!teacher_id) return err('teacher_id is required');
  try {
    const row = await db.prepare(`
      INSERT INTO experiment_variances (experiment_id,teacher_id,equipment,reagents,notes)
      VALUES (?,?,?,?,?) RETURNING *`)
      .bind(experimentId, teacher_id,
            equipment ? JSON.stringify(equipment) : null,
            reagents  ? JSON.stringify(reagents)  : null,
            notes || null).first();
    return ok(parseVariance(row), 201);
  } catch (e) {
    if (e.message?.includes('UNIQUE')) return err('A variance for this teacher already exists', 409);
    throw e;
  }
}

async function updateVariance(req, db, experimentId, varId) {
  const { teacher_id, equipment, reagents, notes } = await req.json();
  const row = await db.prepare(`
    UPDATE experiment_variances
    SET teacher_id=?,equipment=?,reagents=?,notes=?
    WHERE id=? AND experiment_id=? RETURNING *`)
    .bind(teacher_id || null,
          equipment ? JSON.stringify(equipment) : null,
          reagents  ? JSON.stringify(reagents)  : null,
          notes || null, varId, experimentId).first();
  if (!row) return err('Not found', 404);
  return ok(parseVariance(row));
}

async function deleteVariance(db, experimentId, varId) {
  await db.prepare(
    'DELETE FROM experiment_variances WHERE id=? AND experiment_id=?').bind(varId, experimentId).run();
  return ok({ deleted: true });
}

// ─────────────────────────────────────────────────────────
// Experiment notes
// ─────────────────────────────────────────────────────────

async function getNotes(db, experimentId) {
  const { results } = await db.prepare(
    'SELECT * FROM experiment_notes WHERE experiment_id=? ORDER BY created_at DESC')
    .bind(experimentId).all();
  return ok(results);
}

async function createNote(req, db, experimentId) {
  const { note } = await req.json();
  if (!note?.trim()) return err('note is required');
  const row = await db.prepare(
    'INSERT INTO experiment_notes (experiment_id,note) VALUES (?,?) RETURNING *')
    .bind(experimentId, note.trim()).first();
  return ok(row, 201);
}

async function deleteNote(db, experimentId, noteId) {
  await db.prepare(
    'DELETE FROM experiment_notes WHERE id=? AND experiment_id=?').bind(noteId, experimentId).run();
  return ok({ deleted: true });
}

// ─────────────────────────────────────────────────────────
// Practical requests
// ─────────────────────────────────────────────────────────

async function getRequests(db, params) {
  const date = params.get('date');
  const base = `
    SELECT pr.*,
           e.name  AS experiment_name,
           ss.day, ss.period, ss.class_name, ss.student_count,
           t.name  AS teacher_name,
           r.id    AS room_id, r.name AS room_name,
           eo.equipment AS override_equipment,
           eo.reagents  AS override_reagents,
           eo.notes     AS override_notes
    FROM practical_requests pr
    JOIN experiments    e  ON e.id  = pr.experiment_id
    JOIN schedule_slots ss ON ss.id = pr.schedule_slot_id
    JOIN teachers       t  ON t.id  = ss.teacher_id
    JOIN rooms          r  ON r.id  = ss.room_id
    LEFT JOIN experiment_overrides eo ON eo.practical_request_id = pr.id`;
  const { results } = date
    ? await db.prepare(base + ' WHERE pr.date=? ORDER BY ss.period').bind(date).all()
    : await db.prepare(base + ' ORDER BY pr.date DESC, ss.period').all();
  return ok(results);
}

async function createRequest(req, db) {
  const { experiment_id, schedule_slot_id, date, notes } = await req.json();
  if (!experiment_id || !schedule_slot_id || !date)
    return err('experiment_id, schedule_slot_id and date are required');
  const row = await db.prepare(`
    INSERT INTO practical_requests (experiment_id,schedule_slot_id,date,notes) VALUES (?,?,?,?) RETURNING *`)
    .bind(experiment_id, schedule_slot_id, date, notes || null).first();
  return ok(row, 201);
}

async function updateRequest(req, db, id) {
  const { experiment_id, schedule_slot_id, date, notes } = await req.json();
  if (!experiment_id || !schedule_slot_id || !date)
    return err('experiment_id, schedule_slot_id and date are required');
  const row = await db.prepare(`
    UPDATE practical_requests SET experiment_id=?,schedule_slot_id=?,date=?,notes=?
    WHERE id=? RETURNING *`)
    .bind(experiment_id, schedule_slot_id, date, notes || null, id).first();
  if (!row) return err('Not found', 404);
  return ok(row);
}

async function deleteRequest(db, id) {
  await db.prepare('DELETE FROM practical_requests WHERE id=?').bind(id).run();
  return ok({ deleted: true });
}

// One-time override for a single practical request
async function getRequestOverride(db, requestId) {
  const row = await db.prepare(
    'SELECT * FROM experiment_overrides WHERE practical_request_id=?').bind(requestId).first();
  if (!row) return ok(null);
  return ok({
    ...row,
    equipment: row.equipment ? JSON.parse(row.equipment) : null,
    reagents:  row.reagents  ? JSON.parse(row.reagents)  : null,
  });
}

async function upsertRequestOverride(req, db, requestId) {
  const { equipment, reagents, notes } = await req.json();
  const existing = await db.prepare(
    'SELECT id FROM experiment_overrides WHERE practical_request_id=?').bind(requestId).first();
  const eqJson = equipment ? JSON.stringify(equipment) : null;
  const rgJson = reagents  ? JSON.stringify(reagents)  : null;
  let row;
  if (existing) {
    row = await db.prepare(`
      UPDATE experiment_overrides SET equipment=?,reagents=?,notes=?
      WHERE practical_request_id=? RETURNING *`)
      .bind(eqJson, rgJson, notes || null, requestId).first();
  } else {
    row = await db.prepare(`
      INSERT INTO experiment_overrides (practical_request_id,equipment,reagents,notes)
      VALUES (?,?,?,?) RETURNING *`)
      .bind(requestId, eqJson, rgJson, notes || null).first();
  }
  return ok({
    ...row,
    equipment: row.equipment ? JSON.parse(row.equipment) : null,
    reagents:  row.reagents  ? JSON.parse(row.reagents)  : null,
  });
}

async function deleteRequestOverride(db, requestId) {
  await db.prepare(
    'DELETE FROM experiment_overrides WHERE practical_request_id=?').bind(requestId).run();
  return ok({ deleted: true });
}

// ─────────────────────────────────────────────────────────
// Report generation
// ─────────────────────────────────────────────────────────

function calcDelivery(exp, studentCount, roomEq, variance, override) {
  // Priority: one-time override → teacher variance → experiment default
  let equipment = override?.equipment ?? variance?.equipment ??
    (typeof exp.equipment === 'string' ? JSON.parse(exp.equipment) : exp.equipment) ?? [];
  let reagents  = override?.reagents  ?? variance?.reagents  ??
    (typeof exp.reagents  === 'string' ? JSON.parse(exp.reagents)  : exp.reagents)  ?? [];

  if (typeof equipment === 'string') equipment = JSON.parse(equipment);
  if (typeof reagents  === 'string') reagents  = JSON.parse(reagents);

  // Map of what is already in the room (by lower-case name)
  const inRoom = {};
  for (const item of roomEq) inRoom[item.name.toLowerCase()] = item.quantity;

  const eqItems = equipment.map(item => {
    const needed    = (item.quantity_per_class || 0) + (item.quantity_per_student || 0) * studentCount;
    const permanent = inRoom[item.name.toLowerCase()] || 0;
    return { name: item.name, needed, in_room: permanent, to_deliver: Math.max(0, needed - permanent) };
  });

  const rgItems = reagents.map(item => {
    const needed = (item.quantity_per_class || 0) + (item.quantity_per_student || 0) * studentCount;
    return { name: item.name, needed, to_deliver: needed, unit: item.unit || '' };
  });

  return {
    equipment: eqItems.filter(i => i.needed > 0),
    reagents:  rgItems.filter(i => i.needed > 0),
  };
}

async function getReport(db, params) {
  const date = params.get('date');
  if (!date) return err('date parameter is required');

  const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][
    new Date(date + 'T12:00:00Z').getUTCDay()];

  const { results: requests } = await db.prepare(`
    SELECT pr.id, pr.experiment_id, pr.notes AS request_notes,
           e.name AS exp_name, e.equipment, e.reagents,
           ss.period, ss.class_name, ss.student_count,
           t.id AS teacher_id, t.name AS teacher_name,
           r.id AS room_id,    r.name AS room_name,
           eo.equipment AS override_equipment,
           eo.reagents  AS override_reagents,
           eo.notes     AS override_notes
    FROM practical_requests pr
    JOIN experiments    e  ON e.id  = pr.experiment_id
    JOIN schedule_slots ss ON ss.id = pr.schedule_slot_id
    JOIN teachers       t  ON t.id  = ss.teacher_id
    JOIN rooms          r  ON r.id  = ss.room_id
    LEFT JOIN experiment_overrides eo ON eo.practical_request_id = pr.id
    WHERE pr.date=?
    ORDER BY ss.period, r.name`).bind(date).all();

  // Fetch room equipment for all rooms in the report
  const roomIds = [...new Set(requests.map(r => r.room_id))];
  const roomEqMap = {};
  await Promise.all(roomIds.map(async rid => {
    const { results } = await db.prepare(
      'SELECT * FROM room_equipment WHERE room_id=?').bind(rid).all();
    roomEqMap[rid] = results;
  }));

  // Fetch teacher variances for all experiment×teacher combos
  const items = await Promise.all(requests.map(async r => {
    const variance = await db.prepare(`
      SELECT * FROM experiment_variances
      WHERE experiment_id=? AND teacher_id=?`).bind(r.experiment_id, r.teacher_id).first();

    const override = (r.override_equipment !== undefined || r.override_reagents !== undefined)
      ? {
          equipment: r.override_equipment ? JSON.parse(r.override_equipment) : null,
          reagents:  r.override_reagents  ? JSON.parse(r.override_reagents)  : null,
        }
      : null;

    const varianceParsed = variance
      ? {
          equipment: variance.equipment ? JSON.parse(variance.equipment) : null,
          reagents:  variance.reagents  ? JSON.parse(variance.reagents)  : null,
        }
      : null;

    const delivery = calcDelivery(
      r, r.student_count, roomEqMap[r.room_id] || [], varianceParsed, override);

    return {
      period:          r.period,
      room:            r.room_name,
      teacher:         r.teacher_name,
      class:           r.class_name,
      students:        r.student_count,
      experiment_id:   r.experiment_id,
      experiment_name: r.exp_name,
      request_notes:   r.request_notes,
      override_notes:  r.override_notes,
      override_active: !!(override?.equipment || override?.reagents),
      variance_active: !!(varianceParsed?.equipment || varianceParsed?.reagents),
      delivery,
    };
  }));

  // Group by period
  const periodMap = {};
  for (const item of items) {
    if (!periodMap[item.period]) periodMap[item.period] = [];
    periodMap[item.period].push(item);
  }

  return ok({
    date,
    day: dayName,
    periods: Object.entries(periodMap)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([p, items]) => ({ period: Number(p), items })),
  });
}

// ─────────────────────────────────────────────────────────
// Main router
// ─────────────────────────────────────────────────────────

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method;

  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  try {
    const segments = Array.isArray(context.params.route)
      ? context.params.route
      : (context.params.route ? [context.params.route] : []);
    const [s0, s1, s2, s3] = segments;
    const db = env.DB;

    // ── Unauthenticated routes ──────────────────────────────
    if (s0 === 'auth') {
      if (s1 === 'status' && method === 'GET') return handleAuthStatus(db);
      if (s1 === 'setup'  && method === 'POST') return handleSetup(request, env);
      if (s1 === 'login'  && method === 'POST') return handleLogin(request, env);
    }

    // DB initialisation (idempotent)
    if (s0 === 'init' && method === 'POST') {
      await initDB(db);
      return ok({ initialized: true });
    }

    // ── All routes below require a valid JWT ────────────────
    const auth = await requireAuth(request, env);
    if (!auth) return err('Unauthorized', 401);

    // Teachers
    if (s0 === 'teachers') {
      if (!s1 && method === 'GET')    return getTeachers(db);
      if (!s1 && method === 'POST')   return createTeacher(request, db);
      if (s1 && !s2 && method === 'PUT')    return updateTeacher(request, db, s1);
      if (s1 && !s2 && method === 'DELETE') return deleteTeacher(db, s1);
    }

    // Rooms
    if (s0 === 'rooms') {
      if (!s1 && method === 'GET')    return getRooms(db);
      if (!s1 && method === 'POST')   return createRoom(request, db);
      if (s1 && !s2 && method === 'GET')    return getRooms(db);   // single room fallback
      if (s1 && !s2 && method === 'PUT')    return updateRoom(request, db, s1);
      if (s1 && !s2 && method === 'DELETE') return deleteRoom(db, s1);
      if (s1 && s2 === 'equipment') {
        if (!s3 && method === 'GET')    return getRoomEquipment(db, s1);
        if (!s3 && method === 'POST')   return addRoomEquipment(request, db, s1);
        if (s3  && method === 'PUT')    return updateRoomEquipment(request, db, s1, s3);
        if (s3  && method === 'DELETE') return deleteRoomEquipment(db, s1, s3);
      }
    }

    // Schedule
    if (s0 === 'schedule') {
      if (!s1 && method === 'GET')    return getSchedule(db);
      if (!s1 && method === 'POST')   return createScheduleSlot(request, db);
      if (s1 && !s2 && method === 'PUT')    return updateScheduleSlot(request, db, s1);
      if (s1 && !s2 && method === 'DELETE') return deleteScheduleSlot(db, s1);
    }

    // Experiments
    if (s0 === 'experiments') {
      if (!s1 && method === 'GET')    return getExperiments(db);
      if (!s1 && method === 'POST')   return createExperiment(request, db);
      if (s1 && !s2 && method === 'GET')    return getExperiment(db, s1);
      if (s1 && !s2 && method === 'PUT')    return updateExperiment(request, db, s1);
      if (s1 && !s2 && method === 'DELETE') return deleteExperiment(db, s1);
      if (s1 && s2 === 'variances') {
        if (!s3 && method === 'GET')    return getVariances(db, s1);
        if (!s3 && method === 'POST')   return createVariance(request, db, s1);
        if (s3  && method === 'PUT')    return updateVariance(request, db, s1, s3);
        if (s3  && method === 'DELETE') return deleteVariance(db, s1, s3);
      }
      if (s1 && s2 === 'notes') {
        if (!s3 && method === 'GET')    return getNotes(db, s1);
        if (!s3 && method === 'POST')   return createNote(request, db, s1);
        if (s3  && method === 'DELETE') return deleteNote(db, s1, s3);
      }
    }

    // Practical requests
    if (s0 === 'requests') {
      const sp = new URL(request.url).searchParams;
      if (!s1 && method === 'GET')    return getRequests(db, sp);
      if (!s1 && method === 'POST')   return createRequest(request, db);
      if (s1 && !s2 && method === 'PUT')    return updateRequest(request, db, s1);
      if (s1 && !s2 && method === 'DELETE') return deleteRequest(db, s1);
      if (s1 && s2 === 'override') {
        if (method === 'GET')                    return getRequestOverride(db, s1);
        if (method === 'POST' || method === 'PUT') return upsertRequestOverride(request, db, s1);
        if (method === 'DELETE')                  return deleteRequestOverride(db, s1);
      }
    }

    // Report
    if (s0 === 'report' && method === 'GET')
      return getReport(db, new URL(request.url).searchParams);

    return err('Not found', 404);
  } catch (e) {
    console.error('API error:', e);
    return err(e.message || 'Internal server error', 500);
  }
}
