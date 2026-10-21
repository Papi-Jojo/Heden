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
const sansAccent = s => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
async function doSearch(q) {
  const box = $("#results");
  const d = await loadLieux(), k = sansAccent(q);
  const prets = d && k.length >= 3 ? lieuxListe(d).filter(x => sansAccent(x.n).includes(k)).sort((a, b) => (a.k !== "lieu") - (b.k !== "lieu")).slice(0, 3) : [];
  const pretsHTML = prets.map((x, i) => `<button type="button" class="res--pret" data-p="${i}">${esc(x.n)}<small>Zone prédéfinie · Paris ${arrNom(x.arr)}</small></button>`).join("");
  const bindPrets = () => $$("[data-p]", box).forEach(b => b.onclick = () => { box.hidden = true; $("#q").blur(); adoptLieu(prets[+b.dataset.p]); });
  try {
    const vb = `${BOUNDS[0][1]},${BOUNDS[1][0]},${BOUNDS[1][1]},${BOUNDS[0][0]}`;
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&viewbox=${vb}&bounded=1&limit=5&countrycodes=fr&accept-language=fr`);
    const list = r.ok ? await r.json() : [];
    if (!list.length) { box.innerHTML = pretsHTML || `<button type="button" disabled>Aucun résultat dans Paris et la petite couronne</button>`; box.hidden = false; bindPrets(); return; }
    box.innerHTML = pretsHTML + list.map((x, i) => {
      const parts = x.display_name.split(", ");
      return `<button type="button" data-i="${i}">${esc(parts.slice(0, 2).join(", "))}<small>${esc(parts.slice(2, 5).join(", "))}</small></button>`;
    }).join("");
    box.hidden = false;
    bindPrets();
    $$("button[data-i]", box).forEach(b => b.onclick = () => {
      const x = list[+b.dataset.i];
      map.flyTo([+x.lat, +x.lon], 16, {duration: .6});
      box.hidden = true; $("#q").blur();
    });
  } catch (e) {
    box.innerHTML = pretsHTML || `<button type="button" disabled>Recherche indisponible pour le moment</button>`; box.hidden = false; bindPrets();
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
        <p class="auth__txt">Chaque zone suit les rues qui la bordent, d’après OpenStreetMap. Vous pourrez ajuster ses points sur la carte.</p>
        ${grp("lieu") ? `<h3 class="lieux__h">Quartiers</h3><div class="lieux__l">${grp("lieu")}</div>` : ""}
        ${grp("quartier") ? `<h3 class="lieux__h">Quartiers administratifs</h3><div class="lieux__l">${grp("quartier")}</div>` : ""}
        <button class="link" type="button" data-back>‹ Tous les arrondissements</button>`
      : `<div class="auth__head"><h2 id="lieuxT">Zones prédéfinies</h2>${X}</div>
        <p class="auth__txt">Choisissez un arrondissement, puis un quartier : la zone prédéfinie, délimitée par les rues, s’affiche sur la carte.</p>
        <div class="lieux__a">${Array.from({length: 20}, (_, i) => { const l = (data.arr[i + 1] || [])[0]; return `<button type="button" data-arr="${i + 1}"><b>${arrNom(i + 1)}</b><span>${esc(l ? l.n : "")}</span></button>`; }).join("")}</div>`;
    const f = card.querySelector("[data-i], [data-arr]"); if (f) f.focus({preventScroll: true});
  };
  el.onclick = async e => {
    if (e.target.closest("[data-close]")) return close();
    if (e.target.closest("[data-back]")) return step(0);
    const a = e.target.closest("[data-arr]"); if (a) return step(+a.dataset.arr);
    const b = e.target.closest("[data-i]"); if (!b) return;
    const arr = +card.querySelector("#lieuxT").dataset.arrN;
    close(); adoptLieu(Object.assign({arr}, data.arr[arr][+b.dataset.i]));
  };
  el.onkeydown = e => { if (e.key === "Escape") close(); };
  step(0); el.hidden = false; requestAnimationFrame(() => el.classList.add("is-open"));
}

