// POST /api/specialist-questionnaire
// Receives the specialist panel profile intake (specialist-questionnaire.html).
//
// Converted 2026-08-22 to the D1-primary-plus-minimal-notification pattern
// (resend-pages-function SKILL.md, "Structured submissions" section; reference
// implementation: Client Website Hub System Ultra Plan, Section 6). The full
// submission (all fields, all nine publication-consent answers) now writes
// ONE row to the specialist_submissions table on the microgroup-info Pages
// project's existing D1 binding (env.DB). The old behavior, emailing the
// complete submission content to jdavis92105@gmail.com, is retired: the
// notification email below carries no field content, only a submission id
// and a pointer to where the record lives.
//
// FILE UPLOADS, A DEVIATION FROM THE REFERENCE PATTERN, LOGGED HERE ON
// PURPOSE: the reference pattern (Section 6, item 3) assumes uploads already
// go to Google Drive via "the existing per-form service account." No such
// integration exists for this form; it never has. Building one is out of
// this conversion's scope (same reasoning the pattern applies to Access-app
// machinery: do not invent new infrastructure mid-conversion). Three options
// were weighed: (a) drop the file bytes entirely, keeping only metadata in
// D1 -- rejected, a specialist's CV/credentials are the primary artifact of
// a panel intake, not disposable; (b) inline base64 file bytes into the D1
// payload row -- rejected, the handler's own 25 MB cap is well past any
// sane D1 row-size budget, so the failure would only surface on a large
// submission; (c) keep the D1 row primary and carrying file METADATA
// (file_meta column: label, filename, size, type), and ride the actual
// bytes on a SECOND, separate Resend email that names only the submission
// id and file count, no field content. Chosen: (c). This keeps the D1 row
// as the durable, complete-enough record, keeps the pattern's "notification
// carries no content" promise for the notification email specifically, and
// loses nothing, at the acknowledged cost that an uploaded CV (which
// necessarily carries the candidate's name) still transits email once, down
// from every field of the entire profile transiting email today. Report
// this tradeoff plainly if asked; do not let a "no content in email" claim
// stand unqualified when a file-carrying submission arrives.
//
// REVIEW PAGE, NOT BUILT: this form is covered by an existing Cloudflare
// Access application scoped to microgroup.info/specialist-questionnaire*,
// whose policy also allows the twelve named specialist candidates
// themselves (queried live from the Access API 2026-08-22, id
// 26d9dff6-bd8d-496a-8e5c-248c8501528d), not just the owner. A review page
// living under that same path prefix would let every candidate read every
// other candidate's submission. Microgroup.info also has no jonathanlindavis.
// com-style /private* wildcard owner-only gate (_redirects says so
// explicitly: "No private-index.html exists on this domain by design").
// Per the conversion brief, this is reported rather than solved by
// inventing new Access-app machinery. The notification below therefore
// points at the D1 table by name, not at a URL that does not exist yet.
//
// Config (Cloudflare Pages -> Settings -> Variables and Secrets):
//   RESEND_KEY   (required for the notification email; best-effort, see
//                below -- a missing key skips the email, never the D1
//                write). NOTE: this repo uses RESEND_KEY, the sibling
//                Jonathanlindavis.com repo uses RESEND_API_KEY.
//   DB           D1 binding (database id b5f78ff6-e3a7-4913-aa41-fc5d99b79998,
//                the same database contact.js already uses). MUST also be
//                bound on the Pages project's PREVIEW environment, not just
//                production, for this handler to work on a preview branch;
//                confirmed missing there as of 2026-08-22 and requires an
//                owner action via the Cloudflare dashboard (Pages project ->
//                Settings -> Functions -> D1 database bindings -> Preview),
//                since this session's account-mutation permission classifier
//                blocked doing it via the API.
//
// The PANEL_TO/PANEL_FROM env override channel is RETIRED, not just
// unused: with no submission content in either outbound email, there is
// nothing left for a per-deploy recipient override to reroute. DEFAULT_TO
// stays the single hand-written literal recipient below, matching the
// locked-recipient convention (never a config or generator parameter).

const DEFAULT_TO = "jdavis92105@gmail.com";
const DEFAULT_FROM = "MICRO Group, L.L.C. Specialist Panel <onboarding@resend.dev>";

// Uploads still arrive under four separate keys, so file_meta and the
// attachment-carrier email can both say which upload is a CV vs. a
// photograph instead of leaving the reader to infer it from a filename.
const DOC_EXT = [".pdf", ".doc", ".docx", ".rtf", ".odt", ".txt"];
const IMG_EXT = [".jpg", ".jpeg", ".png", ".webp", ".heic"];
const FILE_FIELDS = [
  { key: "file_cv", label: "CV or resume", allow: DOC_EXT },
  { key: "file_bio", label: "Written biography", allow: DOC_EXT },
  { key: "file_photo", label: "Photograph", allow: IMG_EXT },
  { key: "file_other", label: "Other", allow: DOC_EXT.concat(IMG_EXT, [".csv", ".xlsx"]) },
];
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

