/* =========================================================
   Annonces : analyse par règles, score de correspondance, onglet
   ========================================================= */
const HOME_LIB = {
  lumiere:    {name: "Luminosité", desc: "Exposition, logement traversant, étage"},
  etage:      {name: "Étage et ascenseur", desc: "Les étages élevés avec ascenseur, pas de rez-de-chaussée"},
  exterieur:  {name: "Extérieur", desc: "Balcon, loggia, terrasse ou jardin"},
  calme:      {name: "Calme", desc: "Sur cour ou sur jardin plutôt que sur rue"},
  etat:       {name: "État et travaux", desc: "Rénové, à rafraîchir ou gros travaux"},
  energie:    {name: "Performance énergétique", desc: "Classe DPE, de A à G"},
  charges:    {name: "Charges", desc: "De copropriété pour un achat, locatives pour une location, rapportées à la surface"},
  agencement: {name: "Agencement", desc: "Surface par pièce, nombre de chambres"},
  annexes:    {name: "Cave et parking", desc: "Rangements et stationnement"},
  cachet:     {name: "Cachet de l’ancien", desc: "Parquet, moulures, cheminée, hauteur sous plafond"},
  vue:        {name: "Vue et vis-à-vis", desc: "Vue dégagée, sans vis-à-vis"},
  immeuble:   {name: "Immeuble et sécurité", desc: "Gardien, digicode, immeuble entretenu"},
  trajets:    {name: "Trajets quotidiens", desc: "Temps vers vos lieux de travail ou d’études"}
};
const HOME_W = {lumiere: 15, etage: 10, exterieur: 10, calme: 10, etat: 10, energie: 10, charges: 5, agencement: 10, annexes: 5, cachet: 5, vue: 5, immeuble: 5, trajets: 0};
const DPE = "ABCDEFG";
function homeProfile() {
  const p = state.profile;
  if (!p.home) p.home = {};
  const h = p.home;
  if (!h.weights) h.weights = Object.assign({}, HOME_W);
  Object.keys(HOME_LIB).forEach(k => { if (h.weights[k] === undefined) h.weights[k] = HOME_W[k] || 0; });
  if (h.noGround === undefined) h.noGround = true;
  if (h.elevatorFrom === undefined) h.elevatorFrom = 4;
  if (h.dpeMax === undefined) h.dpeMax = "F";
  if (!h.mix) h.mix = {logement: 45, quartier: 35, prix: 20};
  if (!h.loc) h.loc = {loyerMax: null, revenus: null, meuble: "indiff"};
  return h;
}

const listings = () => (state.listings = state.listings || []);

/* ---------- Contrôle de cohérence : les valeurs lues qui méritent un coup d'œil (rien n'est modifié) ---------- */
function checkListing(f) {
  const o = [], loc = kindOf(f) === "location", paris = String(f.postcode || "").startsWith("75") || f.city === "Paris", fr = v => fmtInt(Math.round(v));
  if (!f.price) o.push(["price", loc ? "loyer introuvable" : "prix introuvable"]);
  if (!f.surface) o.push(["surface", "surface introuvable"]);
  if (!f.postcode && !f.city) o.push(["postcode", "lieu introuvable"]);
  if (f.alt && f.alt.surface && f.surface) o.push(["surface", `${fr(f.surface)} m² ou ${fr(f.alt.surface)} m² selon les passages de l’annonce`]);
  if (f.price && f.surface && !f.viager) {
    const ppm = f.price / f.surface, [lo, hi] = loc ? (paris ? [15, 65] : [9, 40]) : (paris ? [4000, 25000] : [1800, 14000]);
    if (ppm < lo || ppm > hi) o.push([ppm < lo ? "price" : "surface", `${fr(ppm)} €/m²${loc ? " par mois" : ""}, inhabituel${paris ? " à Paris" : ""} : prix ou surface mal lus ?`]);
  }
  if (f.rooms && f.surface && (f.surface / f.rooms < 7 || (f.rooms === 1 && f.surface > 50) || f.surface / f.rooms > 60)) o.push(["rooms", `${f.rooms} pièce${f.rooms > 1 ? "s" : ""} pour ${fr(f.surface)} m²`]);
  if (f.bedrooms != null && f.rooms > 1 && f.bedrooms >= f.rooms) o.push(["bedrooms", `${f.bedrooms} chambres pour ${f.rooms} pièces`]);
  if (f.floor != null && f.floors && f.floor > f.floors) o.push(["floor", `${f.floor}e étage d’un immeuble de ${f.floors} étages`]);
  if (f.floor > 15 && paris) o.push(["floor", `${f.floor}e étage, rare à Paris`]);
  const a = f.ademe;
  if (a && a.cls && f.dpe && a.cls !== f.dpe) o.push(["dpe", `DPE annoncé ${f.dpe}, DPE officiel ${a.cls} (ADEME, ${fmtDate(a.date)})`]);
  if (a && a.surf && f.surface && Math.abs(a.surf - f.surface) > 2) o.push(["surface", `${fr(f.surface)} m² annoncés, ${fmtInt(a.surf)} m² au DPE officiel`]);
  if (!loc && f.charges && f.surface && (f.charges / f.surface > 110 || f.charges / f.surface < 4)) o.push(["charges", `${fr(f.charges)} € par an pour ${fr(f.surface)} m² : charges par mois lues comme par an, ou l’inverse ?`]);
  if (loc && f.rentCharges && f.price && f.rentCharges > f.price * 0.35) o.push(["rentCharges", `${fr(f.rentCharges)} € de charges pour ${fr(f.price)} € de loyer`]);
  return o;
}
/* DPE officiel : plusieurs logements possibles, l'utilisateur choisit */
function ademeHTML(f) {
  if (f.ademe || !(f.ademeCands || []).length) return "";
  return `<div class="ademe"><p><b>DPE officiel</b> : ${f.ademeCands.length > 1 ? `${f.ademeCands.length} logements correspondent` : "un logement correspond"} dans la base de l’ADEME. C’est lequel ?</p>
    ${f.ademeCands.map((a, i) => `<div class="ademe__r"><span>${esc(a.addr)}<small class="num">${esc(a.cls)}, ${fmtInt(a.surf)} m²${a.floor ? `, ${a.floor}e étage` : ""}, ${esc(fmtDate(a.date))}</small></span><button class="chip chip--sm" type="button" data-ademe="${i}">C’est celui-ci</button></div>`).join("")}
    <button class="link" type="button" data-ademenone>Aucun de ceux-là</button></div>`;
}
function checkHTML(f) {
  // une info vérifiée et enregistrée dans le formulaire n'est plus signalée
  const c = checkListing(f).filter(([k]) => !(f.checked || []).includes(k)); if (!c.length) return "";
  return `<div class="trust trust--check"><p><b>Infos à vérifier</b></p><ul class="trust__l">${c.map(x => `<li>${esc(x[1])}</li>`).join("")}</ul><button class="link" type="button" data-checkfix>Corriger les informations</button></div>`;
}
function listingTitle(f) {
  const parts = [f.rooms ? (f.rooms === 1 ? "Studio" : `${f.rooms} pièces`) : "Appartement", f.surface ? `${fmtInt(f.surface)}\u00a0m²` : null];
  const pc = f.postcode, place = pc && /^750\d\d$/.test(pc) ? arrLabel(pc) : f.city;
  return parts.filter(Boolean).join(", ") + (place ? `, ${place}` : "");
}

/* ---------- Score de correspondance ---------- */
function homeValues(f, raw = false) {
  const v = {}, known = {};
  const k = (id, val, isKnown) => { v[id] = Math.max(0, Math.min(5, val)); known[id] = isKnown; };
  // luminosité
  let lu = 2.5, kl = false;
  if (f.exposure) { kl = true; lu = /sud|ouest/.test(f.exposure) ? 4 : /est/.test(f.exposure) ? 3 : 1.5; }
  if (f.traversant) { lu += 1; kl = true; }
  if (f.bright) { lu = Math.max(lu, 4); kl = true; }
  if (f.dark) { lu = 1; kl = true; }
  if (f.floor != null) lu += f.floor === 0 ? -1.5 : f.floor >= 4 ? .5 : 0;
  k("lumiere", lu, kl);
  // étage
  if (f.floor == null) k("etage", 2.5, false);
  else if (f.floor === 0) k("etage", 0, true);
  else if (f.floor === 1) k("etage", 2, true);
  else if (f.floor <= 3) k("etage", f.elevator === false && f.floor === 3 ? 3 : 3.5, true);
  else k("etage", f.elevator === false ? 1.5 : f.elevator ? 5 : 3.5, true);
  if (f.top && v.etage >= 3) v.etage = Math.min(5, v.etage + .5);
  // extérieur
  // description complète lue (fiche, ou données de la page assez longues) : un extérieur ou une cave dont elle ne parle pas manque très probablement
  const full = f.descLen >= 600 || !!f.fullPage || !!f.complet, ded = {};
  const ex = {terrasse: 5, jardin: 5, balcon: 3, loggia: 3}[f.outdoor];
  k("exterieur", ex != null ? Math.min(5, ex + (f.outdoorArea >= 8 ? .5 : 0)) : 1, ex != null || full); if (ex == null && full) ded.exterieur = true;
  k("calme", f.quiet === true ? 5 : f.quiet === false ? 1.5 : 2.5, f.quiet != null);
  k("etat", {neuf: 5, bon: 4, rafraichir: 2.5, travaux: 1}[f.works] ?? 3, !!f.works);
  k("energie", f.dpe ? [5, 5, 4, 3, 2, 1, 0][DPE.indexOf(f.dpe)] : 2.5, !!f.dpe);
  if (kindOf(f) === "location" && f.rentCharges && f.surface) { const c = f.rentCharges * 12 / f.surface; k("charges", c < 25 ? 5 : c < 35 ? 4 : c < 45 ? 3 : c < 60 ? 2 : 1, true); }
  else if (f.charges && f.surface) { const c = f.charges / f.surface; k("charges", c < 25 ? 5 : c < 35 ? 4 : c < 45 ? 3 : c < 60 ? 2 : 1, true); } else k("charges", 3, false);
  if (f.surface && f.rooms) { const r = f.surface / f.rooms; k("agencement", (r >= 20 ? 5 : r >= 16 ? 4 : r >= 13 ? 3 : 2) + (f.bedrooms != null && f.rooms >= 3 && f.bedrooms >= f.rooms - 1 ? .5 : 0), true); } else k("agencement", 2.5, false);
  k("annexes", f.cave || f.parking ? (f.cave && f.parking ? 5 : 3.5) : 1, !!(f.cave || f.parking) || full); if (!(f.cave || f.parking) && full) ded.annexes = true;
  k("cachet", f.cachet ? (f.cachet >= 2 ? 5 : 3.5) : 2, !!f.cachet);
  k("vue", f.view ? 5 : 2.5, !!f.view);
  k("immeuble", f.building === "gardien" ? 5 : f.building === "securise" ? 3.5 : 2.5, !!f.building);
  const cm = commutes(f);
  if (cm.length) { const t = Math.max(...cm.map(x => x.min)); k("trajets", t <= 20 ? 5 : t <= 30 ? 4 : t <= 40 ? 3 : t <= 50 ? 2 : t <= 60 ? 1 : 0, true); } else k("trajets", 2.5, false);
  /* corrections faites après lecture ou visite : elles priment sur la lecture de l'annonce */
  const fixed = {};
  if (!raw && f.fix && f.fix.crit) for (const [id, val] of Object.entries(f.fix.crit)) if (id in v && val != null) { v[id] = val; known[id] = true; fixed[id] = true; }
  for (const id in fixed) delete ded[id];
  return {v, known, fixed, ded};
}
/* Secteurs choisis dans le questionnaire : une annonce ailleurs est hors critères (lieu inconnu : on ne juge pas) */
function secteurFail(f, h) {
  if (!(h.arrs && h.arrs.length)) return null;
  const pc = String(f.postcode || "").trim(), m = /^75(?:0(\d\d)|1(16))$/.exec(pc), city = f.city && !/^paris/i.test(f.city) ? `, à ${f.city}` : "";
  if (m) { const n = +(m[1] || m[2]); return h.arrs.includes(n) ? null : `dans le ${arrNom(n)}`; }
  if (/^9[234]\d{3}$/.test(pc)) return h.banlieue ? null : `en banlieue${city}`;
  return /^\d{5}$/.test(pc) ? `hors de Paris${city}` : null;
}
function listingFilters(f, h) {
  const fails = [], lo = h.loc || {}, sec = secteurFail(f, h);
  if (sec) fails.push(sec);
  if (kindOf(f) === "location") {
    if (lo.loyerMax > 0 && f.price > lo.loyerMax) fails.push(`au-dessus de votre loyer maximum de ${fmtInt(lo.loyerMax)} €`);
    if (lo.meuble === "vide" && f.furnished === true) fails.push("meublé");
    if (lo.meuble === "meuble" && f.furnished === false) fails.push("non meublé");
  } else if (h.budgetMax > 0 && f.price > h.budgetMax) fails.push(`au-dessus de votre budget de ${fmtInt(h.budgetMax)} €`);
  if (h.surfaceMin > 0 && f.surface && f.surface < h.surfaceMin) fails.push(`moins de ${h.surfaceMin} m²`);
  if (h.roomsMin > 0 && f.rooms && f.rooms < h.roomsMin) fails.push(`moins de ${h.roomsMin} pièces`);
  if (h.bedroomsMin > 0 && f.bedrooms != null && f.bedrooms < h.bedroomsMin) fails.push(`moins de ${h.bedroomsMin} chambre${h.bedroomsMin > 1 ? "s" : ""}`);
  if (h.noGround && f.floor === 0) fails.push("rez-de-chaussée");
  if (h.elevatorFrom && f.floor >= h.elevatorFrom && f.elevator === false) fails.push(`${f.floor}e étage sans ascenseur`);
  if (h.dpeMax && h.dpeMax !== "G" && f.dpe && DPE.indexOf(f.dpe) > DPE.indexOf(h.dpeMax)) fails.push(`DPE ${f.dpe}`);
  if (h.outdoorReq && !f.outdoor) fails.push("pas d’extérieur");
  if (h.noWorks && f.works === "travaux") fails.push("gros travaux");
  return fails;
}
/* Zones superposées : la plus petite prime, critère par critère ; ce qu'elle ne note pas vient de la zone suivante (plus grande),
   puis de l'estimation la plus locale. Chaque membre d'une carte de groupe est traité de même. */
