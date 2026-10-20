/* =========================================================
   Géocodage (Nominatim / OpenStreetMap)
   ========================================================= */
function arrLabel(pc, city) {
  if (pc && /^750\d\d$/.test(pc)) { const n = +pc.slice(3); return `Paris ${n === 1 ? "1er" : n + "e"}`; }
  if (pc === "75116") return "Paris 16e";
  return city || "";
}
async function reverseGeocode(d) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${d.lat}&lon=${d.lng}&zoom=17&addressdetails=1&accept-language=fr`);
    if (!r.ok) return;
    const j = await r.json(); const a = j.address || {};
    const place = arrLabel(a.postcode, a.city || a.town || a.village || a.municipality);
    const street = a.road || a.pedestrian || a.square || a.neighbourhood || a.quarter || a.suburb || "";
    if (draft !== d) return;
    if (place) d.place = place;
    if (!d.name && !d.nameTouched && street) {
      d.name = street + (a.quarter && a.quarter !== street ? ` (${a.quarter})` : "");
      const inp = $("#zname"); if (inp && !inp.value) inp.value = d.name;
    }
    const sub = $(".panel__head .sub"); if (sub && ui.mode === "rating" && place) sub.textContent = `${place}${d.area ? ", " + fmtArea(d.area) : ""}`;
  } catch (e) { /* hors ligne : on garde la saisie manuelle */ }
}
let searchTimer = null;
$("#q").addEventListener("input", e => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (q.length < 3) { $("#results").hidden = true; return; }
  searchTimer = setTimeout(() => doSearch(q), 450);
});
$("#search").addEventListener("submit", e => { e.preventDefault(); const q = $("#q").value.trim(); if (q) doSearch(q); });
async function doSearch(q) {
  const box = $("#results");
  try {
    const vb = `${BOUNDS[0][1]},${BOUNDS[1][0]},${BOUNDS[1][1]},${BOUNDS[0][0]}`;
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&viewbox=${vb}&bounded=1&limit=5&countrycodes=fr&accept-language=fr`);
    const list = r.ok ? await r.json() : [];
    if (!list.length) { box.innerHTML = `<button type="button" disabled>Aucun résultat dans Paris et la petite couronne</button>`; box.hidden = false; return; }
    box.innerHTML = list.map((x, i) => {
      const parts = x.display_name.split(", ");
      return `<button type="button" data-i="${i}">${esc(parts.slice(0, 2).join(", "))}<small>${esc(parts.slice(2, 5).join(", "))}</small></button>`;
    }).join("");
    box.hidden = false;
    $$("button", box).forEach(b => b.onclick = () => {
      const x = list[+b.dataset.i];
      map.flyTo([+x.lat, +x.lon], 16, {duration: .6});
      box.hidden = true; $("#q").blur();
    });
  } catch (e) {
    box.innerHTML = `<button type="button" disabled>Recherche indisponible pour le moment</button>`; box.hidden = false;
  }
}
document.addEventListener("click", e => { if (!e.target.closest("#search")) $("#results").hidden = true; });
