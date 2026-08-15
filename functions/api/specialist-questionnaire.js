// POST /api/specialist-questionnaire
// Receives the specialist panel profile intake (specialist-questionnaire.html)
// and emails it to the site owner via Resend, forwarding an attached CV as an
// email attachment. Forked from survey.js, which is the closest existing
// pattern: same multipart FormData contract, same FIELD_GROUPS abstraction,
// same helpers. Like that one, this stores nothing; the page's own footer says
// so and that must stay true.
//
// Two things here have no equivalent in survey.js and are the reason this is a
// separate function rather than another branch of that one:
//
//   1. PER-FIELD PUBLICATION CONSENT. Ten independent yes/no answers about
//      what may be published. The default is NO, and it is enforced here
//      rather than trusted from the page: anything that is not the exact
//      string "yes" is recorded as a no, including an empty string, a missing
//      key, and any unexpected value. Silence must never become permission.
//   2. CONSENT IS NOT REQUIRED. Every other question is required (write "None"
//      if it does not apply), but the consent rows deliberately are not, so a
//      person can decline to answer and have that read as a no. Requiring an
//      answer would defeat the default.
//
// Config (Cloudflare Pages -> Settings -> Variables and Secrets):
//   RESEND_KEY   (required, encrypted)  NOTE: this repo uses RESEND_KEY.
//                The sibling Jonathanlindavis.com repo uses RESEND_API_KEY.
//                Copying a function across repos silently stops mail.
//   PANEL_TO     (optional) recipient inbox; default below
//   PANEL_FROM   (optional) verified sender; default uses Resend onboarding

const DEFAULT_TO = "jdavis92105@gmail.com";
const DEFAULT_FROM = "MICRO Group, L.L.C. Specialist Panel <onboarding@resend.dev>";

const ALLOWED_EXTENSIONS = [".pdf", ".doc", ".docx"];
const MAX_TOTAL_BYTES = 25 * 1024 * 1024; // 25 MB, matches survey.js

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

// Required questions, in page order. Drives required-field enforcement, the
// plaintext email and the HTML email from one array, so a new question is one
// line here plus one line on the page.
const FIELD_GROUPS = [
  {
    label: "Identity",
    keys: [["public_name", "Name as it should appear publicly"]],
  },
  {
    label: "Education and credentials",
    keys: [
      ["terminal_degree", "Highest degree, field, institution, year"],
      ["other_degrees", "Other degrees"],
      ["certifications", "Certifications"],
    ],
  },
  {
    label: "Licenses",
    keys: [["licenses", "Professional licenses"]],
  },
  {
    label: "Current position",
    keys: [
      ["current_employer", "Current employer"],
      ["current_title", "Current title"],
      ["prior_positions", "Prior positions worth citing"],
    ],
  },
  {
    label: "Domain and methods",
    keys: [
      ["primary_domain", "Primary domain"],
      ["secondary_domains", "Secondary domains"],
      ["methods", "Methods used"],
    ],
  },
  {
    label: "Sector experience",
    keys: [
      ["nonprofit_experience", "Nonprofit sector experience"],
      ["government_experience", "Government or public sector experience"],
      ["geography", "Where they practice"],
    ],
  },
  {
    label: "Screening",
    keys: [["funder_relationships", "Funder relationships"]],
  },
  {
    label: "Work",
    keys: [["publications", "Selected publications"]],
  },
  {
    label: "Other",
    keys: [
      ["corrections", "Corrections to the public record"],
      ["wishlist", "Anything else"],
    ],
  },
];

// Optional free-text: never required, reported separately when present.
const OPTIONAL_KEYS = [
  ["employer_page_url", "Employer's own page about them"],
  ["government_employer_detail", "Government employer named"],
];

// Required single-choice questions. Consent is deliberately absent from this
// list; see the header note.
const REQUIRED_CHOICES = [
  ["license_status", "License status"],
  ["government_employee", "Employed by a government body"],
  ["review_before_publish", "Review before publishing"],
  ["attestation", "Accuracy confirmation"],
];

// The ten per-field consent questions. Order matters only for the email.
const CONSENT_KEYS = [
  ["consent_name", "Name"],
  ["consent_credentials", "Degrees and credentials"],
  ["consent_affiliation", "Employer and title"],
  ["consent_domain", "Domain of specialization"],
  ["consent_bio", "Professional biography"],
  ["consent_publications", "Selected publications"],
  ["consent_geography", "Where they practice"],
  ["consent_link", "Link to professional profile"],
  ["consent_photo", "Photograph"],
  ["consent_email", "Contact email"],
];

