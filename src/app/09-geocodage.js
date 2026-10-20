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

/* ---------- Choisir un lieu connu : arrondissement, puis lieu, puis zone proposée à ajuster ---------- */
// formes calculées depuis OpenStreetMap par scripts/donnees/lieux.py (quartiers administratifs et lieux nommés)
let lieuxP = null;
const loadLieux = () => lieuxP || (lieuxP = fetch("data/lieux.json").then(r => r.ok ? r.json() : null).catch(() => null).then(d => { if (!d) lieuxP = null; return d; }));
const arrNom = n => n === 1 ? "1er" : n + "e";
async function openLieux() {
  const data = await loadLieux();
  if (!data) return toast("Liste des lieux indisponible pour l’instant : tracez la zone à la main");
  let el = $("#lieux");
  if (!el) { el = document.createElement("div"); el.id = "lieux"; el.className = "auth"; el.hidden = true; el.innerHTML = `<div class="auth__veil" data-close></div><div class="auth__card lieux" role="dialog" aria-modal="true" aria-labelledby="lieuxT"></div>`; document.body.appendChild(el); }
  const card = el.querySelector(".lieux"), close = () => { el.classList.remove("is-open"); setTimeout(() => { el.hidden = true; }, 200); };
  const X = `<button class="x" type="button" data-close aria-label="Fermer"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>`;
  const step = arr => {
    const L_ = arr ? data.arr[arr] || [] : [], grp = k => L_.map((x, i) => [x, i]).filter(([x]) => x.k === k).map(([x, i]) => `<button class="chip" type="button" data-i="${i}">${esc(x.n)}</button>`).join("");
    card.innerHTML = arr ? `<div class="auth__head"><h2 id="lieuxT" data-arr-n="${arr}">Paris ${arrNom(arr)}</h2>${X}</div>
        <p class="auth__txt">Chaque lieu a sa forme, d’après OpenStreetMap : ajustez ensuite les points sur la carte.</p>
        ${grp("lieu") ? `<h3 class="lieux__h">Lieux connus</h3><div class="lieux__l">${grp("lieu")}</div>` : ""}
        ${grp("quartier") ? `<h3 class="lieux__h">Quartiers administratifs</h3><div class="lieux__l">${grp("quartier")}</div>` : ""}
        <button class="link" type="button" data-back>‹ Tous les arrondissements</button>`
      : `<div class="auth__head"><h2 id="lieuxT">Choisir un lieu</h2>${X}</div>
        <p class="auth__txt">Un arrondissement, puis un lieu connu : la zone se trace toute seule.</p>
        <div class="lieux__a">${Array.from({length: 20}, (_, i) => { const l = (data.arr[i + 1] || [])[0]; return `<button type="button" data-arr="${i + 1}"><b>${arrNom(i + 1)}</b><span>${esc(l ? l.n : "")}</span></button>`; }).join("")}</div>`;
    const f = card.querySelector("[data-i], [data-arr]"); if (f) f.focus({preventScroll: true});
  };
  el.onclick = async e => {
    if (e.target.closest("[data-close]")) return close();
    if (e.target.closest("[data-back]")) return step(0);
    const a = e.target.closest("[data-arr]"); if (a) return step(+a.dataset.arr);
    const b = e.target.closest("[data-i]"); if (!b) return;
    const arr = +card.querySelector("#lieuxT").dataset.arrN, x = data.arr[arr][+b.dataset.i];
    close();
    if (currentTab !== "map") setTab("map");
    startNew();
    draft.points = x.p.map(q => q.slice()); draft.closed = true; draft.name = x.n; draft.nameTouched = true; draft.place = `Paris ${arrNom(arr)}`;
    finishZoneGeometry(draft);
    setHint("Zone proposée d’après le lieu : ajustez les points, puis validez");
    drawDraft(); renderPanel();
    requestAnimationFrame(fitDraft);
  };
  el.onkeydown = e => { if (e.key === "Escape") close(); };
  step(0); el.hidden = false; requestAnimationFrame(() => el.classList.add("is-open"));
}
