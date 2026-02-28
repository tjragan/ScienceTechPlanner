-- Science Tech Planner – D1 (SQLite) Schema
-- Apply with: wrangler d1 execute science-tech-planner --file=./schema.sql

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY CHECK(id = 1),
  password_hash TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
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

-- Equipment permanently stored in a room (does not need to be delivered)
CREATE TABLE IF NOT EXISTS room_equipment (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id  INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name     TEXT    NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1
);

-- One row per teacher × day × period
CREATE TABLE IF NOT EXISTS schedule_slots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id    INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  room_id       INTEGER NOT NULL REFERENCES rooms(id)    ON DELETE CASCADE,
  day           TEXT    NOT NULL,   -- Monday … Friday
  period        INTEGER NOT NULL,   -- 1 … 10
  class_name    TEXT    NOT NULL,
  student_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(teacher_id, day, period),
  UNIQUE(room_id,    day, period)
);

-- Master experiment definitions
CREATE TABLE IF NOT EXISTS experiments (
  id          TEXT PRIMARY KEY,           -- user-defined, e.g. "BIO-201"
  name        TEXT NOT NULL,
  description TEXT,
  -- JSON arrays: [{name, quantity_per_class, quantity_per_student}]
  equipment   TEXT NOT NULL DEFAULT '[]',
  -- JSON arrays: [{name, quantity_per_class, quantity_per_student, unit}]
  reagents    TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Long-term variance: a specific teacher always does an experiment differently
CREATE TABLE IF NOT EXISTS experiment_variances (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  experiment_id TEXT    NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  teacher_id    INTEGER NOT NULL REFERENCES teachers(id)    ON DELETE CASCADE,
  equipment     TEXT,   -- JSON array override (NULL = use default)
  reagents      TEXT,   -- JSON array override (NULL = use default)
  notes         TEXT,
  UNIQUE(experiment_id, teacher_id)
);

-- General notes attached to an experiment
CREATE TABLE IF NOT EXISTS experiment_notes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  experiment_id TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  note          TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Practical requests: an experiment assigned to a schedule slot on a date
CREATE TABLE IF NOT EXISTS practical_requests (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  experiment_id    TEXT    NOT NULL REFERENCES experiments(id),
  schedule_slot_id INTEGER NOT NULL REFERENCES schedule_slots(id),
  date             TEXT    NOT NULL,  -- YYYY-MM-DD
  notes            TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- One-time override for a single practical request
CREATE TABLE IF NOT EXISTS experiment_overrides (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  practical_request_id INTEGER NOT NULL REFERENCES practical_requests(id) ON DELETE CASCADE,
  equipment            TEXT,   -- JSON array override (NULL = use default)
  reagents             TEXT,   -- JSON array override (NULL = use default)
  notes                TEXT,
  UNIQUE(practical_request_id)
);
