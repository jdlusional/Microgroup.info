// POST /api/clowndog-questionnaire
// Receives the Clown Dog business questionnaire (clown-dog-questionnaire.html)
// and (1) emails a readable report to the site owner via Resend, forwarding
// any uploaded files (product photos, inventory sheets) as email
// attachments, and (2) best-effort uploads those same files directly into a
// Google Drive folder via a Google Cloud service account. Email is the
// reliable path (files ride along as attachments regardless); Drive upload
// is an additive convenience on top and never blocks the email send.
//
// This page is public and unauthenticated (same posture as survey.js), so
// the submitter's own email is used for reply_to directly, after format
// validation.
//
// ---------------------------------------------------------------------------
// GOOGLE DRIVE UPLOAD SETUP (one-time, human, in Google Cloud Console) --
// Drive upload is inert until these three steps are done. Until then the
// function still works fully: it validates, emails the report, and attaches
// files to that email, and the JSON response simply reports
// driveUpload: "skipped, credentials not configured".
//
//   1. Create a Google Cloud project (or reuse one) and enable the
//      "Google Drive API" for it (APIs & Services -> Enable APIs and
//      Services -> search "Google Drive API" -> Enable).
//
//   2. Create a service account inside that project (IAM & Admin -> Service
//      Accounts -> Create Service Account). Open the new service account ->
//      Keys tab -> Add Key -> Create new key -> JSON, and download it. The
//      JSON contains "client_email" and "private_key" -- those become the
//      two Cloudflare secrets below.
//
//   3. In Google Drive, open (or create) the destination folder, click
//      Share, and share it with the service account's "client_email"
//      address with Editor access (a service account is not a human user;
//      it only sees folders explicitly shared with it). The folder's ID is
//      the segment after /folders/ in its URL
//      (https://drive.google.com/drive/folders/<FOLDER_ID>).
//
//   Then set, in Cloudflare Pages -> Settings -> Environment Variables
//   (Production and Preview) as encrypted secrets:
//     GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL        the JSON key's client_email
//     GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY  the JSON key's private_key
//                                                (paste as-is; literal "\n"
//                                                sequences are un-escaped in
//                                                code below)
//     GOOGLE_DRIVE_CLOWNDOG_FOLDER_ID           the folder ID from step 3
//
//   Troubleshooting: if driveUpload comes back "failed: ... File not
//   found: <folderId>" even though the folder is confirmed shared with the
//   service account as Editor, that's the drive.file-scope-vs-UI-share
//   mismatch (see the DRIVE_SCOPE constant below) -- switch that constant
//   to the full https://www.googleapis.com/auth/drive scope and redeploy.
// ---------------------------------------------------------------------------
//
// Config (Cloudflare Pages -> Settings -> Variables and Secrets):
//   RESEND_KEY               (required, encrypted) same secret already used
//                             by survey.js / contact.js / draft-request.js
//   CLOWNDOG_SURVEY_TO        (optional) recipient inbox; default below
//   CLOWNDOG_SURVEY_FROM      (optional) verified sender; default below
//   GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL         (optional; see setup above)
//   GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY   (optional; see setup above)
//   GOOGLE_DRIVE_CLOWNDOG_FOLDER_ID            (optional; see setup above)

const DEFAULT_TO = "jdavis92105@gmail.com";
const DEFAULT_FROM = "Clown Dog Questionnaire <onboarding@resend.dev>";

const ALLOWED_EXTENSIONS = [
  ".pdf", ".doc", ".docx", ".csv", ".xlsx",
  ".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp", ".gif",
];
// Per-file and total limits both 25 MB: the page's own hint text and its
// client-side check only ever mention a 25 MB *total* (no per-file cap), so
// the per-file limit here exists only as a sanity backstop and must not be
// tighter than what the page tells the user is allowed.
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024; // 25 MB total, matches survey.js and the page's own check
// Note on the 25 MB ceiling: base64-encoding for the Resend JSON payload
// inflates size by roughly a third (25 MB -> ~33 MB in-body), and each file
// is buffered twice (once for the Drive multipart upload, once for the
// email attachment). A max-size submission is closer to Workers/Resend
// limits than the raw 25 MB number suggests; inherited unchanged from
// survey.js per house convention, not a defect introduced here.

