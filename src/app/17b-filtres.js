/* =========================================================
   Filtres d'Explorer et des Favoris : un pictogramme, un panneau, des critères classiques et précis.
   Une annonce dont l'information manque n'est jamais écartée d'office : elle passe après les autres,
   marquée « À vérifier », sauf si l'on demande « Seulement les infos connues ».
   ========================================================= */
const FLT_KEY = "heden.filtres";
let fltAll = (() => { try { const v = JSON.parse(localStorage.getItem(FLT_KEY) || "{}"); return v && typeof v === "object" ? v : {}; } catch (e) { return {}; } })();
const fltOf = tab => (fltAll[tab] = fltAll[tab] && typeof fltAll[tab] === "object" ? fltAll[tab] : {});
const fltSave = () => { try { localStorage.setItem(FLT_KEY, JSON.stringify(fltAll)); } catch (e) {} };
const fltTab = () => currentTab === "favoris" ? "favoris" : "explorer";
const fltOn = v => v != null && v !== "" && v !== false && !(Array.isArray(v) && !v.length);
const fltCount = F => Object.entries(F).filter(([k, v]) => k !== "strict" && fltOn(v)).length;

/* description complète lue : ce qu'elle ne mentionne pas manque très probablement */
const fltFull = f => f.descLen >= 600 || !!f.fullPage || !!f.complet;
const fltBool = (f, yes) => yes ? true : fltFull(f) ? false : null;
/* arrondissement d'une annonce : code postal, sinon position dans les contours */
function fltArr(f) {
  const pc = String(f.postcode || "").trim(), m = /^75(?:0(\d\d)|1(16))$/.exec(pc);
  if (m) return +(m[1] || m[2]);
  if (/^9[234]\d{3}$/.test(pc)) return "b";
  if (/^\d{5}$/.test(pc)) return "x";
  if (f.lat && f.lng && lieuxCache && lieuxCache.c && f.placeLevel !== "ville") {
    for (const [n, ring] of Object.entries(lieuxCache.c)) if (inPoly(f.lat, f.lng, ring)) return +n;
  }
  return null;
}
const fltDays = (f, it) => { const t = (it && it.r && it.r.item && it.r.item.first) || f.addedAt || 0; return t ? (Date.now() - t) / 864e5 : null; };

