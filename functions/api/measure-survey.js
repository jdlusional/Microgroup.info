// POST /api/measure-survey
// Receives a MEASURE funding-priorities worksheet submission and emails
// it to the research inbox via Resend.
//
// Config (Cloudflare Pages -> Settings -> Variables and Secrets):
//   RESEND_KEY  (required, encrypted)  - your Resend API key
//   SURVEY_TO       (optional)             - recipient inbox; default below
//   SURVEY_FROM     (optional)             - verified sender; default uses Resend's
//                                            onboarding domain (works to your own
//                                            Resend-account email out of the box)

const DEFAULT_TO = "jdavis92105@gmail.com";
const DEFAULT_FROM = "MEASURE Survey <onboarding@resend.dev>";

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

function buildHtml(answers, name, email, answered) {
  const rows = answers
    .map((a) => {
      const ans = (a.answer || "").trim();
      return `<tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e6dd;vertical-align:top;font:600 13px/1.4 Georgia,serif;color:#33423b;white-space:nowrap">${esc(a.tag)}<div style="font:400 11px/1.3 monospace;color:#8a5b21;margin-top:2px">${esc(a.cluster)}</div></td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e6dd;vertical-align:top;font:400 13px/1.5 Georgia,serif;color:#182620">
          <div style="color:#5c6b62;margin-bottom:4px">${esc(a.question)}</div>
          <div style="white-space:pre-wrap">${ans ? esc(ans) : '<em style="color:#9aa39a">(no answer)</em>'}</div>
        </td>
      </tr>`;
    })
    .join("");
  const who =
    name || email
      ? `<p style="font:400 13px/1.5 Georgia,serif;color:#33423b;margin:0 0 6px">
           <b>From:</b> ${esc(name)}${name && email ? " &middot; " : ""}${email ? `<a href="mailto:${esc(email)}">${esc(email)}</a>` : ""}
         </p>`
      : "";
  return `<!doctype html><html><body style="margin:0;background:#f7f8f4;padding:24px">
    <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #c9d0c4;border-radius:6px;overflow:hidden">
      <div style="background:#182620;color:#f7f8f4;padding:16px 20px">
        <div style="font:600 11px/1 monospace;letter-spacing:.12em;color:#e6bb70;text-transform:uppercase;margin-bottom:6px">MEASURE &middot; Funding Priorities Worksheet</div>
        <div style="font:600 18px/1.2 Georgia,serif">New survey response</div>
      </div>
      <div style="padding:18px 20px">
        ${who}
        <p style="font:400 12px/1.5 monospace;color:#5c6b62;margin:0 0 14px">${answered} of ${answers.length} answered</p>
        <table style="border-collapse:collapse;width:100%">${rows}</table>
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
    return json({ error: "invalid JSON" }, 400);
  }

  // Honeypot: bots fill the hidden "website" field. Accept silently, send nothing.
  if (data && data.website) return json({ ok: true });

  const answers = Array.isArray(data.answers) ? data.answers : [];
  const answered = answers.filter((a) => a && (a.answer || "").trim()).length;
  if (!answered) return json({ error: "no answers provided" }, 400);

  if (!env.RESEND_KEY) {
    return json({ error: "email is not configured yet (RESEND_KEY missing)" }, 500);
  }

  const name = (data.respondent_name || "").trim().slice(0, 200);
  const email = (data.respondent_email || "").trim().slice(0, 200);
  const to = env.SURVEY_TO || DEFAULT_TO;
  const from = env.SURVEY_FROM || DEFAULT_FROM;
  const subject = "MEASURE survey response" + (name ? " — " + name : "");

  const text =
    typeof data.text === "string" && data.text.trim()
      ? data.text.slice(0, 20000)
      : answers.map((a) => `${a.tag}. ${a.question}\n   ${a.answer || "(no answer)"}`).join("\n\n");

  const payload = {
    from,
    to: [to],
    subject,
    text,
    html: buildHtml(answers, name, email, answered),
  };
  // Let you reply straight to the respondent if they left an email.
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) payload.reply_to = email;

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
