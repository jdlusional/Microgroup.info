/**
 * Site-wide middleware: force every request onto the canonical hostname.
 *
 * WHY THIS EXISTS, and it is not a style preference.
 *
 * Cloudflare Access policies are scoped to a HOSTNAME. Every Access application
 * on this account is scoped to `microgroup.info`, and as of 2026-08-25 zero of
 * the 32 applications referenced any other hostname. This Pages project,
 * however, also answers on `www.microgroup.info` and on its
 * `microgroup-info.pages.dev` alias. The result, measured on 2026-08-25 before
 * this file existed:
 *
 *     microgroup.info/specialist-questionnaire            302  ->  Access login
 *     www.microgroup.info/specialist-questionnaire        200  43,169 bytes
 *     microgroup-info.pages.dev/specialist-questionnaire  200
 *
 * A Cloudflare and GitHub structure audit measured the full extent: 21 of 21
 * gated HTML pages and 10 of 10 gated JSON files, several carrying EINs and
 * funder data, were byte-identical to the authenticated canonical at both
 * alternate hostnames. Gating was effectively optional for anyone who typed
 * `www.`.
 *
 * Redirecting here works because Access is evaluated per hostname at the edge:
 * a request to an unprotected hostname reaches this worker, gets 301'd to the
 * canonical host, and the follow-up request is then evaluated by Access
 * normally.
 *
 * BRANCH PREVIEWS ARE DELIBERATELY NOT MATCHED. The test is exact hostname
 * equality, so `<branch>.microgroup-info.pages.dev` falls through untouched and
 * the preview-review workflow keeps working. Preview leaks are a separate
 * control (Cloudflare's "Access on preview deployments" setting), not this
 * file's job. Do not "improve" this into a suffix match: that would break every
 * preview URL at once.
 *
 * SCOPE, stated so a later reader does not think something is missing. The
 * sibling project `Jonathanlindavis.com` carries a larger `_middleware.js` that
 * also does client-custom-domain serving and case-insensitive page routing.
 * Neither is ported here on purpose. This file has one job. A lowercase-path
 * redirect in particular is NOT included, because this repo's existing links
 * have not been audited for casing and a blanket 301 could break working URLs
 * on a live client-facing site to solve a problem nobody reported.
 */

// Exact hostnames that must not serve content directly. Exact equality only.
const NON_CANONICAL_HOSTS = new Set([
  "www.microgroup.info",
  "microgroup-info.pages.dev",
]);

const CANONICAL_HOST = "microgroup.info";

export async function onRequest(context) {
  const url = new URL(context.request.url);

  if (NON_CANONICAL_HOSTS.has(url.hostname.toLowerCase())) {
    url.hostname = CANONICAL_HOST;
    // url.toString() preserves pathname, search and hash, so a deep link and
    // its query survive the redirect intact.
    return Response.redirect(url.toString(), 301);
  }

  return context.next();
}