/* chaque filtre : vrai (répond), faux (écarté), null (on ne sait pas) ; l'étiquette dit ce qui manque */
const FLT = {
  prixMax: {miss: "prix", t: (f, v) => f.price ? f.price <= v : null},
  prixMin: {miss: "prix", t: (f, v) => f.price ? f.price >= v : null},
  ppmMax: {miss: "prix au m²", t: (f, v) => f.price && f.surface ? f.price / f.surface <= v : null},
  surfMin: {miss: "surface", t: (f, v) => f.surface ? f.surface >= v : null},
  surfMax: {miss: "surface", t: (f, v) => f.surface ? f.surface <= v : null},
  pieces: {miss: "pièces", t: (f, v) => f.rooms ? f.rooms >= v : null},
  chambres: {miss: "chambres", t: (f, v) => f.bedrooms != null ? f.bedrooms >= v : f.rooms && f.rooms <= v ? false : null},   // n chambres demandent au moins n + 1 pièces
  etage: {miss: "étage", t: (f, v) => f.floor == null ? null : v === "top" ? (f.top ? true : null) : f.floor >= v},
  ascenseur: {miss: "ascenseur", t: f => f.elevator === true ? true : f.floor != null && f.floor <= 1 ? true : f.elevator === false ? false : null},
  exterieur: {miss: "extérieur", t: (f, v) => f.outdoor ? (v === "grand" ? /terrasse|jardin/.test(f.outdoor) : true) : fltBool(f, false)},
  dpe: {miss: "DPE", t: (f, v) => f.dpe ? DPE.indexOf(f.dpe) <= DPE.indexOf(v) : null},
  etat: {miss: "état", t: (f, v) => !f.works ? null : v === "pret" ? /neuf|bon/.test(f.works) : f.works !== "travaux"},
  cave: {miss: "cave", t: f => fltBool(f, !!f.cave)},
  parking: {miss: "parking", t: f => fltBool(f, !!f.parking)},
  lumineux: {miss: "luminosité", t: f => f.dark ? false : f.bright || f.traversant || /sud|ouest/.test(f.exposure || "") ? true : f.exposure ? false : null},
  vue: {miss: "vue", t: f => fltBool(f, !!f.view)},
  gardien: {miss: "gardien", t: f => fltBool(f, f.building === "gardien")},
  meuble: {miss: "meublé ou vide", t: (f, v) => f.furnished == null ? null : v === "meuble" ? f.furnished === true : f.furnished === false},
  noteMin: {miss: "note", t: (f, v, s) => s.total == null ? null : s.reliable ? s.total >= v : (s.range ? s.range[1] < v ? false : s.range[0] >= v ? true : null : s.total >= v || null)},
  depuis: {miss: "date", t: (f, v, s, it) => { const d = fltDays(f, it); return d == null ? null : d <= v; }},
  sources: {miss: "site", t: (f, v) => f.source ? v.includes(siteName(f.source)) : null},
  photos: {miss: "photos", t: f => (f.photos || []).length > 0},
  baisse: {miss: "prix", t: f => !!f.dropped},
  sansSuspectes: {miss: "", t: f => !(f.scam || []).length}
};
/* arrondissements et quartiers : listes, l'une ou l'autre suffit (OU) */
function fltLieu(f, F) {
  const arrs = F.arrs || [], lx = F.lieux || [];
  if (!arrs.length && !lx.length) return true;
  const a = fltArr(f);
  if (lx.length) {
    const named = String(f.quartier || "").toLowerCase();
    if (named && lx.some(k => named.includes(k.split("|")[1].toLowerCase()))) return true;
    if (f.lat && f.lng && lieuxCache && f.placeLevel !== "cp" && f.placeLevel !== "ville") {
      const hit = lx.some(k => { const [n, nm] = k.split("|"), q = ((lieuxCache.arr || {})[n] || []).find(x => x.n === nm); return q && inPoly(f.lat, f.lng, q.p); });
      if (hit) return true;
      if (!arrs.length) return false;
    } else if (!arrs.length) return a != null && a !== "b" && !lx.some(k => +k.split("|")[0] === a) ? false : null;
  }
  if (arrs.length) { if (a == null) return null; return arrs.includes(a); }
  return null;
}
/* tri des éléments {f, s, …} : ceux qui répondent, puis ceux à vérifier (avec ce qui manque) */
function applyFlt(items, tab) {
  const F = fltOf(tab), ok = [], maybe = [];
  if (!fltCount(F)) return {ok: items, maybe: [], n: 0};
  for (const it of items) {
    const miss = []; let out = false;
    const lieu = fltLieu(it.f, F); if (lieu === false) continue; if (lieu === null) miss.push((F.lieux || []).length ? "quartier" : "arrondissement");
    for (const [k, d] of Object.entries(FLT)) {
      if (!fltOn(F[k])) continue;
      const r = d.t(it.f, F[k], it.s, it);
      if (r === false) { out = true; break; }
      if (r === null && d.miss && !miss.includes(d.miss)) miss.push(d.miss);
    }
    if (out) continue;
    if (!miss.length) ok.push(it); else if (!F.strict) maybe.push(Object.assign({}, it, {s: Object.assign({}, it.s, {fltMiss: miss})}));
  }
  return {ok, maybe, n: fltCount(F)};
}