// Drive API OAuth scope for the service account. Deliberately the narrow
// https://www.googleapis.com/auth/drive.file scope per spec (rather than
// the full drive scope) -- but drive.file is per-file access limited to
// files/folders the app itself created or opened, and a folder shared
// through Drive's UI Share dialog is not always visible under drive.file
// even with Editor access confirmed. If Drive uploads fail with something
// like "File not found: <folderId>" while the folder is definitely shared
// with the service account as Editor, that mismatch is almost certainly
// why -- change DRIVE_SCOPE below to "https://www.googleapis.com/auth/drive"
// and redeploy. Kept as a named constant specifically so that's a one-line
// fix rather than a hunt through the JWT-building code.
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

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

// Required questions (11 total), field-name-verified 2026-08-05 against the
// sibling HTML build at clown-dog-questionnaire.html (form id
// "survey-form"). If that page's field `name` attributes are ever renamed,
// realigning is a one-line edit to the `key` half of each pair below --
// nothing else in this file needs to change.
const FIELD_GROUPS = [
  {
    label: "Domain and access",
    keys: [
      ["registrar_access", "Domain registrar/DNS access"],
      ["domain_future", "Plans for the domain going forward"],
      ["admin_access", "Current site admin access"],
    ],
  },
  {
    label: "Homepage marketing claims",
    keys: [
      ["homepage_claims_decision", "What to do with the homepage claims"],
      ["homepage_claims_context", "Context on the homepage claims"],
    ],
  },
  {
    label: "Shipping and point of sale",
    keys: [
      ["shipping_pickup", "Shipping vs. pickup"],
      ["pos_system", "Point-of-sale system"],
    ],
  },
  {
    label: "Photography",
    keys: [
      ["photography", "New photo shoot"],
      ["photography_notes", "Scheduling availability or notes"],
    ],
  },
  {
    label: "Inventory",
    keys: [["inventory_notes", "Current inventory to feature"]],
  },
  {
    label: "Other",
    keys: [["wishlist", "Anything else"]],
  },
];

// Optional / conditional fields. restocking_fee_pct is explicitly optional
// on the page (the scope box says so, and its <input> carries no
// `required`). registrar_access_other and pos_system_other are only shown
// and required client-side when their triggering radio value is selected
// (registrar_access === "know_who_has_it", pos_system === "other") --
// enforced server-side in the conditional check below, but never added to
// the blanket FIELD_GROUPS required loop since an untriggered submission
// legitimately leaves them blank.
const CONDITIONAL_KEYS = [
  ["restocking_fee_pct", "Restocking fee (%)"],
  ["registrar_access_other", "Who currently has registrar/DNS access"],
  ["pos_system_other", "Other point-of-sale system"],
];

// [radio field key, trigger value that requires the follow-up, follow-up
// key, follow-up human label]. Mirrors the page's own client-side
// conditional-required checks (see wireConditional / the two `if
// (radioValue(...) === ...)` blocks in clown-dog-questionnaire.html) so a
// submission that bypasses the page's JS still can't skip a required
// follow-up.
const CONDITIONAL_REQUIRED = [
  ["registrar_access", "know_who_has_it", "registrar_access_other", "who has the registrar/DNS login"],
  ["pos_system", "other", "pos_system_other", "your point-of-sale system"],
];

