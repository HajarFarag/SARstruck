"""
dates_fire.py  (wildfire catalog check, downloads nothing)

What it does, in plain words:
  1. Asks the ASF catalog for every NISAR GCOV pass over the Armstrong / Whitesand / Collins
     area between START and END.
  2. Works out each pass's "address" (track, direction, frame). Only same-address passes
     can be compared, because only those look at the ground from the same angle.
  3. Labels each pass BEFORE / FIRE_START / DURING / AFTER the July 2026 fire
     (using Ontario local time, so evening passes get the right day).
  4. For each community, prints GO if one address has a BEFORE pass and a DURING or AFTER
     pass that both cover it and both have the HV channel. Otherwise NO-GO.
  5. Saves fire_dates.txt (readable) and fire_passes.json (for the next script).

Run:  python dates_fire.py
"""
import json
import os
from datetime import datetime, date, timezone, timedelta

START, END = "2026-06-17", "2026-08-31"
W, S, E, N = -89.70, 50.10, -88.70, 50.50          # box around all three communities
PLACES = {                                          # (lat, lon), west is negative
    "Armstrong": (50.300, -89.050),
    "Whitesand_reserve": (50.317, -89.033),
    "Collins": (50.295, -89.450),
}
LOCAL = timezone(timedelta(hours=-4))               # Ontario summer time (EDT)
HERE = os.path.dirname(os.path.abspath(__file__))


def phase(local_day):
    if local_day < date(2026, 7, 12):
        return "BEFORE"
    if local_day < date(2026, 7, 14):
        return "FIRE_START"                          # fire starting, evacuations Jul 13
    if local_day <= date(2026, 7, 27):
        return "DURING"
    if local_day >= date(2026, 8, 10):
        return "AFTER"
    return "GAP"                                     # permanent data gap Jul 27 to Aug 10


def parse_name(scene):
    """address and polarization token from the file name."""
    parts = scene.split("_")
    i = parts.index("GCOV")
    track, direc, frame = parts[i + 2], parts[i + 3], parts[i + 4]
    pol = parts[i + 6] if len(parts) > i + 6 else "?"
    return "%s_%s_%s" % (track, direc, frame), pol


def has_hv(pol):
    # DH = dual pol with H transmit (HH + HV). QP/QQ/QD = quad pol. SH = HH only.
    return pol[:2] in ("DH", "QP", "QQ", "QD")


def analyze(rows):
    """rows: list of dicts with scene, start_utc (datetime), covers (list of place names)."""
    for r in rows:
        r["address"], r["pol"] = parse_name(r["scene"])
        r["hv"] = has_hv(r["pol"])
        loc = r["start_utc"].astimezone(LOCAL)
        r["local"] = loc.strftime("%Y-%m-%d %H:%M")
        r["phase"] = phase(loc.date())
    rows.sort(key=lambda r: r["start_utc"])

    by_addr = {}
    for r in rows:
        by_addr.setdefault(r["address"], []).append(r)

    out = []
    verdict = {}
    for place in PLACES:
        best = []
        for addr, rs in sorted(by_addr.items()):
            ok = [r for r in rs if place in r["covers"] and r["hv"]]
            before = [r for r in ok if r["phase"] == "BEFORE"]
            during = [r for r in ok if r["phase"] == "DURING"]
            after = [r for r in ok if r["phase"] == "AFTER"]
            if before and (during or after):
                best.append({
                    "address": addr,
                    "before": before[-1]["scene"],          # last pass before the fire
                    "before_local": before[-1]["local"],
                    "during": [r["scene"] for r in during],
                    "during_local": [r["local"] for r in during],
                    "after_first": after[0]["scene"] if after else None,
                    "after_first_local": after[0]["local"] if after else None,
                })
        verdict[place] = best
        out.append("")
        out.append("%s: %s (%d usable address%s)" % (
            place, "GO" if best else "NO-GO", len(best), "" if len(best) == 1 else "es"))
        for b in best:
            out.append("  address %s | before %s | during: %s | first after: %s" % (
                b["address"], b["before_local"],
                ", ".join(b["during_local"]) or "none", b["after_first_local"] or "none"))

    out.append("")
    out.append("ALL PASSES (local Ontario time | phase | address | pol | HV? | covers)")
    for r in rows:
        out.append("%s | %-10s | %s | %s | %s | %s" % (
            r["local"], r["phase"], r["address"], r["pol"], "HV" if r["hv"] else "no HV",
            ",".join(r["covers"]) or "none of the 3 points"))
    return out, verdict


def search():
    import asf_search as asf
    from shapely.geometry import shape, Point
    opts = asf.ASFSearchOptions(**{
        "dataset": ["NISAR"],
        "processingLevel": ["GCOV"],
        "intersectsWith": "POLYGON((%s %s, %s %s, %s %s, %s %s, %s %s))" % (
            W, S, E, S, E, N, W, N, W, S),
        "start": START,
        "end": END,
        "productionConfiguration": ["PR"],
    })
    rows, seen = [], set()
    for r in asf.search(opts=opts):
        p = r.properties
        scene = p.get("sceneName") or p.get("fileID") or ""
        if "GCOV" not in scene or scene in seen:
            continue
        seen.add(scene)
        try:
            geom = shape(r.geometry)
            covers = [k for k, (la, lo) in PLACES.items() if geom.contains(Point(lo, la))]
        except Exception:
            covers = list(PLACES)                    # no footprint: assume yes, window check will tell
        t = datetime.fromisoformat(str(p["startTime"]).replace("Z", "+00:00"))
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        rows.append({"scene": scene, "start_utc": t, "covers": covers})
    return rows


if __name__ == "__main__":
    rows = search()
    print("Catalog returned %d GCOV scenes." % len(rows))
    lines, verdict = analyze(rows)
    text = "\n".join(lines)
    print(text)
    with open(os.path.join(HERE, "fire_dates.txt"), "w") as f:
        f.write("Catalog returned %d GCOV scenes.\n%s\n" % (len(rows), text))
    for r in rows:
        r["start_utc"] = r["start_utc"].isoformat()
    with open(os.path.join(HERE, "fire_passes.json"), "w") as f:
        json.dump({"places": PLACES, "verdict": verdict, "passes": rows}, f, indent=1)
    print("\nSaved fire_dates.txt and fire_passes.json")