/* Une zone prédéfinie devient le tracé en cours (depuis la liste, la recherche ou la suggestion pendant le tracé) */
function adoptLieu(x) {
  if (currentTab !== "map") setTab("map");
  if (!draft || ui.mode !== "placing" || draft.id) startNew();
  Object.assign(draft, {points: x.p.map(q => q.slice()), closed: true, fromLieu: x.n, place: `Paris ${arrNom(x.arr)}`});
  if (!draft.nameTouched) { draft.name = x.n; draft.nameTouched = true; }
  selVertex = null; finishZoneGeometry(draft);
  setHint("Zone prédéfinie : ajustez les points si besoin, puis validez");
  drawDraft(); renderPanel();
  requestAnimationFrame(fitDraft);
}
// toutes les zones prêtes à plat : [{n, k, p, arr}]
const lieuxListe = d => Object.entries(d.arr).flatMap(([a, v]) => v.map(x => Object.assign({arr: +a}, x)));
// les zones prêtes qui contiennent ce point, puis les plus proches
function lieuxPres(d, lat, lng, n = 3) {
  return lieuxListe(d).filter(x => x.k === "lieu").map(x => { const c = polyCenter(x.p); return [x, inPoly(lat, lng, x.p) ? -1 : (c[0] - lat) ** 2 + ((c[1] - lng) * .66) ** 2]; })
    .sort((a, b) => a[1] - b[1]).slice(0, n).map(([x]) => x);
}
// ressemblance entre deux contours : part commune / réunion, estimée sur une grille de 28 × 28 points
function ressemblance(a, b) {
  const all = a.concat(b), la = all.map(p => p[0]), lo = all.map(p => p[1]);
  const y0 = Math.min(...la), y1 = Math.max(...la), x0 = Math.min(...lo), x1 = Math.max(...lo);
  let inter = 0, uni = 0;
  for (let i = 0; i < 28; i++) for (let j = 0; j < 28; j++) {
    const y = y0 + (y1 - y0) * (i + .5) / 28, x = x0 + (x1 - x0) * (j + .5) / 28, ia = inPoly(y, x, a), ib = inPoly(y, x, b);
    if (ia || ib) uni++; if (ia && ib) inter++;
  }
  return uni ? inter / uni : 0;
}
// pendant un tracé à la main : la zone prête qui lui ressemble le plus (au moins à moitié)
function lieuRessemblant(d, pts) {
  if (pts.length < 3) return null;
  const c = polyCenter(pts);
  return lieuxPres(d, c[0], c[1], 6).map(x => [x, ressemblance(pts, x.p)]).filter(([, r]) => r >= .5).sort((a, b) => b[1] - a[1]).map(([x]) => x)[0] || null;
}
// encart du panneau de tracé : au départ, les zones prêtes autour de la carte ; en cours de tracé, la zone prête qui ressemble
async function paintPrets() {
  const el = $("#prets"); if (!el || !draft) return;
  const d = await loadLieux(); if (!d || $("#prets") !== el || !draft) return;
  const chip = x => `<button class="chip" type="button" data-pret="${esc(x.arr + "|" + x.n)}">${esc(x.n)}</button>`;
  if (!draft.points.length) {
    const c = map.getCenter(), near = lieuxPres(d, c.lat, c.lng);
    el.innerHTML = `<p class="prets__t">Ou partez d’une zone prédéfinie, délimitée par les rues :</p><div class="prets__l">${near.map(chip).join("")}<button class="chip chip--ghost" type="button" data-tous>Tous les quartiers…</button></div>`;
  } else if (!draft.fromLieu && !draft.walk) {
    const x = lieuRessemblant(d, draft.points);
    el.innerHTML = x ? `<p class="prets__t">Ressemble à « ${esc(x.n)} » :</p><div class="prets__l">${chip(x).replace(esc(x.n) + "</button>", "Utiliser son tracé</button>")}</div>` : "";
  } else el.innerHTML = "";
  el.hidden = !el.innerHTML;
  el.onclick = e => {
    if (e.target.closest("[data-tous]")) return openLieux();
    const b = e.target.closest("[data-pret]"); if (!b) return;
    const [a, n] = b.dataset.pret.split("|"), x = lieuxListe(d).find(y => y.arr === +a && y.n === n);
    if (x) adoptLieu(x);
  };
}
