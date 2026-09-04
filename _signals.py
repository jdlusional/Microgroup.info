"""Homepage rebuild signal instrument: capture the pre-rebuild baseline, then verify the rebuild.

WHY THIS EXISTS AND WHY IT RUNS BEFORE THE FIRST SAVE. Nearly every R-item in Phases 1 to 3 states
its achieved-signal as a count moving from X to Y. X is only measurable on the pre-rebuild file, and
the moment index.html is written it is gone. P1 already cost this run a `correction_owed` for a
baseline taken after the fact; thirty more would make the ledger worthless.

Every count here is an OCCURRENCE count via re.findall, never a line count. `grep -c` counts lines
and already under-reported a colour count of 4 as 2 on this run.

    python _signals.py capture   writes _signals_baseline.json (refuses to overwrite)
    python _signals.py verify    re-measures and prints PASS/FAIL per signal against the baseline
"""
import io
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.abspath(__file__))
INDEX = os.path.join(REPO, "index.html")
OUT = os.path.join(REPO, "_signals_baseline.json")

# Client prose names for R22's entitlement guard, drawn from each hub page's own title,
# word-bounded, case-sensitive. A filename-slug list returns 0 against prose no matter what
# ships, and a naive lowercase "measure" hits the retained tagline three times.
CLIENT_PATTERNS = [r"\bBlack Mamas\b", r"\bHuman Rights Initiative\b", r"\bMeasure\b",
                   r"\bJ\.?P\.? ?Morgan\b", r"\bCustodian\b"]

# R20's outcome-claim phrases, all five, searched against tag-stripped visitor text.
OUTCOME_PHRASES = ["more out of", "maximize", "best-in-class", "proven results", "trusted by"]


def strip_tags(h):
    h = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", h)
    h = re.sub(r"(?s)<!--.*?-->", " ", h)
    h = re.sub(r"(?s)<[^>]+>", " ", h)
    return re.sub(r"\s+", " ", h).strip()


def n(rx, t, flags=0):
    return len(re.findall(rx, t, flags))


def repo_html():
    out = []
    for dp, dn, fn in os.walk(REPO):
        dn[:] = [d for d in dn if d not in (".git", "node_modules", "Assets")]
        for f in fn:
            if f.lower().endswith(".html"):
                out.append(os.path.join(dp, f))
    return out


