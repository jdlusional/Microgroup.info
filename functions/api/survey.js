// POST /api/survey
// Receives the generic organization-intake survey (demo-survey.html) and
// emails it to the site owner via Resend, forwarding any uploaded documents
// (990, audited financials, grant applications) as email attachments. This
// page is public and unauthenticated (unlike draft-request.js's Access-gated
// context), so the submitter's own email is used for reply_to directly,
// after format validation, rather than a Cf-Access-Authenticated-User-Email
// header.
//
// Config (Cloudflare Pages -> Settings -> Variables and Secrets):
//   RESEND_KEY     (required, encrypted)
//   SURVEY_TO      (optional) recipient inbox; default below
//   SURVEY_FROM    (optional) verified sender; default uses Resend onboarding

const DEFAULT_TO = "jdavis92105@gmail.com";
const DEFAULT_FROM = "MICRO Group Organization Intake <onboarding@resend.dev>";

const ALLOWED_EXTENSIONS = [".pdf", ".doc", ".docx"];
const MAX_TOTAL_BYTES = 25 * 1024 * 1024; // 25 MB, matches draft-request.js

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

function hasAllowedExtension(filename) {
  const name = String(filename || "").toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

// Convert an ArrayBuffer to base64 without blowing the call stack on large
// files (avoids String.fromCharCode(...bytes) on the full byte array).
function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

const FIELD_GROUPS = [
  {
    label: "Contact",
    keys: [["title", "Title"], ["ein", "EIN"]],
  },
  {
    label: "Mission and positioning",
    keys: [
      ["mission_text", "Mission and focus"],
      ["operating_areas", "Where they operate"],
    ],
  },
  {
    label: "Goals and problems",
    keys: [
      ["short_term_goals", "Short-term goals"],
      ["long_term_goals", "Long-term goals"],
      ["problems", "Problems being addressed"],
    ],
  },
  {
    label: "Funding relationships",
    keys: [
      ["relationship_notes", "Relationships beyond public filings"],
      ["funder_exclusions", "Funders to exclude"],
      ["watch_requests", "Requested watch list"],
    ],
  },
  {
    label: "Grant history",
    keys: [
      ["recent_applications", "Recent applications and outcomes"],
      ["pipeline_notes", "Current pipeline"],
    ],
  },
  {
    label: "Board and leadership",
    keys: [
      ["board_roster", "Board or trustee roster"],
      ["leadership_notes", "Leadership background"],
    ],
  },
  {
    label: "Documents",
    keys: [["document_links", "Shared document links"]],
  },
  {
    label: "Other",
    keys: [["wishlist", "Anything else"]],
  },
];

function buildText({ name, title, org, email, fields, fileNames, pageUrl, createdAt }) {
  const lines = [
    `Organization: ${org}`,
    `Contact: ${name}${title ? " (" + title + ")" : ""}`,
    `Email: ${email}`,
  ];
  for (const group of FIELD_GROUPS) {
    const rows = group.keys
      .map(([key, label]) => [label, fields[key]])
      .filter(([, v]) => v);
    if (!rows.length) continue;
    lines.push("", group.label.toUpperCase());
    for (const [label, value] of rows) lines.push(`${label}: ${value}`);
  }
  lines.push("", `Attachments: ${fileNames.length ? fileNames.join(", ") : "(none)"}`);
  lines.push(`Page: ${pageUrl || "(none)"}`);
  lines.push(`Submitted: ${createdAt}`);
  return lines.join("\n");
}

function buildHtml({ name, title, org, email, fields, fileNames, pageUrl, createdAt }) {
  const row = (label, value) => `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e3e6ec;vertical-align:top;font:600 12px/1.4 monospace;color:#33507a;white-space:nowrap">${esc(label)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e3e6ec;vertical-align:top;font:400 13px/1.5 Georgia,serif;color:#16233b;white-space:pre-wrap">${esc(value)}</td>
    </tr>`;
  const headerRows = [
    row("Organization", org),
    row("Contact", name + (title ? " (" + title + ")" : "")),
    row("Email", email),
  ].join("");
  const groupBlocks = FIELD_GROUPS.map((group) => {
    const rows = group.keys
      .map(([key, label]) => [label, fields[key]])
      .filter(([, v]) => v);
    if (!rows.length) return "";
    return `<div style="font:600 11px/1 monospace;letter-spacing:.1em;color:#8a5218;text-transform:uppercase;margin:18px 0 6px">${esc(
      group.label
    )}</div><table style="border-collapse:collapse;width:100%">${rows
      .map(([label, value]) => row(label, value))
      .join("")}</table>`;
  }).join("");
  return `<!doctype html><html><body style="margin:0;background:#f5f6f8;padding:24px">
    <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #ccd2de;border-radius:6px;overflow:hidden">
      <div style="background:#1b3a6b;color:#fff;padding:16px 20px">
        <div style="font:600 11px/1 monospace;letter-spacing:.12em;color:#e6c35a;text-transform:uppercase;margin-bottom:6px">MICRO Group &middot; Organization Intake</div>
        <div style="font:600 18px/1.2 Georgia,serif">New survey response</div>
      </div>
      <div style="padding:16px 20px">
        <p style="font:400 12px/1.5 Georgia,serif;color:#5a6b82;margin:0 0 12px">Reply to this email to respond to the submitter directly.</p>
        <table style="border-collapse:collapse;width:100%">${headerRows}</table>
        ${groupBlocks}
        <div style="font:600 11px/1 monospace;letter-spacing:.1em;color:#8a5218;text-transform:uppercase;margin:18px 0 6px">Submission</div>
        <table style="border-collapse:collapse;width:100%">${row(
          "Attachments",
          fileNames.length ? fileNames.join(", ") : "(none)"
        )}${row("Page", pageUrl || "(none)")}${row("Submitted", createdAt)}</table>
      </div>
    </div>
  </body></html>`;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "Invalid form data." }, 400);
  }

  // Honeypot: bots fill the hidden "website" field. Accept silently, send nothing.
  if (clean(form.get("website"))) {
    return json({ ok: true });
  }

  const name = clean(form.get("name"));
  const org = clean(form.get("org"));
  const email = clean(form.get("email")).toLowerCase();
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!name || !org) {
    return json({ error: "Please enter your name and organization." }, 400);
  }
  if (!emailRe.test(email)) {
    return json({ error: "Please enter a valid email." }, 400);
  }

  const fields = {};
  for (const group of FIELD_GROUPS) {
    for (const [key] of group.keys) {
      fields[key] = clean(form.get(key));
    }
  }
  const pageUrl = clean(form.get("page_url"));
  const title = fields.title;

  const files = form
    .getAll("files")
    .filter((f) => f && typeof f === "object" && "size" in f && "name" in f && f.size > 0);

  for (const f of files) {
    if (!hasAllowedExtension(f.name)) {
      return json(
        { error: `Unsupported file type: ${f.name} (allowed: .pdf, .doc, .docx)` },
        400
      );
    }
  }

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    return json({ error: "Attachments exceed the 25 MB total size limit." }, 413);
  }

  if (!env.RESEND_KEY) {
    return json({ error: "Email is not configured yet." }, 500);
  }

  const createdAt = new Date().toISOString();

  const attachments = [];
  for (const f of files) {
    const buf = await f.arrayBuffer();
    attachments.push({ filename: f.name, content: arrayBufferToBase64(buf) });
  }
  const fileNames = files.map((f) => f.name);

  const to = env.SURVEY_TO || DEFAULT_TO;
  const from = env.SURVEY_FROM || DEFAULT_FROM;
  const subject = `Organization intake: ${org}`;

  const emailFields = { name, title, org, email, fields, fileNames, pageUrl, createdAt };

  const payload = {
    from,
    to: [to],
    reply_to: email,
    subject,
    text: buildText(emailFields),
    html: buildHtml(emailFields),
  };
  if (attachments.length) payload.attachments = attachments;

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
