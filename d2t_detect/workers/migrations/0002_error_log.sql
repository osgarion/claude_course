-- Persistent error log for this project's Worker. Lives in the d2t-detect D1,
-- so it is completely separate from pixel-pantry's database.
-- Only unexpected (5xx) server errors are recorded here — not expected 4xx.

CREATE TABLE error_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  method     TEXT    NOT NULL,
  path       TEXT    NOT NULL,
  status     INTEGER NOT NULL,
  name       TEXT    NOT NULL,          -- error class, e.g. "TypeError"
  message    TEXT    NOT NULL,
  stack      TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX idx_error_log_time ON error_log (created_at DESC);