const zoneAire = z => z.area || (Array.isArray(z.points) && z.points.length >= 3 ? polyArea(z.points) : Infinity);
function stackZones(zs) {
  const sz = zs.slice().sort((a, b) => zoneAire(a) - zoneAire(b));
  if (sz.length === 1) return {zone: sz[0], score: zoneScore(sz[0]).score, stack: null};
  const from = new Set();
  const merge = get => { const out = {}; for (const z of sz) for (const [id, v] of Object.entries(get(z) || {})) if (typeof v === "number" && !(id in out)) { out[id] = v; from.add(z); } return out; };
  const ratings = merge(z => z.ratings);
  const ids = [...new Set(sz.flatMap(z => (z.others || []).map(o => o.userId)))];
  const others = ids.map(id => ({userId: id, ratings: merge(z => ((z.others || []).find(o => o.userId === id) || {}).ratings), fav: ((sz[0].others || []).find(o => o.userId === id) || {}).fav}));
  const v = {id: sz[0].id, name: sz[0].name, points: sz[0].points, est: (sz.find(z => z.est) || {}).est, price: (sz.find(z => z.price > 0) || {}).price, ratings, others, fav: sz[0].fav, comment: sz[0].comment};
  const more = sz.slice(1).filter(z => from.has(z));   // les plus grandes qui ont réellement apporté une note
  return {zone: sz[0], score: zoneScore(v).score, stack: more.length ? [sz[0], ...more] : null};
}
/* Quartier : les zones qui contiennent l'annonce (superposées : voir stackZones), sinon la plus proche (moins de 300 m), sinon l'estimation des données du coin */
function listingArea(f) {
  if (!(f.lat && f.lng)) return null;
  const p = {lat: f.lat, lng: f.lng}, coarse = f.placeLevel === "cp" || f.placeLevel === "ville";   // posée au centre de l'arrondissement : aucune zone ne la contient vraiment
  const inside = coarse ? [] : state.zones.filter(z => Array.isArray(z.points) && inPoly(f.lat, f.lng, z.points));
  if (inside.length) return Object.assign(stackZones(inside), {how: "dans"});
  let best = null;
  for (const z of coarse ? [] : state.zones) { if (!z.points) continue; const d = Math.min(...z.points.map(q => distM(p, {lat: q[0], lng: q[1]}))); if (d < 300 && (!best || d < best.d)) best = {zone: z, d}; }
  if (best) { const s = zoneScore(best.zone).score; return {zone: best.zone, score: s == null ? null : Math.max(0, s - 5), how: "près", d: best.d}; }
  if (f.est) {
    const tmp = {est: f.est, ratings: {}}, cs = crit().filter(c => c.weight > 0), sw = scoreWith(tmp, {}, cs, zoneBudget());
    const all = cs.reduce((a, c) => a + c.weight, 0), est = cs.filter(c => critValFor(tmp, c.id, {}, zoneBudget()).v !== undefined), wEst = est.reduce((a, c) => a + c.weight, 0);
    const missing = cs.filter(c => !est.includes(c) && c.id !== "prix").sort((a, b) => b.weight - a.weight).map(c => c.name.toLowerCase());
    return {zone: null, score: sw.score, how: "estimé", cover: all ? wEst / all : 0, missing};
  }
  return null;
}
/* Prix de référence ajusté au bien : la médiane du quartier mélange étages, états et extérieurs.
   Coefficients d'usage (décotes et surcotes courantes), volontairement modérés. */
function priceAdjust(f) {
  const rent = kindOf(f) === "location", k = rent ? .5 : 1, adj = [];
  const add = (label, pct) => { if (pct) adj.push([label, Math.round(pct * k * 10) / 10]); };
  if (f.outdoor === "terrasse" || f.outdoor === "jardin") add(f.outdoor === "jardin" ? "Jardin" : "Terrasse", f.outdoorArea >= 10 ? 8 : 6);
  else if (f.outdoor === "balcon" || f.outdoor === "loggia") add(f.outdoor === "balcon" ? "Balcon" : "Loggia", 2);
  if (f.floor === 0) add("Rez-de-chaussée", -8);
  else if (f.floor === 1) add("1er étage", -2);
  else if (f.floor >= 4 && f.elevator === false) add(`${f.floor}e sans ascenseur`, -6);
  else if (f.floor === 3 && f.elevator === false) add("3e sans ascenseur", -3);
  else if (f.floor >= 4 && f.elevator) add("Étage élevé avec ascenseur", 3);
  if (!rent) { if (f.works === "neuf") add("Rénové", 5); else if (f.works === "rafraichir") add("À rafraîchir", -5); else if (f.works === "travaux") add("Travaux", -12); }
  if (f.dpe === "G") add("DPE G", -10); else if (f.dpe === "F") add("DPE F", -5); else if (f.dpe === "A" || f.dpe === "B") add(`DPE ${f.dpe}`, 3);
  if (f.view) add("Vue dégagée", 3);
  if (!rent && f.surface) { if (f.surface < 25) add("Petite surface", 10); else if (f.surface < 35) add("Petite surface", 5); else if (f.surface > 100) add("Grande surface", -5); }
  return {adj, factor: adj.reduce((m, [, p]) => m * (1 + p / 100), 1)};
}
function scoreListing(f, raw = false) {
  const h = homeProfile(), {v, known, fixed, ded} = homeValues(f, raw), W = homeWeights(), fx = raw ? null : f.fix;
  // Logement : seuls les critères connus comptent ; les inconnus élargissent la fourchette au lieu de valoir la moyenne
  let wAll = 0, wKnown = 0, acc = 0;
  for (const [id, w] of Object.entries(W)) if (w > 0) { wAll += w; if (known[id]) { wKnown += w; acc += w * v[id] / 5; } }
  const cover = wAll ? wKnown / wAll : 0, wU = wAll - wKnown;
  // les inconnus comptent à moitié, pour une valeur neutre : peu d'infos ne donne ni une note extrême, ni une note moyenne d'office
  const logement = wKnown ? Math.round((acc + .5 * wU * .5) / (wKnown + wU * .5) * 100) : null;
  const logLo = wAll ? Math.round((acc + .2 * wU) / wAll * 100) : null, logHi = wAll ? Math.round((acc + .8 * wU) / wAll * 100) : null;
  // Rédhibitoires et coups de cœur : un très mauvais point sur ce qui compte beaucoup n'est pas rattrapé par de petits atouts
  const redhib = [], coeur = [];
  for (const [id, w] of Object.entries(W)) {
    if (!(w > 0) || !known[id] || !wAll) continue;
    const share = w / wAll;
    if (share >= .1 && v[id] <= 1.5) redhib.push([id, Math.round(Math.min(1, share / .15) * (1.6 - v[id]) / 1.6 * 12)]);
    else if (share >= .1 && v[id] >= 4.75 && !["agencement", "charges", "annexes"].includes(id)) coeur.push([id, Math.round(Math.min(1, share / .15) * 4)]);
  }
  const malus = Math.min(24, redhib.reduce((a, [, p]) => a + p, 0)), bonus = Math.min(8, coeur.reduce((a, [, p]) => a + p, 0));
  // Quartier : votre zone, sinon une estimation partielle (sécurité, nuisances, bâti ne s'estiment pas)
  const area = listingArea(f), quartier = fx && fx.quartier != null ? fx.quartier : area ? area.score : null;
  const partial = !(fx && fx.quartier != null) && area && area.how === "estimé" ? area : null;
  // Prix : comparé au marché du quartier, ajusté aux atouts et défauts du bien
  const rentK = kindOf(f) === "location", rr = rentK ? rentFor(f) : null;
  const medRaw = rentK ? (rr ? rr.cc : null) : f.est && f.est.prix ? f.est.prix.med : null, ppm = f.price && f.surface && !f.viager ? f.price / f.surface : null; // viager : bouquet sans rapport avec le prix au m²
  const pa = priceAdjust(f), med = medRaw ? medRaw * pa.factor : null;
  let prix = null, ecart = null;
  if (med && ppm) { ecart = ppm / med - 1; prix = Math.round(Math.max(0, Math.min(1, (0.2 - ecart) / 0.35)) * 100); }
  // Mélange : une partie mal renseignée pèse moins
  const mix = h.mix, wq = partial ? mix.quartier * (.4 + .6 * (partial.cover ?? .5)) : mix.quartier;
  const mkTotal = lg => { const parts = [[lg, mix.logement * (.5 + .5 * cover)], [quartier, wq], [prix, mix.prix]].filter(([x, w]) => x != null && w > 0); const wt = parts.reduce((a, [, w]) => a + w, 0); return wt ? parts.reduce((a, [x, w]) => a + x * w, 0) / wt : null; };
  const base = mkTotal(logement);
  let total = base == null ? null : Math.round(Math.max(0, Math.min(100, base + bonus - malus)));
  const fails = listingFilters(f, h);
  if (fails.length && total != null) total = Math.min(total, 35);
  if ((f.scam || []).length && total != null) total = Math.min(total, 25); // arnaque probable : jamais en tête du fil
  // Fourchette : ce que la note pourrait valoir une fois les inconnues levées
  const coarse = !f.lat || f.placeLevel === "cp" || f.placeLevel === "ville";   // seulement l'arrondissement : le quartier réel est inconnu
  let range = null;
  if (total != null && logLo != null && cover < 1) {
    const qUnc = partial ? (1 - (partial.cover ?? .5)) * (coarse ? 16 : 8) : 0;
    const lo = Math.round(Math.max(0, (mkTotal(logLo) ?? total) + bonus - malus - qUnc)), hi = Math.round(Math.min(100, (mkTotal(logHi) ?? total) + bonus - malus + qUnc));
    if (hi - lo >= 12) range = [Math.min(lo, total), fails.length ? Math.min(hi, 35) : Math.max(hi, total)];
  }
  const hasFix = !!(fx && ((fx.crit && Object.keys(fx.crit).length) || fx.quartier != null || fx.total != null));
  const heden = hasFix ? scoreListing(f, true).total : total;
  if (fx && fx.total != null) total = fx.total;
  // Fiabilité : trop peu d'infos sur le logement ou sur le lieu, et Heden ne note pas ; il dit ce qui manque et invite à noter
  const need = [];
  if (mix.logement >= 20 && cover < .4) need.push(...Object.entries(W).filter(([id, w]) => w > 0 && !known[id] && id !== "trajets").sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => HOME_LIB[id].name.toLowerCase()));
  const qOk = !!(fx && fx.quartier != null) || !!(area && area.zone) || (!!area && !coarse && (area.cover ?? 0) >= .3);
  if (mix.quartier >= 20 && !qOk) need.unshift(f.lat && !coarse ? "quartier" : "adresse");
  const reliable = total == null ? false : !!(fx && fx.total != null) || fails.length > 0 || !need.length;
  const maybe = !reliable && total != null && !fails.length && !(f.scam || []).length && (range ? range[1] : total) >= 68;
  // raisons, les plus parlantes d'abord
  const plus = [], minus = (f.scam || []).length ? ["Annonce suspecte"] : [];
  if (f.dropped && f.priceHistory && f.priceHistory.length) plus.push(`Prix baissé de ${fmtInt(f.priceHistory[f.priceHistory.length - 1].price - f.price)} €`);
  if (fx && fx.quartier != null) (fx.quartier >= 60 ? plus : minus).push(`Quartier corrigé à ${fx.quartier}`);
  else if (area && area.stack) (area.score >= 65 ? plus : area.score < 45 ? minus : plus).push(`Dans vos zones « ${area.stack[0].name} » et « ${area.stack[1].name} » (${area.score ?? "–"})`);
  else if (area && area.zone) (area.score >= 65 ? plus : area.score < 45 ? minus : plus).push(`${area.how === "dans" ? "Dans" : "Près de"} votre zone « ${area.zone.name} » (${area.score ?? "–"})`);
  else if (area) { const ar = coarse && /^750(\d\d)$/.exec(f.postcode || ""); (area.score >= 60 ? plus : minus).push(ar ? `Paris ${arrNom(+ar[1])} estimé à ${area.score}, sans l’adresse` : `Quartier estimé à ${area.score} d’après les données du coin`); }
  if (ecart != null) (ecart <= -0.03 ? plus : ecart >= 0.08 ? minus : plus).push(ecart <= -0.03 ? `${Math.round(-ecart * 100)} % sous les ${rentK ? "loyers" : "ventes"} du quartier` : ecart >= 0.08 ? `${Math.round(ecart * 100)} % au-dessus des ${rentK ? "loyers" : "ventes"} du quartier${pa.adj.length ? ", à atouts égaux" : ""}` : rentK ? "Dans les loyers du quartier" : "Au prix des ventes du quartier");
  const label = {lumiere: f.bright || f.traversant ? "Lumineux" + (f.traversant ? ", traversant" : "") : f.exposure ? `Exposé ${f.exposure}` : "Luminosité",
    etage: f.floor === 0 ? "Rez-de-chaussée" : f.floor != null ? `${f.floor === 1 ? "1er" : f.floor + "e"} étage${f.elevator ? " avec ascenseur" : f.elevator === false ? " sans ascenseur" : ""}` : "Étage",
    exterieur: f.outdoor ? (f.outdoor[0].toUpperCase() + f.outdoor.slice(1)) + (f.outdoorArea ? ` de ${f.outdoorArea} m²` : "") : "Pas d’extérieur",
    calme: f.quiet ? "Au calme, sur cour" : "Sur rue", etat: {neuf: "Rénové", bon: "Bon état", rafraichir: "À rafraîchir", travaux: "Travaux à prévoir"}[f.works],
    energie: f.dpe ? `DPE ${f.dpe}` : "DPE", charges: f.charges ? `Charges de ${fmtInt(f.charges)} € par an` : "Charges", agencement: f.surface && f.rooms ? `${fmtInt(f.surface / f.rooms)} m² par pièce` : "Agencement",
    annexes: [f.cave && "Cave", f.parking && "Parking"].filter(Boolean).join(" et "), cachet: "Cachet de l’ancien", vue: "Vue dégagée", immeuble: f.building === "gardien" ? "Gardien" : "Immeuble sécurisé",
    trajets: (() => { const cm = commutes(f); return cm.length ? cm.map(x => `${x.min} min ${x.p.label ? "vers " + x.p.label : "de trajet"}`).join(", ") : ""; })()};
  const ranked = Object.entries(W).filter(([id, w]) => w > 0 && known[id]).sort((a, b) => b[1] - a[1]);
  if (ded.exterieur) label.exterieur = "Pas d’extérieur mentionné";
  if (ded.annexes) label.annexes = "";
  for (const id in fixed) label[id] = `${HOME_LIB[id].name} : ${fmtNote(v[id])}/5, corrigé`;
  ranked.forEach(([id]) => { if (v[id] >= 4 && label[id]) plus.push(label[id]); else if (v[id] <= 1.5 && label[id]) minus.push(label[id]); });
  const unknown = Object.entries(W).filter(([id, w]) => w >= 10 && !known[id] && id !== "trajets").map(([id]) => HOME_LIB[id].name.toLowerCase());
  return {total, logement, quartier, prix, ecart, ppm, med, medRaw, adj: pa.adj, area, partial, fails, plus: plus.slice(0, 4), minus: minus.slice(0, 3), unknown, values: v, known, fixed, hasFix, heden, fixTotal: !!(fx && fx.total != null), fixQuartier: !!(fx && fx.quartier != null),
    cover, reliable, maybe, need, range: fx && fx.total != null ? null : range, redhib: redhib.map(([id, p]) => ({id, name: HOME_LIB[id].name, label: label[id] || HOME_LIB[id].name, p})), coeur: coeur.map(([id, p]) => ({id, name: HOME_LIB[id].name, label: label[id] || HOME_LIB[id].name, p})), malus, bonus};
}

