"""
Recolor the navy/gold Canva logo exports to the site's established green/bronze
palette (--ink: #1b3a2f, --accent: #8a6b1f), preserving shading/highlight
variation via a proportional HSV remap rather than a flat color swap.

The source art is effectively two color families (a gold cluster ~#c89a4f and
a navy cluster ~#1e3a5f, each with minor tonal variation for shading/highlights
and anti-aliased edges) -- there is no separate black outline; piece outlines
are simply the darker end of the navy cluster.
"""
import colorsys
from pathlib import Path

import numpy as np
from PIL import Image

DIR = Path(__file__).parent

REF_GOLD = np.array([200, 154, 79])   # #c89a4f, source gold reference
REF_NAVY = np.array([30, 58, 95])     # #1e3a5f, source navy reference
TARGET_GOLD = np.array([138, 107, 31])   # #8a6b1f, site --accent
TARGET_GREEN = np.array([27, 58, 47])    # #1b3a2f, site --ink

CLASSIFY_TOL = 90  # RGB-distance beyond which a pixel is left unrecolored (background grain, stray anti-alias)


def rgb_to_hsv(rgb01):
    return np.array(colorsys.rgb_to_hsv(*rgb01))


def hsv_to_rgb(hsv):
    return np.array(colorsys.hsv_to_rgb(*hsv))


REF_GOLD_HSV = rgb_to_hsv(REF_GOLD / 255)
REF_NAVY_HSV = rgb_to_hsv(REF_NAVY / 255)
TARGET_GOLD_HSV = rgb_to_hsv(TARGET_GOLD / 255)
TARGET_GREEN_HSV = rgb_to_hsv(TARGET_GREEN / 255)


def remap_pixel(rgb, ref_hsv, target_hsv):
    h, s, v = rgb_to_hsv(rgb / 255)
    rh, rs, rv = ref_hsv
    th, ts, tv = target_hsv
    new_s = np.clip(s * (ts / rs if rs > 1e-6 else 1.0), 0, 1)
    new_v = np.clip(v * (tv / rv if rv > 1e-6 else 1.0), 0, 1)
    return (hsv_to_rgb((th, new_s, new_v)) * 255).round().astype(np.uint8)


def build_lut():
    """Precompute the remap for all 256^3 isn't needed -- just vectorize over unique colors present."""
    pass


def recolor(src, dst):
    img = Image.open(DIR / src).convert("RGBA")
    arr = np.array(img)
    h, w = arr.shape[:2]
    rgb = arr[:, :, :3].astype(np.int16)
    alpha = arr[:, :, 3]

    flat_rgb = rgb.reshape(-1, 3)
    flat_alpha = alpha.reshape(-1)
    out = flat_rgb.copy()

    opaque_idx = np.where(flat_alpha > 0)[0]
    unique_colors, inverse = np.unique(flat_rgb[opaque_idx], axis=0, return_inverse=True)

    dist_gold = np.sqrt(((unique_colors - REF_GOLD) ** 2).sum(axis=1))
    dist_navy = np.sqrt(((unique_colors - REF_NAVY) ** 2).sum(axis=1))

    remapped = unique_colors.copy()
    for i, c in enumerate(unique_colors):
        dg, dn = dist_gold[i], dist_navy[i]
        if min(dg, dn) > CLASSIFY_TOL:
            continue  # leave as-is (background grain / stray edge)
        if dg < dn:
            remapped[i] = remap_pixel(c.astype(np.float64), REF_GOLD_HSV, TARGET_GOLD_HSV)
        else:
            remapped[i] = remap_pixel(c.astype(np.float64), REF_NAVY_HSV, TARGET_GREEN_HSV)

    out[opaque_idx] = remapped[inverse]
    out_arr = np.dstack([out.reshape(h, w, 3), alpha])
    Image.fromarray(out_arr.astype(np.uint8), "RGBA").save(DIR / dst)
    print(f"{src} -> {dst}: {len(unique_colors)} unique opaque colors remapped")


if __name__ == "__main__":
    JOBS = [
        ("A1-full-color-transparent.png", "SITE-full-color-transparent.png"),
        ("B1-icon-slogan-light-transparent.png", "SITE-icon-slogan-transparent.png"),
    ]
    for src, dst in JOBS:
        recolor(src, dst)
