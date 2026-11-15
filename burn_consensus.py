"""
burn_consensus.py  (final burn map from all 4 orbits), runs in a few seconds, no download

What it does, in plain words:
  1. Loads the passes fire_window.py already saved in out_fire/cache.
  2. For each of the 4 orbits, computes how much HV changed from just before the fire
     (early July) to after it (mid August), minus the scene's typical change.
  3. Averages the 4 orbits. A pixel counts as burned if HV dropped by at least
     DROP_DB on average (each orbit looks from a different angle, so agreement = real).
  4. Removes patches smaller than 1 km2.
  5. Reports burned km2 inside our 50 km square, distance from the burn edge to each
     community, how many orbits agree, and checks the July HH brightening in the same spot.
  6. Saves out_fire/burn_final.png (red overlay, same bounds as every other picture),
     out_fire/slider_before.png and slider_after.png, and adds a "final" block to layers.json.

Run:  python burn_consensus.py
"""
import os
import sys
import json
import glob

import numpy as np
from scipy.ndimage import uniform_filter, binary_opening, label as cc_label
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out_fire")
CACHE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(OUT, "cache")

S, W, N, E = 50.0754, -89.6016, 50.5246, -88.8984   # same grid as fire_window.py
CENTER_LAT, CENTER_LON = 50.30, -89.25
OUT_PX = 1600
PX_M = 50000.0 / (OUT_PX - 1)
PLACES = {"Armstrong": (50.300, -89.050), "Whitesand_reserve": (50.317, -89.033), "Collins": (50.295, -89.450)}
FOREST_HV_DB = -22.0
SMOOTH = 15            # average over 15x15 pixels (about 470 m)
DROP_DB = 1.0          # average HV drop needed to call a pixel burned
MIN_BLOB_KM2 = 1.0

# orbit: (before pass UTC day, after pass UTC day). Local dates: Jul 10/Aug 15, Jul 4/Aug 21, Jul 3/Aug 20, Jul 11/Aug 16
ORBITS = {
    "041_D_063": ("20260711", "20260816"),
    "119_A_027": ("20260704", "20260821"),
    "113_D_063": ("20260704", "20260821"),
    "047_A_027": ("20260711", "20260816"),
}
JULY = ("041_D_063", "20260711", "20260723")   # Jul 10 -> Jul 22 local, for the HH check
CONTROL = ("041_D_063", "20260629", "20260711")


def load(addr, utcday):
    f = [x for x in glob.glob(os.path.join(CACHE, "*.npz")) if "_%s_" % addr in x and "_A_%s" % utcday in x]
    if not f:
        raise SystemExit("Missing pass %s %s in %s. Run: python fire_window.py full" % (addr, utcday, CACHE))
    z = np.load(f[0])
    return z["hh"], z["hv"]


def smooth(x, n=SMOOTH):
    v = np.isfinite(x)
    num = uniform_filter(np.where(v, x, 0.0), n)
    den = uniform_filter(v.astype(float), n)
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(v & (den > 0.5), num / np.maximum(den, 1e-6), np.nan)


def rel_change(addr, d0, d1, pol):
    hb, vb = load(addr, d0)
    ha, va = load(addr, d1)
    b, a = (vb, va) if pol == "hv" else (hb, ha)
    veg = np.isfinite(vb) & np.isfinite(va) & (vb > FOREST_HV_DB)
    d = a - b
    d = d - np.nanmedian(d[veg])
    d[~veg] = np.nan
    return smooth(d)


def clean(m):
    m = binary_opening(m, structure=np.ones((3, 3), bool))
    lab, n = cc_label(m)
    sizes = np.bincount(lab.ravel(), minlength=n + 1) * PX_M * PX_M / 1e6
    keep = sizes >= MIN_BLOB_KM2
    keep[0] = False
    return keep[lab]


def metric_xy(lon, lat):
    return ((np.asarray(lon) - CENTER_LON) * 111320.0 * np.cos(np.radians(CENTER_LAT)),
            (np.asarray(lat) - CENTER_LAT) * 110574.0)


def rc(lat, lon):
    return int(round((N - lat) / (N - S) * (OUT_PX - 1))), int(round((lon - W) / (E - W) * (OUT_PX - 1)))


def rgb(hh, hv):
    v = np.isfinite(hh) & np.isfinite(hv)
    sc = lambda a, lo, hi: np.clip((a - lo) / (hi - lo), 0, 1)
    img = np.dstack([sc(hh, -20, -2), sc(hv, -28, -10), sc(hh - hv, 3, 15)]) * 255
    img = np.where(v[..., None], img, 0).astype("uint8")
    return np.dstack([img, np.where(v, 255, 0).astype("uint8")])


