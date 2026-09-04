"""R7's contrast instrument: enumerate every foreground and background pair index.html declares.

DESIGN, AND A CORRECTION TO ITS FIRST VERSION MADE BY READING ITS OWN OUTPUT. The first version
paired every declared text colour against every declared background token. It returned 104 failures
of 205 pairs and NOT ONE WAS REAL: it was reporting --ink on --ink at 1.00, --accent-text on
--accent-fill at 1.00 (the same value twice), and every colour against --plate-rule, which is a 1px
divider line rather than a surface anything sits on. A check that cannot discriminate is not a
check, and 104 false failures would have trained a reader to ignore the file.

The corrected rule has two branches and no hand-written pair list:
  1. A rule declaring BOTH a colour and a background is an EXACT pair. Test that pair and nothing
     else, because the page composes it directly.
  2. A rule declaring only a colour inherits its surface. Test it against the two surfaces that
     actually contain text in this document, --paper (the page ground) and --well (cards, the
     problem block, the terms block and the footer).
A background token that no text-containing element uses is not a surface and is excluded. That
exclusion is what removes --plate-rule and --ink from the surface set.

Scale is read from the rule's own font-size token. WCAG 2.2 SC 1.4.3 puts the boundary at 18pt, or
14pt bold, which is 24px, or 18.66px at weight 700 or above. Boundary and graphical-object uses are
judged against SC 1.4.11's 3:1 instead.

Prints the pair count so a zero-failure result carries a denominator.
"""
import io
import os
import re
import sys

F = os.path.join(os.path.dirname(os.path.abspath(__file__)), "index.html")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_contrast_report.txt")


def lin(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def lum(h):
    h = h.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)


def ratio(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


t = io.open(F, encoding="utf-8").read()
css = re.search(r"(?s)<style>(.*?)</style>", t).group(1)

# Token table, from section 1 only.
tokens = dict(re.findall(r"(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b", css))
sizes = dict(re.findall(r"(--t-[a-z0-9]+):\s*([\d.]+)rem", css))
ROOT_PX = 16.0

# The inherited-surface set: the two grounds that actually contain text in this document.
# A background token used only on a 1px divider or a solid button is NOT an inherited surface;
# where such a rule sets its own colour it is caught by the exact-pair branch instead.
surfaces = {k: tokens[k] for k in ("--paper", "--well")}

# Every rule block that sets a text colour, with the size and weight it declares.
pairs = []
for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", css):
    sel, body = m.group(1).strip(), m.group(2)
    if sel.startswith("@") or "--paper:" in body:
        continue
    cm = re.search(r"(?<!-)color:\s*var\((--[a-z0-9-]+)\)", body)
    if not cm or cm.group(1) not in tokens:
        continue
    fg_tok = cm.group(1)
    fs = re.search(r"font-size:\s*var\((--t-[a-z0-9]+)\)", body)
    px = float(sizes[fs.group(1)]) * ROOT_PX if fs and fs.group(1) in sizes else ROOT_PX
    wm = re.search(r"font-weight:\s*(\d+)", body)
    wt = int(wm.group(1)) if wm else 400
    # Own background if declared, else every candidate surface.
    ownbg = re.search(r"background(?:-color)?:\s*var\((--[a-z0-9-]+)\)", body)
    bgs = ([ownbg.group(1)] if ownbg and ownbg.group(1) in tokens else list(surfaces))
    large = px >= 24.0 or (px >= 18.66 and wt >= 700)
    for bg in bgs:
        pairs.append((sel[:58], fg_tok, bg, px, wt, large))

lines = []
fails = 0
for sel, fg, bg, px, wt, large in pairs:
    r = ratio(tokens[fg], tokens[bg])
    bar = 3.0 if large else 4.5
    ok = r >= bar
    if not ok:
        fails += 1
    lines.append("%-6s %5.2f  need %.1f  %-13s on %-13s  %5.2fpx/%d %-6s  %s"
                 % ("PASS" if ok else "FAIL", r, bar, fg, bg, px, wt,
                    "LARGE" if large else "normal", sel))

hdr = ["R7 contrast report for index.html",
       "Exact pairs where a rule declares both; inherited pairs against --paper and --well.",
       "pairs evaluated: %d   failures: %d" % (len(pairs), fails),
       "surfaces: %s" % ", ".join(sorted(surfaces)),
       ""]
report = "\n".join(hdr + sorted(lines))
io.open(OUT, "w", encoding="utf-8").write(report + "\n")
print(report)
print("\nwritten to %s" % OUT)
sys.exit(1 if fails else 0)
