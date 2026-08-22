// GET /private-specialist-submissions-data
//
// Data endpoint behind private-specialist-submissions.html, the owner-only review page for
// the Specialist Panel questionnaire's D1-primary submissions (table: specialist_submissions,
// written by functions/api/specialist-questionnaire.js as of the 2026-08-22 D1-primary
// conversion; see item-135-specialist-panel-conversion-log.md for that conversion's full
// detail).
//
// Deliberately named and placed under the "private-" prefix, matching the same convention
// jonathanlindavis.com uses for private-gift-leads-data.js: it puts this endpoint under the
// SAME path prefix as the page it serves, so the new dedicated Cloudflare Access application
// scoped to microgroup.info/private-specialist-submissions* covers both the page and this
// endpoint with one wildcard, no second destination needed. This is the access control itself,
// Access blocks an unauthenticated request before it ever reaches this function. Unlike
// jonathanlindavis.com, this app is a brand NEW dedicated Access application (owner-authorized
// 2026-08-22), not an existing site-wide /private* wildcard, Microgroup.info has no such
// wildcard (see _redirects, "No private-index.html exists on this domain by design").
//
// GET -> { rows: [...] }, newest submission first. Each row carries the full parsed payload
// and file_meta so the page can build both the collapsed excerpt (name, email, primary domain,
// current employer or title) and an expandable full-record view, matching what a real review
// of a specialist candidate profile actually needs, not just the four bare columns named in
// the build brief. Returning the full payload (rather than a server-side json_extract
// projection) was the deliberate, lower-risk choice here, it reuses the exact JSON shape
// already proven correct end to end in the prior conversion pass's local-harness and direct-D1
// round-trip tests, rather than introducing an untested SQLite JSON1 query this session cannot
// verify against a live preview (see the two known blockers in the conversion log).
//
// No POST or PATCH here, this is a read-only review surface. The brief did not ask for a
// disposition or reviewed workflow, and the schema has no such column (see the page's own
// on-page note about this).

export async function onRequestGet(context) {
  const { env } = context;

  if (!env.DB) {
    return json({ error: "Storage is not configured yet." }, 500);
  }

  let rows;
  try {
    rows = await env.DB.prepare(
      `SELECT id, submitted_at, payload, file_meta, honeypot_ok
         FROM specialist_submissions
        ORDER BY id DESC`
    ).all();
  } catch (e) {
    return json({ error: "Database error." }, 500);
  }

  return json({ rows: (rows && rows.results) ? rows.results : [] }, 200);
}

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  return json({ error: "method not allowed" }, 405);
}

function json(obj, statusCode) {
  return new Response(JSON.stringify(obj), {
    status: statusCode,
    headers: { "Content-Type": "application/json" },
  });
}