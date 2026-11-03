CREATE TABLE cards (
  id TEXT PRIMARY KEY NOT NULL,
  metric TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  goal REAL NOT NULL CHECK (goal > 0),
  current REAL NOT NULL,
  previous REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
--> statement-breakpoint
CREATE TABLE card_history (
  id TEXT PRIMARY KEY NOT NULL,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  previous REAL,
  current REAL NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX card_history_card_idx ON card_history(card_id, updated_at);
--> statement-breakpoint
CREATE TABLE auth_attempts (
  key TEXT PRIMARY KEY NOT NULL,
  window INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1
);
