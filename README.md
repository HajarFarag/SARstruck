# Seeing Through Smoke

NASA Space Apps Challenge 2026, "Dancing with the SARs".

In July 2026, wildfires forced Armstrong, Whitesand First Nation and Collins First Nation (northwestern Ontario) to evacuate. Smoke hid the ground from satellite cameras. We used NISAR radar (NASA and ISRO), which sees through smoke, to map where the forest burned around these communities and how close the fire came to homes.

**Website:** link coming (served from the `docs/` folder with GitHub Pages)

## What we found

- About 200 km2 of burned forest inside a 50 x 50 km square around the communities (55 to 340 km2 depending on the cutoff).
- The burn reaches Collins First Nation. The nearest burned forest is 5.8 km from Armstrong and 8.0 km from the Whitesand reserve.
- Four NISAR orbits, each looking from a different angle, show the same burn pattern (map agreement 0.70 to 0.94). A control pair from before the fire shows no change.
- Right after the fire, HH brightened slightly. By mid August, HV had dropped about 1.4 dB in burned forest. HV gives the clearest burn map.

## How to run it

Needs Python 3 and a free NASA Earthdata login.

```
pip install -r requirements.txt
python dates_fire.py            # 1. list NISAR passes over the area (downloads nothing)
python fire_window.py full      # 2. stream a 50 km window from each pass, about 10 minutes
python burn_consensus.py        # 3. combine 4 orbits into the final burn map, a few seconds
```

Results go to `out_fire/`. The scripts never download whole files (each is about 20 GB); they stream only the small window they need.

## Files

| File | What it does |
| --- | --- |
| `dates_fire.py` | Finds NISAR passes before, during and after the fire, grouped by orbit |
| `fire_window.py` | Streams HH and HV radar for each pass, maps change, runs a no-fire control |
| `burn_consensus.py` | Averages 4 orbits into the final burn map and distances to each community |
| `fire_passes.json`, `fire_dates.txt` | The pass list from step 1 |
| `out_fire/` | Final results (`layers.json`, `burn_final.png`, `proof_4_orbits.png`) |
| `docs/` | The website (Leaflet map, before/after slider, story) |

## Data

- NISAR Level 2 GCOV, provisional release (NASA and ISRO), from the Alaska Satellite Facility.
- Base map: OpenStreetMap contributors.

## Limits

This is a record made after the fire, not a live warning. The data is provisional (not fully calibrated). The map works at 30 m and can't show individual houses. The HV drop is small, so the exact burn edge depends on the cutoff. See the website for details.

## Team

Names coming.

## NASA FIRMS check (added Sunday)

`data/firms/` holds NASA FIRMS fire detections (VIIRS 375 m, NOAA-20) for July 10 to August 8, 2026, downloaded from the FIRMS area API.

```
python make_firms_layer.py      # 4. fire detections -> website layer, and a check against the radar burn map
```

- 96% of the forest our radar flags as burned had a NASA fire detection within 375 m, compared with 57% of all land in the area.
- Fire was detected over a larger area than the radar flags, so the radar burn map is cautious.
- NASA first saw fire within 2 km of Collins at 3:19 a.m. on July 14 (local time). The closest detection to Armstrong was 5.0 km, and 3.3 km to the Whitesand reserve.

