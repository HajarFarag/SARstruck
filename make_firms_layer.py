"""
make_firms_layer.py  (NASA FIRMS fire detections -> website layer + check against the radar)

What it does, in plain words:
  1. Reads the FIRMS CSV files in data/firms/ (VIIRS 375 m fire detections from NASA).
  2. Converts each detection's time from UTC to Ontario summer time and groups them by day.
  3. For each community: when was fire first seen within 10, 5 and 2 km, and how close
     did the nearest detection get?
  4. Checks the radar burn map (out_fire/burn_final.png) against the detections:
       - how much of the radar-burned forest had a NASA fire detection nearby
       - how many detections fall on or near the radar-burned forest
  5. Writes docs/firms.js (used by the website) and out_fire/firms_stats.json.

Run:  python make_firms_layer.py      (a few seconds, no download)
"""
import os
import csv
import glob
import json
from datetime import datetime, timedelta, date

import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt

HERE = os.path.dirname(os.path.abspath(__file__))
S, W, N, E = 50.0754, -89.6016, 50.5246, -88.8984   # radar square (same grid as the other scripts)
P = 1600
PX_M = 50000.0 / (P - 1)
FIRST_DAY, LAST_DAY = date(2026, 7, 10), date(2026, 8, 8)
LOCAL = timedelta(hours=-4)                          # Ontario summer time
PLACES = {"Armstrong": (50.300, -89.050), "Whitesand_reserve": (50.317, -89.033), "Collins": (50.295, -89.450)}


def xy(lat, lon):
    return ((np.asarray(lon) - (-89.25)) * 111320.0 * np.cos(np.radians(50.3)),
            (np.asarray(lat) - 50.3) * 110574.0)


def main():
    rows = []
    for f in sorted(glob.glob(os.path.join(HERE, "data", "firms", "*.csv"))):
        for r in csv.DictReader(open(f, newline="")):
            t = datetime.strptime(r["acq_date"] + r["acq_time"].zfill(4), "%Y-%m-%d%H%M") + LOCAL
            rows.append((float(r["latitude"]), float(r["longitude"]), t))
    rows = sorted(set(rows), key=lambda x: x[2])          # drop duplicates, oldest first
    days = [(FIRST_DAY + timedelta(d)).isoformat() for d in range((LAST_DAY - FIRST_DAY).days + 1)]
    idx = {d: i for i, d in enumerate(days)}
    lat = np.array([r[0] for r in rows])
    lon = np.array([r[1] for r in rows])
    when = [r[2] for r in rows]
    pts = [[round(a, 4), round(b, 4), idx[t.date().isoformat()]] for a, b, t in rows if t.date().isoformat() in idx]

    # community arrival times
    comm = {}
    X, Y = xy(lat, lon)
    for name, (la, lo) in PLACES.items():
        px, py = xy(la, lo)
        d = np.hypot(X - px, Y - py)
        c = {"closest_detection_km": round(float(d.min()) / 1000, 1) if d.size else None}
        for km in (10, 5, 2):
            hit = np.nonzero(d <= km * 1000)[0]
            c["first_detection_within_%dkm" % km] = when[hit[0]].strftime("%Y-%m-%dT%H:%M") if hit.size else None
        comm[name] = c

    # check against the radar burn map
    burn = np.array(Image.open(os.path.join(HERE, "out_fire", "burn_final.png")))[..., 3] > 0
    ins = (lat >= S) & (lat <= N) & (lon >= W) & (lon <= E)
    r = np.round((N - lat[ins]) / (N - S) * (P - 1)).astype(int)
    c = np.round((lon[ins] - W) / (E - W) * (P - 1)).astype(int)
    dist_to_burn = distance_transform_edt(~burn) * PX_M
    det = np.zeros_like(burn)
    det[r, c] = True
    dist_to_det = distance_transform_edt(~det) * PX_M
    d_pts = dist_to_burn[r, c]
    # fair comparison: how much of ALL land in the square had a detection that close?
    # (water = very dark pixels in the August radar picture)
    radar = np.array(Image.open(os.path.join(HERE, "docs", "img", "after.jpg"))).astype(float)
    land = radar.sum(axis=2) >= 120
    stats = {
        "detections_total": len(rows),
        "detections_in_square": int(ins.sum()),
        "detections_per_day": {d: int(sum(1 for p in pts if p[2] == i)) for i, d in enumerate(days)},
        "share_radar_burn_within_375m_of_a_detection": round(float(np.mean(dist_to_det[burn] <= 375)), 3),
        "share_radar_burn_within_750m_of_a_detection": round(float(np.mean(dist_to_det[burn] <= 750)), 3),
        "share_of_land_within_375m_of_a_detection": round(float(np.mean(dist_to_det[land] <= 375)), 3),
        "share_of_land_flagged_burned_by_radar": round(float(np.mean(burn[land])), 3),
        "share_detections_within_375m_of_radar_burn": round(float(np.mean(d_pts <= 375)), 3),
        "share_detections_within_1500m_of_radar_burn": round(float(np.mean(d_pts <= 1500)), 3),
        "share_of_square_within_375m_of_radar_burn": round(float(np.mean(dist_to_burn <= 375)), 3),
        "communities": comm,
        "source": "NASA FIRMS, VIIRS 375 m active fire (NOAA-20), standard processing",
    }

    with open(os.path.join(HERE, "docs", "firms.js"), "w") as f:
        f.write("// NASA FIRMS fire detections, made by make_firms_layer.py. [lat, lon, day index]\n")
        f.write("window.FIRMS = " + json.dumps({"days": days, "pts": pts, "stats": stats}, separators=(",", ":")) + ";\n")
    with open(os.path.join(HERE, "out_fire", "firms_stats.json"), "w") as f:
        json.dump(stats, f, indent=1)

    print("Detections: %d total, %d inside the radar square" % (stats["detections_total"], stats["detections_in_square"]))
    print("Per day:", {k: v for k, v in stats["detections_per_day"].items() if v})
    print("Radar-burned forest with a detection within 375 m: %.0f%% (all land: %.0f%%)" % (
        100 * stats["share_radar_burn_within_375m_of_a_detection"], 100 * stats["share_of_land_within_375m_of_a_detection"]))
    print("Detections on or within 375 m of radar burn: %.0f%% (by chance alone: %.0f%%)" % (
        100 * stats["share_detections_within_375m_of_radar_burn"], 100 * stats["share_of_square_within_375m_of_radar_burn"]))
    for k, v in comm.items():
        print("  %-18s %s" % (k, v))
    print("Saved docs/firms.js and out_fire/firms_stats.json")


if __name__ == "__main__":
    main()