// Radio-group answers arrive as machine slugs ("know_who_has_it"), not the
// text the submitter actually read and clicked. Option text below is
// copied verbatim from the <span> inside each .radio-option in
// clown-dog-questionnaire.html so the emailed report reads the same words
// the page showed, not a slug the recipient has to decode. Any value not
// found here (a renamed option, a mismatch) falls back to the raw value
// via display() rather than going blank.
const VALUE_LABELS = {
  registrar_access: {
    have_login: "I have the login",
    know_who_has_it: "I don't have it, but know who does",
    not_sure: "Not sure who has it",
  },
  domain_future: {
    redirect: "Redirect the old site to the new one",
    keep_both: "Keep both live separately",
    let_lapse: "Let the old domain lapse",
    not_sure: "Not sure yet, let's discuss",
  },
  admin_access: {
    yes: "Yes, I can log into the current site's backend",
    no: "No, I don't have that login",
    not_sure: "Not sure",
  },
  homepage_claims_decision: {
    keep_as_is: "Keep these claims as-is for now",
    replace_now: "Replace them now with a different angle",
    verify_first: "I want to verify them before deciding",
  },
  shipping_pickup: {
    pickup_only: "Pickup only",
    also_ship: "We also ship",
    case_by_case: "Sometimes, case by case",
  },
  pos_system: {
    lightspeed: "Lightspeed Retail",
    square: "Square",
    other: "Something else",
    none: "No POS system",
  },
  photography: {
    yes_schedule: "Yes, let's schedule a new photo shoot",
    not_now: "Not right now",
    need_info: "Need more information first",
  },
};

function display(key, value) {
  return (VALUE_LABELS[key] && VALUE_LABELS[key][value]) || value;
}

function buildText({ name, email, fields, fileNames, pageUrl, createdAt, driveNote }) {
  const lines = [`Contact: ${name}`, `Email: ${email}`];
  for (const group of FIELD_GROUPS) {
    const rows = group.keys
      .map(([key, label]) => [label, display(key, fields[key])])
      .filter(([, v]) => v);
    if (!rows.length) continue;
    lines.push("", group.label.toUpperCase());
    for (const [label, value] of rows) lines.push(`${label}: ${value}`);
  }
  const conditionalRows = CONDITIONAL_KEYS.map(([key, label]) => [label, display(key, fields[key])]).filter(
    ([, v]) => v
  );
  if (conditionalRows.length) {
    lines.push("", "OPTIONAL AND FOLLOW-UP DETAILS");
    for (const [label, value] of conditionalRows) lines.push(`${label}: ${value}`);
  }
  lines.push("", `Attachments: ${fileNames.length ? fileNames.join(", ") : "(none)"}`);
  lines.push(`Drive upload: ${driveNote || "(not attempted)"}`);
  lines.push(`Page: ${pageUrl || "(none)"}`);
  lines.push(`Submitted: ${createdAt}`);
  return lines.join("\n");
}