function hasAllowedExtension(filename, allow) {
  const name = String(filename || "").toLowerCase();
  return allow.some((ext) => name.endsWith(ext));
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

// client_ip_hash: hash, never store, the raw requester IP, so the D1 row
// (indefinitely retained, per the reference plan's Open Decision 7) isn't
// itself a plaintext IP log.
async function hashClientIp(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "";
  if (!ip) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Required questions, in page order. Drives required-field enforcement and
// the D1 payload from one array, so a new question is one line here plus
// one line on the page.
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

// Optional free-text: never required.
const OPTIONAL_KEYS = [
  ["employer_page_url", "Employer's own page about them"],
  ["government_employer_detail", "Government employer named"],
];

// Exhibit B (Key Personnel Consent and Letter of Commitment). Optional;
// most submissions are the standing profile with no specific Opportunity
// yet.
const OPPORTUNITY_KEYS = [
  ["opportunity_title", "Opportunity, title and issuer"],
  ["submission_deadline", "Submission deadline"],
  ["project_period", "Anticipated project period"],
  ["anticipated_role", "Anticipated role"],
  ["anticipated_effort", "Anticipated level of effort"],
  ["opportunity_conflicts", "Conflicts to disclose for this Opportunity"],
];

// Required single-choice questions. Consent is deliberately absent; see
// the CONSENT_KEYS note below.
const REQUIRED_CHOICES = [
  ["license_status", "License status"],
  ["government_employee", "Employed by a government body"],
  ["review_before_publish", "Review before publishing"],
  ["attestation", "Accuracy confirmation"],
];

// The per-field consent questions. Order matters only for rendering.
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
];

// Value-slug to plain-English label map, kept for whichever review surface
// eventually reads the payload JSON back out.
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

// The consent gate. Anything that is not exactly "yes" is a no. Unchanged
// from the pre-conversion handler: it is what makes an unanswered row, a
// stripped field, a typo, or a hand-rolled POST all fail closed.
function consentGranted(raw) {
  return clean(raw).toLowerCase() === "yes";
}

// --- Retained, UNUSED, pending removal in a follow-up commit -------------
// buildText/buildHtml composed the full-content report email the old path
// sent. Kept here rather than deleted so the old code path is not lost
// before the new D1 path is verified working on a preview deploy and
// reviewed, per the conversion's own scope boundary. Delete both, and this
// whole comment block, once that review lands.
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
  const oppRows = OPPORTUNITY_KEYS.map(([k, l]) => [l, d.fields[k]]).filter(([, v]) => v);
  if (oppRows.length || d.keyPersonnelConsent) {
    lines.push("", "EXHIBIT B: THIS SPECIFIC OPPORTUNITY");
    for (const [l, v] of oppRows) lines.push(`${l}: ${v}`);
    lines.push(
      `Consent to be named as key personnel: ${
        d.keyPersonnelConsent === "yes" ? "YES" : d.keyPersonnelConsent === "no" ? "No" : "(not answered)"
      }`
    );
  }
  lines.push("", "SINGLE-CHOICE ANSWERS");
  for (const [k, l] of REQUIRED_CHOICES) lines.push(`${l}: ${d.choices[k] === undefined ? "" : d.choices[k]}`);
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
  return `<!doctype html><html><body>${esc(JSON.stringify(d))}</body></html>`;
}
// --- end retained-unused block --------------------------------------------

// The notification email. Deliberately carries no field content: only a
// submission id, a timestamp, and a pointer to where the real record lives.
function buildNotificationText(id, createdAt) {
  return [
    "New submission from the MICRO Group, L.L.C. Specialist Panel.",
    "",
    `Submission #${id}, ${createdAt}.`,
    "This notification carries no submission content.",
    "",
    "Review: the specialist_submissions table, Microgroup.info D1 database.",
    "A dedicated owner-gated review page does not exist yet (see the",
    "2026-08-22 conversion log for why: this form's own Access wildcard",
    "also covers the invited specialist candidates, so a review page cannot",
    "safely live under that same path prefix without further Access-app work).",
  ].join("\n");
}

