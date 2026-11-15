"""
fire_window.py  (wildfire burn map from NISAR HV), version 1

What it does, in plain words:
  1. Logs in to NASA Earthdata (type your username and password in the terminal).
  2. For each pass listed in JOBS, finds the NISAR file (names come from fire_passes.json,
     made by dates_fire.py).
  3. Streams ONLY a 50 km x 50 km square that holds Armstrong, Whitesand and Collins
     (both HH and HV), never the whole 20 GB file.
  4. Averages 3x3 pixels (10 m -> 30 m) and smooths a little to calm radar speckle,
     converts to decibels (dB), and masks the empty strip at the swath edge.
  5. Redraws everything onto ONE fixed lat/lon grid, so every picture lines up exactly
     (before/after slider and timeline just work).
  6. Burn map = forest pixels whose HV dropped by at least BURN_DB, comparing passes with
     the SAME address only. Small speckles are removed.
  7. Also runs a "control" pair (two passes BEFORE the fire). Nothing burned then, so
     whatever it flags is the noise level. Fire pair must be much bigger than that.
  8. Reports burned km2, distance from the burn edge to each community, and burned km2
     within 2 km and 5 km of each community.
  9. Saves pictures, layers.json (for the website) and fire_stats.json into out_fire/.
     Streamed passes are cached in out_fire/cache, so re-runs skip them.

Run:
  python fire_window.py check    (3 passes, address 041_D_063: Jun 28, Jul 10, Jul 22)
  python fire_window.py full     (adds Aug 15 plus 3 more addresses for the timeline)
"""
import os
import sys
import json
import time
from datetime import datetime, timedelta

import numpy as np
from scipy.ndimage import uniform_filter, binary_dilation, binary_opening, label as cc_label
from pyproj import Transformer
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out_fire")
CACHE = os.path.join(OUT, "cache")
SHORT_NAME = "NISAR_L2_GCOV_PROVISIONAL_V1"
GRID = "/science/LSAR/GCOV/grids/frequencyA/"

# ---------------------------------------------------------------- settings
CENTER_LAT, CENTER_LON = 50.30, -89.25   # halfway between Collins and Armstrong
BBOX = (-89.70, 50.10, -88.70, 50.50)    # catalog search box (W, S, E, N)
HALF_KM = 25.0          # square is 50 km x 50 km
OUT_PX = 1600           # output grid is 1600 x 1600 (about 31 m pixels)
LOOKS = 3               # average 3x3 raw pixels before anything else
SMOOTH = 3              # extra smoothing, in 30 m pixels
BURN_DB = 3.0           # HV must drop by at least this many dB to count as burned
FOREST_HV_DB = -22.0    # before-HV brighter than this = vegetation (darker = water/bare)
MIN_BLOB_KM2 = 0.5      # patches smaller than this are dropped as noise
HH_RISE_DB = 2.0        # HH must rise by at least this (vs the scene's typical change) to count
CHANGE_SMOOTH = 7       # average the change over 7x7 pixels (about 200 m) before thresholding
NODATA_DB = -28.0       # big region darker than this touching the edge = outside the swath
GLITCH_HH_DB = 2.0      # HH brighter than this is very unusual over forest
GLITCH_FRAC = 0.01      # more than 1% of pixels that bright = suspect scene, look at it

PLACES = {              # (lat, lon), west is negative
    "Armstrong": (50.300, -89.050),
    "Whitesand_reserve": (50.317, -89.033),
    "Collins": (50.295, -89.450),
}

# local Ontario dates, per address (from fire_dates.txt)
JOBS = {
    "check": {"041_D_063": ["2026-06-28", "2026-07-10", "2026-07-22"]},
    "full": {
        "041_D_063": ["2026-06-28", "2026-07-10", "2026-07-22", "2026-08-15"],
        "113_D_063": ["2026-07-03", "2026-07-15", "2026-08-20"],
        "119_A_027": ["2026-07-04", "2026-07-16", "2026-08-21"],
        "047_A_027": ["2026-07-11", "2026-07-23", "2026-08-16"],
    },
}


