/* =========================================================
   Position : pastille « vous êtes ici », suivie en continu
   ========================================================= */
const geo = {watch: null, marker: null, acc: null, last: null, fly: false, listeners: new Set()};
const meIcon = L.divIcon({className: "", iconSize: null, html: `<span class="me"><b></b><i></i></span>`});
function onGeo(p) {
  const c = p.coords, ll = L.latLng(c.latitude, c.longitude);
  geo.last = {lat: c.latitude, lng: c.longitude, acc: c.accuracy || 50, t: p.timestamp || Date.now()};
  if (!geo.marker) {
    geo.acc = L.circle(ll, {radius: geo.last.acc, stroke: false, fillColor: "#A07B33", fillOpacity: .12, interactive: false}).addTo(map);
    geo.marker = L.marker(ll, {icon: meIcon, interactive: false, keyboard: false, zIndexOffset: -1000}).addTo(map);
  } else { geo.marker.setLatLng(ll); geo.acc.setLatLng(ll).setRadius(Math.min(geo.last.acc, 300)); }
  geo.marker.getElement() && geo.marker.getElement().querySelector(".me").classList.toggle("me--vague", geo.last.acc > 60);
  $("#locate").setAttribute("aria-pressed", "true");
  if (geo.fly) {
    geo.fly = false;
    if (!L.latLngBounds(BOUNDS).pad(0.25).contains(ll)) toast("Vous êtes hors de la zone couverte");
    else map.flyTo(ll, Math.max(map.getZoom(), 16), {duration: .6});
  }
  geo.listeners.forEach(f => f(geo.last, p));
}
function onGeoErr(err) {
  if (err && err.code === 1) { toast("Position refusée : autorisez-la dans les réglages du navigateur"); stopGeo(); }
  else if (geo.fly) { geo.fly = false; toast("Position introuvable pour le moment"); }
}
function startGeo(fly) {
  if (!navigator.geolocation) { toast("Géolocalisation indisponible"); return false; }
  geo.fly = !!fly;
  if (geo.watch == null) geo.watch = navigator.geolocation.watchPosition(onGeo, onGeoErr, {enableHighAccuracy: true, maximumAge: 3000, timeout: 20000});
  else if (fly && geo.last) { geo.fly = false; map.flyTo([geo.last.lat, geo.last.lng], Math.max(map.getZoom(), 16), {duration: .6}); }
  return true;
}
function stopGeo() {
  if (geo.watch != null) navigator.geolocation.clearWatch(geo.watch);
  geo.watch = null;
  if (geo.marker) { map.removeLayer(geo.marker); map.removeLayer(geo.acc); geo.marker = geo.acc = null; }
  $("#locate").setAttribute("aria-pressed", "false");
}
$("#locate").onclick = () => startGeo(true);
$("#brandHome").onclick = () => currentTab === "map" ? tabHome("map") : setTab("map");

/* ---------- Filtres de la carte : les options sortent du bouton en galets ---------- */
function paintMapFilter() {
  $$("#mapf [data-mf]").forEach(b => { const on = mapFilter[b.dataset.mf] !== false; b.setAttribute("aria-pressed", String(on)); b.title = on ? "Masquer sur la carte" : "Afficher sur la carte"; });
  $("#mapf").classList.toggle("has-filter", !mapFilter.zones || !mapFilter.annonces);
}
function openMapFilter(open) {
  const m = $("#mapf"); m.classList.toggle("is-open", open); $("#mapfBtn").setAttribute("aria-expanded", String(open));
}
$("#mapfBtn").onclick = () => openMapFilter(!$("#mapf").classList.contains("is-open"));
$$("#mapf [data-mf]").forEach(b => b.onclick = () => {
  const k = b.dataset.mf; mapFilter[k] = mapFilter[k] === false;
  try { localStorage.setItem("heden.mapf", JSON.stringify(mapFilter)); } catch (e) {}
  paintMapFilter(); if (k === "zones") renderZones(); else renderListingPins();
});
document.addEventListener("pointerdown", e => { if (!e.target.closest("#mapf")) openMapFilter(false); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && $("#mapf").classList.contains("is-open")) { openMapFilter(false); $("#mapfBtn").focus(); } });
paintMapFilter(); paintModeSel(); bindModeSel($("#mapMode"));