/* Note affichée : un « ? » tant que Heden n'en sait pas assez pour noter */
const noteTxt = s => s.reliable ? s.total : s.total != null && s.cover >= .2 ? "≈" + s.total : "?";   // provisoire : un ordre de grandeur quand l'annonce en dit un peu ; presque rien de connu : « ? »
const noteCol = s => colorFor(s.reliable ? s.total : null);

/* ---------- Onglet Annonces ---------- */
const LSTAT = {nouvelle: "Nouvelle", gardee: "Favori", visite: "Visite prévue", ecartee: "Masquée"};
let lui = {filter: "toutes", sort: "reco", openId: null, feed: "explorer", favf: "tous", exf: "pour", exMore: 0};   // Explorer d'abord : la recherche principale
/* Pictogrammes (grille 24, trait 1,9) : ils remplacent le texte là où l'image suffit ; chaque usage garde un libellé lisible par les lecteurs d'écran */
const svgI = (d, w = 16) => `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const PIC = {
  pieces: '<path d="M6 21V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21"/><path d="M3.5 21h17"/><circle cx="14.6" cy="12.4" r=".8" fill="currentColor"/>',
  surface: '<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/>',
  etage: '<path d="M4 20h4.5v-4.5H13V11h4.5V6.5H21"/>',
  ascenseur: '<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="m9 9.5 3-3 3 3M9 14.5l3 3 3-3"/>',
  lieu: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/>',
  prix: '<path d="M17.5 6.6A6.5 6.5 0 1 0 17.5 17.4"/><path d="M4.5 10.5h8.5M4.5 13.5h8.5"/>',
  lumiere: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  exterieur: '<path d="M5 19.5c0-8 5-13.5 14.5-14.5 0 9.5-5.5 14.5-13.5 14.5"/><path d="M5 19.5c3-4.2 6.2-7 10-9"/>',
  calme: '<path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10Z"/>',
  etat: '<path d="M14.8 4.6a4.6 4.6 0 0 0-4.3 6.1L4.4 16.8a2 2 0 1 0 2.8 2.8l6.1-6.1a4.6 4.6 0 0 0 6.1-4.3l-2.8 2.8-2.7-.9-.9-2.7 2.8-2.8Z"/>',
  energie: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z"/>',
  charges: '<ellipse cx="12" cy="6.5" rx="7" ry="2.8"/><path d="M5 6.5v5.5c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8V6.5M5 12v5.5c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8V12"/>',
  agencement: '<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M4 12.5h8.5M12.5 4v16"/>',
  annexes: '<path d="M4 8 12 4l8 4v8l-8 4-8-4Z"/><path d="m4 8 8 4 8-4M12 12v8"/>',
  cachet: '<path d="M12 3c.6 4.4 2.6 6.4 7 7-4.4.6-6.4 2.6-7 7-.6-4.4-2.6-6.4-7-7 4.4-.6 6.4-2.6 7-7Z"/>',
  vue: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  immeuble: '<path d="M12 3 5 6v5.5c0 4.4 3 7.9 7 9.5 4-1.6 7-5.1 7-9.5V6l-7-3Z"/>',
  trajets: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  hors: '<circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/>',
  aide: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.6a2.5 2.5 0 0 1 4.8.8c0 1.7-2.4 2.1-2.4 3.6"/><circle cx="12" cy="16.9" r=".7" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  tri: '<path d="M7 4v16M3.5 16.5 7 20l3.5-3.5M17 20V4M13.5 7.5 17 4l3.5 3.5"/>',
  cible: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".7" fill="currentColor"/>',
  carte: '<path d="M9 4.5 3.5 6.5v13l5.5-2 6 2 5.5-2v-13l-5.5 2-6-2Z"/><path d="M9 4.5v13M15 6.5v13"/>',
  profil: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c.8-3.7 3.8-6 7.5-6s6.7 2.3 7.5 6"/>',
  ouvrir: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>'
};
const isKept = f => f.status === "gardee" || f.status === "visite";
const ICO = {
  keep: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/></svg>',
  drop: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12s3.4-6.5 9-6.5c1.6 0 3 .5 4.2 1.2M21 12s-3.4 6.5-9 6.5c-1.6 0-3-.5-4.2-1.2"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M4 4l16 16"/></svg>',
  mine: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3.5h10a1.5 1.5 0 0 1 1.5 1.5v15.5L12 16.6l-6.5 3.9V5A1.5 1.5 0 0 1 7 3.5Z"/><path d="M12 7.5v5.5M9.25 10.25h5.5"/></svg>',
  explore: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="m15.6 8.4-2.1 5.1-5.1 2.1 2.1-5.1 5.1-2.1Z"/></svg>',
  visit: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>',
  back: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 7 4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 0 12"/></svg>'
};
function setStatus(f, st, after) {
  const prev = f.status || "nouvelle";
  if (prev === st) return;
  f.status = st; f.updatedAt = Date.now(); learnMemo.key = null; save(); renderListingPins();
  if (after) after(); else renderListings();
  toast({gardee: "Ajoutée aux favoris", visite: "Visite prévue", ecartee: "Annonce masquée", nouvelle: prev === "ecartee" ? "Annonce de nouveau affichée" : "Retirée des favoris"}[st], {label: "Annuler", fn: () => { f.status = prev; f.updatedAt = Date.now(); learnMemo.key = null; save(); renderListingPins(); renderListings(); }});
}
function renderListings() { setTimeout(() => tipsKick(), 0);
  const vw = $("#view-annonces"), box = $("#annonces");
  const view = lui.openId && listings().some(x => x.id === lui.openId) ? "d:" + lui.openId : "list", prev = lui.lastView;
  if (prev && prev !== view && prev === "list" && vw) lui.listScroll = vw.scrollTop;
  renderListingsView();
  if (prev && prev !== view && box) {
    box.style.setProperty("--dx", view === "list" ? -1 : 1);
    box.classList.remove("swap-in"); void box.offsetWidth; box.classList.add("swap-in"); clearTimeout(lui.swapT); lui.swapT = setTimeout(() => box.classList.remove("swap-in"), 300);
    if (vw) vw.scrollTop = view === "list" ? (lui.listScroll || 0) : 0;
  }
  lui.lastView = lui.openId && listings().some(x => x.id === lui.openId) ? "d:" + lui.openId : "list";
}
/* Liste : onglet Favoris, ou onglet Annonces en deux flux (Mes annonces, Explorer) */
const mineListings = () => modeListings().filter(f => f.origin !== "vivier");
const listSort = (a, b) => (!!a.f.gone - !!b.f.gone) || (lui.sort === "prix" ? (a.f.price ?? 1e12) - (b.f.price ?? 1e12) : lui.sort === "recent" ? (b.f.addedAt || 0) - (a.f.addedAt || 0) : lui.sort === "match" ? (b.s.reliable - a.s.reliable) || (b.s.total ?? -1) - (a.s.total ?? -1) : recoScore(b) - recoScore(a));
const sortHTML = () => `<label class="ann__sort"><span class="ann__sortic" aria-hidden="true">${svgI(PIC.tri, 17)}</span><span class="sr">Trier par</span><select id="lsort">${[["reco", "Recommandé"], ["match", "Note"], ["prix", "Prix"], ["recent", "Ajout récent"]].map(([v, l]) => `<option value="${v}" ${lui.sort === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>`;
const segHTML = (key, opts) => `<div class="seg seg--sm" role="group" aria-label="Filtrer">${opts.map(([k, l, n]) => `<button type="button" data-${key}="${k}" aria-pressed="${lui[key] === k}">${l}${n != null ? `<span class="num">${n}</span>` : ""}</button>`).join("")}</div>`;
function renderListingsView() {
  const box = $("#annonces"); if (!box) return;
  if (lui.openId && listings().some(x => x.id === lui.openId)) return renderListingDetail(lui.openId);
  if (!["reco", "match", "prix", "recent"].includes(lui.sort)) lui.sort = "reco";
  box.classList.toggle("ann--fav", currentTab === "favoris");
  box.classList.toggle("ann--ex", currentTab !== "favoris" && lui.feed === "explorer");
  if (currentTab === "favoris") renderFavoris(box);
  else if (lui.feed === "explorer") renderExplorer(box);
  else renderMine(box);
  $$("[data-feed]", box).forEach(b => b.onclick = () => { if (lui.feed === b.dataset.feed) return; lui.feed = b.dataset.feed; lui.exMore = 0; renderListings(); const vw = $("#view-annonces"); if (vw) vw.scrollTop = 0; });
  const so = $("#lsort"); if (so) so.onchange = e => { lui.sort = e.target.value; renderListings(); };
  bindHeroes(box);
  const first = $(".hero", box); if (first) countUp(first);
  bindModeSel(box);
  const ao = $("#addOther", box); if (ao) ao.onclick = () => { const h = homeProfile(), k = curMode() === "achat" ? "location" : "achat"; h.projet = "deux"; if (h.setup) h.setup.projet = "deux"; save(); setMode(k); toast(k === "location" ? "Location ajoutée à votre projet" : "Achat ajouté à votre projet"); };
  const ad = $("#addListing", box); if (ad) ad.onclick = () => openAddFlow();
  if (cloud.user && cloud.alert === undefined && !cloud.noInbox) { cloud.alert = null; loadAlertState().then(() => { if (currentTab === "annonces" && !lui.openId) renderListings(); }); }
}
/* En-tête commun de l'onglet Annonces : le titre, puis les deux flux côte à côte */
function feedsHTML(nMine, exLabel) {
  const f = (k, ico, t, n) => `<button class="feed feed--${k}" type="button" role="tab" data-feed="${k}" aria-selected="${lui.feed === k}"><span class="feed__ic">${ico}</span><b class="feed__t">${t}</b>${n !== "" ? `<span class="feed__n num">${n}</span>` : ""}</button>`;
  return `<div class="ann__head"><div>${modeSelHTML("ann__mode")}<h1>${projet() === "deux" ? (isRent() ? "Locations" : "Achats") : "Annonces"}</h1></div>
      <button class="iconbtn ann__add" type="button" id="addListing" aria-label="Ajouter une annonce" title="Ajouter une annonce">${svgI(PIC.plus, 20)}</button></div>
    <div class="feeds" role="tablist" aria-label="Flux d’annonces">${f("explorer", ICO.explore, "Explorer", exLabel)}${f("mes", ICO.mine, "Mes ajouts", nMine)}</div>`;
}
function otherKindHTML() {
  const other = projet() === "deux" ? 0 : listings().filter(f => kindOf(f) !== curMode()).length;
  return other ? `<p class="hint2 ann__other">${plural(other, curMode() === "achat" ? "annonce de location masquée" : "annonce de vente masquée", curMode() === "achat" ? "annonces de location masquées" : "annonces de vente masquées")} : votre projet est ${curMode() === "achat" ? "l’achat" : "la location"}. <button class="link" type="button" id="addOther">Ajouter ${curMode() === "achat" ? "la location" : "l’achat"} à mon projet</button></p>` : "";
}
function exploreLabel() {
  const rows = cloud.vivierRows; if (!cloud.user) return "";
  if (!rows) return "";
  const seen = homeProfile().vivierVu || 0, n = explorerItems().filter(x => !x.ex && x.r.item.first > seen).length;
  return n ? `<em>${plural(n, "nouvelle", "nouvelles")}</em>` : fmtInt(explorerItems().length);
}
function renderMine(box) {
  if (!["toutes", "masquees"].includes(lui.filter)) lui.filter = "toutes";
  const kept = mineListings().filter(isKept).length;
  const all = mineListings().filter(f => !isKept(f)).map(f => ({f, s: scoreListing(f)})), hid = all.filter(x => x.f.status === "ecartee");
  const shown = (lui.filter === "masquees" ? hid : all.filter(x => x.f.status !== "ecartee")).sort(listSort);
  box.innerHTML = `${feedsHTML(fmtInt(all.length - hid.length), exploreLabel())}
    <p class="feed__lead"><span aria-hidden="true">${svgI(PIC.info, 15)}</span><span>Les annonces que vous avez ajoutées vous-même, depuis un site, une alerte ou un texte collé.</span></p>
    ${all.length ? `<div class="ann__bar">${segHTML("filter", [["toutes", "Affichées", all.length - hid.length], ["masquees", "Masquées", hid.length]])}${sortHTML()}</div>` : ""}
    ${otherKindHTML()}
    ${all.length ? `<div class="ann__feed">${shown.map(({f, s}, k) => heroHTML(f, s, k)).join("") || `<p class="hint2 ann__none">${lui.filter === "masquees" ? "Aucune annonce masquée." : "Toutes vos annonces sont masquées."}</p>`}</div>`
      : `<div class="ann__empty">${GALETS}<p>${kept ? `<span>Vos annonces sont toutes dans vos favoris.</span>` : "Ajoutez une annonce vue sur un site : Heden la note et la place sur la carte."}</p><div class="ann__emptyacts">${kept ? `<button class="btn" type="button" id="favGo2">Voir les favoris</button>` : `<button class="btn btn--primary" type="button" id="addListing2">Ajouter une annonce</button>`}</div></div>`}`;
  const a2 = $("#addListing2", box); if (a2) a2.onclick = () => openAddFlow();
  const f2 = $("#favGo2", box); if (f2) f2.onclick = () => setTab("favoris");
  $$("[data-filter]", box).forEach(b => b.onclick = () => { lui.filter = b.dataset.filter; renderListings(); });
  if (cloud.user && !cloud.vivierRows && !cloud.noVivier) loadVivier().then(r => { if (r && currentTab === "annonces" && lui.feed === "mes" && !lui.openId) { const n = $(".feed--explorer .feed__n"); if (n) n.innerHTML = exploreLabel(); } });
}
/* Explorer : les annonces reçues par l'adresse d'alertes de Heden, communes à tous les membres */
function explorerItems() {
  return (cloud.vivierRows || []).filter(r => kindOf(r.f) === curMode()).map(r => {
    const ex = listings().find(x => x.vivierId === r.id) || listings().find(x => sameListing(x, r.f));
    return {r, ex, f: ex || r.f};
  }).filter(x => !(x.ex && (x.ex.status === "ecartee" || isKept(x.ex))));   // masquées et favoris : hors du flux, pour cet utilisateur seulement
}
function renderExplorer(box) {
  if (!["pour", "tout"].includes(lui.exf)) lui.exf = "pour";
  const head = feedsHTML(fmtInt(mineListings().filter(f => f.status !== "ecartee" && !isKept(f)).length), exploreLabel());
  const lead = "";
  if (!cloud.user) { box.innerHTML = `${head}${lead}<div class="ann__empty ann__empty--ex">${GALETS}<p>Connectez-vous pour explorer les annonces reçues par Heden.</p><button class="btn btn--primary" type="button" id="exLogin">Se connecter</button></div>`; const b = $("#exLogin", box); if (b) b.onclick = () => openAuth(); return; }
  if (!cloud.vivierRows) {
    box.innerHTML = `${head}${lead}<div class="ann__feed">${'<article class="hero hero--ex hero--wait" aria-hidden="true"><div class="hero__ph"></div><div class="hero__b"><i></i><i></i><i></i></div></article>'.repeat(2)}</div>`;
    loadVivier().then(() => { if (currentTab === "annonces" && lui.feed === "explorer" && !lui.openId) renderListings(); });
    return;
  }
  const h = homeProfile(), seen = lui.exSeen ?? (lui.exSeen = h.vivierVu || 0);
  const items = explorerItems().map(x => Object.assign(x, {s: scoreListing(x.f), neu: x.r.item.first > seen}));
  const pour = items.filter(x => !x.s.fails.length), list = (lui.exf === "pour" ? pour : items).sort((a, b) => (b.neu - a.neu) || listSort(a, b));
  const max = 30 + (lui.exMore || 0), shown = list.slice(0, max);
  box.innerHTML = `${head}${lead}
    ${items.length ? `<div class="ann__bar">${segHTML("exf", [["pour", "Pour vous", pour.length], ["tout", "Toutes", items.length]])}${sortHTML()}</div>` : ""}
    ${otherKindHTML()}
    ${items.length ? nudgeHTML(items) : ""}
    ${items.length ? `<div class="ann__feed">${shown.map(({f, s, neu}, k) => heroHTML(f, s, k, neu)).join("") || `<p class="hint2 ann__none">Aucune annonce ne correspond à vos critères pour l’instant. Touchez « Toutes » pour tout voir.</p>`}</div>
      ${list.length > max ? `<button class="btn btn--block feed__more" type="button" id="exMore">Afficher ${Math.min(30, list.length - max)} annonces de plus</button>` : ""}`
      : `<div class="ann__empty ann__empty--ex">${GALETS}<p>Rien de neuf pour l’instant : les annonces arrivent au fil des alertes reçues par Heden.</p></div>`}`;
  $$("[data-exf]", box).forEach(b => b.onclick = () => { lui.exf = b.dataset.exf; lui.exMore = 0; renderListings(); });
  const mo = $("#exMore", box); if (mo) mo.onclick = () => { lui.exMore = (lui.exMore || 0) + 30; renderListings(); };
  bindNudge(box);
  if (!h.vivierVu || h.vivierVu < Date.now() - 60000) { h.vivierVu = Date.now(); save(); }
  estimerExplorer([...shown, ...items].map(x => x.f).filter(f => String(f.id).startsWith("v:")));
}
/* une annonce d'Explorer devient une annonce de l'utilisateur au premier geste (ouverture, cœur, masquer) */
function adoptVivier(id) {
  const r = (cloud.vivierRows || []).find(x => "v:" + x.id === id); if (!r) return null;
  const ex = listings().find(x => x.vivierId === r.id) || listings().find(x => sameListing(x, r.f)); if (ex) return ex;
  const m = mergeCard(r.item, {origin: "vivier", source: r.item.source, at: r.item.first}); if (!m.f) return null;
  m.f.vivierId = r.id; save(); queuePlace([m.f]);
  return m.f;
}
function renderFavoris(box) {
  if (!["tous", "visite"].includes(lui.favf)) lui.favf = "tous";
  const all = modeListings().filter(isKept).map(f => ({f, s: scoreListing(f)})), vis = all.filter(x => x.f.status === "visite");
  const shown = (lui.favf === "visite" ? vis : all).sort(listSort);
  box.innerHTML = `<div class="ann__head"><div>${modeSelHTML("ann__mode")}<h1>Favoris</h1><p class="lead">${all.length ? `${plural(all.length, "annonce gardée", "annonces gardées")}, sur la carte aussi.` : ""}</p></div></div>
    ${all.length ? `<div class="ann__bar">${segHTML("favf", [["tous", "Tous", all.length], ["visite", "Visite prévue", vis.length]])}${sortHTML()}</div>` : ""}
    ${all.length ? `<div class="ann__feed">${shown.map(({f, s}, k) => heroHTML(f, s, k)).join("") || `<p class="hint2 ann__none">Aucune visite prévue : touchez « Prévoir la visite » sur un favori.</p>`}</div>`
      : `<div class="ann__empty ann__empty--fav"><span class="fav__ic" aria-hidden="true">${ICO.keep}</span><p>Touchez le cœur d’une annonce, dans Explorer ou Mes ajouts : elle se range ici et apparaît sur la carte.</p><button class="btn" type="button" id="favGo">Voir les annonces</button></div>`}`;
  $$("[data-favf]", box).forEach(b => b.onclick = () => { lui.favf = b.dataset.favf; renderListings(); });
  const go = $("#favGo", box); if (go) go.onclick = () => setTab("annonces");
}
function bindHeroes(box) {
  const get = id => id.startsWith("v:") ? adoptVivier(id) : listings().find(x => x.id === id);
  $$(".hero[data-id]", box).forEach(card => {
    card.onclick = e => {
      if (e.target.closest("[data-hst]")) return;
      const f = get(card.dataset.id); if (!f) return;
      const vw = $("#view-annonces"); lui.listScroll = vw.scrollTop;
      morph([[card.querySelector(".hero__ph"), "lph"], [card.querySelector(".hero__s"), "lsc"]],
        () => { lui.openId = f.id; renderListings(); vw.scrollTop = 0; },
        () => [[$(".ldet .lgal"), "lph"], [$(".ldet__score b"), "lsc"]]);
    };
    $$("[data-hst]", card).forEach(b => b.onclick = e => {
      e.stopPropagation();
      const f = get(card.dataset.id); if (!f) return;
      let st = b.dataset.hst;
      if (st === "fav") st = isKept(f) ? "nouvelle" : "gardee";
      else if (st === "visite") st = f.status === "visite" ? "gardee" : "visite";
      else if (st === "ecartee" && f.status === "ecartee") st = "nouvelle";
      const toFav = st === "gardee" && currentTab !== "favoris";   // un favori quitte Mes ajouts et Explorer : il part dans l'onglet Favoris
      const leaves = toFav || st === "ecartee" || (currentTab === "favoris" && st === "nouvelle") || (lui.filter === "masquees" && st === "nouvelle" && currentTab !== "favoris" && lui.feed === "mes");
      if (st === "gardee" || st === "nouvelle") { const hb = card.querySelector(".hero__fav"); if (hb) { hb.setAttribute("aria-pressed", String(st === "gardee")); hb.classList.remove("is-pop"); void hb.offsetWidth; hb.classList.add("is-pop"); } }
      if (!leaves || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setTimeout(() => setStatus(f, st), st === "gardee" ? 220 : 0);
      if (toFav) { const ids = [card.dataset.id, f.id]; return setTimeout(() => {   // la liste a pu être redessinée entre-temps (annonce d'Explorer adoptée) : on reprend la carte affichée
        const live = ids.map(i => document.querySelector(`.ann__feed .hero[data-id="${CSS.escape(i)}"]`)).find(Boolean) || card;
        const hb = live.querySelector(".hero__fav"); if (hb) hb.setAttribute("aria-pressed", "true");
        flyToFav(live, () => setStatus(f, st));
      }, 200); }
      card.style.height = card.offsetHeight + "px"; card.classList.add(st === "ecartee" ? "hero--out-l" : "hero--out-r");
      setTimeout(() => setStatus(f, st), 260);
    });
  });
}
/* Favori : la carte rétrécit et file vers l'onglet Favoris (barre du bas sur téléphone, onglets du haut sur ordinateur), puis le flux se referme */
function flyToFav(card, done) {
  const tab = $$('[role="tab"][data-tab="favoris"]').find(b => b.offsetParent), r = card.getBoundingClientRect();
  if (!tab || !card.animate || !r.width || r.bottom < 0 || r.top > innerHeight) return done();
  card.style.pointerEvents = "none";
  const t = tab.getBoundingClientRect(), ic = tab.querySelector("svg") || tab, ti = ic.getBoundingClientRect();
  const ghost = card.cloneNode(true);
  ghost.classList.add("hero--fly"); ghost.removeAttribute("data-id"); ghost.setAttribute("aria-hidden", "true");
  Object.assign(ghost.style, {position: "fixed", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px", margin: "0", zIndex: "1200", pointerEvents: "none", transformOrigin: "50% 50%"});
  document.body.appendChild(ghost);
  card.style.visibility = "hidden";
  const cx = ti.left + ti.width / 2 - (r.left + r.width / 2), cy = ti.top + ti.height / 2 - (r.top + r.height / 2), end = Math.max(.04, 28 / r.width);
  const lift = Math.min(90, Math.abs(cy) * .25) * (cy > 0 ? -1 : 1);   // une courbe : la carte se soulève avant de plonger vers l'onglet
  const a = ghost.animate([
    {transform: "translate(0,0) scale(1)", opacity: 1, borderRadius: "28px"},
    {transform: `translate(${cx * .35}px, ${cy * .3 + lift}px) scale(.5)`, opacity: 1, borderRadius: "40px", offset: .45},
    {transform: `translate(${cx}px, ${cy}px) scale(${end})`, opacity: .35, borderRadius: "50%"}
  ], {duration: 640, easing: "cubic-bezier(.45,0,.2,1)", fill: "forwards"});
  // le flux se referme derrière elle
  card.style.height = card.offsetHeight + "px"; card.style.overflow = "hidden";
  requestAnimationFrame(() => { card.classList.add("hero--gone"); });
  a.onfinish = () => {
    ghost.remove();
    tab.classList.remove("is-recu"); void tab.offsetWidth; tab.classList.add("is-recu"); setTimeout(() => tab.classList.remove("is-recu"), 700);
    done();
  };
}
/* Recommandé : la note, plus un bonus pour les annonces récentes (qui s'efface en deux à trois semaines), hors critères en dernier */
function recoScore({f, s}) {
  const days = Math.max(0, (Date.now() - (f.addedAt || f.firstSeen || 0)) / 864e5);
  return (s.total ?? 45) - (s.reliable ? 0 : s.maybe ? 4 : 12) + 14 * Math.exp(-days / 6) - (s.fails.length ? 25 : 0) + (f.dropped ? 3 : 0);
}
/* Explorer : quand trop d'annonces restent en note provisoire, une seule invitation, celle qui en débloque le plus */
function nudgeHTML(items) {
  const q = items.filter(x => !x.s.reliable && !x.s.fails.length && x.s.total != null);
  if (q.length < 2 && homeProfile().setup) return "";
  const lieu = q.filter(x => x.s.need.some(n => n === "quartier" || n === "adresse")).length, loge = q.filter(x => x.s.need.some(n => n !== "quartier" && n !== "adresse")).length;
  const card = (k, ic, t, d, b) => `<div class="nudge nudge--${k}"><span class="nudge__ic" aria-hidden="true">${svgI(ic, 22)}</span><p><b>${t}</b><span>${d}</span></p><button class="btn btn--sm" type="button" data-invite="${k}">${b}</button></div>`;
  if (!homeProfile().setup) return card("profil", PIC.profil, "Des notes faites pour vous", "Neuf questions, deux minutes : Heden note chaque annonce selon vos critères.", "Définir mon profil");
  if (lieu >= loge && zonesRated() < 3) return card("carte", PIC.carte, `${plural(lieu, "annonce attend", "annonces attendent")} une note de quartier`, "Notez deux ou trois coins que vous connaissez : Heden s’en sert pour toutes les annonces autour.", "Noter un quartier");
  if (loge >= 2) return card("fiche", PIC.ouvrir, `${plural(loge, "annonce n’en dit", "annonces n’en disent")} pas assez`, extInstalled() ? "Ouvrez-en une sur son site : l’extension lit sa fiche entière, et la note se précise pour tout le monde." : "Avec l’extension Heden, les fiches entières des sites sont lues : étage, DPE, extérieur, position.", extInstalled() ? "Voir les annonces à compléter" : "L’extension");
  return "";
}
function bindNudge(box) {
  $$("[data-invite]", box).forEach(b => b.onclick = () => {
    const k = b.dataset.invite;
    if (k === "profil") openQuiz();
    else if (k === "carte") openLieux();
    else if (extInstalled()) { lui.sort = "match"; lui.exf = "tout"; renderListings(); const f = $(".hero__s--q", box); if (f) f.closest(".hero").scrollIntoView({behavior: "smooth", block: "center"}); }
    else openAddFlow("extension");
  });
}
/* Fiabilité : signaux d'annonce douteuse (à vérifier, pas un verdict) */
function trustSignals(f, s) {
  const risk = [...(f.scam || [])];
  if (s.ecart != null && s.ecart <= (kindOf(f) === "location" ? -0.3 : -0.35)) risk.unshift(`prix ${Math.round(-s.ecart * 100)} % sous le marché`);
  // une photo reprise par une seule autre annonce (une image présente partout est un visuel par défaut du site)
  const all = listings(), shared = (f.photos || []).some(u => { const w = all.filter(x => x.id !== f.id && (x.photos || []).includes(u)); return w.length === 1 && !sameListing(w[0], f); });
  if (shared) risk.push("mêmes photos qu’une autre annonce");
  // un bien à Paris, un numéro à l'étranger : classique des fausses locations
  if (/^(?:\+|00)(?!33)\d/.test(String(f.agencyPhone || "").replace(/[\s.()-]/g, ""))) risk.push("numéro de téléphone étranger");
  return {risk, photo: f.aiPhoto || [], level: risk.length > 1 || (f.scam || []).length ? "fort" : risk.length ? "moyen" : null};
}
/* Passage fil ↔ fiche : la photo et la note glissent d'un écran à l'autre (View Transitions), sinon changement direct */
function morph(from, update, to) {
  if (!document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) return update();
  const name = (pairs, on) => pairs.forEach(([el, n]) => { if (el) el.style.viewTransitionName = on ? n : ""; });
  name(from, true);
  const t = document.startViewTransition(() => { name(from, false); update(); name(to(), true); });
  t.finished.finally(() => name(to(), false));
}
function heroKicker(f, s, k) {
  if (f.gone) return "Plus en ligne";
  if (f.status === "visite") return "Visite prévue";
  if (s.fails.length) return "Hors critères";
  const tr = trustSignals(f, s); if (tr.level) return tr.level === "fort" ? "Annonce suspecte" : "Annonce à vérifier";
  if (f.viager) return f.viager === "occupe" ? "Viager occupé" : f.viager === "libre" ? "Viager libre" : "Viager";
  if (f.dropped) return "Baisse de prix";
  const vu = f.origin === "vivier" && f.lastSeen ? Math.floor((Date.now() - f.lastSeen) / 864e5) : 0;
  if (vu >= 10) return `Pas revue depuis ${vu} jours`;   // plus vue dans les alertes ni par l'extension : peut-être vendue
  if (!s.reliable) return "À noter";
  if (k === 0 && lui.sort === "reco" && currentTab === "annonces") return "Recommandée";
  const days = Math.floor((Date.now() - (f.addedAt || 0)) / 864e5);
  if (days < 2) return "Nouvelle";
  return days < 60 ? `Ajoutée il y a ${days} jours` : (kindOf(f) === "location" ? "Location" : "Vente");
}
function trustHTML(t) {
  if (!t.level && !t.photo.length) return "";
  return `<div class="trust${t.level ? " trust--" + t.level : ""}">
    ${t.level ? `<p><b>${t.level === "fort" ? "Annonce suspecte" : "Annonce à vérifier"}</b> : ${esc(t.risk.join(", "))}.</p><p class="hint2">Ne versez rien avant d’avoir visité et signé, vérifiez l’agence (carte professionnelle) ou l’identité du propriétaire.</p>` : ""}
    ${t.photo.length ? `<p><b>Photos à prendre avec recul</b> : ${esc(t.photo.join(", "))}. Les pièces réelles peuvent être différentes : demandez des photos actuelles ou une visite vidéo.</p>` : ""}
  </div>`;
}
/* Lieu court : arrondissement (ou commune), puis le quartier s'il est connu ; un morceau par <span> (traduction) */
function placeHTML(f, s) {
  const pc = f.postcode, base = pc && /^75\d{3}$/.test(pc) ? arrLabel(pc) : f.city || "";
  const q = f.quartier || (s && s.area && s.area.zone && s.area.how === "dans" ? s.area.zone.name : "");
  return [base, q].filter(Boolean).map(x => `<span>${esc(x)}</span>`).join('<span aria-hidden="true"> · </span>') || "<span>Lieu à préciser</span>";
}
/* Caractéristiques : pictogramme + valeur, le mot complet reste pour les lecteurs d'écran */
function factsHTML(f) {
  const it = (ic, v, sr, cls = "") => `<li class="fact${cls}"><span class="fact__ic">${svgI(ic, 16)}</span><b class="num">${v}</b><span class="sr">${sr}</span></li>`;
  const out = [];
  if (f.rooms) out.push(it(PIC.pieces, f.rooms === 1 ? "Studio" : `${f.rooms} p.`, f.rooms === 1 ? "" : " pièces"));
  if (f.surface) out.push(it(PIC.surface, `${fmtInt(f.surface)} m²`, ""));
  if (f.floor != null) out.push(it(f.elevator ? PIC.ascenseur : PIC.etage, f.floor === 0 ? "RDC" : f.floor === 1 ? "1er ét." : `${f.floor}e ét.`, f.floor === 0 ? "rez-de-chaussée" : f.elevator ? "avec ascenseur" : f.elevator === false ? "sans ascenseur" : ""));
  if (f.dpe) out.push(`<li class="fact fact--dpe" style="--dpe:var(--dpe-${f.dpe.toLowerCase()})"><b>${esc(f.dpe)}</b><span class="sr">DPE ${esc(f.dpe)}</span></li>`);
  return out.length ? `<ul class="facts" aria-label="Caractéristiques">${out.join("")}</ul>` : "";
}
/* Raisons de la note en pastilles : un pictogramme et deux ou trois mots */
const CHIP_TXT = {lumiere: ["Lumineux", "Sombre"], etage: ["Étage élevé", "Étage bas"], exterieur: ["Extérieur", "Sans extérieur"], calme: ["Calme", "Sur rue"], etat: ["Bon état", "Travaux"],
  energie: ["Bon DPE", "DPE faible"], charges: ["Charges basses", "Charges élevées"], agencement: ["Bien agencé", "Petites pièces"], annexes: ["Cave, parking", "Sans annexe"], cachet: ["Cachet", ""], vue: ["Vue dégagée", ""], immeuble: ["Gardien", ""], trajets: ["Trajets courts", "Trajets longs"]};
function chipsOf(f, s) {
  const out = [], add = (ic, t, tone, title) => { if (t && out.length < 4) out.push({ic, t, tone, title}); };
  if (s.fails.length) add(PIC.hors, "Hors critères", "minus", "Hors de vos critères : " + s.fails.join(", "));
  if (s.quartier != null) add(PIC.lieu, `Quartier ${s.quartier}`, s.quartier >= 65 ? "plus" : s.quartier < 45 ? "minus" : "", s.area && s.area.stack ? `Vos zones « ${s.area.stack[0].name} » et « ${s.area.stack[1].name} »` : s.area && s.area.zone ? `Votre zone « ${s.area.zone.name} »` : "Estimé d’après les données du coin");
  if (s.ecart != null) add(PIC.prix, s.ecart <= -0.03 ? `${Math.round(-s.ecart * 100)} % sous le marché` : s.ecart >= 0.08 ? `${Math.round(s.ecart * 100)} % au-dessus` : "Prix du marché", s.ecart <= -0.03 ? "plus" : s.ecart >= 0.08 ? "minus" : "");
  const W = homeWeights(), ranked = Object.entries(W).filter(([id, w]) => w > 0 && s.known[id]).sort((a, b) => b[1] - a[1]);
  for (const [id] of ranked) {
    const v = s.values[id], good = v >= 4, bad = v <= 1.5; if (!good && !bad) continue;
    let t = CHIP_TXT[id][good ? 0 : 1];
    if (id === "exterieur" && good && f.outdoor) t = f.outdoor[0].toUpperCase() + f.outdoor.slice(1);
    if (id === "etat" && good && f.works === "neuf") t = "Rénové";
    if (id === "annexes" && good) t = [f.cave && "Cave", f.parking && "Parking"].filter(Boolean).join(", ");
    if (id === "lumiere" && good && f.exposure && !f.bright) t = `Exposé ${f.exposure}`;
    if (id === "energie" || id === "etage") continue;   // déjà dans les caractéristiques
    add(PIC[id], t, good ? "plus" : "minus");
  }
  if (!s.reliable && s.need.length) add(PIC.aide, "À compléter", "need", "Il manque : " + s.need.join(", "));
  return out;
}
const chipsHTML = cs => cs.length ? `<ul class="whys">${cs.map(c => `<li class="why${c.tone ? " why--" + c.tone : ""}"${c.title ? ` title="${esc(c.title)}"` : ""}><span class="why__ic">${svgI(c.ic, 15)}</span><span>${esc(c.t)}</span></li>`).join("")}</ul>` : "";
function heroHTML(f, s, k = 0, neu = false) {
  const ph = f.photos && f.photos[0], fav = isKept(f), ex = f.origin === "vivier" && currentTab !== "favoris";
  const acts = currentTab === "favoris"
    ? `<button class="chip hero__keep" type="button" data-hst="visite" aria-pressed="${f.status === "visite"}">${ICO.visit}${f.status === "visite" ? "Visite prévue" : "Prévoir la visite"}</button>`
    : f.status === "ecartee"
    ? `<button class="chip hero__drop" type="button" data-hst="ecartee">${ICO.back}Afficher de nouveau</button>`
    : "";
  const hide = currentTab !== "favoris" && f.status !== "ecartee" ? `<button class="hero__hide" type="button" data-hst="ecartee" aria-label="Masquer l’annonce" title="Masquer l’annonce">${ICO.drop}</button>` : "";
  return `<article class="hero${ex ? " hero--ex" : ""}${ph ? "" : " hero--nophoto"}${f.gone || f.status === "ecartee" ? " hero--off" : ""}${s.fails.length ? " hero--fail" : ""}" data-id="${f.id}" style="--c:${noteCol(s)}">
    <div class="hero__ph">${ph ? `<img src="${esc(ph)}" alt="" loading="${k < 2 ? "eager" : "lazy"}" referrerpolicy="no-referrer" onerror="this.remove()">` : GALETS}${(f.photos || []).length > 1 ? `<span class="hero__nph num">${f.photos.length} photos</span>` : ""}</div>
    <button class="hero__fav" type="button" data-hst="fav" aria-pressed="${fav}" aria-label="${fav ? "Retirer des favoris" : "Ajouter aux favoris"}" title="${fav ? "Retirer des favoris" : "Ajouter aux favoris"}">${ICO.keep}</button>${hide}
    <b class="hero__s num${s.reliable ? "" : " hero__s--q"}"${k === 0 && s.reliable ? ` data-count="${s.total}"` : ""}${s.reliable ? "" : ` title="${s.total != null ? "Note provisoire : il manque des infos" : "Pas assez d’infos pour noter"}"`}>${noteTxt(s)}</b>
    <div class="hero__b">
      <span class="hero__k${s.maybe ? " hero__k--maybe" : ""}">${esc(s.maybe ? "Peut vous plaire" : neu ? "Nouvelle" : heroKicker(f, s, k))}${ex && f.source ? `<span class="hero__src">${esc(siteName(f.source))}</span>` : ""}</span>
      <h2 class="hero__lieu"><span class="hero__lic" aria-hidden="true">${svgI(PIC.lieu, 18)}</span><span>${placeHTML(f, s)}</span></h2>
      <p class="hero__p num">${f.price ? priceTxt(f) : kindOf(f) === "location" ? "Loyer ?" : "Prix ?"}${s.ppm ? `<small>${ppmTxt(f)}</small>` : ""}</p>
      ${factsHTML(f)}
      ${chipsHTML(chipsOf(f, s))}
      ${!f.lat && !String(f.id).startsWith("v:") ? `<p class="hero__why hero__why--none">${placeQ.tried.has(f.id) ? "Lieu introuvable : ouvrez-la pour le préciser" : "Placement sur la carte…"}</p>` : ""}
      ${acts ? `<div class="hero__acts">${acts}</div>` : ""}
    </div>
  </article>`;
}
function renderListingDetail(id) { setTimeout(() => tipsKick(), 0);
  const f = listings().find(x => x.id === id), box = $("#annonces"); if (!f) { lui.openId = null; return renderListings(); }
  const s = scoreListing(f), h = homeProfile();
  const bar = (label, val, hint) => `<div class="mbar"><span>${label}</span><span class="bar"><i style="width:${val ?? 0}%;--c:${traitFor(val)}"></i></span><b class="num">${val ?? "–"}</b>${hint ? `<small>${hint}</small>` : ""}</div>`;
  const crits = Object.entries(homeWeights()).filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]);
  box.innerHTML = `
    <div class="ldet__top"><button class="link ann__back" type="button" id="lback">‹ ${currentTab === "favoris" ? "Favoris" : f.origin === "vivier" && lui.feed === "explorer" ? "Explorer" : "Mes ajouts"}</button><button class="x x--del" type="button" id="ldel" aria-label="Supprimer l’annonce" title="Supprimer"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg></button></div>
    ${f.photos && f.photos.length ? `<div class="lgal">${f.photos.map(u => `<img src="${esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`).join("")}</div>` : ""}
    <div class="ldet__head">
      <div><h1${(f.title || listingTitle(f)).length > 70 ? ' class="is-long"' : ""}>${esc(f.title || listingTitle(f))}</h1>
        <p class="ldet__price num">${f.price ? priceTxt(f) : kindOf(f) === "location" ? "Loyer non trouvé" : "Prix non trouvé"}${s.ppm ? ` <small>${ppmTxt(f)}</small>` : ""}</p>
        ${factsHTML(f)}
        ${f.priceHistory && f.priceHistory.length ? `<p class="ldet__hist num">${f.priceHistory.map(x => `<s>${fmtInt(x.price)}&#8239;€</s>`).join(" ")} ${f.dropped ? "<em class=\"drop\">Baisse de prix</em>" : ""}</p>` : ""}
        <p class="hint2">${esc([...(f.sources || [f.source]).filter(Boolean)].join(", "))}${f.source || f.sources ? ", " : ""}${f.origin === "alerte" ? "reçue par alerte le" : "ajoutée le"} ${esc(fmtDate(new Date(f.firstSeen || f.addedAt || Date.now()).toISOString().slice(0, 10)))}</p></div>
      <div class="ldet__score${s.reliable ? "" : " ldet__score--q"}" style="--c:${noteCol(s)}"><b class="num" ${s.reliable ? `data-count="${s.total}"` : ""}>${noteTxt(s)}</b><span>${!s.reliable ? (s.total != null ? "note provisoire" : "pas encore notée") : s.hasFix ? `corrigée${s.heden != null && s.heden !== s.total ? ` · Heden&nbsp;${s.heden}` : ""}` : "note"}</span>${s.range ? `<span class="ldet__rng num" title="Fourchette tant que l’annonce ne dit pas tout">${s.range[0]} à ${s.range[1]}</span>` : ""}${(() => { const others = modeListings().filter(x => x.id !== f.id && x.status !== "ecartee").map(x => scoreListing(x)).filter(x => x.reliable).map(x => x.total); if (others.length < 3 || !s.reliable) return ""; const pct = Math.round(others.filter(v => v < s.total).length / others.length * 100); return `<span class="ldet__pct">${pct >= 50 ? `mieux que ${pct} %` : `moins bien que ${100 - pct} %`} de vos annonces</span>`; })()}</div>
    </div>
    <div class="lstat">
      <button class="lst lst--keep" type="button" data-st="gardee" aria-pressed="${isKept(f)}">${ICO.keep}<span>${isKept(f) ? "En favori" : "Ajouter aux favoris"}</span></button>
      <button class="lst lst--drop" type="button" data-st="ecartee" aria-pressed="${f.status === "ecartee"}">${ICO.drop}<span>${f.status === "ecartee" ? "Masquée" : "Masquer"}</span></button>
    </div>
    <div class="lact">
      ${isKept(f) ? `<button class="chip chip--sm" type="button" data-st="visite" aria-pressed="${f.status === "visite"}">${ICO.visit}Visite prévue</button>` : ""}
      ${cleanWeb(f.url) ? `<a class="chip chip--sm" href="${esc(cleanWeb(f.url))}" target="_blank" rel="noopener noreferrer">Voir l’annonce ↗</a>` : ""}
    </div>
    ${askHTML(f, s)}
    ${s.reliable && !f.fullPage && cleanWeb(f.url) && (f.photos || []).length < 6 ? `<p class="hint2 lact__hint">Toutes les photos et la fiche complète : ouvrez l’annonce, puis touchez + Heden sur sa page.</p>` : ""}
    ${s.fails.length ? `<div class="banner banner--alerte">Hors de vos critères : ${esc(s.fails.join(", "))}.</div>` : ""}
    ${trustHTML(trustSignals(f, s))}
    ${checkHTML(f)}
    ${ademeHTML(f)}
    ${s.reliable ? `<div class="feel" role="group" aria-label="Votre avis sur la note"><span>Cette note vous semble</span>${[["juste", "Juste"], ["haut", "Trop haute"], ["bas", "Trop basse"]].map(([k, l]) => `<button class="chip chip--sm" type="button" data-feel="${k}" aria-pressed="${!!(f.feel && f.feel.v === k)}">${l}</button>`).join("")}
      ${f.feel && f.feel.v !== "juste" ? `<p class="feel__next">Noté. Une info mal lue ? <button class="link" type="button" id="feelFix">Corrigez-la</button>.</p>` : ""}</div>` : ""}
    ${freshHTML(f)}
    ${contactHTML(f)}
    <section class="lsec">
      <div class="lsec__head"><h2>${s.reliable ? "Pourquoi ce score" : "Ce que Heden sait déjà"}</h2><button class="btn btn--sm btn--clair" type="button" id="lfix">${s.hasFix ? "Revoir mes corrections" : s.reliable ? "Corriger la note" : "La noter"}</button></div>
      ${s.fixTotal ? `<p class="banner">Note fixée à ${s.total} par ${f.fix.by && cloud.user && f.fix.by !== cloud.user.id ? esc(personName(f.fix.by)) : "vous"}. Le détail ci-dessous reste celui de l’analyse${s.heden != null ? `, qui donne ${s.heden}` : ""}.</p>` : ""}
      ${bar("Logement", s.logement, `compte pour ${h.mix.logement} %${s.cover < .999 ? `, ${Math.round(s.cover * 100)} % des critères connus` : ""}`)}
      ${bar("Quartier", s.quartier, s.fixQuartier ? "corrigé" : s.partial ? `estimé, sans ${esc((s.partial.missing || []).slice(0, 3).join(", ") || "vos critères de terrain")}` : s.area ? (s.area.stack ? `« ${esc(s.area.stack[0].name)} », complétée par « ${esc(s.area.stack.slice(1).map(z => z.name).join(" », « "))} »` : s.area.zone ? (s.area.how === "dans" ? "dans « " + esc(s.area.zone.name) + " »" : "près de « " + esc(s.area.zone.name) + " »") : "estimé") : "lieu inconnu")}
      ${bar("Prix", s.prix, s.ecart != null ? `${s.ecart > 0 ? "+" : "−"}${Math.abs(Math.round(s.ecart * 100))} % / quartier` : "à comparer")}
      ${s.adj && s.adj.length && s.med ? `<p class="hint2 lwhy__adj">Prix comparé à ${kindOf(f) === "location" ? fmt1(s.med) : fmtInt(s.med)} €/m² : le marché du quartier${s.medRaw ? ` (${kindOf(f) === "location" ? fmt1(s.medRaw) : fmtInt(s.medRaw)} €/m²)` : ""} ajusté au bien, ${esc(s.adj.map(([l, pc]) => `${l.toLowerCase()} ${pc > 0 ? "+" : "−"}${String(Math.abs(pc)).replace(".", ",")} %`).join(", "))}.</p>` : ""}
      ${s.redhib.length ? `<p class="lnote lnote--minus"><b>Rédhibitoire pour vous :</b> ${esc(s.redhib.map(r => r.label).join(", "))}, ce qui retire ${s.malus} points.</p>` : ""}
      ${s.coeur.length ? `<p class="lnote lnote--plus"><b>Coup de cœur :</b> ${esc(s.coeur.map(r => r.label).join(", "))}, ${s.bonus} points de plus.</p>` : ""}
      ${s.plus.length ? `<ul class="lwhy lwhy--plus">${s.plus.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      ${s.minus.length ? `<ul class="lwhy lwhy--minus">${s.minus.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      ${s.unknown.length ? `<p class="hint2">À vérifier, l’annonce n’en parle pas : ${esc(s.unknown.join(", "))}${s.range ? `. Selon ce que montrera la visite, la note ira de ${s.range[0]} à ${s.range[1]}` : ""}.</p>` : ""}
    </section>
    ${analysisHTML(f)}
    <section class="lsec">
      <h2>Le logement</h2>
      <div class="lcrit">${crits.map(([cid]) => `<div class="${s.fixed[cid] ? "fix" : s.known[cid] ? "" : "unk"}" ${s.fixed[cid] ? `title="Corrigé"` : ""}><span>${esc(HOME_LIB[cid].name)}</span><i style="--c:${colorFor(s.values[cid] * 20)}"></i><b class="num">${s.known[cid] ? fmtNote(Math.round(s.values[cid] * 2) / 2) : "?"}</b></div>`).join("")}</div>
      <dl class="meta">${[["Viager", f.viager && [f.viager === "occupe" ? "occupé" : f.viager === "libre" ? "libre" : "", f.price && `bouquet de ${fmtInt(f.price)} €`, f.rente && `rente de ${fmtInt(f.rente)} € par mois`].filter(Boolean).join(", ")], ["Surface", f.surface && fmtInt(f.surface) + " m²"], ["Pièces", f.rooms && `${f.rooms}${f.bedrooms != null ? `, dont ${f.bedrooms} chambre${f.bedrooms > 1 ? "s" : ""}` : ""}`], ["Étage", f.floor != null && (f.floor === 0 ? "rez-de-chaussée" : (f.floor === 1 ? "1er" : f.floor + "e") + (f.floors ? ` sur ${f.floors}` : "")) + (f.elevator ? ", ascenseur" : f.elevator === false ? ", sans ascenseur" : "")],
        ["DPE", [f.dpe, f.dpeKwh && `${fmtInt(f.dpeKwh)} kWh/m²/an`].filter(Boolean).join(", ")], ["DPE officiel", f.ademe && `${f.ademe.cls}, ${fmtInt(f.ademe.surf)} m², établi le ${fmtDate(f.ademe.date)}, ${f.ademe.addr}`], ["Charges", f.charges && fmtInt(f.charges) + " € par an"], ["Taxe foncière", f.taxe && fmtInt(f.taxe) + " €"], ["Copropriété", f.lots && `${fmtInt(f.lots)} lots`], ["Lieu", [f.street, f.metro && "métro " + f.metro, f.quartier, f.postcode, f.city].filter(Boolean).join(", ") + (f.lat && !f.precise ? " (position approximative)" : "")]]
        .filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
      ${Object.keys(s.fixed).length ? `<p class="hint2"><span class="fixdot"></span> Corrigé après lecture ou visite.</p>` : ""}
    </section>
    <div class="field"><label class="label" for="lnote">Vos notes</label><textarea id="lnote" placeholder="Impression, questions pour l’agent, date de visite…">${esc(f.note || "")}</textarea></div>
    <div class="datarow">
      <button class="btn" type="button" id="ledit">Corriger les informations</button>
      ${f.lat ? `<button class="btn" type="button" id="lmap">Voir sur la carte</button>` : ""}
    </div>`;
  $("#lback").onclick = () => {
    const id = lui.openId, vw = $("#view-annonces");
    morph([[$(".ldet .lgal"), "lph"], [$(".ldet__score b"), "lsc"]],
      () => { lui.openId = null; renderListings(); vw.scrollTop = lui.listScroll || 0; },
      () => { const c = document.querySelector(`.hero[data-id="${id}"]`); return c ? [[c.querySelector(".hero__ph"), "lph"], [c.querySelector(".hero__s"), "lsc"]] : []; });
  };
  countUp(box);
  if (kindOf(f) !== "location") paintFair(f);
  const fe = $("#finEdit"); if (fe) fe.onclick = openFinance;
  const re = $("#revEdit"); if (re) re.onclick = openRentSettings;
  if (f.dropped) { f.dropped = false; f.updatedAt = Date.now(); save(); }
  $$("[data-st]", box).forEach(b => b.onclick = () => {
    const k = b.dataset.st, st = k === "gardee" ? (isKept(f) ? "nouvelle" : "gardee") : k === "visite" ? (f.status === "visite" ? "gardee" : "visite") : (f.status === "ecartee" ? "nouvelle" : "ecartee");
    setStatus(f, st, () => renderListingDetail(f.id));
  });
  $("#lnote").oninput = e => { f.note = e.target.value; f.updatedAt = Date.now(); save(); };
  $("#ledit").onclick = () => openAddListing(f);
  const cf = $("[data-checkfix]", box); if (cf) cf.onclick = () => openAddListing(f);
  $$("[data-ademe]", box).forEach(b => b.onclick = async () => { adoptAdeme(f, f.ademeCands[+b.dataset.ademe]); await placeListing(f); f.updatedAt = Date.now(); save(); renderListingPins(); renderListingDetail(f.id); toast("DPE officiel rattaché à l’annonce"); });
  const an = $("[data-ademenone]", box); if (an) an.onclick = () => { f.ademeCands = []; f.updatedAt = Date.now(); save(); renderListingDetail(f.id); };
  if (!f.ademeAt && (f.street || f.dpeKwh)) ademeCheck(f).then(async ch => { if (!ch) return; await placeListing(f); f.updatedAt = Date.now(); save(); renderListingPins(); if (lui.openId === f.id && currentTab === "annonces") renderListingDetail(f.id); });
  $("#lfix").onclick = () => openScoreFix(f);
  const ar = $("#laskRate", box); if (ar) ar.onclick = () => openScoreFix(f);
  const ae = $("#laskEdit", box); if (ae) ae.onclick = () => openAddListing(f);
  $$("[data-feel]", box).forEach(b => b.onclick = () => {
    const k = b.dataset.feel; f.feel = f.feel && f.feel.v === k ? null : {v: k, at: Date.now(), total: s.total}; if (!f.feel) delete f.feel;
    f.updatedAt = Date.now(); save(); learnMemo.key = null; renderListingDetail(f.id);
    if (f.feel) if (k !== "juste") toast("Merci : Heden ajuste vos priorités");
  });
  const ff = $("#feelFix", box); if (ff) ff.onclick = () => openScoreFix(f);
  bindContact(f, box);
  foldSections(box);
  const lm = $("#lmap"); if (lm) lm.onclick = () => { setTab("map"); map.flyTo([f.lat, f.lng], 16, {duration: .6}); };
  $("#ldel").onclick = async () => {
    if (!(await askConfirm({title: "Supprimer cette annonce ?", text: "Elle disparaît de vos annonces et de la carte.", ok: "Supprimer", danger: true}))) return;
    state.listings = listings().filter(x => x.id !== f.id); save(); lui.openId = null; renderListings(); renderListingPins();
  };
}

/* ---------- Pas assez d'infos pour noter : ce qui manque, et comment compléter ---------- */
function askHTML(f, s) {
  if (s.reliable) return "";
  const url = cleanWeb(f.url), lo = s.range ? s.range[0] : null, hi = s.range ? s.range[1] : null;
  return `<section class="lask${s.maybe ? " lask--maybe" : ""}" aria-label="Note à compléter">
    <p class="lask__t">${s.maybe ? "Elle peut vous plaire" : "Pas assez d’infos pour la noter"}</p>
    <p class="lask__x">${s.maybe ? "<span>Elle entre dans vos critères.</span> " : ""}<span>${s.need.length ? `Pour une note fiable, il manque : ${esc(s.need.join(", "))}.` : "L’annonce en dit trop peu."}</span>${lo != null ? ` <span>Selon ce qui manque, sa note irait de ${lo} à ${hi}.</span>` : ""}</p>
    <div class="lask__acts"><button class="btn btn--sm btn--primary" type="button" id="laskRate">La noter moi-même</button><button class="btn btn--sm" type="button" id="laskEdit">Compléter les infos</button></div>
    ${url ? `<p class="hint2">Ou ouvrez l’annonce et touchez + Heden sur sa page : Heden lit toute la fiche, photos comprises, et la note.</p>` : ""}
  </section>`;
}

/* ---------- Fraîcheur : l'annonce est-elle toujours en ligne ? ---------- */
function freshHTML(f) {
  const last = f.lastSeen || f.checkedAt || f.firstSeen || f.addedAt, days = last ? Math.floor((Date.now() - last) / 864e5) : null;
  const ago = days == null ? "" : days < 1 ? "aujourd’hui" : days === 1 ? "hier" : `il y a ${days} jours`;
  const txt = f.gone ? `<b>Plus en ligne</b> depuis le ${esc(fmtDate(new Date(f.gone).toISOString().slice(0, 10)))}. Gardez-la pour comparer, ou supprimez-la.`
    : `En ligne, vue ${ago}${f.priceHistory && f.priceHistory.length ? ` · ${f.priceHistory.length} changement${f.priceHistory.length > 1 ? "s" : ""} de prix` : ""}.`;
  if (!f.gone && !(days > 14)) return f.url ? `<p class="fresh fresh--line"><span class="fresh__dot" aria-hidden="true"></span>${txt.replace(/\.$/, "")} · <button class="link" type="button" id="lrecheck">Revérifier</button></p>` : "";
  return `<div class="fresh ${f.gone ? "fresh--off" : "fresh--old"}"><span class="fresh__dot" aria-hidden="true"></span><p>${txt}</p>${f.url ? `<button class="btn btn--sm btn--clair" type="button" id="lrecheck">Revérifier</button>` : ""}</div>`;
}

/* ---------- Contacter l'agence (ou le particulier) depuis Heden ---------- */
function visitMessage(f) {
  const duo = (homeProfile().setup || {}).who === "deux", name = (state.profile.name || "").trim();
  const what = `${f.ref ? `réf. ${f.ref}, ` : ""}${f.title || listingTitle(f)}${f.price ? ` à ${fmtInt(f.price)} €` : ""}`;
  return `Bonjour,\n\n${duo ? "Nous sommes intéressés" : "Je suis intéressé"} par votre annonce (${what})${f.url ? ` :\n${normUrl(f.url)}` : "."}\n\n${duo ? "Pourrions-nous la visiter ? Nous sommes" : "Serait-il possible de la visiter ? Je suis"} disponible${duo ? "s" : ""} en semaine après 18 h et le samedi.\n\nBien cordialement,${name ? "\n" + name : ""}`;
}
function contactHTML(f) {
  const tel = cleanPhone(f.agencyPhone), mail = cleanMail(f.agencyEmail), web = cleanWeb(f.agencyUrl), part = f.seller === "particulier";
  const any = f.agencyName || tel || mail || web;
  const subject = `Annonce ${f.ref ? "réf. " + f.ref + " : " : ""}${f.title || listingTitle(f)}`;
  return `<section class="contact" aria-label="Contact">
    <div class="contact__who"><span class="contact__ic" aria-hidden="true">${part ? "P" : "A"}</span><span><small>${part ? "Particulier" : "Agence"}${f.ref ? ` · réf. ${esc(f.ref)}` : ""}</small><b>${esc(f.agencyName || (part ? "Vendu par un particulier" : any ? "Agence" : "Coordonnées non trouvées"))}</b>${f.agencyAddress ? `<small>${esc(f.agencyAddress)}</small>` : ""}</span></div>
    ${any ? "" : `<p class="hint2">Pas de coordonnées sur la page : touchez « Afficher le numéro » sur le site, puis + Heden.</p>`}
    <div class="contact__acts">
      ${tel ? `<a class="btn btn--sm btn--primary" href="tel:${tel}">Appeler ${esc(fmtPhone(tel))}</a>` : ""}
      ${mail ? `<a class="btn btn--sm" href="mailto:${mail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(visitMessage(f))}">Écrire</a>` : ""}
      <button class="btn btn--sm" type="button" id="lmsg">Copier un message de visite</button>
      ${web ? `<a class="btn btn--sm btn--clair" href="${esc(web)}" target="_blank" rel="noopener noreferrer">Site de l’agence ↗</a>` : ""}
      ${any ? "" : `<button class="btn btn--sm btn--clair" type="button" id="lcontactEdit">Ajouter les coordonnées</button>`}
    </div>
  </section>`;
}
/* Fiche raccourcie : chaque section se replie sous son titre. « Pourquoi ce score » et les points de vigilance restent ouverts ;
   ce qu'on ouvre ou ferme est retenu pour les annonces suivantes (même session). */
function foldSections(box) {
  lui.fold = lui.fold || {};
  $$(".lsec", box).forEach((sec, i) => {
    const h = sec.querySelector(":scope > h2, :scope > .lsec__head > h2"); if (!h || h.dataset.fold) return;
    const key = sec.id || sec.dataset.k || (sec.dataset.k = h.textContent.trim());
    const set = open => { sec.classList.toggle("lsec--shut", !open); h.setAttribute("aria-expanded", String(open)); };
    set(key in lui.fold ? lui.fold[key] : i === 0 || sec.hasAttribute("data-open"));
    Object.assign(h.dataset, {fold: "1"}); h.tabIndex = 0; h.setAttribute("role", "button");
    const toggle = () => { const open = sec.classList.contains("lsec--shut"); lui.fold[key] = open; set(open); };
    h.onclick = toggle; h.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } };
  });
}
function bindContact(f, box) {
  const m = $("#lmsg", box); if (m) m.onclick = async () => {
    try { await navigator.clipboard.writeText(visitMessage(f)); toast(f.agencyPhone || f.agencyEmail ? "Message copié" : "Message copié : collez-le dans le formulaire du site"); }
    catch (e) { toast("Copie impossible sur ce navigateur"); }
  };
  const e = $("#lcontactEdit", box); if (e) e.onclick = () => openAddListing(f);
  const r = $("#lrecheck", box); if (r) r.onclick = () => {
    if (cleanWeb(f.url)) window.open(cleanWeb(f.url), "_blank", "noopener");
    toast("Ouvrez l’annonce et touchez + Heden pour la mettre à jour");
  };
}

/* ---------- Corriger la note d'une annonce ----------
   Critère par critère (ce que Heden a mal lu ou que la visite a montré), le quartier,
   et en dernier recours la note finale. Les corrections valent pour toute la carte :
   chacun garde ses priorités, donc sa note. */
function openScoreFix(f) {
  let el = $("#lsheet");
  const closeSheet = () => { el.classList.remove("is-open"); setTimeout(() => { el.hidden = true; }, 200); };
  if (!el) { el = document.createElement("div"); el.id = "lsheet"; el.className = "auth"; el.innerHTML = `<div class="auth__veil" data-lclose></div><div class="auth__card lsheet" role="dialog" aria-modal="true" aria-labelledby="lsTitle"></div>`; document.body.appendChild(el); el.addEventListener("click", e => { if (e.target.closest("[data-lclose]")) closeSheet(); }); }
  const card = el.querySelector(".lsheet");
  const raw = scoreListing(f, true), {v: auto, known: autoKnown} = homeValues(f, true);
  const fx = {crit: {...((f.fix && f.fix.crit) || {})}, quartier: f.fix ? f.fix.quartier ?? null : null, total: f.fix ? f.fix.total ?? null : null};
  const cur = scoreListing(f), toRate = !cur.reliable;   // pas encore notée : les critères inconnus d'abord
  const crits = Object.entries(homeWeights()).filter(([, w]) => w > 0).sort((a, b) => (toRate ? autoKnown[a[0]] - autoKnown[b[0]] : 0) || b[1] - a[1]).map(([id]) => id);
  const preview = () => { const sv = f.fix; f.fix = fx; const r = scoreListing(f); f.fix = sv; return r; };
  const scale = (key, cur, est) => `<div class="scale" data-k="${key}">${[0, 1, 2, 3, 4, 5].map(n => `<button type="button" data-v="${n}" aria-pressed="${cur != null && Math.round(cur) === n}" class="${cur == null && est === n ? "is-est" : cur != null && est === n && Math.round(cur) !== n ? "est-mark" : ""}" style="--c:${colorFor(n * 20)}">${n}</button>`).join("")}</div>`;
  const draw = () => {
    const r = preview(), qa = raw.quartier != null ? Math.round(raw.quartier / 20) : null;
    card.innerHTML = `<div class="auth__head"><h2 id="lsTitle">${toRate ? "Noter l’annonce" : "Corriger la note"}</h2><button class="x" type="button" data-lclose aria-label="Fermer"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
      <div class="fixsum"><b class="fixsum__s num" style="--c:${noteCol(r)}">${noteTxt(r)}</b><span><b>${r.hasFix ? (r.reliable ? "Avec vos corrections" : "Encore incomplète") : r.reliable ? "Analyse de Heden" : "Pas encore notée"}</b><small>${r.hasFix && raw.total != null ? `Heden seul : ${raw.total}.` : ""}${isShared() ? " Vaut aussi pour votre binôme." : ""}</small></span></div>
      <section class="fixsec"><h3>Le logement</h3><p class="hint2">${toRate ? "D’après les photos et la description, notez ce que l’annonce ne dit pas. " : ""}En pointillés : la lecture de Heden.</p>
        ${crits.map(id => `<div class="fixrow"><div class="fixrow__l"><b>${esc(HOME_LIB[id].name)}</b><small>${fx.crit[id] != null ? `Heden : ${autoKnown[id] ? fmtNote(Math.round(auto[id] * 2) / 2) : "pas dans l’annonce"}` : autoKnown[id] ? "Lu dans l’annonce" : "Pas dans l’annonce, valeur moyenne"}</small></div>${scale("c:" + id, fx.crit[id], Math.round(auto[id]))}</div>`).join("")}
      </section>
      <section class="fixsec"><h3>Le quartier</h3>
        <div class="fixrow"><div class="fixrow__l"><b>${raw.area && raw.area.zone ? `Zone « ${esc(raw.area.zone.name)} »` : "Le coin"}</b><small>${fx.quartier != null ? `Heden : ${raw.quartier ?? "inconnu"}` : raw.area ? (raw.area.zone ? `Note de la zone : ${raw.quartier}` : `Estimé à ${raw.quartier} d’après les données du coin`) : "Lieu inconnu"}</small></div>${scale("q", fx.quartier != null ? fx.quartier / 20 : null, qa)}</div>
      </section>
      <section class="fixsec"><h3>La note finale</h3>
        <label class="fixtot"><input type="checkbox" id="fxT" ${fx.total != null ? "checked" : ""}><span>Fixer la note moi-même</span></label>
        ${fx.total != null ? `<div class="fixrange"><input type="range" id="fxR" min="0" max="100" step="1" value="${fx.total}" aria-label="Note finale"><b class="num" id="fxV">${fx.total}</b></div><p class="hint2">Elle ne bougera plus avec l’analyse.</p>` : ""}
      </section>
      <div class="auth__foot fixfoot">${r.hasFix || (f.fix && Object.keys(f.fix).length) ? `<button class="btn btn--clair" type="button" id="fxReset">Revenir à l’analyse</button>` : ""}<button class="btn btn--primary btn--block" type="button" id="fxSave">Enregistrer</button></div>`;
    $$(".scale button", card).forEach(b => b.onclick = () => {
      const k = b.closest(".scale").dataset.k, n = +b.dataset.v;
      if (k === "q") fx.quartier = fx.quartier != null && Math.round(fx.quartier / 20) === n ? null : n * 20;
      else { const id = k.slice(2); fx.crit[id] = fx.crit[id] != null && Math.round(fx.crit[id]) === n ? null : n; if (fx.crit[id] == null) delete fx.crit[id]; }
      const y = card.scrollTop; draw(); card.scrollTop = y;
    });
    $("#fxT").onchange = e => { fx.total = e.target.checked ? (preview().total ?? raw.total ?? 50) : null; const y = card.scrollTop; draw(); card.scrollTop = y; };
    const rg = $("#fxR"); if (rg) rg.oninput = e => { fx.total = +e.target.value; $("#fxV").textContent = fx.total; const sum = $(".fixsum__s", card); sum.textContent = fx.total; sum.style.setProperty("--c", colorFor(fx.total)); };
    const rs = $("#fxReset"); if (rs) rs.onclick = () => { fx.crit = {}; fx.quartier = null; fx.total = null; draw(); };
    $("#fxSave").onclick = () => {
      const empty = !Object.keys(fx.crit).length && fx.quartier == null && fx.total == null;
      const had = !!f.fix;
      if (empty) delete f.fix; else f.fix = {crit: fx.crit, quartier: fx.quartier, total: fx.total, by: cloud.user ? cloud.user.id : null, at: Date.now()};
      f.updatedAt = Date.now(); save(); closeSheet(); renderListings(); renderListingPins();
    };
  };
  draw();
  el.hidden = false; requestAnimationFrame(() => el.classList.add("is-open"));
}

/* La feuille #lsheet sert à plusieurs formulaires : à chaque ouverture, elle repart du haut */
new MutationObserver(ms => { for (const m of ms) if (m.target.id === "lsheet" && !m.target.hidden) { const c = m.target.querySelector(".lsheet"); if (c) c.scrollTop = 0; } })
  .observe(document.body, {subtree: true, attributes: true, attributeFilter: ["hidden"]});

/* ---------- Ajouter ou corriger une annonce ---------- */
const FIELDS = [["price", "Prix", "num", "€"], ["surface", "Surface", "num", "m²"], ["rooms", "Pièces", "num"], ["bedrooms", "Chambres", "num"], ["floor", "Étage (0 = RDC)", "num"],
  ["elevator", "Ascenseur", "bool"], ["outdoor", "Extérieur", "sel", ["", "balcon", "loggia", "terrasse", "jardin"]], ["dpe", "DPE", "sel", ["", ..."ABCDEFG"]], ["dpeKwh", "Consommation", "num", "kWh/m²/an"], ["charges", "Charges par an", "num", "€"], ["lots", "Lots de copropriété", "num"],
  ["works", "État", "sel", ["", "neuf", "bon", "rafraichir", "travaux"]], ["quiet", "Au calme, sur cour", "bool"], ["traversant", "Traversant", "bool"], ["bright", "Lumineux", "bool"],
  ["cave", "Cave", "bool"], ["parking", "Parking", "bool"], ["view", "Vue dégagée", "bool"], ["street", "Rue", "txt"], ["postcode", "Code postal", "txt"], ["metro", "Métro le plus proche", "txt"],
  ["seller", "Vendu par", "sel", ["", "agence", "particulier"]], ["agencyName", "Agence", "txt"], ["agencyPhone", "Téléphone", "txt"], ["agencyEmail", "E-mail", "txt"], ["agencyUrl", "Site de l’agence", "txt"], ["agencyAddress", "Adresse de l’agence", "txt"], ["ref", "Référence de l’annonce", "txt"]];
const FIELDS_LOC = [["rentHC", "Loyer hors charges", "num", "€ par mois"], ["rentCharges", "Dont charges", "num", "€ par mois"], ["furnished", "Meublé ou vide", "sel", ["", "true", "false"]],
  ["deposit", "Dépôt de garantie", "num", "€"], ["agencyFee", "Frais d’agence", "num", "€"], ["available", "Disponible", "txt"], ["epoque", "Construction", "sel", ["", "a", "b", "c", "d"]],
  ["refMaj", "Loyer de référence majoré", "num", "€/m²"], ["complement", "Complément de loyer", "num", "€ par mois"]];
function fieldsFor(f) {
  const loc = kindOf(f) === "location";
  let F = FIELDS.map(x => x[0] === "price" ? ["price", loc ? "Loyer charges comprises" : "Prix", "num", loc ? "€ par mois" : "€"] : x);
  if (loc) F = F.filter(x => !["charges", "taxe", "lots"].includes(x[0])).concat(FIELDS_LOC);
  return [["kind", "Type d’annonce", "sel", ["vente", "location"]], ...F];
}
const SEL_LABEL = {vente: "Vente", location: "Location", "true": "Meublé", "false": "Vide", a: "Avant 1946", b: "1946 à 1970", c: "1971 à 1990", d: "Après 1990", agence: "Une agence", particulier: "Un particulier", neuf: "Rénové", bon: "Bon état", rafraichir: "À rafraîchir", travaux: "Travaux", balcon: "Balcon", loggia: "Loggia", terrasse: "Terrasse", jardin: "Jardin", "": "Non précisé"};
function openAddListing(existing, imported, opts = {}) {
  let el = $("#lsheet");
  if (!el) { el = document.createElement("div"); el.id = "lsheet"; el.className = "auth"; el.innerHTML = `<div class="auth__veil" data-lclose></div><div class="auth__card lsheet" role="dialog" aria-modal="true" aria-labelledby="lsTitle"></div>`; document.body.appendChild(el); el.addEventListener("click", e => { if (e.target.closest("[data-lclose]")) closeSheet(); }); }
  const card = el.querySelector(".lsheet");
  const closeSheet = () => { el.classList.remove("is-open"); setTimeout(() => { el.hidden = true; }, 200); };
  const close = `<button class="x" type="button" data-lclose aria-label="Fermer"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>`;
  const review = f => {
    const doubt = new Map(checkListing(f).reverse());
    card.innerHTML = `<div class="auth__head"><h2 id="lsTitle">${existing ? "Corriger l’annonce" : "Vérifier l’annonce"}</h2>${close}</div>
      <p class="auth__txt">${existing ? "Corrigez ce que l’annonce ne disait pas." : `Heden a trouvé ${Object.keys(f.found || {}).filter(k => k !== "kind" && fieldsFor(f).some(x => x[0] === k)).length} informations. Complétez ou corrigez avant d’enregistrer.`}${doubt.size ? ` <span class="lf__dtxt">${doubt.size} à vérifier.</span>` : ""}</p>
      <form class="lform" id="lform">
        ${fieldsFor(f).map(([k, label, type, opt]) => {
          const v = k === "kind" ? (kindOf(f) === "location" ? "location" : "vente") : f[k], tag = doubt.has(k) ? ` <em class="lf__doubt" title="${esc(doubt.get(k))}">à vérifier</em>` : f.found && f.found[k] && k !== "kind" ? ` <em>trouvé</em>` : "";
          if (type === "bool") return `<label class="lf lf--bool"><input type="checkbox" name="${k}" ${v ? "checked" : ""}><span>${label}${tag}</span></label>`;
          if (type === "sel") return `<label class="lf"><span>${label}${tag}</span><select name="${k}">${opt.map(o => `<option value="${o}" ${String(v ?? "") === o ? "selected" : ""}>${SEL_LABEL[o] || o}</option>`).join("")}</select></label>`;
          return `<label class="lf"><span>${label}${tag}</span><input name="${k}" ${type === "num" ? `inputmode="decimal"` : ""} value="${v ?? ""}" placeholder="${opt || ""}"></label>`;
        }).join("")}
      </form>
      ${f.photos && f.photos.length ? `<div class="lgal lgal--sm">${f.photos.slice(0, 6).map(u => `<img src="${esc(u)}" alt="" referrerpolicy="no-referrer">`).join("")}</div>` : ""}
      <div class="auth__foot"><button class="btn btn--primary btn--block" type="button" id="lsave">${existing ? "Enregistrer" : "Ajouter l’annonce"}</button></div>`;
    const readForm = () => {
      const fd = new FormData($("#lform"));
      fieldsFor(f).forEach(([k, , type]) => {
        if (k === "kind") f.kind = fd.get(k) === "location" ? "location" : "vente";
        else if (k === "furnished") { const v = fd.get(k); f[k] = v === "true" ? true : v === "false" ? false : null; }
        else if (type === "bool") f[k] = fd.get(k) === "on" ? true : (f[k] === false ? false : null);
        else if (type === "num") { const n = numFR(fd.get(k)); f[k] = n == null ? null : n; }
        else f[k] = (fd.get(k) || "").trim() || null;
      });
    };
    const ks = $("#lform [name=kind]"); if (ks) ks.onchange = () => { readForm(); const y = card.scrollTop; review(f); card.scrollTop = y; };
    $("#lsave").onclick = async () => {
      readForm();
      if (existing) { f.checked = checkListing(f).map(x => x[0]); if (!f.checked.length) delete f.checked; }
      if (!existing && !(await kindAllowed(kindOf(f)))) return;
      const b = $("#lsave"); b.disabled = true; b.textContent = "Placement sur la carte…";
      const moved = existing && ["postcode", "metro", "street"].some(k => existing[k] !== f[k]);
      if (existing && (moved || ["surface", "dpe", "dpeKwh"].some(k => existing[k] !== f[k]))) { delete f.ademeAt; delete f.ademeCands; if (f.ademe) { if (f.placeLevel === "dpe") f.precise = false; delete f.ademe; } }
      if (moved && !f.precise) { f.lat = f.lng = null; f.est = null; }
      await placeListing(f); f.updatedAt = Date.now();
      if (existing) Object.assign(existing, f);
      else { f.id = zoneId(); f.status = "nouvelle"; f.addedAt = f.firstSeen = Date.now(); f.origin = "manuel"; f.mapId = cloud.user ? cloud.mapId : null; f.createdBy = cloud.user ? cloud.user.id : null; listings().unshift(f); lui.openId = f.id; lui.feed = "mes"; }
      save(); closeSheet(); if (currentTab !== "annonces") setTab("annonces"); else renderListings(); renderListingPins();
    };
  };
  if (existing || imported) review(existing ? Object.assign(clone(existing), {found: existing.found || {}}) : imported);
  else {
    card.innerHTML = `<div class="addf addf--${opts.dir || "in"}"><div class="auth__head">${opts.back ? `<button class="x addf__back" type="button" aria-label="Retour"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5 8 12l7 7"/></svg></button>` : ""}<h2 id="lsTitle">Coller une annonce</h2>${close}</div>
      <p class="auth__txt">Le lien et le texte de l’annonce : Heden lit le prix, la surface, l’étage, le DPE…</p>
      <form class="auth__form" id="lpaste">
        <input type="url" id="lurl" placeholder="https://… lien de l’annonce" inputmode="url">
        <textarea id="ltext" rows="7" placeholder="Collez ici le texte de l’annonce"></textarea>
        <button class="btn btn--primary btn--block" type="submit">Analyser l’annonce</button>
      </form>
      </div>`;
    const bk = card.querySelector(".addf__back"); if (bk) bk.onclick = opts.back;
    $("#lpaste").onsubmit = e => {
      e.preventDefault();
      const url = $("#lurl").value.trim(), text = $("#ltext").value;
      if (!text.trim() && !url) return toast("Collez au moins le texte de l’annonce");
      review(parseListing({url, text}));
    };
  }
  el.hidden = false; requestAnimationFrame(() => el.classList.add("is-open"));
}

/* ---------- Profil : le logement idéal ---------- */
function homeSectionHTML() {
  const h = homeProfile(), ws = Object.values(h.weights).reduce((a, w) => a + (w > 0 ? w : 0), 0) || 1;
  const num = (id, label, val, unit, step = 1) => `<div class="field"><label class="label" for="${id}">${label}</label><input type="number" id="${id}" inputmode="numeric" min="0" step="${step}" value="${val ?? ""}" placeholder="${unit}"></div>`;
  return `<section class="sec" id="homeSec">
    <h2>Votre logement idéal</h2>
    <p class="hint2">Une annonce hors filtre reste visible, avec une note plafonnée.</p>
    ${projet() === "deux" ? `<div class="row2">${num("hBudget", "Prix max à l’achat", h.budgetMax, "Ex. 550 000 €", 5000)}${num("hLoyer", "Loyer max, charges comprises", (h.loc || {}).loyerMax, "€ par mois", 50)}</div>
    <div class="row2">${num("hSurf", "Surface min", h.surfaceMin, "m²")}<span></span></div>`
      : `<div class="row2">${projet() === "location" ? num("hLoyer", "Loyer max, charges comprises", (h.loc || {}).loyerMax, "€ par mois", 50) : num("hBudget", "Budget total max", h.budgetMax, "Ex. 550 000 €", 5000)}${num("hSurf", "Surface min", h.surfaceMin, "m²")}</div>`}
    <div class="row2">${num("hRooms", "Pièces min", h.roomsMin, "Ex. 3")}${num("hBeds", "Chambres min", h.bedroomsMin, "Ex. 2")}</div>
    <div class="row2">
      <div class="field"><label class="label" for="hElev">Ascenseur indispensable</label><select id="hElev">${[[0, "Jamais"], [2, "Dès le 2e étage"], [3, "Dès le 3e étage"], [4, "Dès le 4e étage"], [5, "Dès le 5e étage"]].map(([v, l]) => `<option value="${v}" ${+h.elevatorFrom === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div class="field"><label class="label" for="hDpe">DPE au pire</label><select id="hDpe">${["A", "B", "C", "D", "E", "F", "G"].map(l => `<option value="${l}" ${h.dpeMax === l ? "selected" : ""}>${l === "G" ? "Peu importe" : l}</option>`).join("")}</select></div>
    </div>
    <div class="chips">
      <button class="chip" type="button" id="hGround" aria-pressed="${!!h.noGround}">Pas de rez-de-chaussée</button>
      <button class="chip" type="button" id="hOut" aria-pressed="${!!h.outdoorReq}">Extérieur exigé</button>
    </div>
    <h3 class="sub3">Ce qui compte dans le logement</h3>
    <div class="cards">${Object.keys(HOME_LIB).map(id => `<div class="crow crow--home" data-h="${id}">
        <div style="min-width:0"><b class="nm">${esc(HOME_LIB[id].name)}</b><span class="ds">${esc(HOME_LIB[id].desc)}</span></div>
        <div class="wctl"><input type="range" min="0" max="30" step="5" value="${h.weights[id] || 0}" aria-label="Poids de ${esc(HOME_LIB[id].name)}"><output class="num"><span class="wv">${h.weights[id] || 0}</span><small class="ws">${Math.round(Math.max(0, h.weights[id] || 0) / ws * 100)} %</small></output></div>
      </div>`).join("")}</div>
    <h3 class="sub3">Dans la note d’une annonce</h3>
    <div class="cards">${[["logement", "Le logement", "Vos critères ci-dessus"], ["quartier", "Le quartier", "La note de vos zones, ou l’estimation du coin"], ["prix", projet() === "location" ? "Le loyer" : "Le prix", {achat: "Comparé aux ventes réelles du quartier", location: "Comparé aux loyers de référence du quartier", deux: "Comparé aux ventes ou aux loyers du quartier"}[projet()]]].map(([k, n, d]) => `<div class="crow crow--home" data-mix="${k}">
        <div style="min-width:0"><b class="nm">${n}</b><span class="ds">${d}</span></div>
        <div class="wctl"><input type="range" min="0" max="60" step="5" value="${h.mix[k]}" aria-label="Part de ${n}"><output class="num"><span class="wv">${h.mix[k]}</span><small class="ws">${Math.round(h.mix[k] / ((h.mix.logement + h.mix.quartier + h.mix.prix) || 1) * 100)} %</small></output></div>
      </div>`).join("")}</div>
  </section>`;
}
function bindHomeSection() {
  const sec = $("#homeSec"); if (!sec) return;
  const h = homeProfile(), save = () => { h.custom = true; learnMemo.key = null; saveState(); };
  const numIn = (id, key) => { $("#" + id).oninput = e => { const v = parseFloat(e.target.value); h[key] = isFinite(v) && v > 0 ? v : null; save(); }; };
  if ($("#hBudget")) numIn("hBudget", "budgetMax");
  const hl = $("#hLoyer"); if (hl) hl.oninput = e => { const v = parseFloat(e.target.value); h.loc = Object.assign({}, h.loc, {loyerMax: isFinite(v) && v > 0 ? Math.round(v) : null}); save(); };
  numIn("hSurf", "surfaceMin"); numIn("hRooms", "roomsMin"); numIn("hBeds", "bedroomsMin");
  $("#hElev").onchange = e => { h.elevatorFrom = +e.target.value || 0; save(); };
  $("#hDpe").onchange = e => { h.dpeMax = e.target.value; save(); };
  $("#hGround").onclick = e => { h.noGround = !h.noGround; e.currentTarget.setAttribute("aria-pressed", String(h.noGround)); save(); };
  $("#hOut").onclick = e => { h.outdoorReq = !h.outdoorReq; e.currentTarget.setAttribute("aria-pressed", String(h.outdoorReq)); save(); };
  const repaint = () => {
    const ws = Object.values(h.weights).reduce((a, w) => a + (w > 0 ? w : 0), 0) || 1, ms = (h.mix.logement + h.mix.quartier + h.mix.prix) || 1;
    $$("[data-h]", sec).forEach(r => { const w = h.weights[r.dataset.h] || 0; r.querySelector(".wv").textContent = w; r.querySelector(".ws").textContent = Math.round(w / ws * 100) + " %"; });
    $$("[data-mix]", sec).forEach(r => { const w = h.mix[r.dataset.mix]; r.querySelector(".wv").textContent = w; r.querySelector(".ws").textContent = Math.round(w / ms * 100) + " %"; });
  };
  $$("[data-h] input", sec).forEach(i => i.oninput = e => { h.weights[e.target.closest("[data-h]").dataset.h] = +e.target.value; repaint(); save(); });
  $$("[data-mix] input", sec).forEach(i => i.oninput = e => { h.mix[e.target.closest("[data-mix]").dataset.mix] = +e.target.value; repaint(); save(); });
}

/* réception d'une annonce envoyée par le bouton */
/* Une page envoyée par le bouton + Heden ou l'extension : on ne garde que des chaînes et des tableaux de taille bornée */
function cleanPage(d) {
  const safe = {url: String(d.url || "").slice(0, 2000), title: String(d.title || "").slice(0, 300), text: String(d.text || "").slice(0, 40000),
    meta: typeof d.meta === "object" && d.meta ? d.meta : {}, ld: Array.isArray(d.ld) ? d.ld.map(x => String(x).slice(0, 60000)).slice(0, 8) : [], imgs: Array.isArray(d.imgs) ? d.imgs.map(String).slice(0, 40) : []};
  const hi = d.hints && typeof d.hints === "object" ? d.hints : {}, arr = (a, n, len) => Array.isArray(a) ? a.slice(0, n).map(x => String(x).slice(0, len)) : [];
  safe.hints = {tels: arr(hi.tels, 6, 100), mails: arr(hi.mails, 4, 120), state: arr(hi.state, 24, 1600)};
  // position et longueur de description lues dans les données de la page (extension) : des nombres, rien d'autre
  const geo = g => g && typeof g === "object" && isFinite(+g.lat) && isFinite(+g.lng) && Math.abs(+g.lat) <= 90 && Math.abs(+g.lng) <= 180 ? {lat: +g.lat, lng: +g.lng, ex: g.ex === true} : null;
  const items = Array.isArray(d.items) ? d.items.slice(0, 80).map(c => ({url: String(c.url || "").slice(0, 2000), img: String(c.img || "").slice(0, 2000), imgs: Array.isArray(c.imgs) ? c.imgs.slice(0, 12).map(x => String(x).slice(0, 2000)) : [], text: String(c.text || "").slice(0, 4000), geo: geo(c.geo), dl: Math.max(0, Math.min(1e5, +c.dl || 0))})) : [];
  Object.assign(safe, {geo: geo(d.geo), dl: Math.max(0, Math.min(1e5, +d.dl || 0)), fiche: String(d.fiche || "").slice(0, 4000)});
  return {safe, items};
}
(function listenImport() {
  let done = false;
  const use = d => {
    if (done || !d) return; done = true;
    const {safe, items} = cleanPage(d);
    try { localStorage.setItem("heden.bmk", "1"); } catch (e) {}
    setTab("annonces");
    if (items.length >= 3 && !isDetailUrl(safe.url)) return openBatchImport(items, safe.url, (+d.v || 0) < 4);
    const p = poserFiche(Object.assign(parseListing(safe.fiche ? Object.assign({}, safe, {text: safe.text + "\n" + safe.fiche}) : safe), {fullPage: true}), safe), ex = listings().find(x => sameListing(x, p));
    vivierEnrichir(p);
    if ((+d.v || 0) < 6) setTimeout(() => toast("Réinstallez le bouton + Heden (Annonces, « Le bouton + Heden ») : il récupère maintenant toute la galerie photos"), 2500);
    if (ex) return refreshFromPage(ex, p);
    if (p.gone) return toast("Cette annonce n’est plus en ligne : rien à ajouter");
    openAddListing(null, p);
  };
  // seule la page qui vient d'ouvrir Heden avec le bouton + Heden peut envoyer une annonce (pas un autre site)
  const fromBtn = /importer=\d/.test(location.search);
  window.addEventListener("message", e => {
    const m = e.data; if (!fromBtn || !e.source || e.source !== window.opener || !m || m.type !== "heden-import" || !m.data) return;
    try { e.source && e.source.postMessage("heden-recu", "*"); } catch (err) {}
    use(m.data);
  });
  if (/importer=\d/.test(location.search)) {   // l'horodatage force la dernière version du site
    let fromHash = null;
    try { const h = location.hash.match(/import=([^&]*)/); if (h) fromHash = JSON.parse(decodeURIComponent(h[1])); } catch (e) {}
    try { history.replaceState(null, "", location.pathname + "#annonces"); } catch (e) {}
    if (fromHash) setTimeout(() => use(fromHash), 1800);       // si la page d'origine n'a pas pu envoyer l'annonce complète
  }
})();
