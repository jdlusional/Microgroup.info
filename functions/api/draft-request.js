// POST /api/draft-request
// Receives a Scribe draft request (multipart form, optionally with uploaded
// RFP/guideline files), RECORDS IT in the scribe_requests D1 table, and then
// emails a copy to the site owner via Resend with any uploaded files attached.
//
// REDESIGNED 2026-08-31 for Enterprise Suite Phase 1 Section 5, "Scribe: structural intake, no
// displayed grant identity", ratified 2026-08-18 and scheduled as its own bounded build.
//
// WHAT CHANGED AND WHY. This endpoint used to REQUIRE grant_name and grant_id, which encoded the
// assumption that the organization picked a named opportunity off a displayed shortlist. Section 5
// is explicit that Scribe displays no live opportunity data at all, so the request now arrives as
// STRUCTURE: the categories and criteria an organization can describe without naming a specific
// opportunity (focus area, opportunity type, award-size band, deadline window). The four legacy
// fields are still accepted so an older cached page cannot start failing mid-session, but none of
// them is required and no grant_id is resolved from a list that was never shown.
//
// IT ALSO USED TO PERSIST NOTHING. Section 2.7's own words: "the live endpoint sends an email via
// Resend and persists nothing." A submitted request existed only in an inbox, so there was nothing
// for the owner's later manual draft upload to attach back onto. Every request is now a row in
// scribe_requests carrying a stable status, and the row is written BEFORE the email, matching the
// established convention in this repo's specialist-questionnaire.js and contact.js: a mail hiccup
// must never cost the visitor their submission.
//
// Config (Cloudflare Pages -> Settings -> Variables and Secrets):
//   RESEND_KEY       (required, encrypted)  - your Resend API key
//   DRAFT_REQUEST_TO     (optional)             - recipient inbox; default below
//   DRAFT_REQUEST_FROM   (optional)             - verified sender; default below
//   env.DB           (required binding)         - the microgroup D1 database, table scribe_requests
//                                                 (schema-scribe-requests.sql at the repo root)

const DEFAULT_TO = "jdavis92105@gmail.com";
const DEFAULT_FROM = "MEASURE Grant Drafter <notifications@microgroup.info>";

const ALLOWED_EXTENSIONS = [".pdf", ".doc", ".docx"];
const MAX_TOTAL_BYTES = 25 * 1024 * 1024; // 25 MB

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

function buildText({
  requestId, org, focusArea, opportunityType, awardBand, deadlineWindow,
  opportunityUid, pageUrl, requester, message, fileNames,
}) {
  return [
    `Request: #${requestId}`,
    `Organization: ${org || "(none provided)"}`,
    "",
    "What they are looking for:",
    `  Focus area:      ${focusArea || "(not specified)"}`,
    `  Opportunity type:${opportunityType ? " " + opportunityType : " (not specified)"}`,
    `  Award band:      ${awardBand || "(not specified)"}`,
    `  Deadline window: ${deadlineWindow || "(not specified)"}`,
    `  Register match:  ${opportunityUid || "(none, structural request)"}`,
    "",
    `Scribe page: ${pageUrl || "(none)"}`,
    `Requester: ${requester}`,
    "",
    "Message:",
    message || "(none)",
    "",
    `Attachments: ${fileNames.length ? fileNames.join(", ") : "(none)"}`,
    "",
    `Recorded as scribe_requests row ${requestId}, status "submitted".`,
  ].join("\n");
}