function buildHtml({ name, email, fields, fileNames, pageUrl, createdAt, driveNote }) {
  const row = (label, value) => `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e3e6ec;vertical-align:top;font:600 12px/1.4 monospace;color:#33507a;white-space:nowrap">${esc(label)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e3e6ec;vertical-align:top;font:400 13px/1.5 Georgia,serif;color:#16233b;white-space:pre-wrap">${esc(value)}</td>
    </tr>`;
  const headerRows = [row("Contact", name), row("Email", email)].join("");
  const groupBlocks = FIELD_GROUPS.map((group) => {
    const rows = group.keys
      .map(([key, label]) => [label, display(key, fields[key])])
      .filter(([, v]) => v);
    if (!rows.length) return "";
    return `<div style="font:600 11px/1 monospace;letter-spacing:.1em;color:#8a5218;text-transform:uppercase;margin:18px 0 6px">${esc(
      group.label
    )}</div><table style="border-collapse:collapse;width:100%">${rows
      .map(([label, value]) => row(label, value))
      .join("")}</table>`;
  }).join("");
  const conditionalRows = CONDITIONAL_KEYS.map(([key, label]) => [label, display(key, fields[key])]).filter(
    ([, v]) => v
  );
  const conditionalBlock = conditionalRows.length
    ? `<div style="font:600 11px/1 monospace;letter-spacing:.1em;color:#8a5218;text-transform:uppercase;margin:18px 0 6px">Optional and follow-up details</div><table style="border-collapse:collapse;width:100%">${conditionalRows
        .map(([label, value]) => row(label, value))
        .join("")}</table>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f5f6f8;padding:24px">
    <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #ccd2de;border-radius:6px;overflow:hidden">
      <div style="background:#1b3a6b;color:#fff;padding:16px 20px">
        <div style="font:600 11px/1 monospace;letter-spacing:.12em;color:#e6c35a;text-transform:uppercase;margin-bottom:6px">MICRO Group &middot; Clown Dog Questionnaire</div>
        <div style="font:600 18px/1.2 Georgia,serif">New questionnaire response</div>
      </div>
      <div style="padding:16px 20px">
        <p style="font:400 12px/1.5 Georgia,serif;color:#5a6b82;margin:0 0 12px">Reply to this email to respond to the submitter directly.</p>
        <table style="border-collapse:collapse;width:100%">${headerRows}</table>
        ${groupBlocks}
        ${conditionalBlock}
        <div style="font:600 11px/1 monospace;letter-spacing:.1em;color:#8a5218;text-transform:uppercase;margin:18px 0 6px">Submission</div>
        <table style="border-collapse:collapse;width:100%">${row(
          "Attachments",
          fileNames.length ? fileNames.join(", ") : "(none)"
        )}${row("Drive upload", driveNote || "(not attempted)")}${row(
    "Page",
    pageUrl || "(none)"
  )}${row("Submitted", createdAt)}</table>
      </div>
    </div>
  </body></html>`;
}

// ---------------------------------------------------------------------------
// Google Drive service-account upload (best-effort, additive on top of the
// Resend email attachments; see the setup comment block at the top of this
// file). Everything here is hand-rolled against Fetch + Web Crypto since
// Cloudflare Pages Functions have no npm dependency install step.
// ---------------------------------------------------------------------------

function base64UrlFromBytes(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlFromString(str) {
  return base64UrlFromBytes(new TextEncoder().encode(str));
}

function pemToArrayBuffer(pem) {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function getDriveAccessToken(env) {
  const clientEmail = env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL;
  const privateKeyPem = String(env.GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY || "").replace(
    /\\n/g,
    "\n"
  );

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: clientEmail,
    scope: DRIVE_SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    iat: nowSec,
    exp: nowSec + 3600,
  };
  const signingInput =
    base64UrlFromString(JSON.stringify(header)) + "." + base64UrlFromString(JSON.stringify(claims));
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput)
  );
  const jwt = signingInput + "." + base64UrlFromBytes(new Uint8Array(signature));

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!tokenRes.ok) {
    const detail = await tokenRes.text().catch(() => "");
    throw new Error("Drive token exchange failed: " + detail.slice(0, 300));
  }
  const tokenJson = await tokenRes.json();
  if (!tokenJson.access_token) throw new Error("Drive token exchange returned no access_token");
  return tokenJson.access_token;
}