/* bouton de la barre, avec le nombre de filtres actifs */
function fltBtnHTML(tab) {
  const n = fltCount(fltOf(tab));
  return `<button class="iconbtn ann__flt${n ? " is-on" : ""}" type="button" id="fltOpen" aria-label="Filtres${n ? ` (${n})` : ""}" title="Filtres">${svgI(PIC.filtre, 19)}${n ? `<b class="ann__fltn num">${n}</b>` : ""}</button>`;
}
/* filtres actifs, en pastilles qu'on retire d'un geste */
function fltChipsHTML(tab) {
  const F = fltOf(tab), out = [], e = (k, l) => out.push(`<button class="chip chip--sm fltc" type="button" data-fltx="${k}"><span>${l}</span><span class="fltc__x" aria-hidden="true">×</span></button>`);
  const eur = v => `${fmtInt(v)} €`;
  if (fltOn(F.prixMax)) e("prixMax", `≤ ${eur(F.prixMax)}`);
  if (fltOn(F.prixMin)) e("prixMin", `≥ ${eur(F.prixMin)}`);
  if (fltOn(F.ppmMax)) e("ppmMax", `≤ ${fmtInt(F.ppmMax)} €/m²`);
  if (fltOn(F.surfMin)) e("surfMin", `≥ ${fmtInt(F.surfMin)} m²`);
  if (fltOn(F.surfMax)) e("surfMax", `≤ ${fmtInt(F.surfMax)} m²`);
  if (fltOn(F.pieces)) e("pieces", `${F.pieces} p. et +`);
  if (fltOn(F.chambres)) e("chambres", `${F.chambres} ch. et +`);
  if (fltOn(F.arrs)) e("arrs", F.arrs.map(a => a === "b" ? "Banlieue" : arrNom(a)).join(", "));
  if (fltOn(F.lieux)) e("lieux", F.lieux.map(k => k.split("|")[1]).join(", "));
  if (fltOn(F.etage)) e("etage", F.etage === "top" ? "Dernier étage" : F.etage === 1 ? "Pas de RDC" : `Dès le ${F.etage}e`);
  if (F.ascenseur) e("ascenseur", "Ascenseur");
  if (fltOn(F.exterieur)) e("exterieur", F.exterieur === "grand" ? "Terrasse ou jardin" : "Extérieur");
  if (fltOn(F.dpe)) e("dpe", `DPE ${F.dpe} au pire`);
  if (fltOn(F.etat)) e("etat", F.etat === "pret" ? "Prêt à vivre" : "Sans gros travaux");
  [["cave", "Cave"], ["parking", "Parking"], ["lumineux", "Lumineux"], ["vue", "Vue dégagée"], ["gardien", "Gardien"], ["photos", "Avec photos"], ["baisse", "Prix en baisse"], ["sansSuspectes", "Sans annonces suspectes"]].forEach(([k, l]) => { if (F[k]) e(k, l); });
  if (fltOn(F.meuble)) e("meuble", F.meuble === "meuble" ? "Meublé" : "Vide");
  if (fltOn(F.noteMin)) e("noteMin", `Note ≥ ${F.noteMin}`);
  if (fltOn(F.depuis)) e("depuis", {1: "Dernières 24 h", 3: "3 derniers jours", 7: "7 derniers jours", 30: "30 derniers jours"}[F.depuis] || "");
  if (fltOn(F.sources)) e("sources", F.sources.join(", "));
  return out.length ? `<div class="fltcs">${out.join("")}${F.strict ? `<span class="fltcs__strict">${svgI(PIC.cible, 14)}<span>Infos connues seulement</span></span>` : ""}</div>` : "";
}
function bindFlt(box, getItems) {
  const tab = fltTab(), o = $("#fltOpen", box); if (o) o.onclick = () => openFlt(tab, getItems);
  $$("[data-fltx]", box).forEach(b => b.onclick = () => { delete fltOf(tab)[b.dataset.fltx]; fltSave(); renderListings(); });
}
/* séparateur avant les annonces à vérifier */
const fltSepHTML = n => `<div class="feed__sep" role="separator"><span>${svgI(PIC.aide, 16)}<span>Infos manquantes</span></span><b class="num">${n}</b></div>`;

