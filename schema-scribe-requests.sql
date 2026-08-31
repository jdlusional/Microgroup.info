-- scribe_requests: the Scribe request record, Enterprise Suite Phase 1 Section 2.7.
--
-- APPLY (remote, the live microgroup D1 database):
--   npx wrangler d1 execute microgroup --remote --file=schema-scribe-requests.sql
-- VERIFY AFTERWARDS BY QUERYING sqlite_master DIRECTLY, never by trusting the exit status:
--   npx wrangler d1 execute microgroup --remote --command "SELECT sql FROM sqlite_master WHERE name='scribe_requests';"
--
-- WHY THIS TABLE EXISTS. Before it, functions/api/draft-request.js sent an email via Resend and
-- PERSISTED NOTHING, so a submitted Scribe request existed only in an inbox. Section 2.7's own
-- words: "Build the scribe_requests table itself, since none exists."
--
-- THE SHAPE FOLLOWS SECTION 2.7 AND ITS ONE DELIBERATE ADDITION IS RECORDED HERE RATHER THAN
-- SLIPPED IN. Section 2.7 specifies request_id, client_id, opportunity_uid (nullable),
-- submitted_at, status, populated_result_ref (nullable). The structural criteria columns
-- (focus_area, award_band, deadline_window, opportunity_type) are added because Section 5 requires
-- Scribe to accept a request that names NO live opportunity, which means opportunity_uid is NULL on
-- exactly the requests this redesign exists to support. Without these columns such a row would
-- record that somebody asked for something and nothing about what they asked for.
--
-- opportunity_uid IS A FOREIGN KEY BY VALUE, NOT BY CONSTRAINT, and that is deliberate. The
-- register it points at (nonprofit-data/opportunity_register/opportunity_register.csv) is a CSV in
-- a different repo, not a table in this database, so a REFERENCES clause here would be a lie the
-- engine cannot enforce. Section 5's one-way boundary means Scribe never resolves this value at
-- request time; it is populated only if the owner later reconciles a request against the register.
--
-- SHARED VOCABULARY, per Phase 1 Section 8 decision 7 (ratified 2026-08-18, accepted as
-- recommended): focus_area and opportunity_type draw from the register's own vocabulary
-- (program_area, opportunity_type) rather than free text, so a submission can be reconciled against
-- the register at upload time without abandoning "structure only". The vocabulary is NOT enforced
-- as a CHECK constraint: the register's own vocabulary is open and grows, and a constraint here
-- would start rejecting live submissions the day the register adds a term.

CREATE TABLE IF NOT EXISTS scribe_requests (
  request_id           INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id            TEXT    NOT NULL,
  opportunity_uid      TEXT,
  focus_area           TEXT,
  opportunity_type     TEXT,
  award_band           TEXT,
  deadline_window      TEXT,
  org                  TEXT,
  requester            TEXT,
  message              TEXT,
  page_url             TEXT,
  file_meta            TEXT,
  submitted_at         TEXT    NOT NULL,
  status               TEXT    NOT NULL DEFAULT 'submitted'
                               CHECK (status IN ('submitted','in progress','draft delivered','closed')),
  status_changed_at    TEXT,
  populated_result_ref TEXT
);

-- The owner's own working queries are "what has this client asked for" and "what is still open",
-- so those are the two indexes. Nothing else is indexed on speculation.
CREATE INDEX IF NOT EXISTS idx_scribe_requests_client ON scribe_requests (client_id, submitted_at);
CREATE INDEX IF NOT EXISTS idx_scribe_requests_status ON scribe_requests (status, submitted_at);