# ---------------------------------------------------------------- grid
def out_grid():
    """The one fixed lat/lon grid every picture is drawn on."""
    dlat = HALF_KM / 111.32
    dlon = HALF_KM / (111.32 * np.cos(np.radians(CENTER_LAT)))
    south, north = CENTER_LAT - dlat, CENTER_LAT + dlat
    west, east = CENTER_LON - dlon, CENTER_LON + dlon
    LON, LAT = np.meshgrid(np.linspace(west, east, OUT_PX), np.linspace(north, south, OUT_PX))
    px_m = 2 * HALF_KM * 1000.0 / (OUT_PX - 1)
    return LON, LAT, [south, west, north, east], px_m


def metric_xy(lon, lat):
    """lat/lon -> metres east/north of the centre (fine for 50 km)."""
    return ((np.asarray(lon) - CENTER_LON) * 111320.0 * np.cos(np.radians(CENTER_LAT)),
            (np.asarray(lat) - CENTER_LAT) * 110574.0)


# ---------------------------------------------------------------- reading
def get_epsg(group, lon):
    try:
        p = group["projection"]
        v = int(np.ravel(p[()])[0])
        if 1000 < v < 70000:
            return v
        if "epsg_code" in p.attrs:
            return int(np.ravel(p.attrs["epsg_code"])[0])
    except Exception:
        pass
    return 32600 + int((lon + 180) // 6) + 1


def read_window(fobj, LON, LAT):
    """Read only the part of HH and HV that covers our square."""
    import h5py
    with h5py.File(fobj, "r") as f:
        g = f[GRID]
        for k in ("HHHH", "HVHV"):
            if k not in g:
                raise RuntimeError("No %s layer. Layers: %s" % (k, list(g.keys())))
        xs = g["xCoordinates"][:]
        ys = g["yCoordinates"][:]
        epsg = get_epsg(g, CENTER_LON)
        tr = Transformer.from_crs(4326, epsg, always_xy=True)
        cx, cy = tr.transform(
            np.array([LON.min(), LON.max(), LON.min(), LON.max()]),
            np.array([LAT.min(), LAT.min(), LAT.max(), LAT.max()]))
        pad = 500.0
        xi = np.where((xs >= cx.min() - pad) & (xs <= cx.max() + pad))[0]
        yi = np.where((ys >= cy.min() - pad) & (ys <= cy.max() + pad))[0]
        if len(xi) < 10 * LOOKS or len(yi) < 10 * LOOKS:
            return None
        x0, x1, y0, y1 = xi.min(), xi.max() + 1, yi.min(), yi.max() + 1
        hh = g["HHHH"][y0:y1, x0:x1].astype("float32")
        hv = g["HVHV"][y0:y1, x0:x1].astype("float32")
    return hh, hv, xs[x0:x1], ys[y0:y1], epsg


def multilook(a, xs, ys, n=LOOKS):
    """Average n x n blocks of linear power (ignores empty pixels)."""
    H, W = (a.shape[0] // n) * n, (a.shape[1] // n) * n
    a = a[:H, :W]
    valid = np.isfinite(a) & (a > 0)
    p = np.where(valid, a, 0).reshape(H // n, n, W // n, n).sum(axis=(1, 3))
    c = valid.reshape(H // n, n, W // n, n).sum(axis=(1, 3))
    out = np.where(c > (n * n) // 2, p / np.maximum(c, 1), np.nan).astype("float32")
    return out, xs[:W].reshape(-1, n).mean(1), ys[:H].reshape(-1, n).mean(1)


def to_db(a):
    valid = np.isfinite(a) & (a > 0)
    num = uniform_filter(np.where(valid, a, 0.0).astype("float32"), SMOOTH)
    den = uniform_filter(valid.astype("float32"), SMOOTH)
    with np.errstate(divide="ignore", invalid="ignore"):
        sm = np.where(den > 0.5, num / np.maximum(den, 1e-6), np.nan)
        return (10.0 * np.log10(sm)).astype("float32")


def swath_edge(db, step=2, grow_px=25, big_frac=0.02):
    """True where the swath has ended or is fading (grows the empty area by ~1.5 km)."""
    small = db[::step, ::step]
    dark = ~np.isfinite(small) | (small < NODATA_DB)
    lab, n = cc_label(dark)
    none = np.zeros(db.shape, dtype=bool)
    if n == 0:
        return none
    sizes = np.bincount(lab.ravel(), minlength=n + 1)
    border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    keep = [i for i in border if i != 0 and sizes[i] >= big_frac * dark.size]
    if not keep:
        return none
    edge = binary_dilation(np.isin(lab, keep), iterations=grow_px)
    full = np.kron(edge.astype(np.uint8), np.ones((step, step), np.uint8)).astype(bool)
    return full[:db.shape[0], :db.shape[1]]


def to_grid(db, xs, ys, epsg, LON, LAT):
    X, Y = Transformer.from_crs(4326, epsg, always_xy=True).transform(LON, LAT)
    ix = np.rint((X - xs[0]) / (xs[1] - xs[0])).astype(int)
    iy = np.rint((Y - ys[0]) / (ys[1] - ys[0])).astype(int)
    ok = (ix >= 0) & (ix < len(xs)) & (iy >= 0) & (iy < len(ys))
    out = np.full(LON.shape, np.nan, dtype="float32")
    out[ok] = db[iy[ok], ix[ok]]
    return out


def process(fobj, LON, LAT):
    got = read_window(fobj, LON, LAT)
    if got is None:
        return None
    hh, hv, xs, ys, epsg = got
    hh, xs2, ys2 = multilook(hh, xs, ys)
    hv, _, _ = multilook(hv, xs, ys)
    hh, hv = to_db(hh), to_db(hv)
    edge = swath_edge(hh)
    hh[edge] = np.nan
    hv[edge] = np.nan
    return to_grid(hh, xs2, ys2, epsg, LON, LAT), to_grid(hv, xs2, ys2, epsg, LON, LAT), epsg


def describe(hh, hv):
    v = np.isfinite(hh) & np.isfinite(hv)
    info = {"percent_no_data": round(100.0 * (1 - v.mean()), 1)}
    if v.sum() == 0:
        info["glitch_suspect"] = True
        return info
    info["hh_db_p5_50_95"] = [round(float(x), 1) for x in np.percentile(hh[v], [5, 50, 95])]
    info["hv_db_p5_50_95"] = [round(float(x), 1) for x in np.percentile(hv[v], [5, 50, 95])]
    bright = float((hh[v] > GLITCH_HH_DB).mean())
    info["percent_very_bright_hh"] = round(100 * bright, 2)
    info["glitch_suspect"] = bool(bright > GLITCH_FRAC or info["percent_no_data"] > 60)
    return info


# ---------------------------------------------------------------- pictures
def scale(a, lo, hi):
    return np.clip((a - lo) / (hi - lo), 0, 1)


def save_grey(path, db, lo, hi):
    v = np.isfinite(db)
    g = (np.where(v, scale(db, lo, hi), 0) * 255).astype("uint8")
    Image.fromarray(np.dstack([g, g, g, np.where(v, 255, 0).astype("uint8")]), "RGBA").save(path)


def save_rgb(path, hh, hv):
    """Radar colour picture: red = HH, green = HV, blue = HH minus HV.
    Healthy forest looks green, burned forest turns pink/purple, water is black."""
    v = np.isfinite(hh) & np.isfinite(hv)
    r = scale(hh, -20, -2)
    g = scale(hv, -28, -10)
    b = scale(hh - hv, 3, 15)
    rgb = (np.dstack([r, g, b]) * 255)
    rgb = np.where(v[..., None], rgb, 0).astype("uint8")
    Image.fromarray(np.dstack([rgb, np.where(v, 255, 0).astype("uint8")]), "RGBA").save(path)


def save_burn(path, burn):
    rgba = np.zeros(burn.shape + (4,), dtype=np.uint8)
    rgba[burn] = (255, 60, 0, 200)
    Image.fromarray(rgba, "RGBA").save(path)


def save_dhv(path, d):
    """HV change: red = HV dropped, blue = HV rose. Stronger colour = bigger change."""
    v = np.isfinite(d)
    m = np.where(v, np.clip(d / 6.0, -1, 1), 0)
    rgba = np.zeros(d.shape + (4,), dtype=np.uint8)
    rgba[..., 0] = np.where(m < 0, 230, 40)
    rgba[..., 1] = 40
    rgba[..., 2] = np.where(m > 0, 230, 40)
    rgba[..., 3] = (np.abs(m) * 220).astype("uint8")
    Image.fromarray(rgba, "RGBA").save(path)


# ---------------------------------------------------------------- burn analysis
def smooth_nan(x, n=CHANGE_SMOOTH):
    v = np.isfinite(x)
    num = uniform_filter(np.where(v, x, 0).astype("float32"), n)
    den = uniform_filter(v.astype("float32"), n)
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(v & (den > 0.5), num / np.maximum(den, 1e-6), np.nan)


def clean(raw, px_km2):
    """Remove speckle and patches smaller than MIN_BLOB_KM2."""
    c = binary_opening(raw, structure=np.ones((3, 3), bool))
    lab, n = cc_label(c)
    sizes = np.bincount(lab.ravel(), minlength=n + 1)
    keep = sizes * px_km2 >= MIN_BLOB_KM2
    keep[0] = False
    return keep[lab], int(keep.sum())


def near(mask, LON, LAT, px_km2):
    X, Y = metric_xy(LON, LAT)
    bx, by = X[mask], Y[mask]
    out = {}
    for name, (la, lo) in PLACES.items():
        px, py = metric_xy(lo, la)
        if bx.size == 0:
            out[name] = {"km_to_nearest": None, "km2_within_2km": 0, "km2_within_5km": 0}
            continue
        d = np.hypot(bx - px, by - py)
        out[name] = {"km_to_nearest": round(float(d.min()) / 1000.0, 2),
                     "km2_within_2km": round(float((d <= 2000).sum() * px_km2), 1),
                     "km2_within_5km": round(float((d <= 5000).sum() * px_km2), 1)}
    return out


def burn_pair(b, a, LON, LAT, px_m):
    """Change between two same-address passes.
    The whole scene can shift (rain everywhere, calibration), so we subtract the scene's
    typical (median) change first and only look for places that changed MORE than that."""
    both = np.isfinite(b["hh"]) & np.isfinite(b["hv"]) & np.isfinite(a["hh"]) & np.isfinite(a["hv"])
    veg = both & (b["hv"] > FOREST_HV_DB)
    px_km2 = px_m * px_m / 1e6
    dhv = np.where(both, a["hv"] - b["hv"], np.nan)
    dhh = np.where(both, a["hh"] - b["hh"], np.nan)
    off_hv = float(np.median(dhv[veg])) if veg.any() else 0.0
    off_hh = float(np.median(dhh[veg])) if veg.any() else 0.0
    rhv = smooth_nan(dhv - off_hv)
    rhh = smooth_nan(dhh - off_hh)
    hv_drop, n1 = clean(veg & (rhv <= -BURN_DB), px_km2)
    hh_rise, n2 = clean(veg & (rhh >= HH_RISE_DB), px_km2)
    nveg = max(int(veg.sum()), 1)
    pct = lambda m: round(float(100.0 * m.sum() / nveg), 2)
    st = {
        "compared_km2": round(float(both.sum() * px_km2), 1),
        "scene_offset_db_hv_hh": [round(off_hv, 2), round(off_hh, 2)],
        "percent_forest_rel_hv_drop_1_2_3_db": [pct(veg & (rhv <= -t)) for t in (1, 2, 3)],
        "percent_forest_rel_hh_rise_1_2_3_db": [pct(veg & (rhh >= t)) for t in (1, 2, 3)],
        "burned_km2": round(float(hv_drop.sum() * px_km2), 1),
        "hv_drop_patches": n1,
        "hh_rise_km2": round(float(hh_rise.sum() * px_km2), 1),
        "hh_rise_patches": n2,
    }
    if hh_rise.any():
        st["in_hh_rise_area_median_rel_dhv_dhh"] = [round(float(np.nanmedian(rhv[hh_rise])), 2),
                                                    round(float(np.nanmedian(rhh[hh_rise])), 2)]
    st["communities_hv_drop"] = near(hv_drop, LON, LAT, px_km2)
    st["communities_hh_rise"] = near(hh_rise, LON, LAT, px_km2)
    return st, {"hv_drop": hv_drop, "hh_rise": hh_rise}, dhv - off_hv, dhh - off_hh


def save_rise(path, m):
    rgba = np.zeros(m.shape + (4,), dtype=np.uint8)
    rgba[m] = (255, 200, 0, 200)
    Image.fromarray(rgba, "RGBA").save(path)


def overlap(a, b):
    """Share of the smaller patch set that the other one also covers (0 to 1)."""
    s = min(int(a.sum()), int(b.sum()))
    return round(float((a & b).sum()) / s, 2) if s else None


# ---------------------------------------------------------------- main
def fetch(scene, start_utc, fs, LON, LAT):
    import earthaccess
    t = datetime.fromisoformat(start_utc).replace(tzinfo=None)
    t0, t1 = t.strftime("%Y-%m-%d"), (t + timedelta(days=1)).strftime("%Y-%m-%d")
    granules = earthaccess.search_data(short_name=SHORT_NAME, bounding_box=BBOX, temporal=(t0, t1))
    urls = [u for g in granules for u in g.data_links(access="external")
            if u.endswith(".h5") and scene in u]
    if not urls:
        print("  Not found in CMR. Found instead:",
              [u.split("/")[-1] for g in granules for u in g.data_links(access="external") if u.endswith(".h5")][:4])
        return None
    print("  streaming", urls[0].split("/")[-1])
    with fs.open(urls[0], cache_type="background", block_size=16 * 1024 * 1024) as fobj:
        return process(fobj, LON, LAT)


def main(mode):
    os.makedirs(CACHE, exist_ok=True)
    passes = json.load(open(os.path.join(HERE, "fire_passes.json")))["passes"]
    LON, LAT, bounds, px_m = out_grid()
    fs = None
    data = {}            # (address, day) -> dict
    for addr, days in JOBS[mode].items():
        for day in days:
            m = [p for p in passes if p["address"] == addr and p["local"].startswith(day)]
            if not m:
                print("No pass for %s on %s in fire_passes.json, skipping" % (addr, day))
                continue
            p = m[0]
            label = "%s_%s" % (addr, day)
            print("\n=== %s (%s, local %s) ===" % (label, p["phase"], p["local"]))
            cache = os.path.join(CACHE, p["scene"] + ".npz")
            if os.path.exists(cache):
                z = np.load(cache)
                hh, hv = z["hh"], z["hv"]
                print("  from cache")
            else:
                if fs is None:
                    import earthaccess
                    print("Logging in to Earthdata. Type your username and password when asked.")
                    earthaccess.login()
                    fs = earthaccess.get_fsspec_https_session()
                t = time.time()
                try:
                    res = fetch(p["scene"], p["start_utc"], fs, LON, LAT)
                except Exception as e:
                    print("  could not read:", type(e).__name__, e)
                    continue
                if res is None:
                    print("  our square is not in this file")
                    continue
                hh, hv, epsg = res
                np.savez_compressed(cache, hh=hh, hv=hv)
                print("  done in %.0f s (UTM EPSG %s)" % (time.time() - t, epsg))
            info = describe(hh, hv)
            print("  no data: %s%% | HH dB p5/50/95: %s | HV dB p5/50/95: %s | glitch suspect: %s" % (
                info["percent_no_data"], info.get("hh_db_p5_50_95"), info.get("hv_db_p5_50_95"),
                info["glitch_suspect"]))
            save_rgb(os.path.join(OUT, label + "_rgb.png"), hh, hv)
            save_grey(os.path.join(OUT, label + "_hv.png"), hv, -28, -8)
            save_grey(os.path.join(OUT, label + "_hh.png"), hh, -22, -2)
            data[(addr, day)] = {"hh": hh, "hv": hv, "phase": p["phase"], "local": p["local"],
                                 "scene": p["scene"], "info": info, "label": label}

    layers = {"bounds_south_west_north_east": bounds, "pixel_m": round(px_m, 1),
              "places": PLACES, "passes": [], "pairs": []}
    for (addr, day), d in sorted(data.items(), key=lambda kv: kv[1]["local"]):
        layers["passes"].append({"address": addr, "local": d["local"], "phase": d["phase"],
                                 "rgb": d["label"] + "_rgb.png", "hv": d["label"] + "_hv.png",
                                 "hh": d["label"] + "_hh.png", "info": d["info"]})

    all_masks = {}
    print("\n================ PAIRS (same address only) ================")
    for addr in JOBS[mode]:
        mine = sorted([d for (a, _), d in data.items() if a == addr], key=lambda d: d["local"])
        before = [d for d in mine if d["phase"] == "BEFORE"]
        later = [d for d in mine if d["phase"] in ("DURING", "AFTER")]
        pairs = []
        if len(before) >= 2:
            pairs.append(("CONTROL", before[-2], before[-1]))
        if before:
            pairs += [("FIRE", before[-1], d) for d in later]
        for kind, b, a in pairs:
            name = "%s_%s__to__%s" % (addr, b["local"][:10], a["local"][:10])
            st, masks, dhv, dhh = burn_pair(b, a, LON, LAT, px_m)
            save_burn(os.path.join(OUT, "burn_" + name + ".png"), masks["hv_drop"])
            save_rise(os.path.join(OUT, "rise_" + name + ".png"), masks["hh_rise"])
            save_dhv(os.path.join(OUT, "dhv_" + name + ".png"), dhv)
            save_dhv(os.path.join(OUT, "dhh_" + name + ".png"), dhh)
            np.save(os.path.join(CACHE, "rise_" + name + ".npy"), masks["hh_rise"])
            st.update({"kind": kind, "address": addr, "before": b["local"], "after": a["local"],
                       "burn_png": "burn_" + name + ".png", "rise_png": "rise_" + name + ".png",
                       "dhv_png": "dhv_" + name + ".png", "dhh_png": "dhh_" + name + ".png"})
            layers["pairs"].append(st)
            all_masks[(kind, addr, a["local"][:10])] = masks
            print("\n%s  %s  ->  %s  (%s)" % (kind, b["local"], a["local"], addr))
            print("  whole-scene shift removed: HV %+.2f dB, HH %+.2f dB" % tuple(st["scene_offset_db_hv_hh"]))
            print("  forest with HV drop >=1/2/3 dB: %s%% | HH rise >=1/2/3 dB: %s%%" % (
                st["percent_forest_rel_hv_drop_1_2_3_db"], st["percent_forest_rel_hh_rise_1_2_3_db"]))
            print("  HV-drop patches: %s km2 (%s) | HH-rise patches: %s km2 (%s) | inside HH-rise: rel dHV, dHH = %s" % (
                st["burned_km2"], st["hv_drop_patches"], st["hh_rise_km2"], st["hh_rise_patches"],
                st.get("in_hh_rise_area_median_rel_dhv_dhh")))
            for c, v in st["communities_hh_rise"].items():
                print("  %-18s nearest HH-rise patch %s km | within 2 km: %s km2, within 5 km: %s km2" % (
                    c, v["km_to_nearest"], v["km2_within_2km"], v["km2_within_5km"]))

    # Persistence test: a burn scar stays and shows from every orbit; rain moves and fades.
    fire = {k: v for k, v in all_masks.items() if k[0] == "FIRE"}
    ctrl = {k: v for k, v in all_masks.items() if k[0] == "CONTROL"}
    keys = sorted(fire, key=lambda k: k[2])
    if len(keys) >= 2:
        print("\n================ PERSISTENCE (HH-rise patches) ================")
        print("Number = share of the smaller patch set that the other also covers. Near 1 = same place.")
        agree = []
        for i in range(len(keys)):
            for j in range(i + 1, len(keys)):
                o = overlap(fire[keys[i]]["hh_rise"], fire[keys[j]]["hh_rise"])
                agree.append({"a": list(keys[i][1:]), "b": list(keys[j][1:]), "overlap": o})
                print("  %s %s  vs  %s %s : %s" % (keys[i][1], keys[i][2], keys[j][1], keys[j][2], o))
        for kc in ctrl:
            for kf in keys:
                o = overlap(ctrl[kc]["hh_rise"], fire[kf]["hh_rise"])
                print("  (control %s vs %s %s : %s)" % (kc[2], kf[1], kf[2], o))
        layers["persistence"] = agree

    with open(os.path.join(OUT, "layers.json"), "w") as f:
        json.dump(layers, f, indent=1)
    print("\nFinished. Pictures and layers.json are in out_fire/")


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in JOBS:
        print("Usage: python fire_window.py check   (or full)")
        sys.exit(1)
    main(sys.argv[1])
