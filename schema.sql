-- Run once in the D1 console for the microgroup database.
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name  TEXT NOT NULL,
  email      TEXT NOT NULL,
  phone      TEXT,
  location   TEXT,
  purpose    TEXT,
  urgency    TEXT,
  referral   TEXT,
  created_at TEXT NOT NULL
);