// Render choice slugs as the words the person actually read on the page, so
// the email never says "state_local" where the form said something in English.
const VALUE_LABELS = {
  license_status: {
    active: "Active and in good standing",
    inactive: "Inactive, or a status that does not permit practice",
    not_applicable: "Not applicable, holds no license",
  },
  government_employee: {
    no: "No",
    federal: "YES, FEDERAL",
    state_local: "YES, state, local, or a public institution",
  },
  review_before_publish: {
    review_first: "Wants to see exact wording and approve before anything is published",
    no_review_needed: "May publish within the consent given, without a further check",
  },
  attestation: {
    confirmed: "Confirmed accurate, MICRO Group may rely on it",
  },
};

function display(key, value) {
  const map = VALUE_LABELS[key];
  if (map && map[value]) return map[value];
  return value;
}

// The consent gate. Anything that is not exactly "yes" is a no. This is the
// single most important line in the file: it is what makes an unanswered row,
// a stripped field, a typo, or a hand-rolled POST all fail closed.
function consentGranted(raw) {
  return clean(raw).toLowerCase() === "yes";
}

function buildText(d) {
  const lines = [
    `Specialist panel profile: ${d.name}`,
    `Email: ${d.email}`,
    d.slug ? `Link slug: ${d.slug}` : `Link slug: (none, opened without ?p=)`,
  ];
  for (const group of FIELD_GROUPS) {
    const rows = group.keys.map(([k, l]) => [l, d.fields[k]]).filter(([, v]) => v);
    if (!rows.length) continue;
    lines.push("", group.label.toUpperCase());
    for (const [l, v] of rows) lines.push(`${l}: ${v}`);
  }
  const opt = OPTIONAL_KEYS.map(([k, l]) => [l, d.fields[k]]).filter(([, v]) => v);
  if (opt.length) {
    lines.push("", "OPTIONAL AND FOLLOW-UP");
    for (const [l, v] of opt) lines.push(`${l}: ${v}`);
  }
  lines.push("", "SINGLE-CHOICE ANSWERS");
  for (const [k, l] of REQUIRED_CHOICES) lines.push(`${l}: ${display(k, d.choices[k])}`);

  lines.push("", "PUBLICATION CONSENT (anything not an explicit yes is a no)");
  for (const [k, l] of CONSENT_KEYS) {
    lines.push(`${l}: ${d.consent[k] ? "YES, may publish" : "no"}`);
  }
  const granted = CONSENT_KEYS.filter(([k]) => d.consent[k]).length;
  lines.push(`Consent granted on ${granted} of ${CONSENT_KEYS.length} fields.`);

  lines.push("", `Attachments: ${d.fileNames.length ? d.fileNames.join(", ") : "(none)"}`);
  lines.push(`Page: ${d.pageUrl || "(none)"}`);
  lines.push(`Submitted: ${d.createdAt}`);
  return lines.join("\n");
}

