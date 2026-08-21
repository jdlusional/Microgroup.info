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

-- 2026-08-19: Enterprise Suite questionnaire intake. Owner Decision 6 of the
-- Enterprise Page Build Architecture plan directed D1-backed persistence built
-- now, then amended it to D1 AND email, both: the endpoint stores a record a
-- build step can consume, and still sends the Resend notification so a
-- submission is actually noticed.
--
-- NOT RUN AUTOMATICALLY, same as everything above. Apply against the live D1
-- database (wrangler d1 execute, or the D1 console) before survey.js will
-- persist anything. Until it exists, the endpoint degrades to email-only by
-- design and no submission is lost, so applying this is not urgent and not
-- risky to defer.
--
-- org_slug is the whole point of the table. The endpoint previously carried no
-- organization identifier at all, only a page URL, so answers arrived as an
-- inbox message no build step could attribute to an organization. The
-- questionnaire generator now injects the build's own slug as a hidden field.
-- It is nullable because demo-survey.html posts to this same endpoint with no
-- slug, and rejecting those would break a live public form to serve a new one.
-- APPLIED 2026-08-20 (owner-authorised, Enterprise Suite gap reconciliation): the two
-- statements below were executed against the live microgroup database with
-- `wrangler d1 execute microgroup --remote`, then verified with a sqlite_master query
-- (table + index present) and PRAGMA table_info (all eleven columns). The ALTER TABLE
-- lines above were deliberately NOT re-run; their columns already exist.
CREATE TABLE IF NOT EXISTS questionnaire_submissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  org_slug    TEXT,
  org_name    TEXT NOT NULL,
  contact_name  TEXT NOT NULL,
  contact_title TEXT,
  email       TEXT NOT NULL,
  ein         TEXT,
  answers     TEXT NOT NULL,   -- JSON object of every question key to its answer
  file_names  TEXT,            -- JSON array; the files themselves go to email, not here
  page_url    TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_questionnaire_org_slug
  ON questionnaire_submissions (org_slug);
