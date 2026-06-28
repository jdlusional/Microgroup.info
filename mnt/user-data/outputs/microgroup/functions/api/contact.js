// POST /api/contact
// Receives a contact submission from the form on index.html,
// stores it in the D1 database bound as env.DB, and emails a copy
// to the MICRO Group inbox through Resend.
//
// Expects JSON:
//   { first_name, last_name, email, phone, location, purpose,
//     urgency, referral, company_website }
//
// company_website is the honeypot. Real people never see it, so if it
// has any value the submission is treated as a bot and silently
// accepted without being stored or emailed.
//
// Environment:
//   env.DB           D1 binding (database: microgroup)
//   env.RESEND_KEY   Resend API key (encrypted secret)
//   env.CONTACT_TO   destination inbox (e.g. jonathanlindavis@gmail.com)
//   env.CONTACT_FROM verified Resend sender (e.g. contact@microgroup.info)

export async function onRequestPost(context) {
  const { request, env } = context;

  let data;
  try {
    data = await request.json();
  } catch (e) {
    return json({ error: "Invalid request." }, 400);
  }

  // Honeypot: pretend success, store nothing, send nothing.
  if (data.company_website && String(data.company_website).trim() !== "") {
    return json({ ok: true }, 200);
  }

  const first_name = clean(data.first_name);
  const last_name = clean(data.last_name);
  const email = clean(data.email).toLowerCase();
  const phone = clean(data.phone);
  const location = clean(data.location);
  const purpose = clean(data.purpose);
  const urgency = clean(data.urgency);
  const referral = clean(data.referral);

  // Server side validation, mirroring the client.
  if (!first_name || !last_name) {
    return json({ error: "Please enter your first and last name." }, 400);
  }
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email)) {
    return json({ error: "Please enter a valid email." }, 400);
  }
  if (!location) {
    return json({ error: "Please choose your location." }, 400);
  }
  if (!purpose) {
    return json({ error: "Please tell us the purpose of your message." }, 400);
  }

  const created_at = new Date().toISOString();

  // Save to D1 first. The submission is preserved even if email fails.
  try {
    await env.DB.prepare(
      `INSERT INTO contacts
        (first_name, last_name, email, phone, location, purpose, urgency, referral, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(first_name, last_name, email, phone, location, purpose, urgency, referral, created_at)
      .run();
  } catch (e) {
    return json({ error: "Something went wrong saving your message. Please try again." }, 500);
  }

  // Email a copy through Resend. Failure here does not lose the record.
  try {
    if (env.RESEND_KEY && env.CONTACT_TO && env.CONTACT_FROM) {
      const subject = `New MICRO Group inquiry from ${first_name} ${last_name}`;
      const lines = [
        `Name: ${first_name} ${last_name}`,
        `Email: ${email}`,
        `Phone: ${phone || "(not provided)"}`,
        `Location: ${location}`,
        `Urgency: ${urgency || "(not provided)"}`,
        `Referral: ${referral || "(not provided)"}`,
        `Submitted: ${created_at}`,
        ``,
        `Purpose:`,
        purpose,
      ];
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.RESEND_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: env.CONTACT_FROM,
          to: [env.CONTACT_TO],
          reply_to: email,
          subject: subject,
          text: lines.join("\n"),
        }),
      });
    }
  } catch (e) {
    // Intentionally ignored. The row is already saved.
  }

  return json({ ok: true }, 200);
}

function clean(v) {
  return (v == null ? "" : String(v)).trim().slice(0, 2000);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}
