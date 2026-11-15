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
const before = L.imageOverlay("img/before.jpg", B, { opacity: 1 }).addTo(map);
const after = L.imageOverlay("img/after.jpg", B, { opacity: 1 }).addTo(map);
const change = L.imageOverlay("img/change.png", B, { opacity: 0.9 });
const burn = L.imageOverlay("img/burn.png", B, { opacity: 0.75 }).addTo(map);

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

// Community markers with distance to the burn
const F = D.final || {};
for (const [name, ll] of Object.entries(D.places)) {
  const c = (F.communities || {})[D.keys[name]] || {};
  const where = c.inside_burn ? "Inside the burned area." :
    `Nearest burned forest: <b>${c.km_to_burn_edge} km</b> away.`;
  L.circleMarker(ll, { radius: 7, color: "#111", weight: 2, fillColor: "#fff", fillOpacity: 1 })
    .addTo(map)
    .bindTooltip(name.split(" (")[0], name.startsWith("Whitesand")
      ? { permanent: true, direction: "top", className: "place", offset: [0, -8] }
      : { permanent: true, direction: "right", className: "place", offset: [8, 0] })
    .bindPopup(`<b>${name}</b><br>${where}<br>Burned within 5 km: ${c.burned_km2_within_5km} km&sup2;<br>Burned within 10 km: ${c.burned_km2_within_10km} km&sup2;`);
}

// Fill the headline numbers from the analysis, so the page always matches the data
function setText(id, txt) { const el = document.getElementById(id); if (el && txt) el.textContent = txt; }
if (F.burned_km2_in_50km_square) setText("stat-area", "~" + Math.round(F.burned_km2_in_50km_square / 50) * 50 + " km²");
const C = F.communities || {};
if (C.Collins) { setText("stat-col", C.Collins.km_to_burn_edge + " km"); setText("col5", C.Collins.burned_km2_within_5km + " km²"); }
if (C.Armstrong) { setText("stat-arm", C.Armstrong.km_to_burn_edge + " km"); setText("arm-km", C.Armstrong.km_to_burn_edge + " km"); setText("arm10", C.Armstrong.burned_km2_within_10km + " km²"); }
if (C.Whitesand_reserve) setText("stat-ws", C.Whitesand_reserve.km_to_burn_edge + " km");

clip();