/* ---------- le panneau ---------- */
function openFlt(tab, getItems) {
  const F = Object.assign({}, fltOf(tab)), rent = curMode() === "location";
  if (lieuxCache === undefined) loadLieux().then(d => { lieuxCache = d || null; if ($("#lsheet.is-open .flt")) paint(); });
  let el = $("#lsheet");
  if (!el) { el = document.createElement("div"); el.id = "lsheet"; el.className = "auth"; el.innerHTML = `<div class="auth__veil" data-lclose></div><div class="auth__card lsheet" role="dialog" aria-modal="true" aria-labelledby="lsTitle"></div>`; document.body.appendChild(el); }
  const card = el.querySelector(".lsheet"), close = () => { el.classList.remove("is-open"); setTimeout(() => { el.hidden = true; }, 200); };
  el.onclick = e => { if (e.target.closest("[data-lclose]")) close(); };
  const sites = [...new Set(getItems().map(x => x.f.source).filter(Boolean).map(siteName))].sort();
  const one = (k, opts) => `<div class="chips">${opts.map(([v, l]) => `<button type="button" class="chip chip--sm" data-f1="${k}" data-v="${v}" aria-pressed="${String(F[k] ?? "") === String(v)}">${l}</button>`).join("")}</div>`;
  const tog = (k, l) => `<button type="button" class="chip chip--sm" data-ft="${k}" aria-pressed="${!!F[k]}">${l}</button>`;
  const num = (k, label, ph, step) => `<div class="field"><label class="label" for="flt-${k}">${label}</label><input type="number" id="flt-${k}" data-fn="${k}" inputmode="numeric" min="0" step="${step}" value="${F[k] ?? ""}" placeholder="${ph}"></div>`;
  const sec = (t, body) => `<section class="flt__s"><h3 class="sub3">${t}</h3>${body}</section>`;
  function paint() {
    const arrs = F.arrs || [], lieuxDispo = lieuxCache && lieuxCache.arr ? arrs.filter(a => a !== "b").flatMap(a => (lieuxCache.arr[a] || []).filter(x => x.k === "lieu").map(x => [a, x.n])) : [];
    card.innerHTML = `<div class="auth__head"><h2 id="lsTitle">Filtres</h2><button class="x" type="button" data-lclose aria-label="Fermer"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
      <div class="flt">
      ${sec(rent ? "Loyer" : "Prix", `<div class="home__grid">${num("prixMin", "Minimum", "€", rent ? 50 : 10000)}${num("prixMax", "Maximum", "€", rent ? 50 : 10000)}${num("ppmMax", rent ? "€/m² par mois max" : "€/m² max", "€/m²", rent ? 1 : 100)}</div>`)}
      ${sec("Taille", `<div class="home__grid">${num("surfMin", "Surface min", "m²", 1)}${num("surfMax", "Surface max", "m²", 1)}</div>
        <span class="label">Pièces</span>${one("pieces", [["", "Toutes"], [1, "1+"], [2, "2+"], [3, "3+"], [4, "4+"], [5, "5+"]])}
        <span class="label">Chambres</span>${one("chambres", [["", "Toutes"], [1, "1+"], [2, "2+"], [3, "3+"], [4, "4+"]])}`)}
      ${sec("Lieu", `<div class="flt__arrs">${Array.from({length: 20}, (_, i) => i + 1).concat(["b"]).map(a => `<button type="button" class="chip chip--sm" data-fa="${a}" aria-pressed="${arrs.includes(a)}">${a === "b" ? "Banlieue" : arrNom(a)}</button>`).join("")}</div>
        ${lieuxDispo.length ? `<span class="label">Quartiers</span><div class="chips">${lieuxDispo.map(([a, n]) => `<button type="button" class="chip chip--sm" data-fq="${a}|${esc(n)}" aria-pressed="${(F.lieux || []).includes(a + "|" + n)}">${esc(n)}</button>`).join("")}</div>` : ""}`)}
      ${sec("Immeuble", `<span class="label">Étage</span>${one("etage", [["", "Tous"], [1, "Pas de RDC"], [2, "Dès le 2e"], [4, "Dès le 4e"], ["top", "Dernier"]])}
        <div class="chips">${tog("ascenseur", "Ascenseur")}${tog("gardien", "Gardien")}</div>`)}
      ${sec("Le bien", `<span class="label">Extérieur</span>${one("exterieur", [["", "Peu importe"], ["tout", "Un extérieur"], ["grand", "Terrasse ou jardin"]])}
        <span class="label">DPE au pire</span>${one("dpe", [["", "Tous"], ["A", "A"], ["B", "B"], ["C", "C"], ["D", "D"], ["E", "E"], ["F", "F"]])}
        <span class="label">État</span>${one("etat", [["", "Peu importe"], ["sans", "Sans gros travaux"], ["pret", "Prêt à vivre"]])}
        ${rent ? `<span class="label">Meublé ou vide</span>${one("meuble", [["", "Peu importe"], ["vide", "Vide"], ["meuble", "Meublé"]])}` : ""}
        <div class="chips">${tog("lumineux", "Lumineux")}${tog("vue", "Vue dégagée")}${tog("cave", "Cave")}${tog("parking", "Parking")}</div>`)}
      ${sec("L’annonce", `<span class="label">Note minimum</span>${one("noteMin", [["", "Toutes"], [50, "50+"], [60, "60+"], [70, "70+"], [80, "80+"]])}
        <span class="label">Ajoutée</span>${one("depuis", [["", "Peu importe"], [1, "24 h"], [3, "3 jours"], [7, "7 jours"], [30, "30 jours"]])}
        <div class="chips">${tog("photos", "Avec photos")}${tog("baisse", "Prix en baisse")}${tog("sansSuspectes", "Sans annonces suspectes")}</div>
        ${sites.length > 1 ? `<span class="label">Sites</span><div class="chips">${sites.map(n => `<button type="button" class="chip chip--sm" data-fs="${esc(n)}" aria-pressed="${(F.sources || []).includes(n)}">${esc(n)}</button>`).join("")}</div>` : ""}`)}
      <section class="flt__s flt__strict"><div class="chips">${tog("strict", "Seulement les infos connues")}</div></section>
      </div>
      <div class="auth__foot flt__foot"><button class="btn btn--clair" type="button" id="fltClr" ${fltCount(F) ? "" : "disabled"}>Tout effacer</button><button class="btn btn--primary btn--block" type="button" id="fltGo"></button></div>`;
    count(); bind();
  }
  function count() {
    const saved = fltAll[tab]; fltAll[tab] = F; const r = applyFlt(getItems(), tab); fltAll[tab] = saved;
    const b = $("#fltGo", card); if (b) b.innerHTML = `<span>Voir ${plural(r.ok.length, "annonce", "annonces")}</span>${r.maybe.length ? `<span class="flt__plus num"> + ${r.maybe.length} à vérifier</span>` : ""}`;
    const c = $("#fltClr", card); if (c) c.disabled = !fltCount(F);
  }
  function bind() {
    $$("[data-fn]", card).forEach(i => i.oninput = () => { const v = parseFloat(i.value); if (isFinite(v) && v > 0) F[i.dataset.fn] = v; else delete F[i.dataset.fn]; count(); });
    $$("[data-f1]", card).forEach(b => b.onclick = () => { const k = b.dataset.f1, raw = b.dataset.v, v = raw === "" ? null : isFinite(+raw) ? +raw : raw; if (v == null || String(F[k]) === String(v)) delete F[k]; else F[k] = v; $$(`[data-f1="${k}"]`, card).forEach(x => x.setAttribute("aria-pressed", String(String(F[k] ?? "") === x.dataset.v))); count(); });
    $$("[data-ft]", card).forEach(b => b.onclick = () => { const k = b.dataset.ft; if (F[k]) delete F[k]; else F[k] = true; b.setAttribute("aria-pressed", String(!!F[k])); count(); });
    $$("[data-fa]", card).forEach(b => b.onclick = () => { const a = b.dataset.fa === "b" ? "b" : +b.dataset.fa, s = new Set(F.arrs || []); if (s.has(a)) s.delete(a); else s.add(a); F.arrs = [...s]; if (!F.arrs.length) delete F.arrs;
      if (F.lieux) { F.lieux = F.lieux.filter(k => (F.arrs || []).includes(+k.split("|")[0])); if (!F.lieux.length) delete F.lieux; }
      const y = card.scrollTop; paint(); card.scrollTop = y; });
    $$("[data-fq]", card).forEach(b => b.onclick = () => { const k = b.dataset.fq, s = new Set(F.lieux || []); if (s.has(k)) s.delete(k); else s.add(k); F.lieux = [...s]; if (!F.lieux.length) delete F.lieux; b.setAttribute("aria-pressed", String(s.has(k))); count(); });
    $$("[data-fs]", card).forEach(b => b.onclick = () => { const n = b.dataset.fs, s = new Set(F.sources || []); if (s.has(n)) s.delete(n); else s.add(n); F.sources = [...s]; if (!F.sources.length) delete F.sources; b.setAttribute("aria-pressed", String(s.has(n))); count(); });
    $("#fltClr", card).onclick = () => { Object.keys(F).forEach(k => delete F[k]); const y = card.scrollTop; paint(); card.scrollTop = y; };
    $("#fltGo", card).onclick = () => { fltAll[tab] = F; fltSave(); lui.exMore = 0; close(); renderListings(); };
  }
  paint();
  el.hidden = false; requestAnimationFrame(() => el.classList.add("is-open"));
}
