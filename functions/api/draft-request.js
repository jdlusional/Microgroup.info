// POST /api/draft-request
// Receives a MEASURE grant-drafter request (multipart form, optionally with
// uploaded RFP/guideline files) and emails it to the site owner via Resend,
// forwarding any uploaded files as email attachments.
//
// Config (Cloudflare Pages -> Settings -> Variables and Secrets):
//   RESEND_KEY       (required, encrypted)  - your Resend API key
//   DRAFT_REQUEST_TO     (optional)             - recipient inbox; default below
//   DRAFT_REQUEST_FROM   (optional)             - verified sender; default uses Resend's
//                                                 onboarding domain (works to your own
//                                                 Resend-account email out of the box)

const DEFAULT_TO = "jdavis92105@gmail.com";
const DEFAULT_FROM = "MEASURE Grant Drafter <onboarding@resend.dev>";

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

function buildText({ org, grantName, funder, grantUrl, pageUrl, requester, message, fileNames }) {
  return [
    `Organization: ${org || "(none provided)"}`,
    `Grant: ${grantName} — ${funder || "(unknown funder)"}`,
    `Grant URL: ${grantUrl || "(none)"}`,
    `Drafter page: ${pageUrl || "(none)"}`,
    `Requester: ${requester}`,
    "",
    "Message:",
    message || "(none)",
    "",
    `Attachments: ${fileNames.length ? fileNames.join(", ") : "(none)"}`,
  ].join("\n");
}

function buildHtml({ org, grantName, funder, grantUrl, pageUrl, requester, message, fileNames }) {
  const row = (label, value) => `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e6dd;vertical-align:top;font:600 12px/1.4 monospace;color:#8a5b21;white-space:nowrap">${esc(label)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e6dd;vertical-align:top;font:400 13px/1.5 Georgia,serif;color:#182620;white-space:pre-wrap">${esc(value)}</td>
    </tr>`;
  const rows = [
    row("Organization", org || "(none provided)"),
    row("Grant", `${grantName} — ${funder || "(unknown funder)"}`),
    row("Grant URL", grantUrl || "(none)"),
    row("Drafter page", pageUrl || "(none)"),
    row("Requester", requester),
    row("Message", message || "(none)"),
    row("Attachments", fileNames.length ? fileNames.join(", ") : "(none)"),
  ].join("");
  return `<!doctype html><html><body style="margin:0;background:#f7f8f4;padding:24px">
    <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #c9d0c4;border-radius:6px;overflow:hidden">
      <div style="background:#182620;color:#f7f8f4;padding:16px 20px">
        <div style="font:600 11px/1 monospace;letter-spacing:.12em;color:#e6bb70;text-transform:uppercase;margin-bottom:6px">MEASURE Grant Drafter</div>
        <div style="font:600 18px/1.2 Georgia,serif">New draft request</div>
      </div>
      <div style="padding:18px 20px">
        <table style="border-collapse:collapse;width:100%">${rows}</table>
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

  const grantId = (form.get("grant_id") || "").toString().trim();
  const grantName = (form.get("grant_name") || "").toString().trim();
  const funder = (form.get("funder") || "").toString().trim();
  const grantUrl = (form.get("grant_url") || "").toString().trim();
  const pageUrl = (form.get("page_url") || "").toString().trim();
  const org = (form.get("org") || "").toString().trim();
  const message = (form.get("message") || "").toString().trim();

  if (!grantName || !grantId) {
    return json({ error: "grant_name and grant_id are required" }, 400);
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

  if (!env.RESEND_KEY) {
    return json({ error: "email is not configured yet (RESEND_KEY missing)" }, 500);
  }

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

  const to = env.DRAFT_REQUEST_TO || DEFAULT_TO;
  const from = env.DRAFT_REQUEST_FROM || DEFAULT_FROM;
  const subject = `MEASURE draft request — ${grantName}`;

  const fields = { org, grantName, funder, grantUrl, pageUrl, requester, message, fileNames };

  const payload = {
    from,
    to: [to],
    subject,
    text: buildText(fields),
    html: buildHtml(fields),
  };
  if (validAccessEmail) payload.reply_to = accessEmail;
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
  } catch (e) {
    return json({ error: "network error contacting mail service" }, 502);
  }

  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    return json({ error: "mail service rejected the send", detail: detail.slice(0, 300) }, 502);
  }

  return json({ ok: true });
}

// Anything other than POST
export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return json({ error: "method not allowed" }, 405);
}
