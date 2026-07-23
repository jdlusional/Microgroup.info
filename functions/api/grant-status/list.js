// GET /api/grant-status/list?org=measure-austin
//
// Returns the current pipeline status for every funder/grant an org has
// touched. Public -- read access is intentionally not gated. The content
// here (e.g. "researching", "submitted") is low-sensitivity, and this
// tool's pages are already unlisted (noindex, not linked from anywhere) --
// consistent with that existing threat model, not a new exposure.
//
// Returns: { org_slug, statuses: { "funder:364336415": {status, notes, updated_at}, ... } }

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const org_slug = clean(url.searchParams.get("org"));
  if (!/^[a-z0-9-]+$/.test(org_slug)) {
    return json({ error: "Invalid or missing org." }, 400);
  }

  let rows;
  try {
    rows = await env.GRANT_STATUS_DB.prepare(
      `SELECT item_type, item_id, status, notes, updated_at
         FROM grant_status
        WHERE org_slug = ?`
    ).bind(org_slug).all();
  } catch (e) {
    return json({ error: "Database error." }, 500);
  }

  const records = (rows && rows.results) ? rows.results : [];
  const statuses = {};
  for (const r of records) {
    statuses[`${r.item_type}:${r.item_id}`] = {
      status: r.status,
      notes: r.notes,
      updated_at: r.updated_at
    };
  }

  return json({ org_slug, statuses }, 200);
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
