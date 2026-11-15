// Results from burn_consensus.py (NISAR GCOV, 4 orbits). Regenerate if the analysis changes.
window.SITE = {
 "bounds": [
  [
   50.0754,
   -89.6016
  ],
  [
   50.5246,
   -88.8984
  ]
 ],
 "places": {
  "Armstrong": [
   50.3,
   -89.05
  ],
  "Whitesand First Nation (reserve)": [
   50.317,
   -89.033
  ],
  "Collins First Nation (Namaygoosisagagun)": [
   50.295,
   -89.45
  ]
 },
 "keys": {
  "Armstrong": "Armstrong",
  "Whitesand First Nation (reserve)": "Whitesand_reserve",
  "Collins First Nation (Namaygoosisagagun)": "Collins"
 },
 "final": {
  "method": "mean HV change over 4 orbits, early July to mid August, scene median removed, smoothed 15 px, burned if <= -1.0 dB, patches >= 1 km2",
  "burned_km2_in_50km_square": 207.1,
  "square_km2": 2500,
  "burned_km2_if_threshold_db": {
   "0.75": 338.6,
   "1.0": 207.1,
   "1.5": 54.6
  },
  "control_pair_km2_same_method": 0.0,
  "orbit_map_correlations": {
   "041_D_063 vs 119_A_027": 0.94,
   "041_D_063 vs 113_D_063": 0.86,
   "041_D_063 vs 047_A_027": 0.86,
   "119_A_027 vs 113_D_063": 0.88,
   "119_A_027 vs 047_A_027": 0.84,
   "113_D_063 vs 047_A_027": 0.7
  },
  "median_orbits_agreeing_in_burn": 3,
  "median_hv_change_db_in_burn": -1.4,
  "july_hh_change_db_in_burn_vs_outside": [
   0.39,
   -0.06
  ],
  "communities": {
   "Armstrong": {
    "inside_burn": false,
    "km_to_burn_edge": 5.8,
    "burned_km2_within_5km": 0.0,
    "burned_km2_within_10km": 12.5
   },
   "Whitesand_reserve": {
    "inside_burn": false,
    "km_to_burn_edge": 8.0,
    "burned_km2_within_5km": 0.0,
    "burned_km2_within_10km": 4.8
   },
   "Collins": {
    "inside_burn": false,
    "km_to_burn_edge": 0.1,
    "burned_km2_within_5km": 19.3,
    "burned_km2_within_10km": 45.1
   }
  },
  "burn_png": "burn_final.png",
  "slider_before": "slider_before.png",
  "slider_before_date": "2026-07-10 (orbit 041, descending)",
  "slider_after": "slider_after.png",
  "slider_after_date": "2026-08-15 (orbit 041, descending)"
 }
};
