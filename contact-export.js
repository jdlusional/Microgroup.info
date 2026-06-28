// GET /api/admin/contact-export?key=YOUR_SECRET
//
// Returns a CSV of contact submissions that opens directly in Excel.
// Protected by a secret key stored as the ADMIN_KEY environment
// variable in Cloudflare (never hard coded here).
//
// Example:
//   /api/admin/contact-export?key=YOUR_SECRET
//       -> every contact submission, newest first

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const key = url.searchParams.get("key") || "";

  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
    return new Response("Not authorized.", { status: 401 });
  }

  let rows;
  try {
    const res = await env.DB.prepare(
      `SELECT first_name, last_name, email, phone, location, purpose, urgency, referral, created_at
         FROM contacts
        ORDER BY created_at DESC`
    ).all();
    rows = res.results || [];
  } catch (e) {
    return new Response("Could not read submissions.", { status: 500 });
  }

  const headers = [
    "First Name", "Last Name", "Email", "Phone", "Location",
    "Purpose", "Urgency", "Referral", "Submitted",
  ];
  const out = [headers.map(csv).join(",")];
  for (const r of rows) {
    out.push([
      r.first_name, r.last_name, r.email, r.phone, r.location,
      r.purpose, r.urgency, r.referral, r.created_at,
    ].map(csv).join(","));
  }

  return new Response(out.join("\r\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="microgroup-contacts.csv"`,
    },
  });
}

function csv(v) {
  const s = v == null ? "" : String(v);
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