def measure():
    t = io.open(INDEX, encoding="utf-8").read()
    vis = strip_tags(t)
    html_files = repo_html()

    # R2: repo-wide inbound anchor count, EXCLUDING index.html itself.
    inbound = 0
    inbound_files = 0
    contact_linkers = []
    for p in html_files:
        if os.path.abspath(p) == os.path.abspath(INDEX):
            continue
        s = io.open(p, encoding="utf-8", errors="replace").read()
        c = n(r'href="/#contact"', s)
        if c:
            inbound += c
            inbound_files += 1
        if n(r'href="contact\.html"', s):
            contact_linkers.append(os.path.basename(p))

    style_css_in_repo = sum(n(r"style\.css", io.open(p, encoding="utf-8", errors="replace").read())
                            for p in html_files)

    # R6/R13: every six-digit hex with its line number.
    hexes = {}
    for i, line in enumerate(t.split("\n"), 1):
        for m in re.finditer(r"#([0-9a-fA-F]{6})\b", line):
            hexes.setdefault("#" + m.group(1).lower(), []).append(i)

    # R18: first h1, its classes and visible word count.
    h1 = re.search(r"(?is)<h1\b([^>]*)>(.*?)</h1>", t)
    h1_attrs = h1.group(1) if h1 else ""
    h1_words = len(strip_tags(h1.group(2)).split()) if h1 else 0

    # R16: banner comments, the quoted form from repair 7.
    banners = re.findall(r"(?m)^/\* =+ ([1-7])\. [A-Z][A-Z ]+ =+ \*/$", t)

    # R17: <li> inside .nav-links.
    navblock = re.search(r'(?is)<ul class="nav-links">(.*?)</ul>', t)
    nav_li = n(r"<li\b", navblock.group(1)) if navblock else 0

    # R12: font families requested vs rendered-consumer proof.
    href = re.search(r'href="(https://fonts\.googleapis\.com/[^"]+)"', t)
    fams = re.findall(r"family=([A-Za-z+ ]+)", href.group(1)) if href else []
    fams = [f.replace("+", " ").strip() for f in fams]
    outside = t.replace(href.group(1), "") if href else t
    fam_used = {f: n(re.escape(f), outside) for f in fams}

    return {
        # R1
        "html_file_count": len(html_files),
        # R2  whitespace-anchored, NOT bare: a bare pattern matches data-id="contact"
        "id_contact_anchored": n(r'(?<![-\w])id="contact"', t),
        "id_contact_naive": n(r'id="contact"', t),
        "inbound_hash_contact": inbound,
        "inbound_hash_contact_files": inbound_files,
        # R3
        "footer_legal_div": n(r'<div class="footer-legal">', t),
        # R4
        "href_style_css": n(r'href="style\.css"', t),
        "style_css_repo_wide": style_css_in_repo,
        # R5
        "banned_atrules": sum(n(x, t) for x in
                              [r"@layer", r"@container", r"@supports", r":is\(", r":where\("]),
        # R6 / R13
        "distinct_hexes": sorted(hexes),
        "distinct_hex_count": len(hexes),
        "hex_lines": {k: v for k, v in sorted(hexes.items())},
        "style_attr": n(r'style="', t),
        # R8
        "opacity_decls": n(r"opacity\s*:", t),
        # R10
        "font_size_px": n(r"font-size:\s*\d+(?:\.\d+)?px", t),
        # R11
        "ch_units": n(r"\d+ch\b", t),
        # R12
        "font_families": fams,
        "font_family_used_outside_href": fam_used,
        # R14
        "ledger_js": n(r"ledger\.js", t),
        "class_ledger": n(r'class="ledger', t),
        "class_chevron": n(r'class="chevron"', t),
        "class_stack_item": n(r'class="stack-item', t),
        "explore": n(r"EXPLORE", t),
        # R15
        "html_stack_page": n(r"html\.stack-page", t),
        # R16
        "banner_comments": banners,
        # R17
        "nav_li": nav_li,
        "href_demo": n(r'href="demo\.html"', t),
        "href_demo_pricing": n(r'href="demo-pricing\.html"', t),
        # R18
        "h1_is_sr_only": "sr-only" in h1_attrs,
        "h1_visible_words": 0 if "sr-only" in h1_attrs else h1_words,
        # R19-R22
        "data_block_problem": n(r'data-block="problem"', t),
        "data_block_scope": n(r'data-block="scope"', t),
        "data_block_proof": n(r'data-block="proof"', t),
        "data_block_terms": n(r'data-block="terms"', t),
        "section_ids": re.findall(r'<section id="([^"]+)"', t),
        "outcome_phrases": {p: len(re.findall(re.escape(p), vis, re.I)) for p in OUTCOME_PHRASES},
        "client_names_in_visitor_text": {p: len(re.findall(p, vis)) for p in CLIENT_PATTERNS},
        # R23
        "founder_name": n(r"Jonathan Lin Davis", t),
        "founders_apostrophe": n(r"founder's", t),
        # R24
        "contact_html_linkers": sorted(contact_linkers),
        # R25
        "option_values": n(r"<option value=", t),
        # R27
        "mailto": n(r"mailto:", t),
        "address_in_visitor_text": n(r"jonathan@microgroup\.info", vis),
        # R28
        "price_2000": n(r"\$2,000", t),
        "built_to_varying_degrees": n(r"built to varying degrees", t),
        # R29
        "required_attrs": n(r"\brequired\b", t),
        "message_required": bool(re.search(r'(?s)<textarea[^>]*id="message".*?required', t)
                                 or re.search(r'(?s)id="message"[^>]*required', t)),
        # R30
        "og_image": (re.search(r'property="og:image" content="([^"]+)"', t) or [None, ""])[1]
        if re.search(r'property="og:image" content="([^"]+)"', t) else "",
        # D6 targets
        "political_and_legislative": n(r"political and legislative", t, re.I),
        "opposition_research": n(r"opposition research", t, re.I),
        "campaign_mgmt_candidates": n(r"campaign management for candidates", t, re.I),
        "bill_analysis_CONTROL": n(r"bill analysis", t, re.I),
        # D4
        "playfair": n(r"Playfair Display", t),
        "instrument_serif": n(r"Instrument Serif", t),
        "parisienne": n(r"Parisienne", t),
        # bytes
        "index_bytes": len(t.encode("utf-8")),
    }


mode = sys.argv[1] if len(sys.argv) > 1 else "capture"

if mode == "capture":
    if os.path.exists(OUT):
        print("REFUSED: %s already exists. A baseline is captured once, before the first save."
              % os.path.basename(OUT))
        raise SystemExit(1)
    d = measure()
    io.open(OUT, "w", encoding="utf-8").write(json.dumps(d, indent=1, sort_keys=True))
    print("BASELINE CAPTURED -> %s" % OUT)
    for k in sorted(d):
        v = d[k]
        if isinstance(v, (list, dict)):
            v = "%s(%d)" % (type(v).__name__, len(v))
        print("  %-34s %s" % (k, v))

elif mode == "verify":
    base = json.load(io.open(OUT, encoding="utf-8"))
    cur = measure()
    print("%-34s %-22s %-22s" % ("signal", "baseline", "now"))
    print("-" * 80)
    for k in sorted(cur):
        b, c = base.get(k), cur[k]
        flag = "" if b == c else "  <== CHANGED"
        bs = json.dumps(b)[:20] if isinstance(b, (list, dict)) else b
        cs = json.dumps(c)[:20] if isinstance(c, (list, dict)) else c
        print("%-34s %-22s %-22s%s" % (k, bs, cs, flag))
else:
    print("usage: _signals.py [capture|verify]")
    raise SystemExit(2)
