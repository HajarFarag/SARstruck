/* One Road Out: a map-first story of the 2026 Thunder Bay 36 fire.
   Data comes from data/story.js (story.json + geojson), data/nisar.js (real NISAR passes)
   and firms.js (NASA FIRMS detections). Nothing in the story text is generated here. */
(() => {
  "use strict";
  const S = window.STORY, G = window.GEO, NI = window.NISAR, FI = window.FIRMS;
  const META = S.meta;
  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ------------------------------------------------------------ dates
  const DAYS = [];
  for (let t = Date.parse(META.slider.start + "T12:00:00Z"); t <= Date.parse(META.slider.end + "T12:00:00Z"); t += 86400000) {
    DAYS.push(new Date(t).toISOString().slice(0, 10));
  }
  const dayIdx = (iso) => DAYS.indexOf(iso);
  const fmt = (iso, o) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-CA", Object.assign({ timeZone: "UTC" }, o));
  const fmtLong = (iso) => fmt(iso, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const fmtDay = (iso) => fmt(iso, { month: "long", day: "numeric", year: "numeric" });
  const fmtShort = (iso) => fmt(iso, { month: "short", day: "numeric" });

  // ------------------------------------------------------------ scenes
  // The radar scene's date is the first NISAR pass after the fire (from our real pass list).
  const firstAfter = (NI.passes || []).find((p) => p.phase === "AFTER");
  S.scenes.forEach((s) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date)) s.date = firstAfter ? firstAfter.date : META.slider.end; });
  const HOOK = S.scenes.find((s) => s.id === "hook");
  const SCENES = S.scenes.filter((s) => s.id !== "hook");

  // ------------------------------------------------------------ communities
  const COMM = G.communities.features;
  const commById = Object.fromEntries(COMM.map((f) => [f.properties.id, f]));
  // Names communities use first (story.json representation rules)
  const displayName = (p) => p.name
    .replace(/ First Nation \(Collins\)$/, " (Collins)")
    .replace(/ \(Gull Bay First Nation\)$/, " (Gull Bay)");

  // ------------------------------------------------------------ FIRMS
  const FIRMS_OFFSET = dayIdx(FI.days[0]);                  // FIRMS day 0 = July 10
  const FIRMS_FIRST = FIRMS_OFFSET, FIRMS_LAST = FIRMS_OFFSET + FI.days.length - 1;
  const FIRMS_BOX = [-89.8, 50.0, -88.7, 50.6];             // area we downloaded (W, S, E, N)
  const firmsByDay = new Map();
  const firmsFC = { type: "FeatureCollection", features: [] };
  for (const [la, lo, d] of FI.pts) {
    const k = d + FIRMS_OFFSET;
    firmsFC.features.push({ type: "Feature", geometry: { type: "Point", coordinates: [lo, la] }, properties: { d: k } });
    if (!firmsByDay.has(k)) firmsByDay.set(k, []);
    firmsByDay.get(k).push([la, lo]);
  }
  const perDay = DAYS.map((_, i) => (firmsByDay.get(i) || []).length);
  const km = (la1, lo1, la2, lo2) => {
    const r = Math.PI / 180, a = Math.sin((la2 - la1) * r / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin((lo2 - lo1) * r / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(a));
  };

  // ------------------------------------------------------------ NISAR
  const NB = NI.bounds;
  const BLANK = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const onOrBefore = (list, iso) => { let best = null; for (const x of list) if (x.date <= iso) best = x; return best; };
  const preFor = (iso) => onOrBefore(NI.pre, iso) || NI.pre[0];
  const changeFor = (iso) => onOrBefore(NI.change, iso);
  const afterFor = (iso) => onOrBefore(NI.radar_after, iso);
  const orbitName = (o) => "orbit " + o.slice(0, 3);

  // ------------------------------------------------------------ closure
  const CL = G.closure.features[0].properties;
  const roadClosed = (iso) => iso >= CL.closed_from && iso < CL.reopened;

  // ------------------------------------------------------------ layers shown in the panel
  const LAYERS = [
    { id: "firms", label: "FIRMS hotspots (VIIRS, daily)", sw: "#ff8a3d" },
    { id: "truecolor", label: "NASA GIBS VIIRS true color", sw: "#8fb8de" },
    { id: "aod", label: "Smoke from space (AOD)", sw: "#c9a36b" },
    { id: "nisar_pre", label: "Pre-fire forest (NISAR L-band backscatter)", sw: "#9fd36a" },
    { id: "nisar_change", label: "Radar change after fire (NISAR)", sw: "#d63aff" },
    { id: "roads", label: "Highways 527 and 811", sw: "#d9d4cc" },
    { id: "closure", label: "Highway 527 closure", sw: "#ff4d4d" },
    { id: "communities", label: "Communities", sw: "#fff1e0" },
  ];
  const GROUPS = {
    firms: ["firms-glow", "firms-core"], truecolor: ["truecolor"], aod: ["aod"],
    nisar_pre: ["nisar_pre"], nisar_change: ["nisar_change"],
    roads: ["roads-hl", "roads-811", "roads-527"], closure: ["closure-glow", "closure"], communities: [],
  };
  function layerMeta(id) {
    const d = state.date, i = dayIdx(d);
    switch (id) {
      case "firms":
        if (i < FIRMS_FIRST || i > FIRMS_LAST) return "NASA FIRMS, NOAA-20. No data loaded for this day.";
        return `NASA FIRMS, NOAA-20. ${perDay[i].toLocaleString()} detections on ${fmtShort(d)}; earlier days dimmer.`;
      case "truecolor": return `NOAA-20 satellite photo for ${fmtShort(d)}.`;
      case "aod": return `NOAA-20 Deep Blue aerosol optical depth for ${fmtShort(d)}. Not an air quality index.`;
      case "nisar_pre": { const p = preFor(d); return `Green shows the radar echo from branches and trunks (HV). Pass of ${fmtShort(p.date)}, ${orbitName(p.orbit)}.`; }
      case "nisar_change": {
        const c = changeFor(d);
        return c ? `Magenta = radar echo from the canopy dropped. Pass of ${fmtShort(c.date)}, ${orbitName(c.orbit)}, compared with ${fmtShort(c.compared_with)}.`
                 : "No NISAR pass since the fire began, as of this date.";
      }
      case "roads": return "OpenStreetMap.";
      case "closure": return roadClosed(d) ? `Closed: ${CL.segment}.` : (d >= CL.reopened ? "Reopened (green)." : "Shown once the closure starts.");
      case "communities": return "Circle size shows population where there is an official count.";
    }
    return "";
  }

  // ------------------------------------------------------------ state
  const state = {
    date: META.slider.start, on: new Set(), selected: "whitesand", mode: "story",
    scene: -1, paused: false, theme: "dark", compare: false, playing: null, highlight: null,
  };
  const cur = {};                       // what each source currently shows
  let styleReady = false;

  // ------------------------------------------------------------ map
  const STYLE = {
    dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
    light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  };
  const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/";
  // NOAA-20: the S-NPP true color layer has no images for July 14 and 15, 2026 in GIBS.
  const tcURL = (d) => `${GIBS}VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/${d}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`;
  const aodURL = (d) => `${GIBS}VIIRS_NOAA20_AOD_Deep_Blue_Land_Ocean/default/${d}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`;

  let map;
  try {
    map = new maplibregl.Map({
      container: "map", style: STYLE.dark,
      center: META.default_view.center, zoom: META.default_view.zoom,
      attributionControl: false, dragRotate: false, pitchWithRotate: false, maxZoom: 13, minZoom: 4,
    });
  } catch (e) {
    $("nogl").hidden = false;
    return;
  }
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "NASA FIRMS, NASA GIBS, NISAR (NASA and ISRO, ASF DAAC)" }), "bottom-right");
  map.once("load", () => {   // start with the credits collapsed to the small (i) button
    const a = document.querySelector(".maplibregl-ctrl-attrib");
    if (a) a.classList.remove("maplibregl-compact-show");
  });
  map.on("error", (e) => { if (window.console) console.warn("map:", e && e.error ? e.error.message : e); });

  // fire colours by age: today white-hot, last days orange, older embers dim red
  const age = (i) => ["-", i, ["get", "d"]];
  const firmsFilter = (i) => ["<=", ["get", "d"], i];
  const coreColor = (i) => ["case", ["==", age(i), 0], "#ffe7a3", ["<=", age(i), 2], "#ff7a1a", "#9c2b18"];
  const coreOpacity = (i) => ["case", ["==", age(i), 0], 1, ["<=", age(i), 2], 0.85, 0.42];
  const glowOpacity = (i) => ["case", ["==", age(i), 0], 0.2, ["==", age(i), 1], 0.09, 0];

  function addLayers() {
    const style = map.getStyle();
    const firstSymbol = (style.layers.find((l) => l.type === "symbol") || {}).id;
    const i = dayIdx(state.date);
    const pre = preFor(state.date), ch = changeFor(state.date);
    cur.truecolor = tcURL(state.date); cur.aod = aodURL(state.date);
    cur.pre = pre.file; cur.change = ch ? ch.file : BLANK;
    const hidden = { visibility: "none" };
    const dark = state.theme === "dark";

    map.addSource("truecolor", { type: "raster", tiles: [cur.truecolor], tileSize: 256, maxzoom: 9, attribution: "Imagery: NASA GIBS (VIIRS NOAA-20)" });
    map.addSource("aod", { type: "raster", tiles: [cur.aod], tileSize: 256, maxzoom: 6, attribution: "AOD: NASA GIBS (VIIRS NOAA-20 Deep Blue)" });
    map.addSource("nisar_pre", { type: "image", url: cur.pre, coordinates: NB });
    map.addSource("nisar_change", { type: "image", url: cur.change, coordinates: NB });
    map.addSource("roads", { type: "geojson", data: G.roads });
    map.addSource("closure", { type: "geojson", data: G.closure });
    map.addSource("evac", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addSource("firms", { type: "geojson", data: firmsFC, attribution: "Fire detections: NASA FIRMS" });

    map.addLayer({ id: "truecolor", type: "raster", source: "truecolor", layout: hidden, paint: { "raster-opacity": 0.92, "raster-fade-duration": 250 } }, firstSymbol);
    map.addLayer({ id: "aod", type: "raster", source: "aod", layout: hidden, paint: { "raster-opacity": 0.7, "raster-fade-duration": 250 } }, firstSymbol);
    map.addLayer({ id: "nisar_pre", type: "raster", source: "nisar_pre", layout: hidden, paint: { "raster-opacity": 0.95, "raster-fade-duration": 0 } }, firstSymbol);
    map.addLayer({ id: "nisar_change", type: "raster", source: "nisar_change", layout: hidden, paint: { "raster-opacity": 1, "raster-fade-duration": 0 } }, firstSymbol);
    map.addLayer({ id: "roads-hl", type: "line", source: "roads", filter: ["==", ["get", "id"], "hwy527"], layout: Object.assign({ "line-cap": "round", "line-join": "round" }, hidden),
      paint: { "line-color": "#ffd27a", "line-width": ["interpolate", ["linear"], ["zoom"], 5, 7, 10, 16], "line-blur": 6, "line-opacity": 0 } }, firstSymbol);
    map.addLayer({ id: "roads-811", type: "line", source: "roads", filter: ["==", ["get", "id"], "hwy811"], layout: Object.assign({ "line-cap": "round" }, hidden),
      paint: { "line-color": dark ? "#9a9590" : "#6a6f75", "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.8, 10, 1.8], "line-dasharray": [2, 2] } }, firstSymbol);
    map.addLayer({ id: "roads-527", type: "line", source: "roads", filter: ["==", ["get", "id"], "hwy527"], layout: Object.assign({ "line-cap": "round", "line-join": "round" }, hidden),
      paint: { "line-color": dark ? "#e8e2d8" : "#3d4248", "line-width": ["interpolate", ["linear"], ["zoom"], 5, 1.6, 10, 3.4] } }, firstSymbol);
    map.addLayer({ id: "closure-glow", type: "line", source: "closure", layout: Object.assign({ "line-cap": "round" }, hidden),
      paint: { "line-color": "#ff4d4d", "line-width": ["interpolate", ["linear"], ["zoom"], 5, 8, 10, 18], "line-blur": 8, "line-opacity": 0.45 } }, firstSymbol);
    map.addLayer({ id: "closure", type: "line", source: "closure", layout: Object.assign({ "line-cap": "round", "line-join": "round" }, hidden),
      paint: { "line-color": "#ff4d4d", "line-width": ["interpolate", ["linear"], ["zoom"], 5, 3, 10, 6] } }, firstSymbol);
    map.addLayer({ id: "firms-glow", type: "circle", source: "firms", filter: firmsFilter(i), layout: hidden,
      paint: { "circle-color": "#ff7a1a", "circle-blur": 1, "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 5, 8, 11, 12, 26], "circle-opacity": glowOpacity(i) } }, firstSymbol);
    map.addLayer({ id: "firms-core", type: "circle", source: "firms", filter: firmsFilter(i), layout: hidden,
      paint: { "circle-color": coreColor(i), "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 1.1, 8, 2.2, 12, 5], "circle-opacity": coreOpacity(i) } }, firstSymbol);
    map.addLayer({ id: "evac-glow", type: "line", source: "evac", filter: ["==", ["get", "k"], "road"], layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#ffe1a8", "line-width": 12, "line-blur": 9, "line-opacity": 0.55 } });
    map.addLayer({ id: "evac", type: "line", source: "evac", filter: ["==", ["get", "k"], "road"], layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#fff4de", "line-width": 3 } });
    map.addLayer({ id: "evac-tb", type: "line", source: "evac", filter: ["==", ["get", "k"], "tb"], layout: { "line-cap": "round" },
      paint: { "line-color": "#fff4de", "line-width": 2, "line-dasharray": [1.5, 1.5] } });
    map.addLayer({ id: "evac-head", type: "circle", source: "evac", filter: ["==", ["get", "k"], "head"],
      paint: { "circle-radius": 6, "circle-color": "#fff4de", "circle-blur": 0.25, "circle-stroke-width": 2, "circle-stroke-color": "rgba(255,180,90,0.6)" } });
  }

  function setTiles(id, url) {
    const src = map.getSource(id);
    if (!src || cur[id] === url) return;
    if (typeof src.setTiles === "function") src.setTiles([url]);
    cur[id] = url;
  }
  function setImage(id, key, url) {
    const src = map.getSource(id);
    if (!src || cur[key] === url) return;
    src.updateImage({ url, coordinates: NB });
    cur[key] = url;
  }

  let lastTiles = 0;
  function updateDateLayers(playing) {
    if (!styleReady) return;
    const i = dayIdx(state.date);
    map.setFilter("firms-core", firmsFilter(i));
    map.setFilter("firms-glow", firmsFilter(i));
    map.setPaintProperty("firms-core", "circle-color", coreColor(i));
    map.setPaintProperty("firms-core", "circle-opacity", coreOpacity(i));
    map.setPaintProperty("firms-glow", "circle-opacity", glowOpacity(i));
    const now = performance.now();
    if (!playing || now - lastTiles > 1200) {         // don't ask NASA for every day while playing fast
      setTiles("truecolor", tcURL(state.date));
      setTiles("aod", aodURL(state.date));
      lastTiles = now;
    }
    setImage("nisar_pre", "pre", preFor(state.date).file);
    const ch = changeFor(state.date);
    setImage("nisar_change", "change", ch ? ch.file : BLANK);
    const closed = roadClosed(state.date);
    map.setPaintProperty("closure", "line-color", closed ? "#ff4d4d" : "#3ddc84");
    map.setPaintProperty("closure-glow", "line-color", closed ? "#ff4d4d" : "#3ddc84");
    map.setPaintProperty("closure-glow", "line-opacity", closed ? 0.45 : 0.2);
    applyVisibility();
    if (state.compare) updateCompare();
  }

  function applyVisibility() {
    if (styleReady) {
      for (const [id, layers] of Object.entries(GROUPS)) {
        let on = state.on.has(id);
        if (id === "nisar_change" && state.compare) on = false;          // shown on the right of the swipe
        if (id === "closure" && state.date < CL.closed_from) on = false;  // nothing to show before it closed
        for (const l of layers) if (map.getLayer(l)) map.setLayoutProperty(l, "visibility", on ? "visible" : "none");
      }
      map.setPaintProperty("roads-hl", "line-opacity", state.highlight === "hwy527" ? 0.6 : 0);
    }
    const showComm = state.on.has("communities");
    for (const [id, m] of Object.entries(markers)) {
      const el = m.getElement();
      el.style.display = showComm ? "" : "none";
      el.classList.toggle("pulse", state.highlight === id);
      el.classList.toggle("sel", state.selected === id);
    }
    document.querySelectorAll(".layer input").forEach((cb) => { cb.checked = state.on.has(cb.dataset.id); });
  }

  // ------------------------------------------------------------ community markers (HTML, so they sit above everything)
  const markers = {};
  let popup = null, pinned = false;
  function showPopup(f, pin) {
    const p = f.properties;
    if (popup) popup.remove();
    const src = p.source ? `<br><a class="pop-src" href="${esc(p.source)}" target="_blank" rel="noopener">Source</a>` : "";
    popup = new maplibregl.Popup({ closeButton: !!pin, closeOnClick: false, offset: 14, maxWidth: "260px" })
      .setLngLat(f.geometry.coordinates)
      .setHTML(`<span class="pop-name">${esc(displayName(p))}</span>${esc(p.population_label)}${src}`)
      .addTo(map);
    pinned = !!pin;
    popup.on("close", () => { pinned = false; });
  }
  for (const f of COMM) {
    const p = f.properties;
    const el = document.createElement("div");
    el.className = `cm ${p.marker} ${p.kind}${p.destroyed ? " lost" : ""} lbl-${{ collins: "left", armstrong: "below" }[p.id] || "right"}`;
    const size = p.marker === "scaled" && p.population ? Math.round(8 + 1.05 * Math.sqrt(p.population)) : 12;
    el.innerHTML = `<span class="dot" style="width:${size}px;height:${size}px"></span><span class="lbl">${esc(displayName(p))}</span>`;
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    el.setAttribute("aria-label", `${displayName(p)}: ${p.population_label}`);
    el.addEventListener("mouseenter", () => { if (!pinned) showPopup(f, false); });
    el.addEventListener("mouseleave", () => { if (!pinned && popup) { popup.remove(); popup = null; } });
    const pick = (e) => { e.stopPropagation(); state.selected = p.id; showPopup(f, true); updateHUD(); applyVisibility(); };
    el.addEventListener("click", pick);
    el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") pick(e); });
    markers[p.id] = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(f.geometry.coordinates).addTo(map);
  }

  // ------------------------------------------------------------ HUD
  function updateHUD() {
    $("hud-date").textContent = fmtLong(state.date);
    const f = commById[state.selected] || COMM[0];
    const p = f.properties;
    $("hud-name").textContent = displayName(p);
    $("hud-pop").textContent = p.population_label || "";
    const [lo, la] = f.geometry.coordinates;
    const i = dayIdx(state.date);
    let txt, na = true;
    if (lo < FIRMS_BOX[0] || lo > FIRMS_BOX[2] || la < FIRMS_BOX[1] || la > FIRMS_BOX[3]) txt = "Outside our hotspot data area";
    else if (i < FIRMS_FIRST || i > FIRMS_LAST) txt = "No hotspot data for this day";
    else {
      const pts = firmsByDay.get(i) || [];
      if (!pts.length) txt = "None detected this day";
      else {
        let m = Infinity;
        for (const [a, b] of pts) { const d = km(la, lo, a, b); if (d < m) m = d; }
        txt = `${m.toFixed(1)} km`;
        na = false;
      }
    }
    const fire = $("hud-fire");
    fire.textContent = txt;
    fire.className = "v" + (na ? " na" : "");
    const closed = roadClosed(state.date);
    $("hud-road").innerHTML = closed
      ? `<a class="status closed" href="${esc(CL.source_closed)}" target="_blank" rel="noopener" title="${esc(CL.segment)}"><i></i>Closed</a>`
      : (state.date >= CL.reopened
        ? `<a class="status open" href="${esc(CL.source_reopened)}" target="_blank" rel="noopener"><i></i>Open</a>`
        : `<span class="status open"><i></i>Open</span>`);
  }

  // ------------------------------------------------------------ event log
  const EVENTS = SCENES.filter((s) => s.alert).map((s) => ({ date: s.date, text: s.alert.text, url: s.alert.source_url, good: false }));
  if (CL.reopened && CL.source_reopened) {
    const note = (CL.source_reopened_note || "").replace(/^[^:]*:\s*/, "");
    EVENTS.push({ date: CL.reopened, text: note || "Highway 527 reopened", url: CL.source_reopened, good: true });
  }
  EVENTS.sort((a, b) => (a.date < b.date ? -1 : 1));
  let logKey = "";
  function updateLog() {
    const shown = EVENTS.filter((e) => e.date <= state.date);
    const key = shown.map((e) => e.date + e.text).join("|");
    if (key === logKey) return;
    logKey = key;
    $("log-empty").hidden = shown.length > 0;
    $("event-log").innerHTML = shown.slice().reverse().map((e) =>
      `<li class="${e.good ? "good" : ""}"><time>${esc(fmtDay(e.date))}</time>${esc(e.text)}<br><a href="${esc(e.url)}" target="_blank" rel="noopener">Source</a></li>`).join("");
  }

  // ------------------------------------------------------------ layer panel
  function buildLayerList() {
    $("layer-list").innerHTML = LAYERS.map((L) => `
      <div class="layer">
        <span class="name"><span class="sw" style="background:${L.sw}"></span>${esc(L.label)}</span>
        <label class="switch"><input type="checkbox" data-id="${L.id}" aria-label="${esc(L.label)}"><span></span></label>
        <span class="meta" id="meta-${L.id}"></span>
      </div>`).join("");
    document.querySelectorAll(".layer input").forEach((cb) => cb.addEventListener("change", () => onToggle(cb.dataset.id, cb.checked)));
  }
  function refreshLayerMeta() { for (const L of LAYERS) { const el = $("meta-" + L.id); if (el) el.textContent = layerMeta(L.id); } }
  function onToggle(id, on) {
    if (on) state.on.add(id); else state.on.delete(id);
    if (state.mode === "story" && state.scene >= 0 && !state.paused) {
      state.paused = true;
      $("paused").hidden = false;
      stopEvac();
    }
    updateDateLayers();
  }
  function openSidebar(open) {
    $("sidebar").classList.toggle("closed", !open);
    $("side-open").hidden = open;
    document.body.classList.toggle("side-is-open", open);
  }

  // ------------------------------------------------------------ timeline
  const tl = $("tl");
  tl.max = DAYS.length - 1;
  const pct = (i) => (i / (DAYS.length - 1)) * 100;
  {
    const maxC = Math.max(1, ...perDay);
    const w = 100 / (DAYS.length - 1);
    $("tl-spark").style.display = "block";
    $("tl-spark").innerHTML = perDay.map((c, i) => c
      ? `<i style="position:absolute;bottom:0;left:${pct(i)}%;width:${w * 0.7}%;transform:translateX(-50%);height:${Math.max(10, 100 * Math.sqrt(c / maxC))}%" title="${fmtShort(DAYS[i])}: ${c.toLocaleString()} fire detections"></i>` : "").join("");
    $("tl-passes").innerHTML = (NI.passes || []).filter((p) => dayIdx(p.date) >= 0).map((p) =>
      `<i class="${p.phase === "BEFORE" ? "pre" : ""}" style="left:${pct(dayIdx(p.date))}%" title="NISAR pass ${fmtShort(p.date)}, ${orbitName(p.orbit)}"></i>`).join("");
    const byDate = {};
    SCENES.forEach((s, k) => { (byDate[s.date] = byDate[s.date] || []).push(k); });
    $("tl-scenes").innerHTML = Object.entries(byDate).map(([d, ks]) =>
      `<button data-k="${ks[0]}" data-date="${d}" style="left:${pct(dayIdx(d))}%" data-title="${esc(fmtShort(d) + ": " + ks.map((k) => SCENES[k].title).join(" / "))}" aria-label="${esc("Scene: " + SCENES[ks[0]].title)}"></button>`).join("");
    $("tl-scenes").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      if (state.mode !== "story") setMode("story");
      goScene(+b.dataset.k);
    }));
  }
  tl.addEventListener("input", () => setDate(DAYS[+tl.value]));
  function step(n) { const i = Math.min(DAYS.length - 1, Math.max(0, dayIdx(state.date) + n)); setDate(DAYS[i]); }
  function togglePlay(force) {
    const btn = $("play");
    if (state.playing || force === false) {
      clearInterval(state.playing); state.playing = null;
      btn.classList.remove("on"); btn.innerHTML = "&#9654;"; btn.setAttribute("aria-label", "Play timeline");
      updateDateLayers(false);
      return;
    }
    let i = dayIdx(state.date);
    if (i >= DAYS.length - 1) i = -1;
    btn.classList.add("on"); btn.innerHTML = "&#10073;&#10073;"; btn.setAttribute("aria-label", "Pause timeline");
    state.playing = setInterval(() => {
      i += 1;
      if (i >= DAYS.length) { togglePlay(false); return; }
      setDate(DAYS[i], true);
    }, 450);
  }
  $("play").addEventListener("click", () => togglePlay());

  function setDate(iso, playing) {
    state.date = iso;
    const i = dayIdx(iso);
    tl.value = i;
    $("tl-date").textContent = fmtLong(iso);
    const notes = [];
    if (i >= FIRMS_FIRST && i <= FIRMS_LAST) notes.push(perDay[i] ? `${perDay[i].toLocaleString()} fire detections in the area` : "No fire detected in the area");
    const passes = (NI.passes || []).filter((p) => p.date === iso);
    if (passes.length) notes.push("NISAR pass: " + passes.map((p) => orbitName(p.orbit)).join(", "));
    $("tl-note").textContent = notes.join("   |   ");
    $("tl-scenes").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.date === iso));
    updateDateLayers(!!playing);
    updateHUD();
    updateLog();
    refreshLayerMeta();
  }

  // ------------------------------------------------------------ camera
  const isNarrow = () => window.innerWidth < 900;
  function pad() {
    const card = state.mode === "story" && !isNarrow() ? 440 : (state.mode === "explore" && !$("sidebar").classList.contains("closed") && !isNarrow() ? 330 : 40);
    return { top: 90, bottom: isNarrow() ? 300 : 170, left: card, right: isNarrow() ? 40 : 320 };
  }
  function boundsOf(coords) {
    const b = new maplibregl.LngLatBounds(coords[0], coords[0]);
    coords.forEach((c) => b.extend(c));
    return b;
  }
  const road527 = G.roads.features.find((f) => f.properties.id === "hwy527").geometry.coordinates;
  const closureCoords = G.closure.features[0].geometry.coordinates;
  // Fit a set of points into the part of the screen the panels leave free (Web Mercator, 512 px tiles).
  function fitView(coords, maxZoom) {
    const b = boundsOf(coords);
    const P = pad(), c = map.getContainer();
    const w = Math.max(200, c.clientWidth - P.left - P.right - 40), h = Math.max(200, c.clientHeight - P.top - P.bottom - 40);
    const x = (lon) => (lon + 180) / 360 * 512;
    const y = (lat) => { const s = Math.sin(lat * Math.PI / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 512; };
    const dx = Math.abs(x(b.getEast()) - x(b.getWest())), dy = Math.abs(y(b.getSouth()) - y(b.getNorth()));
    const zoom = Math.min(maxZoom || 12, Math.log2(w / Math.max(dx, 1e-9)), Math.log2(h / Math.max(dy, 1e-9)));
    const cy = (y(b.getNorth()) + y(b.getSouth())) / 2;
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * cy / 512))) * 180 / Math.PI;
    return { center: [(b.getEast() + b.getWest()) / 2, lat], zoom };
  }
  function moveCamera(m, instant) {
    let view;
    if (m.fit === "hwy527") view = fitView(road527.concat([commById.thunderbay.geometry.coordinates]));
    else if (m.fit === "closure") view = fitView(closureCoords, 9.5);
    else if (m.center) view = { center: m.center, zoom: m.zoom };
    else view = { center: META.default_view.center, zoom: META.default_view.zoom };
    const opts = Object.assign(view, { padding: pad(), essential: true });
    if (instant) map.jumpTo(opts);
    else map.flyTo(Object.assign(opts, { duration: 2600, curve: 1.3 }));
  }

  // ------------------------------------------------------------ evacuation route animation (north to south, then on to Thunder Bay)
  let evacRAF = null, evacTimer = null;
  function stopEvac() {
    if (evacRAF) cancelAnimationFrame(evacRAF);
    if (evacTimer) clearTimeout(evacTimer);
    evacRAF = null; evacTimer = null;
    const src = map.getSource && map.getSource("evac");
    if (src) src.setData({ type: "FeatureCollection", features: [] });
  }
  function startEvac() {
    stopEvac();
    const road = road527.slice().reverse();                 // Armstrong end first
    const tb = commById.thunderbay.geometry.coordinates;
    const end = road[road.length - 1];
    const DUR = 6500, TAIL = 1500;
    evacTimer = setTimeout(() => {
      const t0 = performance.now();
      const frame = (now) => {
        const src = map.getSource("evac");
        if (!src) return;
        const p = Math.min(1, (now - t0) / DUR);
        const n = Math.max(2, Math.round(p * road.length));
        const feats = [{ type: "Feature", properties: { k: "road" }, geometry: { type: "LineString", coordinates: road.slice(0, n) } }];
        let head = road[n - 1];
        if (p >= 1) {
          const q = Math.min(1, (now - t0 - DUR) / TAIL);
          head = [end[0] + (tb[0] - end[0]) * q, end[1] + (tb[1] - end[1]) * q];
          feats.push({ type: "Feature", properties: { k: "tb" }, geometry: { type: "LineString", coordinates: [end, head] } });
          if (q >= 1) { src.setData({ type: "FeatureCollection", features: feats }); evacRAF = null; return; }
        }
        feats.push({ type: "Feature", properties: { k: "head" }, geometry: { type: "Point", coordinates: head } });
        src.setData({ type: "FeatureCollection", features: feats });
        evacRAF = requestAnimationFrame(frame);
      };
      evacRAF = requestAnimationFrame(frame);
    }, 1800);
  }

  // ------------------------------------------------------------ before/after swipe (radar scene)
  let map2 = null, swipeX = null;
  function createMap2() {
    const div = document.createElement("div");
    div.id = "map2";
    map.getCanvasContainer().insertBefore(div, map.getCanvas().nextSibling);   // under the community markers
    map2 = new maplibregl.Map({
      container: div, interactive: false, attributionControl: false,
      style: { version: 8, sources: {}, layers: [] },
      center: map.getCenter(), zoom: map.getZoom(),
    });
    map2.on("load", () => {
      map2.addSource("after", { type: "image", url: BLANK, coordinates: NB });
      map2.addSource("after-change", { type: "image", url: BLANK, coordinates: NB });
      map2.addLayer({ id: "after", type: "raster", source: "after", paint: { "raster-opacity": 0.95, "raster-fade-duration": 0 } });
      map2.addLayer({ id: "after-change", type: "raster", source: "after-change", paint: { "raster-opacity": 1, "raster-fade-duration": 0 } });
      map2.loaded2 = true;
      updateCompare();
      syncMap2();
    });
    map.on("move", syncMap2);
    map.on("resize", () => { map2.resize(); placeSwipe(swipeX); });
  }
  function syncMap2() {
    if (!map2 || !state.compare) return;
    map2.jumpTo({ center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch(), padding: map.getPadding() });
  }
  function updateCompare() {
    if (!map2 || !map2.loaded2) return;
    const a = afterFor(state.date);
    const c = a ? NI.change.find((x) => x.date === a.date && x.orbit === a.orbit) : null;
    const want = [a ? a.file : BLANK, c && state.on.has("nisar_change") ? c.file : BLANK];
    if (map2.cur0 !== want[0]) { map2.cur0 = want[0]; map2.getSource("after").updateImage({ url: want[0], coordinates: NB }); }
    if (map2.cur1 !== want[1]) { map2.cur1 = want[1]; map2.getSource("after-change").updateImage({ url: want[1], coordinates: NB }); }
    const p = preFor(state.date);
    $("swipe-left").textContent = `Before: NISAR radar, ${fmtShort(p.date)}`;
    $("swipe-right").textContent = a ? `After: NISAR radar, ${fmtShort(a.date)}` : "After: no NISAR pass yet";
  }
  function placeSwipe(x) {
    const w = map.getContainer().clientWidth;
    if (x == null) { const pd = pad(); x = pd.left + (w - pd.left - pd.right) / 2; }
    swipeX = Math.max(20, Math.min(w - 20, x));
    const pctX = (swipeX / w) * 100;
    document.querySelector(".swipe-line").style.left = pctX + "%";
    $("swipe-knob").style.left = pctX + "%";
    $("swipe-left").style.right = `calc(${100 - pctX}% + 14px)`;
    $("swipe-right").style.left = `calc(${pctX}% + 14px)`;
    const d2 = $("map2");
    if (d2) d2.style.clipPath = `inset(0 0 0 ${swipeX}px)`;
  }
  function setCompare(on) {
    state.compare = on;
    $("swipe").hidden = !on;
    if (on) {
      if (!map2) createMap2();
      $("map2").style.display = "";
      placeSwipe(null);
      updateCompare();
      syncMap2();
    } else if (map2) {
      $("map2").style.display = "none";
    }
    applyVisibility();
  }
  {
    const knob = $("swipe-knob");
    let drag = false;
    knob.addEventListener("pointerdown", (e) => { drag = true; knob.setPointerCapture(e.pointerId); e.preventDefault(); });
    knob.addEventListener("pointermove", (e) => { if (drag) placeSwipe(e.clientX - map.getContainer().getBoundingClientRect().left); });
    knob.addEventListener("pointerup", () => { drag = false; });
    knob.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") { placeSwipe(swipeX - 30); e.preventDefault(); e.stopPropagation(); }
      if (e.key === "ArrowRight") { placeSwipe(swipeX + 30); e.preventDefault(); e.stopPropagation(); }
    });
  }

  // ------------------------------------------------------------ story
  const hostLabel = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return "source"; } };
  function renderCard(s, k) {
    $("card-date").textContent = fmtDay(s.date);
    $("card-count").textContent = `${k + 1} of ${SCENES.length}`;
    $("card-title").textContent = s.title;
    $("card-body").textContent = s.body;
    if (s.quote) {
      $("quote-text").textContent = `“${s.quote.text}”`;
      $("quote-speaker").textContent = s.quote.speaker;
      const a = $("quote-src");
      a.textContent = s.quote.source_name;
      a.href = s.quote.source_url;
      $("card-quote").hidden = false;
    } else {
      $("card-quote").hidden = true;
    }
    const srcs = [...new Set(s.sources || [])];
    $("card-sources").innerHTML = srcs.length
      ? "Sources: " + srcs.map((u, n) => `<a href="${esc(u)}" target="_blank" rel="noopener">${n + 1}. ${esc(hostLabel(u))}</a>`).join("")
      : "";
    $("prev").disabled = k === 0;
    $("next").textContent = k === SCENES.length - 1 ? "Explore the map" : "Next";
    $("card-dots").innerHTML = SCENES.map((x, j) => `<button class="${j === k ? "on" : ""}" data-k="${j}" aria-label="${esc("Scene " + (j + 1) + ": " + x.title)}"></button>`).join("");
    $("card-dots").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => goScene(+b.dataset.k)));
    const card = $("card");
    card.hidden = state.mode !== "story";
    card.style.animation = "none"; void card.offsetHeight; card.style.animation = "";
    card.scrollTop = 0;
  }
  function applySceneMap(s, instant) {
    stopEvac();
    setCompare(false);
    state.on = new Set(s.map.layers || []);
    state.highlight = s.map.highlight || null;
    if (state.highlight && commById[state.highlight]) state.selected = state.highlight;
    setDate(s.date);
    moveCamera(s.map, instant);
    if (s.map.animate) startEvac();
    if (s.map.compare) setTimeout(() => { if (SCENES[state.scene] === s) setCompare(true); }, instant ? 0 : 900);
  }
  function goScene(k, instant) {
    k = Math.max(0, Math.min(SCENES.length - 1, k));
    if (state.playing) togglePlay(false);
    state.scene = k;
    state.paused = false;
    $("paused").hidden = true;
    const s = SCENES[k];
    renderCard(s, k);
    applySceneMap(s, instant);
    if (history.replaceState) history.replaceState(null, "", "#" + s.id);
  }
  $("next").addEventListener("click", () => {
    if (state.scene >= SCENES.length - 1) setMode("explore");
    else goScene(state.scene + 1);
  });
  $("prev").addEventListener("click", () => goScene(state.scene - 1));
  $("resume").addEventListener("click", () => goScene(state.scene));

  // ------------------------------------------------------------ intro (the hook)
  function showIntro() {
    $("intro-date").textContent = fmtDay(HOOK.date);
    $("intro-title").textContent = HOOK.title;
    $("intro-body").textContent = HOOK.body;
    $("intro-src").innerHTML = (HOOK.sources || []).length
      ? "Sources: " + HOOK.sources.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(hostLabel(u))}</a>`).join("") : "";
    state.on = new Set(HOOK.map.layers || []);
    state.highlight = null;
    setDate(HOOK.date);
    $("intro").classList.remove("gone");
    $("card").hidden = true;
  }
  function closeIntro() { $("intro").classList.add("gone"); }
  $("begin").addEventListener("click", () => { closeIntro(); state.scene = 0; setMode("story"); });
  $("skip").addEventListener("click", () => { closeIntro(); setMode("explore"); });

  // ------------------------------------------------------------ modes
  function setMode(m) {
    state.mode = m;
    document.body.classList.toggle("mode-story", m === "story");
    document.body.classList.toggle("mode-explore", m === "explore");
    $("mode-story").classList.toggle("on", m === "story");
    $("mode-explore").classList.toggle("on", m === "explore");
    $("mode-story").setAttribute("aria-selected", m === "story");
    $("mode-explore").setAttribute("aria-selected", m === "explore");
    if (m === "explore") {
      stopEvac();
      setCompare(false);
      openSidebar(true);
      $("card").hidden = true;
      $("paused").hidden = true;
      if (history.replaceState) history.replaceState(null, "", "#explore");
    } else {
      openSidebar(false);
      closeIntro();
      goScene(state.scene < 0 ? 0 : state.scene);
    }
  }
  $("mode-story").addEventListener("click", () => setMode("story"));
  $("mode-explore").addEventListener("click", () => setMode("explore"));
  $("side-close").addEventListener("click", () => openSidebar(false));
  $("side-open").addEventListener("click", () => openSidebar(true));

  // ------------------------------------------------------------ theme
  function setTheme(t) {
    state.theme = t;
    document.documentElement.dataset.theme = t;
    $("theme").textContent = t === "dark" ? "Light map" : "Dark map";
    styleReady = false;
    map.setStyle(STYLE[t], { diff: false });
  }
  $("theme").addEventListener("click", () => setTheme(state.theme === "dark" ? "light" : "dark"));

  // ------------------------------------------------------------ credits
  const SRC_LABEL = {
    cp_jul16: "The Canadian Press via CP24, July 16, 2026",
    cp_jul17_recognition: "The Canadian Press via CP24, July 17, 2026",
    cp_jul19: "The Canadian Press via CP24, July 19, 2026",
    ctv_jul19: "The Canadian Press via CTV News, July 19, 2026",
    ctv_jul22: "The Canadian Press via CTV News, July 22, 2026",
    aptn_jul15: "APTN News via ICT, July 15, 2026",
    cnn_jul17: "CNN via KRDO, July 17, 2026",
    ctv_teen: "CTV News Thunder Bay",
    cbc_jul16_list: "CBC News via The Weather Network, July 16, 2026",
    cbc_jul22: "CBC News, July 22, 2026",
    kenora_aug20: "YourKenora, August 20, 2026",
    affes_size: "YourKenora: AFFES fire size update",
    statcan_armstrong: "Statistics Canada, table 98-10-0012-01 (Armstrong)",
    whitesand_pop: "City Population (Statistics Canada estimate, Whitesand)",
    collins_wiki: "Wikipedia: Namaygoosisagagun First Nation",
    collins_boats: "PreventionWeb",
    hwy527_wiki: "Wikipedia: Ontario Highway 811",
    collins_location: "Northwest Health Line",
    cbc_start_date_TO_CONFIRM: "CBC News (fire start date, being confirmed)",
  };
  $("source-list").innerHTML = Object.entries(S.all_sources || {}).map(([k, u]) =>
    `<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc(SRC_LABEL[k] || hostLabel(u))}</a></li>`).join("");
  const openCredits = () => { $("credits").hidden = false; $("credits-close").focus(); };
  const closeCredits = () => { $("credits").hidden = true; };
  $("credits-btn").addEventListener("click", openCredits);
  $("credits-btn-2").addEventListener("click", openCredits);
  $("credits-close").addEventListener("click", closeCredits);
  $("credits").addEventListener("click", (e) => { if (e.target === $("credits")) closeCredits(); });

  // ------------------------------------------------------------ keyboard
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("credits").hidden) { closeCredits(); return; }
    if (!$("intro").classList.contains("gone")) {
      if (e.key === "Enter" && e.target.tagName !== "BUTTON") { $("begin").click(); }
      return;
    }
    if (e.target === tl || e.target.closest(".maplibregl-ctrl") || e.target.isContentEditable) return;
    if (e.key === "ArrowRight") { step(1); e.preventDefault(); }
    else if (e.key === "ArrowLeft") { step(-1); e.preventDefault(); }
  });

  // ------------------------------------------------------------ start
  $("brand-title").textContent = META.title_suggestion || "One Road Out";
  buildLayerList();
  openSidebar(false);
  map.on("style.load", () => {
    addLayers();
    styleReady = true;
    updateDateLayers();
    if (state.compare) updateCompare();
  });
  const hash = decodeURIComponent((location.hash || "").slice(1));
  const startK = SCENES.findIndex((s) => s.id === hash);
  if (hash === "explore") { closeIntro(); state.on = new Set(["firms", "roads", "communities"]); setMode("explore"); setDate(HOOK.date); }
  else if (startK >= 0) { closeIntro(); state.scene = startK; setMode("story"); }
  else showIntro();
  window.__story = { state, goScene, setMode, setDate, setTheme, map: () => map };   // handy for testing
})();