async function uploadFileToDrive(accessToken, folderId, file, buf) {
  const boundary = "clowndog-drive-" + crypto.randomUUID();
  const metadata = { name: file.name, parents: [folderId] };
  const bytes = new Uint8Array(buf);

  const encoder = new TextEncoder();
  const preamble = encoder.encode(
    `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${file.type || "application/octet-stream"}\r\n\r\n`
  );
  const closing = encoder.encode(`\r\n--${boundary}--`);

  const body = new Uint8Array(preamble.length + bytes.length + closing.length);
  body.set(preamble, 0);
  body.set(bytes, preamble.length);
  body.set(closing, preamble.length + bytes.length);

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + accessToken,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
      signal: AbortSignal.timeout(20000),
    }
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Drive upload failed for ${file.name}: ${detail.slice(0, 300)}`);
  }
  return res.json();
}

// Uploads all files to the configured Drive folder. Returns a short status
// string for the email/response, and never throws -- callers get a graceful
// note either way ("skipped, credentials not configured" or an error
// summary), because Drive upload is best-effort on top of the email, which
// already carries the files as attachments.
async function tryDriveUpload(env, files) {
  const {
    GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY,
    GOOGLE_DRIVE_CLOWNDOG_FOLDER_ID,
  } = env;

  if (
    !GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL ||
    !GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY ||
    !GOOGLE_DRIVE_CLOWNDOG_FOLDER_ID
  ) {
    return "skipped, credentials not configured";
  }

  if (!files.length) return "skipped, no files submitted";

  try {
    const accessToken = await getDriveAccessToken(env);
    const uploaded = [];
    const failed = [];
    for (const f of files) {
      try {
        const buf = await f.arrayBuffer();
        await uploadFileToDrive(accessToken, GOOGLE_DRIVE_CLOWNDOG_FOLDER_ID, f, buf);
        uploaded.push(f.name);
      } catch (e) {
        failed.push(f.name);
      }
    }
    if (failed.length) {
      return `${uploaded.length} of ${files.length} uploaded (failed: ${failed.join(", ")})`;
    }
    return `${uploaded.length} of ${files.length} uploaded to Drive`;
  } catch (e) {
    return "failed: " + (e && e.message ? e.message : "unknown error");
  }
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
    return json({ error: "Please enter your name." }, 400);
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
  for (const [key] of CONDITIONAL_KEYS) {
    fields[key] = clean(form.get(key));
  }
  const pageUrl = clean(form.get("page_url"));

  // Every core question is required (house convention, mirrors survey.js);
  // the frontend already enforces this, but a submission bypassing the
  // page's own JS must not silently produce a blank-section response.
  // "N/A" is an accepted answer, an empty string is not. Conditional
  // follow-up fields (CONDITIONAL_KEYS) are intentionally excluded from
  // this loop -- see the comment where they're declared.
  for (const group of FIELD_GROUPS) {
    for (const [key, label] of group.keys) {
      if (!fields[key]) {
        return json({ error: `Please fill in "${label}" (write N/A if it doesn't apply).` }, 400);
      }
    }
  }

  // Conditional-required follow-ups: only enforced when their triggering
  // radio value was actually selected (see CONDITIONAL_REQUIRED above).
  for (const [radioKey, triggerValue, followUpKey, followUpLabel] of CONDITIONAL_REQUIRED) {
    if (fields[radioKey] === triggerValue && !fields[followUpKey]) {
      return json({ error: `Please tell us ${followUpLabel}.` }, 400);
    }
  }

  const files = form
    .getAll("files")
    .filter((f) => f && typeof f === "object" && "size" in f && "name" in f && f.size > 0);

  for (const f of files) {
    if (!hasAllowedExtension(f.name)) {
      return json(
        {
          error: `Unsupported file type: ${f.name} (allowed: .pdf, .doc, .docx, .csv, .xlsx, .jpg, .jpeg, .png, .heic, .heif, .webp, .gif)`,
        },
        400
      );
    }
    if (f.size > MAX_FILE_BYTES) {
      return json({ error: `${f.name} exceeds the 10 MB per-file size limit.` }, 413);
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

  // Best-effort Drive upload happens first (its own try/catch, never
  // throws) so its status note can ride along in the email report; the
  // email send below is unaffected by whatever this returns.
  const driveNote = await tryDriveUpload(env, files);

  const attachments = [];
  for (const f of files) {
    const buf = await f.arrayBuffer();
    attachments.push({ filename: f.name, content: arrayBufferToBase64(buf) });
  }
  const fileNames = files.map((f) => f.name);

  const to = env.CLOWNDOG_SURVEY_TO || DEFAULT_TO;
  const from = env.CLOWNDOG_SURVEY_FROM || DEFAULT_FROM;
  const subject = `Clown Dog questionnaire: ${name}`;

  const emailFields = { name, email, fields, fileNames, pageUrl, createdAt, driveNote };

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

  return json({ ok: true, driveUpload: driveNote });
}

// Anything other than POST
export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return json({ error: "method not allowed" }, 405);
}
