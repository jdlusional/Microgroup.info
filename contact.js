// Contact form handler for microgroup.info
// Validates on the client, then posts JSON to /api/contact.
(function () {
  var form = document.getElementById("contactForm");
  if (!form) return;
  var status = document.getElementById("formStatus");

  function setStatus(msg, kind) {
    status.textContent = msg;
    status.className = "mg-status" + (kind ? " " + kind : "");
  }

  var emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  form.addEventListener("submit", function (e) {
    e.preventDefault();

    var first = form.first_name.value.trim();
    var last = form.last_name.value.trim();
    var email = form.email.value.trim();
    var location = form.location.value;
    var purpose = form.purpose.value.trim();

    if (!first || !last) { setStatus("Please enter your first and last name.", "err"); return; }
    if (!emailRe.test(email)) { setStatus("Please enter a valid email.", "err"); return; }
    if (!location) { setStatus("Please choose your location.", "err"); return; }
    if (!purpose) { setStatus("Please tell us the purpose of your message.", "err"); return; }

    var btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    setStatus("Sending...", "");

    var payload = {
      first_name: first,
      last_name: last,
      email: email,
      phone: form.phone.value.trim(),
      location: location,
      urgency: form.urgency.value,
      purpose: purpose,
      referral: form.referral.value.trim(),
      company_website: form.company_website.value
    };

    fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
      .then(function (res) {
        if (res.ok && res.body && res.body.ok) {
          form.reset();
          setStatus("Thank you. Your message has been received and we will be in touch.", "ok");
        } else {
          setStatus((res.body && res.body.error) || "Something went wrong. Please try again.", "err");
          btn.disabled = false;
        }
      })
      .catch(function () {
        setStatus("Something went wrong. Please try again.", "err");
        btn.disabled = false;
      });
  });
})();