function buildNotificationHtml(id, createdAt) {
  return `<!doctype html><html><body style="margin:0;background:#f5f6f8;padding:24px;font-family:Georgia,serif">
    <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #ccd2de;border-radius:6px;overflow:hidden">
      <div style="background:#1b3a6b;color:#fff;padding:16px 20px">
        <div style="font:600 11px/1 monospace;letter-spacing:.12em;color:#e6c35a;text-transform:uppercase;margin-bottom:6px">MICRO Group, L.L.C. &middot; Specialist Panel</div>
        <div style="font:600 16px/1.2 Georgia,serif">New submission received</div>
      </div>
      <div style="padding:16px 20px;font-size:13px;color:#16233b;line-height:1.6">
        <p style="margin:0 0 10px">Submission #${esc(id)}, ${esc(createdAt)}.</p>
        <p style="margin:0 0 10px">This notification carries no submission content.</p>
        <p style="margin:0">Review the <code>specialist_submissions</code> table, Microgroup.info D1 database. A dedicated owner-gated review page does not exist yet.</p>
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

  // Honeypot: bots fill the hidden "website" field. Accept silently, write
  // nothing to D1, send nothing. Unchanged, and still the first thing this
  // handler does, before any D1 access.
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
  for (const [key] of OPPORTUNITY_KEYS) fields[key] = clean(form.get(key));
  const keyPersonnelConsent = clean(form.get("key_personnel_consent"));

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

  // Collect per field, validating each against its own allow-list and
  // keeping the field label attached so file_meta and the attachment email
  // can group them.
  const collected = [];
  for (const spec of FILE_FIELDS) {
    const got = form
      .getAll(spec.key)
      .filter((f) => f && typeof f === "object" && "size" in f && "name" in f && f.size > 0);
    for (const f of got) {
      if (!hasAllowedExtension(f.name, spec.allow)) {
        return json(
          {
            error: `Unsupported file type in "${spec.label}": ${f.name} (allowed there: ${spec.allow.join(", ")})`,
          },
          400
        );
      }
      collected.push({ file: f, label: spec.label });
    }
  }
  const files = collected.map((c) => c.file);

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    return json({ error: "Attachments exceed the 25 MB total size limit." }, 413);
  }

  const createdAt = new Date().toISOString();
  const clientIpHash = await hashClientIp(request);

  // D1 is the primary store. The full submission (fields, choices,
  // consent matrix, Exhibit B) lands in the payload JSON column; nothing
  // here is emailed in full any more.
  const payload = { name, email, slug, pageUrl, createdAt, fields, choices, consent, keyPersonnelConsent };
  const fileMeta = collected.map((c) => ({
    label: c.label,
    filename: c.file.name,
    size: c.file.size,
    type: c.file.type || null,
  }));

  if (!env.DB) {
    return json({ error: "Storage is not configured yet." }, 500);
  }

  let submissionId;
  try {
    const result = await env.DB.prepare(
      `INSERT INTO specialist_submissions
        (submitted_at, payload, file_meta, client_ip_hash, honeypot_ok)
       VALUES (?, ?, ?, ?, 1)`
    )
      .bind(createdAt, JSON.stringify(payload), fileMeta.length ? JSON.stringify(fileMeta) : null, clientIpHash)
      .run();
    submissionId = result.meta && result.meta.last_row_id;
  } catch {
    return json({ error: "Something went wrong saving your submission. Please try again." }, 500);
  }

  // Notification email: best-effort. The row is already saved; a mail
  // hiccup must never fail the visitor's submission (matches contact.js's
  // established best-effort convention in this repo).
  const to = DEFAULT_TO;
  const from = DEFAULT_FROM;
  if (env.RESEND_KEY) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + env.RESEND_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [to],
          subject: `New submission from Specialist Panel #${submissionId}`,
          text: buildNotificationText(submissionId, createdAt),
          html: buildNotificationHtml(submissionId, createdAt),
        }),
      });
    } catch {
      // Intentionally ignored. The row is already saved.
    }

    // Attachment-carrier email, best-effort, sent only when files were
    // uploaded. Carries the actual bytes (there is no Drive integration
    // for this form to hold them instead, see the header comment) but no
    // field content: no name, no answers, only the submission id and file
    // count in the subject/body, matching the same "no content" discipline
    // as the notification above as closely as an actual file payload allows.
    if (collected.length) {
      try {
        const attachments = [];
        for (const c of collected) {
          const buf = await c.file.arrayBuffer();
          attachments.push({ filename: c.file.name, content: arrayBufferToBase64(buf) });
        }
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + env.RESEND_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from,
            to: [to],
            subject: `Specialist Panel attachment(s) for submission #${submissionId}`,
            text: `${collected.length} file(s) uploaded with specialist panel submission #${submissionId}. No field content in this email; see the D1 record for the applicant's profile.`,
            attachments,
          }),
        });
      } catch {
        // Intentionally ignored. file_meta in the D1 row still records
        // what was uploaded even if the bytes failed to send.
      }
    }
  }

  return json({ ok: true });
}

// Anything other than POST
export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return json({ error: "method not allowed" }, 405);
}
