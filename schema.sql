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

-- 2026-07-22: contact form rebuilt to match jonathanlindavis.com's own
-- field contract (organization + message replace the old required
-- location/urgency pair). Additive only -- old columns (location, urgency)
-- are left in place, unused by the new form, rather than dropped, so no
-- existing row is destroyed. NOT run automatically; apply against the live
-- D1 database (wrangler d1 execute, or the D1 console) before the new
-- contact.js/functions/api/contact.js contract will actually persist
-- submissions without erroring on the missing columns.
ALTER TABLE contacts ADD COLUMN organization TEXT;
ALTER TABLE contacts ADD COLUMN message TEXT;
