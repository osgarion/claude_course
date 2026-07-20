-- D2T teaching classifier — initial schema.
-- Teaching data only: `patient_label` is a user-chosen label, NOT real PHI.

CREATE TABLE users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  username   TEXT    NOT NULL,
  password   TEXT    NOT NULL,            -- pbkdf2_sha256$iter$salt$hash
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
-- Case-insensitive unique usernames (so "Alice" and "alice" can't both exist).
CREATE UNIQUE INDEX idx_users_username ON users (username COLLATE NOCASE);

CREATE TABLE auth_tokens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  key_hash   TEXT    NOT NULL UNIQUE,     -- sha256(token); raw token never stored
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tokens_user ON auth_tokens (user_id);

CREATE TABLE assessments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  patient_label   TEXT    NOT NULL,       -- e.g. "PT-0001" (suggested) or user's own
  inputs_json     TEXT    NOT NULL,       -- the 5 raw inputs as submitted (JSON)
  p_d2t           REAL    NOT NULL,       -- server-recomputed, authoritative
  p_rem           REAL    NOT NULL,
  predicted_class TEXT    NOT NULL,       -- 'd2t' | 'rem'
  eta             REAL    NOT NULL,       -- log-odds
  note            TEXT    NOT NULL DEFAULT '',
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_assess_user ON assessments (user_id, created_at DESC);
-- One label per patient per user (prevents accidental duplicates; drives PT-000X).
CREATE UNIQUE INDEX idx_assess_label ON assessments (user_id, patient_label COLLATE NOCASE);