function buildHtml(d) {
  const row = (label, value) => `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e3e6ec;vertical-align:top;font:600 12px/1.4 monospace;color:#33507a;white-space:nowrap">${esc(label)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e3e6ec;vertical-align:top;font:400 13px/1.5 Georgia,serif;color:#16233b;white-space:pre-wrap">${esc(value)}</td>
    </tr>`;
  const block = (title, rows) =>
    !rows.length
      ? ""
      : `<div style="font:600 11px/1 monospace;letter-spacing:.1em;color:#8a5218;text-transform:uppercase;margin:18px 0 6px">${esc(
          title
        )}</div><table style="border-collapse:collapse;width:100%">${rows.join("")}</table>`;

  const headerRows = [row("Name", d.name), row("Email", d.email), row("Link slug", d.slug || "(none)")].join("");

  const groupBlocks = FIELD_GROUPS.map((g) =>
    block(g.label, g.keys.map(([k, l]) => [l, d.fields[k]]).filter(([, v]) => v).map(([l, v]) => row(l, v)))
  ).join("");

  const optBlock = block(
    "Optional and follow-up",
    OPTIONAL_KEYS.map(([k, l]) => [l, d.fields[k]]).filter(([, v]) => v).map(([l, v]) => row(l, v))
  );

  const choiceBlock = block(
    "Single-choice answers",
    REQUIRED_CHOICES.map(([k, l]) => row(l, display(k, d.choices[k])))
  );

  // Consent is rendered with an explicit yes/no on every row, including the
  // nos, so a reader can see the whole matrix rather than inferring silence.
  const consentRows = CONSENT_KEYS.map(([k, l]) => {
    const yes = d.consent[k];
    return `<tr>
      <td style="padding:6px 12px;border-bottom:1px solid #e3e6ec;font:600 12px/1.4 monospace;color:#33507a">${esc(l)}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #e3e6ec;font:600 12px/1.4 monospace;color:${
        yes ? "#1d6b3f" : "#8a2b2b"
      }">${yes ? "YES, may publish" : "no"}</td>
    </tr>`;
  }).join("");
  const granted = CONSENT_KEYS.filter(([k]) => d.consent[k]).length;

  return `<!doctype html><html><body style="margin:0;background:#f5f6f8;padding:24px">
    <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #ccd2de;border-radius:6px;overflow:hidden">
      <div style="background:#1b3a6b;color:#fff;padding:16px 20px">
        <div style="font:600 11px/1 monospace;letter-spacing:.12em;color:#e6c35a;text-transform:uppercase;margin-bottom:6px">MICRO Group, L.L.C. &middot; Specialist Panel</div>
        <div style="font:600 18px/1.2 Georgia,serif">Panel profile from ${esc(d.name)}</div>
      </div>
      <div style="padding:16px 20px">
        <p style="font:400 12px/1.5 Georgia,serif;color:#5a6b82;margin:0 0 12px">Reply to this email to respond to them directly.</p>
        <table style="border-collapse:collapse;width:100%">${headerRows}</table>
        ${groupBlocks}
        ${optBlock}
        ${choiceBlock}
        <div style="font:600 11px/1 monospace;letter-spacing:.1em;color:#8a5218;text-transform:uppercase;margin:18px 0 6px">Publication consent, ${granted} of ${CONSENT_KEYS.length} granted</div>
        <p style="font:400 12px/1.5 Georgia,serif;color:#5a6b82;margin:0 0 8px">Anything not an explicit yes is recorded as a no. Do not publish a field showing "no".</p>
        <table style="border-collapse:collapse;width:100%">${consentRows}</table>
        <div style="font:600 11px/1 monospace;letter-spacing:.1em;color:#8a5218;text-transform:uppercase;margin:18px 0 6px">Submission</div>
        <table style="border-collapse:collapse;width:100%">${row(
          "Attachments",
          d.fileNames.length ? d.fileNames.join(", ") : "(none)"
        )}${row("Page", d.pageUrl || "(none)")}${row("Submitted", d.createdAt)}</table>
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
  const email = clean(form.get("email")).toLowerCase();
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!name) {
    return json({ error: "Please enter your full legal name." }, 400);
  }
  if (!emailRe.test(email)) {
    return json({ error: "Please enter a valid email." }, 400);
  }

  const fields = {};
  for (const group of FIELD_GROUPS) {
    for (const [key] of group.keys) fields[key] = clean(form.get(key));
  }
  for (const [key] of OPTIONAL_KEYS) fields[key] = clean(form.get(key));

  // Every question above is required. The page enforces this too, but a
  // submission bypassing its JS must not silently produce a profile with
  // blank sections. "None" is an accepted answer, an empty string is not.
  for (const group of FIELD_GROUPS) {
    for (const [key, label] of group.keys) {
      if (!fields[key]) {
        return json({ error: `Please fill in "${label}" (write None if it doesn't apply).` }, 400);
      }
    }
  }

  const choices = {};
  for (const [key, label] of REQUIRED_CHOICES) {
    choices[key] = clean(form.get(key));
    if (!choices[key]) {
      return json({ error: `Please choose an answer for "${label}".` }, 400);
    }
  }

  // Conditional: naming the employer is required only when the answer says
  // there is one, mirroring the page.
  const gov = choices.government_employee;
  if ((gov === "federal" || gov === "state_local") && !fields.government_employer_detail) {
    return json({ error: "Please name the agency or body that employs you." }, 400);
  }

  // Consent, fail-closed. Not validated for presence, only interpreted.
  const consent = {};
  for (const [key] of CONSENT_KEYS) consent[key] = consentGranted(form.get(key));

  const slug = clean(form.get("panel_slug"));
  const pageUrl = clean(form.get("page_url"));

  const files = form
    .getAll("files")
    .filter((f) => f && typeof f === "object" && "size" in f && "name" in f && f.size > 0);

  for (const f of files) {
    if (!hasAllowedExtension(f.name)) {
      return json({ error: `Unsupported file type: ${f.name} (allowed: .pdf, .doc, .docx)` }, 400);
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

  const to = env.PANEL_TO || DEFAULT_TO;
  const from = env.PANEL_FROM || DEFAULT_FROM;

  // Flag the two answers that change what MICRO Group may do, so they are
  // visible in the inbox list without opening the mail.
  const flags = [];
  if (gov === "federal") flags.push("FEDERAL EMPLOYEE");
  if (choices.license_status === "inactive") flags.push("LICENSE INACTIVE");
  const subject =
    `Panel profile: ${name}` + (flags.length ? ` [${flags.join(", ")}]` : "");

  const d = { name, email, slug, fields, choices, consent, fileNames, pageUrl, createdAt };

  const payload = {
    from,
    to: [to],
    reply_to: email,
    subject,
    text: buildText(d),
    html: buildHtml(d),
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