def main():
    maps = {k: rel_change(k, d0, d1, "hv") for k, (d0, d1) in ORBITS.items()}
    stack = np.stack(list(maps.values()))
    n_valid = np.isfinite(stack).sum(0)
    with np.errstate(invalid="ignore"):
        mean = np.nanmean(np.where(n_valid >= 2, stack, np.nan), axis=0)
        n_agree = (stack <= -DROP_DB).sum(0)
    burn = clean(np.isfinite(mean) & (mean <= -DROP_DB))
    px_km2 = PX_M * PX_M / 1e6
    LON, LAT = np.meshgrid(np.linspace(W, E, OUT_PX), np.linspace(N, S, OUT_PX))

    # agreement between orbits (correlation of their change maps)
    ks = list(maps)
    corr = {}
    for i in range(len(ks)):
        for j in range(i + 1, len(ks)):
            m = np.isfinite(maps[ks[i]]) & np.isfinite(maps[ks[j]])
            corr["%s vs %s" % (ks[i], ks[j])] = round(float(np.corrcoef(maps[ks[i]][m][::7], maps[ks[j]][m][::7])[0, 1]), 2)

    ctrl = rel_change(*CONTROL, "hv")
    july_hh = rel_change(*JULY, "hh")
    sens = {str(t): round(float(clean(np.isfinite(mean) & (mean <= -t)).sum() * px_km2), 1) for t in (0.75, 1.0, 1.5)}
    ctrl_km2 = round(float(clean(np.isfinite(ctrl) & (ctrl <= -DROP_DB)).sum() * px_km2), 1)

    X, Y = metric_xy(LON, LAT)
    bx, by = X[burn], Y[burn]
    comm = {}
    for name, (la, lo) in PLACES.items():
        px, py = metric_xy(lo, la)
        d = np.hypot(bx - px, by - py) if bx.size else np.array([np.inf])
        r, c = rc(la, lo)
        comm[name] = {"inside_burn": bool(burn[r, c]),
                      "km_to_burn_edge": round(float(d.min()) / 1000.0, 1),
                      "burned_km2_within_5km": round(float((d <= 5000).sum() * px_km2), 1),
                      "burned_km2_within_10km": round(float((d <= 10000).sum() * px_km2), 1)}

    inside, outside = burn & np.isfinite(july_hh), ~burn & np.isfinite(july_hh) & np.isfinite(mean)
    final = {
        "method": "mean HV change over 4 orbits, early July to mid August, scene median removed, "
                  "smoothed %d px, burned if <= -%.1f dB, patches >= %.0f km2" % (SMOOTH, DROP_DB, MIN_BLOB_KM2),
        "burned_km2_in_50km_square": round(float(burn.sum() * px_km2), 1),
        "square_km2": 2500,
        "burned_km2_if_threshold_db": sens,
        "control_pair_km2_same_method": ctrl_km2,
        "orbit_map_correlations": corr,
        "median_orbits_agreeing_in_burn": int(np.median(n_agree[burn])) if burn.any() else 0,
        "median_hv_change_db_in_burn": round(float(np.nanmedian(mean[burn])), 2) if burn.any() else None,
        "july_hh_change_db_in_burn_vs_outside": [round(float(np.nanmedian(july_hh[inside])), 2),
                                                 round(float(np.nanmedian(july_hh[outside])), 2)],
        "communities": comm,
        "burn_png": "burn_final.png",
        "slider_before": "slider_before.png", "slider_before_date": "2026-07-10 (orbit 041, descending)",
        "slider_after": "slider_after.png", "slider_after_date": "2026-08-15 (orbit 041, descending)",
    }

    rgba = np.zeros(burn.shape + (4,), np.uint8)
    rgba[burn] = (255, 60, 0, 170)
    Image.fromarray(rgba, "RGBA").save(os.path.join(OUT, "burn_final.png"))
    for name, day in (("slider_before", "20260711"), ("slider_after", "20260816")):
        hh, hv = load("041_D_063", day)
        Image.fromarray(rgb(hh, hv), "RGBA").save(os.path.join(OUT, name + ".png"))

    lj = os.path.join(OUT, "layers.json")
    layers = json.load(open(lj)) if os.path.exists(lj) else {}
    layers["final"] = final
    json.dump(layers, open(lj, "w"), indent=1)

    print("Orbit agreement (correlation, 1 = identical):", corr)
    print("Burned forest inside our 50 x 50 km square: %s km2 (threshold 0.75/1.0/1.5 dB: %s)" % (
        final["burned_km2_in_50km_square"], sens))
    print("Same method on the control pair (nothing burned): %s km2" % ctrl_km2)
    print("Median HV change inside burn: %s dB | orbits agreeing: %s of 4" % (
        final["median_hv_change_db_in_burn"], final["median_orbits_agreeing_in_burn"]))
    print("July HH change inside burn vs outside: %s dB" % final["july_hh_change_db_in_burn_vs_outside"])
    for k, v in comm.items():
        print("  %-18s inside burn: %-5s | burn edge %s km away | burned within 5 km: %s km2, within 10 km: %s km2" % (
            k, v["inside_burn"], v["km_to_burn_edge"], v["burned_km2_within_5km"], v["burned_km2_within_10km"]))
    print("Saved out_fire/burn_final.png, slider_before.png, slider_after.png, layers.json")


if __name__ == "__main__":
    main()
