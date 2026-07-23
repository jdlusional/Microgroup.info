// POST /api/grant-status/update
// Header: X-Admin-Key: YOUR_SECRET (checked against env.GRANT_STATUS_KEY)
// Body JSON: { org_slug, item_type: "funder"|"grant", item_id, status, notes }
//
// Upserts one row -- status genuinely changes over time for the same item
// (unlike a newsletter signup, which either exists or doesn't), so this is
// INSERT ... ON CONFLICT DO UPDATE, not insert-or-ignore.
//
// The key is sent as a header, not a query param: a `?key=` in the URL ends
// up in browser history and gets shared accidentally the moment someone
// pastes the page's own link. The page prompts for this once client-side
// and caches it in localStorage.

const VALID_STATUSES = ["not_started", "researching", "in_progress", "submitted", "awarded", "declined"];
const VALID_TYPES = ["funder", "grant"];

export async function onRequestPost(context) {
  const { request, env } = context;

  const key = request.headers.get("X-Admin-Key") || "";
  if (!env.GRANT_STATUS_KEY || key !== env.GRANT_STATUS_KEY) {
    return json({ error: "Not authorized." }, 401);
  }

  let data;
  try {
    data = await request.json();
  } catch (e) {
    return json({ error: "Invalid request." }, 400);
  }

  const org_slug = clean(data.org_slug);
  const item_type = clean(data.item_type);
  const item_id = clean(data.item_id);
  const status = clean(data.status) || "not_started";
  const notes = clean(data.notes);

  if (!/^[a-z0-9-]+$/.test(org_slug)) {
    return json({ error: "Invalid org." }, 400);
  }
  if (VALID_TYPES.indexOf(item_type) === -1) {
    return json({ error: "item_type must be 'funder' or 'grant'." }, 400);
  }
  if (!item_id) {
    return json({ error: "item_id is required." }, 400);
  }
  if (VALID_STATUSES.indexOf(status) === -1) {
    return json({ error: "Invalid status." }, 400);
  }

  const now = new Date().toISOString();

  try {
    await env.GRANT_STATUS_DB.prepare(
      `INSERT INTO grant_status (org_slug, item_type, item_id, status, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(org_slug, item_type, item_id)
       DO UPDATE SET status = excluded.status, notes = excluded.notes, updated_at = excluded.updated_at`
    ).bind(org_slug, item_type, item_id, status, notes, now, now).run();
  } catch (e) {
    return json({ error: "Could not save status." }, 500);
  }

  return json({ org_slug, item_type, item_id, status, notes, updated_at: now }, 200);
}

function clean(v) {
  return (v === undefined || v === null) ? "" : String(v).trim();
}

function json(obj, statusCode) {
  return new Response(JSON.stringify(obj), {
    status: statusCode,
    headers: { "Content-Type": "application/json" }
  });
}
