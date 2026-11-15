// Seeing Through Smoke: map, before/after slider, burn layers and community markers.
const D = window.SITE;
const B = D.bounds; // [[south, west], [north, east]]

const map = L.map("map", { zoomSnap: 0.25 });
map.fitBounds(B);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 16,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

// Radar images: "before" sits underneath, "after" is clipped at the divider.
const before = L.imageOverlay("../img/before.jpg", B, { opacity: 1 }).addTo(map);
const after = L.imageOverlay("../img/after.jpg", B, { opacity: 1 }).addTo(map);
const change = L.imageOverlay("../img/change.png", B, { opacity: 0.9 });
const burn = L.imageOverlay("../img/burn.png", B, { opacity: 0.75 }).addTo(map);

const slider = document.getElementById("slider");
const divider = document.getElementById("divider");
L.DomEvent.disableClickPropagation(slider);
L.DomEvent.disableScrollPropagation(slider);

function clip() {
  const x = map.getSize().x * slider.value / 100;            // divider position in map pixels
  const left = map.latLngToContainerPoint([B[1][0], B[0][1]]).x; // left edge of the images
  const el = after.getElement();
  if (el) el.style.clipPath = `inset(0 0 0 ${Math.max(0, x - left)}px)`;
  // the burn layer only shows on the "after" side, so the left side stays a clean "before"
  const bl = burn.getElement();
  if (bl) bl.style.clipPath = `inset(0 0 0 ${Math.max(0, x - left)}px)`;
  const cl = change.getElement();
  if (cl) cl.style.clipPath = `inset(0 0 0 ${Math.max(0, x - left)}px)`;
  divider.style.left = (x - 1.5) + "px";
}
slider.addEventListener("input", clip);
map.on("move zoom zoomend viewreset resize", clip);
after.on("load", clip);
burn.on("load", clip);
change.on("load", clip);

// Layer toggles
function toggle(id, layer) {
  document.getElementById(id).addEventListener("change", (e) => {
    if (e.target.checked) layer.addTo(map); else map.removeLayer(layer);
    clip();
  });
}
toggle("t-burn", burn);
toggle("t-change", change);
document.getElementById("t-radar").addEventListener("change", (e) => {
  [before, after].forEach((l) => (e.target.checked ? l.addTo(map) : map.removeLayer(l)));
  if (e.target.checked) { burn.bringToFront(); change.bringToFront(); }
  clip();
});

// Community markers: distance to the radar burn, and when NASA's fire satellites saw fire nearby
const F = D.final || {};
const FI = window.FIRMS;
const FS = (FI && FI.stats && FI.stats.communities) || {};
const fmtT = (iso) => new Date(iso).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
function arrival(key) {
  const a = FS[key];
  if (!a) return "";
  const lines = [];
  if (a.first_detection_within_10km) lines.push(`Fire first seen within 10 km: <b>${fmtT(a.first_detection_within_10km)}</b>`);
  if (a.first_detection_within_2km) lines.push(`Fire first seen within 2 km: <b>${fmtT(a.first_detection_within_2km)}</b>`);
  if (a.closest_detection_km != null) lines.push(`Closest fire detection: <b>${Number(a.closest_detection_km).toFixed(1)} km</b>`);
  return lines.length ? "<br><span class='pop-sub'>NASA fire satellites (FIRMS)</span><br>" + lines.join("<br>") : "";
}
for (const [name, ll] of Object.entries(D.places)) {
  const key = D.keys[name];
  const c = (F.communities || {})[key] || {};
  const where = c.inside_burn ? "Inside the burned area." :
    `Nearest burned forest (radar): <b>${c.km_to_burn_edge} km</b>`;
  L.circleMarker(ll, { radius: 7, color: "#111", weight: 2, fillColor: "#fff", fillOpacity: 1 })
    .addTo(map)
    .bindTooltip(name.split(" (")[0], name.startsWith("Whitesand")
      ? { permanent: true, direction: "top", className: "place", offset: [0, -8] }
      : { permanent: true, direction: "right", className: "place", offset: [8, 0] })
    .bindPopup(`<b>${name}</b><br><span class='pop-sub'>NISAR radar</span><br>${where}<br>Burned within 5 km: ${c.burned_km2_within_5km} km&sup2;<br>Burned within 10 km: ${c.burned_km2_within_10km} km&sup2;${arrival(key)}`);
}

// Fill the headline numbers from the analysis, so the page always matches the data
function setText(id, txt) { const el = document.getElementById(id); if (el && txt) el.textContent = txt; }
if (F.burned_km2_in_50km_square) setText("stat-area", "~" + Math.round(F.burned_km2_in_50km_square / 50) * 50 + " km²");
const C = F.communities || {};
if (C.Collins) { setText("stat-col", C.Collins.km_to_burn_edge + " km"); setText("col5", C.Collins.burned_km2_within_5km + " km²"); }
if (C.Armstrong) { setText("stat-arm", C.Armstrong.km_to_burn_edge + " km"); setText("arm-km", C.Armstrong.km_to_burn_edge + " km"); setText("arm10", C.Armstrong.burned_km2_within_10km + " km²"); }
if (C.Whitesand_reserve) setText("stat-ws", C.Whitesand_reserve.km_to_burn_edge + " km");