function buildHtml({
  requestId, org, focusArea, opportunityType, awardBand, deadlineWindow,
  opportunityUid, pageUrl, requester, message, fileNames,
}) {
  const row = (label, value) => `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e6dd;vertical-align:top;font:600 12px/1.4 monospace;color:#8a5b21;white-space:nowrap">${esc(label)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e6dd;vertical-align:top;font:400 13px/1.5 Georgia,serif;color:#182620;white-space:pre-wrap">${esc(value)}</td>
    </tr>`;
  const rows = [
    row("Request", `#${requestId}`),
    row("Organization", org || "(none provided)"),
    row("Focus area", focusArea || "(not specified)"),
    row("Opportunity type", opportunityType || "(not specified)"),
    row("Award band", awardBand || "(not specified)"),
    row("Deadline window", deadlineWindow || "(not specified)"),
    row("Register match", opportunityUid || "(none, structural request)"),
    row("Scribe page", pageUrl || "(none)"),
    row("Requester", requester),
    row("Message", message || "(none)"),
    row("Attachments", fileNames.length ? fileNames.join(", ") : "(none)"),
  ].join("");
  return `<!doctype html><html><body style="margin:0;background:#f7f8f4;padding:24px">
    <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #c9d0c4;border-radius:6px;overflow:hidden">
      <div style="background:#182620;color:#f7f8f4;padding:16px 20px">
        <div style="font:600 11px/1 monospace;letter-spacing:.12em;color:#e6bb70;text-transform:uppercase;margin-bottom:6px">Scribe</div>
        <div style="font:600 18px/1.2 Georgia,serif">New draft request</div>
      </div>
      <div style="padding:18px 20px">
        <table style="border-collapse:collapse;width:100%">${rows}</table>
        <p style="margin:14px 0 0;font:400 12px/1.5 Georgia,serif;color:#55635a">Recorded as <code>scribe_requests</code> row ${esc(requestId)}, status &ldquo;submitted&rdquo;. Set the status as you work it.</p>
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
    return json({ error: "invalid form data" }, 400);
  }

  // Honeypot: bots fill the hidden "website" field. Accept silently, send nothing.
  const website = (form.get("website") || "").toString().trim();
  if (website) return json({ ok: true });

  // Section 5's structural fields. These are what the organization actually describes.
  const clientId = (form.get("client_id") || "measure-austin").toString().trim();
  const focusArea = (form.get("focus_area") || "").toString().trim();
  const opportunityType = (form.get("opportunity_type") || "").toString().trim();
  const awardBand = (form.get("award_band") || "").toString().trim();
  const deadlineWindow = (form.get("deadline_window") || "").toString().trim();
  const pageUrl = (form.get("page_url") || "").toString().trim();
  const org = (form.get("org") || "").toString().trim();
  const message = (form.get("message") || "").toString().trim();

  // The four legacy fields, ACCEPTED BUT NEVER REQUIRED. Kept only so a browser holding an older
  // cached copy of the page does not start failing mid-session; nothing here resolves a grant_id
  // against any list, per Section 5's one-way boundary. opportunity_uid is populated only when the
  // caller genuinely has a register id already, never derived here.
  const opportunityUid = (form.get("opportunity_uid") || form.get("grant_id") || "").toString().trim();

  // A request has to say SOMETHING about what is wanted, or the row records only that somebody
  // pressed a button. Any one structural field, or a written message, satisfies this.
  if (!focusArea && !opportunityType && !awardBand && !deadlineWindow && !message) {
    return json(
      { error: "describe at least one of: focus area, opportunity type, award band, deadline window, or a message" },
      400
    );
  }

  const files = form
    .getAll("files")
    .filter((f) => f && typeof f === "object" && "size" in f && "name" in f && f.size > 0);

  for (const f of files) {
    if (!hasAllowedExtension(f.name)) {
      return json(
        { error: `unsupported file type: ${f.name} (allowed: .pdf, .doc, .docx)` },
        400
      );
    }
  }

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    return json({ error: "attachments exceed the 25 MB total size limit" }, 413);
  }

  // The RESEND_KEY check that used to sit here has MOVED to the mail step below. It aborted the
  // whole request before anything was recorded, which was harmless while the email was the only
  // record and is a data-loss bug now that the row is: a missing key would silently discard a real
  // request rather than storing it unmailed.

  const accessEmail = (request.headers.get("Cf-Access-Authenticated-User-Email") || "").trim();
  const validAccessEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(accessEmail);
  const requester = validAccessEmail ? accessEmail : "unknown (not authenticated)";

  const attachments = [];
  for (const f of files) {
    const buf = await f.arrayBuffer();
    attachments.push({
      filename: f.name,
      content: arrayBufferToBase64(buf),
    });
  }
  const fileNames = files.map((f) => f.name);

  // PERSIST FIRST, EMAIL SECOND. The row is the record; the email is a notification. This ordering
  // is the established convention in this repo (specialist-questionnaire.js, contact.js) and it is
  // the whole point of Section 2.7: the owner's later manual draft upload needs a request to attach
  // back onto, and an inbox is not that.
  if (!env.DB) {
    return json({ error: "Storage is not configured yet." }, 500);
  }

  const submittedAt = new Date().toISOString();
  let requestId;
  try {
    const result = await env.DB.prepare(
      `INSERT INTO scribe_requests
         (client_id, opportunity_uid, focus_area, opportunity_type, award_band, deadline_window,
          org, requester, message, page_url, file_meta, submitted_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted')`
    )
      .bind(
        clientId,
        opportunityUid || null,
        focusArea || null,
        opportunityType || null,
        awardBand || null,
        deadlineWindow || null,
        org || null,
        requester,
        message || null,
        pageUrl || null,
        fileNames.length ? JSON.stringify(fileNames) : null,
        submittedAt
      )
      .run();
    requestId = result.meta && result.meta.last_row_id;
  } catch {
    return json({ error: "Something went wrong saving your request. Please try again." }, 500);
  }

  const to = env.DRAFT_REQUEST_TO || DEFAULT_TO;
  const from = env.DRAFT_REQUEST_FROM || DEFAULT_FROM;
  const subject = `Scribe draft request #${requestId}${focusArea ? " — " + focusArea : ""}`;

  const fields = {
    requestId, org, focusArea, opportunityType, awardBand, deadlineWindow,
    opportunityUid, pageUrl, requester, message, fileNames,
  };

  const payload = {
    from,
    to: [to],
    subject,
    text: buildText(fields),
    html: buildHtml(fields),
  };
  if (validAccessEmail) payload.reply_to = accessEmail;
  if (attachments.length) payload.attachments = attachments;

  // THE EMAIL IS BEST-EFFORT FROM HERE DOWN, AND THAT IS A DELIBERATE CHANGE FROM THE PRE-2026-08-31
  // BEHAVIOR. It used to return 502 on a mail failure, which was correct while the email WAS the
  // record. It is now actively wrong: the row is already committed, so a 502 would tell the
  // organization its request failed when it succeeded, and the natural response, resubmitting,
  // would write a duplicate row. Report delivery honestly in the payload instead of failing the
  // request. Same reasoning and same shape as specialist-questionnaire.js.
  let mailed = false;
  let mailError = null;

  if (!env.RESEND_KEY) {
    mailError = "email is not configured (RESEND_KEY missing)";
  } else {
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + env.RESEND_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (r.ok) {
        mailed = true;
      } else {
        const detail = await r.text().catch(() => "");
        mailError = "mail service rejected the send: " + detail.slice(0, 300);
      }
    } catch {
      mailError = "network error contacting mail service";
    }
  }

  // request_id goes back to the caller so a submission is traceable to its row without a lookup.
  return json({ ok: true, request_id: requestId, status: "submitted", mailed, mail_error: mailError });
}

// Anything other than POST
export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return json({ error: "method not allowed" }, 405);
}
