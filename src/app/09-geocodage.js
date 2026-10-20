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
const LIEUX = [
  ["Les Halles", "Palais-Royal", "Place Vendôme", "Île de la Cité", "Place Dauphine"],
  ["Montorgueil", "Sentier", "Bourse", "Grands Boulevards", "Passage des Panoramas"],
  ["Haut Marais", "Arts et Métiers", "Square du Temple", "Rue de Bretagne", "Musée Picasso"],
  ["Le Marais", "Saint-Paul", "Île Saint-Louis", "Hôtel de Ville", "Place des Vosges"],
  ["Quartier latin", "Rue Mouffetard", "Panthéon", "Jardin des Plantes", "Maubert"],
  ["Saint-Germain-des-Prés", "Odéon", "Jardin du Luxembourg", "Saint-Sulpice", "Notre-Dame-des-Champs"],
  ["Gros-Caillou", "Rue Cler", "Invalides", "Champ-de-Mars", "Saint-Thomas-d’Aquin"],
  ["Madeleine", "Parc Monceau", "Champs-Élysées", "Europe", "Saint-Philippe-du-Roule"],
  ["Pigalle", "Rue des Martyrs", "Saint-Georges", "Nouvelle Athènes", "Square Montholon"],
  ["Canal Saint-Martin", "Faubourg Saint-Denis", "Gare de l’Est", "Château-d’Eau", "Hôpital Saint-Louis"],
  ["Oberkampf", "Bastille", "Roquette", "Folie-Méricourt", "Charonne", "Parmentier"],
  ["Aligre", "Bercy Village", "Nation", "Daumesnil", "Picpus"],
  ["Butte-aux-Cailles", "Gobelins", "Place d’Italie", "Bibliothèque François-Mitterrand", "Maison-Blanche"],
  ["Montparnasse", "Denfert-Rochereau", "Alésia", "Pernety", "Parc Montsouris"],
  ["Commerce", "Convention", "Vaugirard", "Beaugrenelle", "Cambronne", "Parc Georges-Brassens"],
  ["Passy", "Auteuil", "Trocadéro", "La Muette", "Porte Dauphine"],
  ["Batignolles", "Ternes", "Plaine Monceau", "Épinettes", "Rue de Lévis"],
  ["Abbesses", "Montmartre", "Lamarck-Caulaincourt", "Goutte d’Or", "Jules Joffrin"],
  ["Buttes-Chaumont", "Bassin de la Villette", "Jourdain", "Place des Fêtes", "Parc de la Villette"],
  ["Belleville", "Ménilmontant", "Gambetta", "Père-Lachaise", "Saint-Blaise"]];
const arrNom = n => n === 1 ? "1er" : n + "e";
function openLieux() {
  let el = $("#lieux");
  if (!el) { el = document.createElement("div"); el.id = "lieux"; el.className = "auth"; el.hidden = true; el.innerHTML = `<div class="auth__veil" data-close></div><div class="auth__card lieux" role="dialog" aria-modal="true" aria-labelledby="lieuxT"></div>`; document.body.appendChild(el); }
  const card = el.querySelector(".lieux"), close = () => { el.classList.remove("is-open"); setTimeout(() => { el.hidden = true; }, 200); };
  const X = `<button class="x" type="button" data-close aria-label="Fermer"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>`;
  const step = arr => {
    card.innerHTML = arr ? `<div class="auth__head"><h2 id="lieuxT">Paris ${arrNom(arr)}</h2>${X}</div>
        <p class="auth__txt">Heden propose une zone autour du lieu : ajustez ensuite les points sur la carte.</p>
        <div class="lieux__l">${LIEUX[arr - 1].map(n => `<button class="chip" type="button" data-lieu="${esc(n)}">${esc(n)}</button>`).join("")}</div>
        <button class="link" type="button" data-back>‹ Tous les arrondissements</button>`
      : `<div class="auth__head"><h2 id="lieuxT">Choisir un lieu</h2>${X}</div>
        <p class="auth__txt">Un arrondissement, puis un lieu connu : la zone se trace toute seule.</p>
        <div class="lieux__a">${LIEUX.map((l, i) => `<button type="button" data-arr="${i + 1}"><b>${arrNom(i + 1)}</b><span>${esc(l[0])}</span></button>`).join("")}</div>`;
    const f = card.querySelector("[data-lieu], [data-arr]"); if (f) f.focus({preventScroll: true});
  };
  el.onclick = async e => {
    if (e.target.closest("[data-close]")) return close();
    if (e.target.closest("[data-back]")) return step(0);
    const a = e.target.closest("[data-arr]"); if (a) return step(+a.dataset.arr);
    const b = e.target.closest("[data-lieu]"); if (!b) return;
    const arr = +card.querySelector("#lieuxT").textContent.replace(/\D/g, ""), name = b.dataset.lieu;
    b.disabled = true;
    const g = await nominatim(`${name}, ${750 + String(arr).padStart(2, "0")} Paris`) || await nominatim(`${name}, Paris`);
    if (!g) { b.disabled = false; return toast("Lieu introuvable : tracez la zone à la main"); }
    close();
    if (currentTab !== "map") setTab("map");
    startNew();
    draft.points = circlePoints(g.lat, g.lng, 250, 10); draft.closed = true; draft.name = name; draft.nameTouched = true; draft.place = `Paris ${arrNom(arr)}`;
    finishZoneGeometry(draft);
    setHint("Zone proposée autour du lieu : ajustez les points, puis validez");
    drawDraft(); renderPanel();
    requestAnimationFrame(fitDraft);
  };
  el.onkeydown = e => { if (e.key === "Escape") close(); };
  step(0); el.hidden = false; requestAnimationFrame(() => el.classList.add("is-open"));
}
