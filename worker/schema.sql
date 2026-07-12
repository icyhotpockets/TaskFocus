CREATE TABLE IF NOT EXISTS subscriptions (
  device_id TEXT PRIMARY KEY,
  subscription TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pending (
  device_id TEXT NOT NULL,
  nid INTEGER NOT NULL,
  fire_at INTEGER NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (device_id, nid)
);

CREATE INDEX IF NOT EXISTS pending_fire_at_idx ON pending (fire_at);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS logs_at_idx ON logs (at DESC);