clip();

// ---------------------------------------------------------------- NASA FIRMS fire detections, day by day
if (FI && FI.pts && FI.pts.length) {
  document.getElementById("firms-ctl").hidden = false;
  const renderer = L.canvas({ padding: 0.5 });
  const OLD = { fillColor: "#7a0a0a", fillOpacity: 0.8, radius: 2.4, stroke: true, color: "#ffffff", weight: 0.5, opacity: 0.6 };
  const NOW = { fillColor: "#ff9a1f", fillOpacity: 1, radius: 3.6, stroke: true, color: "#3a1500", weight: 1, opacity: 1 };
  const groups = FI.days.map(() => L.layerGroup());
  const perDay = FI.days.map(() => 0);
  for (const [la, lo, d] of FI.pts) {
    L.circleMarker([la, lo], Object.assign({ renderer, interactive: false }, OLD)).addTo(groups[d]);
    perDay[d] += 1;
  }
  const lastWithData = perDay.reduce((acc, n, i) => (n ? i : acc), 0);
  const daySl = document.getElementById("day");
  const label = document.getElementById("day-label");
  const firmsBox = document.getElementById("t-firms");
  const playBtn = document.getElementById("play");
  daySl.max = FI.days.length - 1;
  L.DomEvent.disableClickPropagation(daySl);

  const fmtD = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-CA", { month: "short", day: "numeric" });
  let shown = -1;
  function showDay(k) {
    groups.forEach((g, i) => {
      const on = firmsBox.checked && i <= k;
      if (on && !map.hasLayer(g)) g.addTo(map);
      if (!on && map.hasLayer(g)) map.removeLayer(g);
    });
    if (shown >= 0 && shown !== k) groups[shown].eachLayer((m) => m.setStyle(OLD));
    groups[k].eachLayer((m) => { m.setStyle(NOW); m.bringToFront(); });
    shown = k;
    let total = 0;
    for (let i = 0; i <= k; i++) total += perDay[i];
    const today = perDay[k] ? `${perDay[k].toLocaleString()} new fire detections` : "no fire detected";
    label.textContent = `${fmtD(FI.days[k])}: ${today} (${total.toLocaleString()} so far)`;
  }
  daySl.addEventListener("input", () => { firmsBox.checked = true; showDay(+daySl.value); });
  firmsBox.addEventListener("change", () => showDay(+daySl.value));

  let timer = null;
  function stop() { clearInterval(timer); timer = null; playBtn.innerHTML = "&#9654; Play the fire"; }
  playBtn.addEventListener("click", () => {
    if (timer) { stop(); return; }
    let k = 0;
    firmsBox.checked = true;
    playBtn.innerHTML = "&#10073;&#10073; Pause";
    timer = setInterval(() => {
      daySl.value = k; showDay(k);
      k += 1;
      if (k > lastWithData + 2 || k >= FI.days.length) stop();
    }, 800);
  });
  daySl.value = lastWithData;
  showDay(lastWithData);

  // Story box: when the fire arrived
  const C2 = FS.Collins || {}, A2 = FS.Armstrong || {}, W2 = FS.Whitesand_reserve || {};
  const li = document.getElementById("arrival-li");
  if (C2.first_detection_within_2km) {
    const km = (x) => Number(x).toFixed(1);
    li.innerHTML = `NASA fire satellites first saw fire within 2 km of Collins on <b>${fmtT(C2.first_detection_within_2km)}</b> (local time). ` +
      `The closest fire detection to Armstrong was <b>${km(A2.closest_detection_km)} km</b> away, and <b>${km(W2.closest_detection_km)} km</b> from the Whitesand reserve.`;
    li.hidden = false;
  }

  // How we checked our work: radar vs NASA FIRMS
  const st = FI.stats || {};
  const fc = document.getElementById("firms-check");
  if (st.detections_in_square) {
    const pc = (x) => Math.round(100 * x) + "%";
    fc.className = "";
    fc.innerHTML = `<b>Checked against a second NASA source.</b> NASA's FIRMS satellites recorded ` +
      `${st.detections_in_square.toLocaleString()} fire detections in our area, almost all from July 13 to 16. ` +
      `<b>${pc(st.share_radar_burn_within_375m_of_a_detection)}</b> of the forest our radar flags as burned had a fire detection within 375 m ` +
      `(the size of one detection pixel), compared with ${pc(st.share_of_land_within_375m_of_a_detection)} of all land in the area. ` +
      `So when the radar says "burned", NASA's fire satellites agree. Fire was detected over a larger area than our radar flags, ` +
      `so our burn map is cautious: it shows where we are sure, not everything that burned.`;
  }
}
