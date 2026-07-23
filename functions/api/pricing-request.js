// POST /api/pricing-request
// Receives a pricing request from demo-pricing.html and emails it to the site
// owner via Resend. Hard-fail: the email IS the deliverable here (there is no
// D1 record backing this up), so a Resend failure is returned to the visitor
// as a real error rather than swallowed.
//
// Expects JSON:
//   { name, org, email, phone, products: [], message, website,
//     referrer_name, referrer_email, referrer_phone, referral_date, page_url }
//
// website is the honeypot: people never see it, so any value there is treated
// as a bot submission and accepted silently without being emailed.
//
// referral_date is the date a referral was actually MADE, entered by the
// submitter. It is intentionally kept separate from created_at below, which
// is the server-stamped submission timestamp — the two must never be
// conflated in the email body.
//
// Config (Cloudflare Pages -> Settings -> Variables and Secrets):
//   RESEND_KEY        (required, encrypted)
//   PRICING_REQUEST_TO    (optional) recipient inbox; default below
//   PRICING_REQUEST_FROM  (optional) verified sender; default uses Resend onboarding

const DEFAULT_TO = "jdavis92105@gmail.com";
const DEFAULT_FROM = "MICRO Group Pricing <onboarding@resend.dev>";

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])
  );
}

function clean(v) {
  return v === undefined || v === null ? "" : String(v).trim();
}

function buildText({ fields, referral, createdAt }) {
  const lines = [
    "Submission",
    ...fields.filter((f) => f[1]).map((f) => `${f[0]}: ${f[1]}`),
    `Submitted: ${createdAt}`,
  ];
  if (referral) {
    lines.push("", "Referral");
    lines.push(...referral.filter((f) => f[1]).map((f) => `${f[0]}: ${f[1]}`));
  }
  return lines.join("\n");
}

function buildHtml({ fields, referral, createdAt }) {
  const row = (label, value) => `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e3e6ec;vertical-align:top;font:600 13px/1.4 Georgia,serif;color:#33507a;white-space:nowrap">${esc(label)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e3e6ec;vertical-align:top;font:400 13px/1.5 Georgia,serif;color:#16233b;white-space:pre-wrap">${esc(value)}</td>
    </tr>`;
  const submissionRows = fields
    .filter((f) => f[1])
    .map((f) => row(f[0], f[1]))
    .join("") + row("Submitted", createdAt);
  const referralBlock = referral
    ? `<div style="font:600 11px/1 monospace;letter-spacing:.1em;color:#8a5218;text-transform:uppercase;margin:20px 0 6px">Referral</div>
       <table style="border-collapse:collapse;width:100%">${referral
         .filter((f) => f[1])
         .map((f) => row(f[0], f[1]))
         .join("")}</table>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f5f6f8;padding:24px">
    <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #ccd2de;border-radius:6px;overflow:hidden">
      <div style="background:#1b3a6b;color:#fff;padding:16px 20px">
        <div style="font:600 11px/1 monospace;letter-spacing:.12em;color:#e6c35a;text-transform:uppercase;margin-bottom:6px">MICRO Group &middot; Pricing</div>
        <div style="font:600 18px/1.2 Georgia,serif">New pricing request</div>
      </div>
      <div style="padding:16px 20px">
        <p style="font:400 12px/1.5 Georgia,serif;color:#5a6b82;margin:0 0 12px">Reply to this email to respond to the submitter directly.</p>
        <div style="font:600 11px/1 monospace;letter-spacing:.1em;color:#33507a;text-transform:uppercase;margin-bottom:6px">Submission</div>
        <table style="border-collapse:collapse;width:100%">${submissionRows}</table>
        ${referralBlock}
      </div>
    </div>
  </body></html>`;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  // Honeypot: pretend success, send nothing.
  if (clean(data.website)) {
    return json({ ok: true });
  }

  const name = clean(data.name);
  const org = clean(data.org);
  const email = clean(data.email).toLowerCase();
  const phone = clean(data.phone);
  const message = clean(data.message);
  const pageUrl = clean(data.page_url);
  const products = Array.isArray(data.products)
    ? data.products.map(clean).filter(Boolean)
    : [];

  if (!name || !org) {
    return json({ error: "Please enter your name and organization." }, 400);
  }
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email)) {
    return json({ error: "Please enter a valid email." }, 400);
  }

  const referrerName = clean(data.referrer_name);
  const referrerEmail = clean(data.referrer_email);
  const referrerPhone = clean(data.referrer_phone);
  const referralDate = clean(data.referral_date);
  const anyReferralField = referrerName || referrerEmail || referrerPhone || referralDate;
  if (anyReferralField && (!referrerName || !referralDate)) {
    return json(
      { error: "If crediting a referrer, please include their full name and the date of referral." },
      400
    );
  }

  if (!env.RESEND_KEY) {
    return json({ error: "Email is not configured yet." }, 500);
  }

  const createdAt = new Date().toISOString();

  const fields = [
    ["Name", name],
    ["Organization", org],
    ["Email", email],
    ["Phone", phone],
    ["Interested in", products.join(", ")],
    ["Message", message],
    ["Page", pageUrl],
  ];
  const referral = anyReferralField
    ? [
        ["Referrer name", referrerName],
        ["Referrer email", referrerEmail],
        ["Referrer phone", referrerPhone],
        ["Date of referral", referralDate],
      ]
    : null;

  const to = env.PRICING_REQUEST_TO || DEFAULT_TO;
  const from = env.PRICING_REQUEST_FROM || DEFAULT_FROM;
  const subject = `Pricing request — ${org}` + (referral ? " (referred)" : "");

  const payload = {
    from,
    to: [to],
    reply_to: email,
    subject,
    text: buildText({ fields, referral, createdAt }),
    html: buildHtml({ fields, referral, createdAt }),
  };

  let r;
  try {
    r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.RESEND_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return json({ error: "Network error contacting mail service." }, 502);
  }

  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    return json({ error: "Mail service rejected the send.", detail: detail.slice(0, 300) }, 502);
  }

  return json({ ok: true });
}

// Anything other than POST
export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return json({ error: "method not allowed" }, 405);
}
