/* =========================================================
   Lecture des annonces : fonctions pures, sans interface ni état.
   Utilisées par l'app (bouton + Heden, alertes, vivier) et par le traitement automatique du vivier
   (scripts/vivier/traiter.mjs, qui charge ce fichier tel quel dans Node).
   ========================================================= */
const sansAccent = s => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
/* ---------- Lecture d'une annonce (texte, balises de la page, données structurées) ---------- */
const numFR = s => { if (s == null) return null; const v = parseFloat(String(s).replace(/[\s  .](?=\d{3}\b)/g, "").replace(/\s/g, "").replace(",", ".")); return isFinite(v) ? v : null; };
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } };
function parseListing(src) {
  const meta = src.meta || {};
  const raw = [src.title, meta["og:title"], meta["og:description"] || meta.description, src.text].filter(Boolean).join("\n").replace(/[  ]/g, " ");
  const low = raw.toLowerCase();
  const nodes = [];
  (src.ld || []).forEach(s => { try { (function walk(o) { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === "object") { nodes.push(o); Object.values(o).forEach(v => v && typeof v === "object" && walk(v)); } })(JSON.parse(s)); } catch (e) {} });
  const pick = f => { for (const n of nodes) { try { const v = f(n); if (v != null && v !== "") return v; } catch (e) {} } return null; };
  const kv = readTable(raw);
  // ligne de caractéristiques des cartes et e-mails : « 5 pièces · 1 chambre · 180 m² » l'emporte sur le titre (« appartement de 4 pièces »)
  const al = raw.match(/(?:^|\n)\s*(\d{1,2})\s?pi[eè]ces?\s*·\s*(?:\d{1,2}\s?chambres?\s*·\s*)?(\d{1,3}(?:[.,]\d{1,2})?)\s?m²/i);
  if (al) { kv.rooms = kv.rooms || al[1]; kv.surface = kv.surface || al[2]; }
  const f = {}, found = {};
  const set = (k, v) => { if (v != null && v !== "" && !(typeof v === "number" && !isFinite(v))) { f[k] = v; found[k] = true; } };
  // Prix
  let price = numFR(pick(n => n.price ?? (n.offers && (n.offers.price ?? (Array.isArray(n.offers) && n.offers[0] && n.offers[0].price)))));
  if (!(price >= 30000 && price <= 20e6)) {
    const c = [...raw.matchAll(/(\d{1,3}(?:[ .]\d{3})+|\d{5,8})\s?€(?!\s*(?:\/|par)\s*(?:m|mois))/g)]
      .filter(m => !/(?:ancien prix|au lieu de|prix initial|prix pr[ée]c[ée]dent|frais de notaire[^\n]{0,20}|hors honoraires|soit|valeur v[ée]nale|baiss[ée] de)\s*:?\s*$/i.test(raw.slice(Math.max(0, m.index - 40), m.index)))
      .map(m => numFR(m[1])).filter(v => v >= 30000 && v <= 20e6);
    price = c.length ? c[0] : null;
  }
  set("price", price);
  // Viager : le prix affiché est le bouquet, une rente mensuelle s'y ajoute ; le bien est occupé ou libre
  const viager = /\bviager\b/.test(low);
  if (viager) {
    const amt = re => { const m = raw.match(re); return m ? numFR(m[1]) : null; };
    const bq = amt(/bouquet\s*(?:de|:|net)?\s*(\d{1,3}(?:[ .]\d{3})+|\d{4,8})\s?€/i), rt = amt(/rente\s*(?:mensuelle|viag[eè]re)?\s*(?:de|:)?\s*(\d{1,3}(?:[ .]\d{3})+|\d{2,6})(?:[.,]\d{1,2})?\s?€/i);
    set("viager", /viager libre|libre (?:de toute occupation|à la vente)/.test(low) ? "libre" : /viager occup|occup[ée]/.test(low) ? "occupe" : "oui");
    if (bq >= 1000) set("price", bq);
    if (rt > 0) set("rente", rt);
  }
  // Location : loyer par mois, charges, dépôt, honoraires, meublé, disponibilité, encadrement
  const rent = viager ? null : readRent(raw, low, String(src.url || "").toLowerCase(), price, numFR(pick(n => n.price ?? (n.offers && n.offers.price))));
  if (rent) { delete f.price; delete found.price; for (const [k, v] of Object.entries(rent)) set(k, v); if (kv.furnished) set("furnished", !/non/i.test(kv.furnished)); }
  // Surface
  let surf = numFR(pick(n => n.floorSize && (n.floorSize.value ?? n.floorSize))) ?? numFR((kv.surface || "").match(/[\d.,]+/));
  // première surface du texte qui n'est pas celle d'une pièce, d'un extérieur ou d'une annexe
  const surfIn = str => {
    const lw = str.toLowerCase();
    for (const m of str.matchAll(/(\d{1,3}(?:[.,]\d{1,2})?)\s?m(?:²|2(?![\d²]))/g)) {
      const before = lw.slice(Math.max(0, m.index - 28), m.index).split(/[\n·•|\/]/).pop();
      // « 2 chambres 64 m² » : la surface totale suit le nombre de chambres ; « chambre de 12 m² » : surface d'une pièce
      if (!/\d\s*chambres?\s*[,·-]?\s*$/.test(before) && /terrasse|balcon|jardin|cave|parking|terrain|loggia|box|séjour|sejour|chambre|cuisine|€/.test(before)) continue;
      const v = numFR(m[1]); if (v >= 9 && v <= 500) return v;
    }
    return null;
  };
  if (!(surf >= 9 && surf <= 500)) surf = surfIn(raw);
  set("surface", surf);
  // le titre et le texte ne donnent pas la même surface : on garde l'autre valeur pour la signaler
  const ts = surfIn(String(src.title || "")), bs = surfIn(String(src.text || ""));
  if (surf && ts && bs && Math.abs(ts - bs) / bs > 0.03) f.alt = {surface: surf === ts ? bs : ts};
  // Pièces, chambres
  let rooms = numFR(pick(n => n.numberOfRooms && (n.numberOfRooms.value ?? n.numberOfRooms))) ?? numFR(kv.rooms);
  if (!(rooms != null && rooms >= 1 && rooms <= 15)) { const m = low.match(/(\d{1,2})\s?pi[eè]ces?\b/) || raw.match(/\b[TF](\d)\b/) || low.match(/\b(\d{1,2})\s?p\.(?=\s|$)/); rooms = m ? +m[1] : (/\bstudio\b/.test(low) ? 1 : null); }
  set("rooms", rooms);
  let beds = numFR(pick(n => n.numberOfBedrooms ?? n.numberOfBedroomsTotal)) ?? numFR(kv.bedrooms);
  if (!(beds != null && beds >= 0 && beds <= 10)) {
    const WN = {une: 1, un: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6};
    const m = low.match(/(\d{1,2}|une?|deux|trois|quatre|cinq|six)[ \u00a0](?:belles?\s|grandes?\s|vraies?\s)?chambres?\b/); beds = m ? (WN[m[1]] || +m[1]) : null;
  }
  set("bedrooms", beds);
  // Étage
  let floor = null, floors = null;
  if (/\b(rez[- ]de[- ](?:chauss[ée]e|jardin)|rdc)\b/.test(low) && !/au-dessus du rez/.test(low)) floor = 0;
  let m = (kv.floor || "").toLowerCase().match(/^(\d{1,2})(?:\s?(?:er|e|ème))?(?:\s?(?:\/|sur)\s?(\d{1,2}))?/) || low.match(/dernier [ée]tage\s*\((\d{1,2})\s?(?:er|e|ème|eme)?\)/)
    || low.match(/(\d{1,2})\s?(?:er|e|ème|eme|è)\s?(?:et\s)?(?:dernier\s)?[ée]tage/) || low.match(/[ée]tage\s*:?\s*(\d{1,2})(?:\s?\/\s?(\d{1,2}))?/);
  if (kv.floor && /rez|rdc/i.test(kv.floor)) { floor = 0; m = null; }
  if (m) { floor = +m[1]; if (m[2]) floors = +m[2]; }
  const mf = numFR(kv.floors) ? [0, numFR(kv.floors)] : low.match(/[ée]tage\s*:?\s*\d{1,2}\s?\/\s?(\d{1,2})/) || low.match(/[ée]tage\s+sur\s+(\d{1,2})\b/) || low.match(/sur\s(\d{1,2})\s[ée]tages?/) || low.match(/immeuble de\s(\d{1,2})\s[ée]tages?/); if (mf) floors = +mf[1];
  set("floor", floor); set("floors", floors);
  if (/dernier [ée]tage/.test(low)) set("top", true);
  if (kv.elevator) set("elevator", /^oui/i.test(kv.elevator));
  else if (/sans ascenseur|pas d['’]ascenseur/.test(low)) set("elevator", false); else if (/ascenseur/.test(low)) set("elevator", true);
  // Extérieur
  const no = k => /^non/i.test(kv[k] || ""), yes = k => /^oui/i.test(kv[k] || "") || new RegExp(k).test((kv.outdoor || "").toLowerCase());
  const ext = ["terrasse", "jardin", "balcon", "loggia"].find(yes) || (/terrasse/.test(low) && !no("terrasse") ? "terrasse" : /jardin privatif|jardin de \d|avec jardin/.test(low) && !no("jardin") ? "jardin" : /balcon/.test(low) && !no("balcon") ? "balcon" : /loggia/.test(low) && !no("loggia") ? "loggia" : null);
  set("outdoor", ext);
  if (ext) { const ma = low.match(new RegExp(ext + "[^.\\n]{0,18}?(\\d{1,3})\\s?m")); if (ma) set("outdoorArea", +ma[1]); }
  // Lumière, exposition
  const me = low.match(/expos(?:[ée]e?s?|ition)\s*:?\s(?:plein\s)?(sud[- ]ouest|sud[- ]est|nord[- ]ouest|nord[- ]est|sud|nord|est|ouest)/);
  if (me) set("exposure", me[1].replace(" ", "-"));
  if (/traversant/.test(low)) set("traversant", true);
  if (/lumineu|tr[eè]s clair|baign[ée] de lumi|ensoleill|lumi[eè]re naturelle/.test(low)) set("bright", true);
  if (/\bsombre\b/.test(low)) set("dark", true);
  // DPE, charges, taxe foncière
  const md = raw.match(/(?:DPE|[Cc]lasse [ée]nergie|[Cc]onsommation [ée]nerg[ée]tique|[Pp]erformance [ée]nerg[ée]tique)[^A-Za-z\n]{0,14}\b([A-G])\b/);
  const dk = (kv.dpe || "").match(/^([A-G])\b/), dc = raw.match(/[ée]nerg[^\n]{0,60}?\bclasse\s*:?\s*([A-G])\b/i);
  if (dk) set("dpe", dk[1]); else if (md) set("dpe", md[1]); else if (dc) set("dpe", dc[1].toUpperCase());
  const mc = low.match(/charges?(?: de copropri[ée]t[ée])?(?: pr[ée]visionnelles)?(?: annuelles| mensuelles| courantes)?\s*:?\s*(?:(?:de|d['’]|environ|env\.|d['’]environ|approx\.?|±)\s*)*(\d[\d .]{0,6}?)\s?(?:€|euros?)\s?(?:\/\s?|par\s)?(an|mois|année)?/);
  const mqp = low.match(/quote-part (?:annuelle )?(?:de |des )?charges[^:\n]{0,40}:\s*(\d[\d .]{0,6}?)\s?€/);   // mention légale : montant annuel
  if (mqp) set("charges", numFR(mqp[1]));
  else if (mc) { let v = numFR(mc[1]); const unit = mc[2] || (v > 600 ? "an" : "mois"); if (/mois/.test(unit)) v *= 12; if (v > 0 && v < 30000) set("charges", Math.round(v)); }
  const ml0 = numFR(kv.lots) || +((low.match(/copropri[ée]t[ée] (?:de |d['’])?(\d{1,4}) lots|(?:^|[^\d])(\d{1,4}) lots principaux|nombre de lots\s*:?\s*(\d{1,4})/) || []).slice(1).find(Boolean) || 0);
  if (ml0 >= 2 && ml0 <= 2000) set("lots", ml0);
  const mt = low.match(/taxe fonci[eè]re\s*:?\s*(?:de\s)?(\d[\d ]{0,6})\s?€/); if (mt) set("taxe", numFR(mt[1]));
  // Annexes, état, ambiance
  if (kv.cave) set("cave", /^oui/i.test(kv.cave)); else if (/\bcaves?\b/.test(low) && !/sans cave/.test(low)) set("cave", true);
  if (kv.parking) set("parking", /^oui/i.test(kv.parking)); else if (/\b(parking|box|garage|place de stationnement)\b/.test(low) && !/parking (?:public|à proximité)/.test(low)) set("parking", true);
  const work = /(refait à neuf|entièrement rénové|entierement renove|rénové avec goût|rénovation récente|neuf\b)/.test(low) ? "neuf"
    : /(travaux à prévoir|à rénover|a renover|gros travaux|rénovation complète à prévoir)/.test(low) ? "travaux"
    : /(rafra[iî]chissement|à rafra[iî]chir)/.test(low) ? "rafraichir" : /(bon état|bon etat|très bon état|parfait état)/.test(low) ? "bon" : null;
  set("works", work);
  if (/sur cour|côté cour|au calme|très calme|sur jardin|calme absolu/.test(low)) set("quiet", true); else if (/sur rue|boulevard|avenue passante|axe passant/.test(low)) set("quiet", false);
  const cach = (low.match(/parquet|moulures|chemin[ée]e|haussmannien|cachet|poutres|hauteur sous plafond/g) || []).length; if (cach) set("cachet", cach);
  if (/sans vis[- ]?[àa][- ]vis|vue d[ée]gag[ée]e|vue imprenable|vue sur (?:la seine|le parc|jardin|la tour eiffel|le sacr)/.test(low)) set("view", true);
  if (/gardien|concierge/.test(low)) set("building", "gardien"); else if (/digicode|interphone|vidéophone|visiophone/.test(low)) set("building", "securise");
  // Lieu
  const addr = pick(n => n.address && typeof n.address === "object" ? n.address : null) || {};
  let pc = addr.postalCode || (raw.match(/\b(75(?:0[0-1]\d|02[0]|116)|9[234]\d{3})\b/) || [])[1] || null;
  const ma2 = low.match(/paris\s?(\d{1,2})\s?(?:er|e|ème|eme)\b/) || low.match(/paris\s(\d{1,2})(?![\d,.])(?!\s*(?:pi|ch|m²|m2|m\b|€|p\.|-))/) || low.match(/\b(\d{1,2})\s?(?:er|e|ème|eme)\s+arr(?:ondissement|\.|\b)/); if (!pc && ma2 && +ma2[1] >= 1 && +ma2[1] <= 20) pc = "750" + String(ma2[1]).padStart(2, "0");
  set("postcode", pc);
  let city = addr.addressLocality || (pc && pc.startsWith("75") ? "Paris" : null);
  if (!city && dataStore.meta && dataStore.meta.communes) {          // commune de la petite couronne citée dans le texte
    const hit = dataStore.meta.communes.filter(c => !/^Paris/.test(c[1]) && c[1].length > 3).find(c => new RegExp("\\b" + c[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(raw));
    if (hit) { city = hit[1]; if (!pc) set("postcode", null); }
  }
  set("city", city);
  const geo = pick(n => n.geo && n.geo.latitude ? n.geo : null);
  if (geo) { set("lat", +geo.latitude); set("lng", +geo.longitude); set("precise", true); }
  // « Métro : Ligne 1 (Reuilly Diderot - 5 mn à pied) et 8 (Faidherbe-Chaligny - 1 mn) » : on garde la station la plus proche
  const ml = raw.match(/[Mm][ée]tro[^\n]{0,160}/), near = ml ? [...ml[0].matchAll(/\(([A-ZÉÈ][^()\n]{2,32}?)\s+[-–]\s+(\d{1,2})\s?(?:mn|min)/g)].sort((a, b) => a[2] - b[2]) : [];
  const mm = near.length ? null : raw.match(/[Mm][ée]tro\s*:?\s+([A-ZÉÈ][\wÀ-ÿ'’\- ]{2,40}?)(?=\s*[,.\n(]| à | et |\s+-\s+\d|$)/);
  if (near.length) set("metro", near[0][1].trim()); else if (mm && !/^Ligne\b/i.test(mm[1])) set("metro", mm[1].trim().replace(/\s*-\s*/g, "-"));
  const mq = raw.match(/[Qq]uartier\s(?:de\s|du\s|des\s|d['’])?([A-ZÉÈ][\wÀ-ÿ'’\- ]{2,28}?)(?=[,.\n(/]| à | et |$)/); if (mq) set("quartier", mq[1].trim());
  else if (/^Paris\s+75\d{3}\s+[A-ZÉÈ]/m.test(raw)) set("quartier", raw.match(/^Paris\s+75\d{3}\s+([A-ZÉÈ][\wÀ-ÿ'’\- ]{2,40}?)\s*$/m)?.[1]);
  else { const mp = raw.match(/\b(?:75\d{3}\s+)?Paris\s+\d{1,2}(?:e|er|ème)?\s*\(([A-ZÉÈ][^()\n]{2,40}?)\)/); if (mp && !/^\d/.test(mp[1])) set("quartier", mp[1].split(/\s+-\s+/)[0].trim()); }
  // Rue (et numéro) du bien : pas celle de l'agence, ni un repère « proche de… »
  const st = readStreet(raw); if (st) set("street", st);
  // Consommation affichée avec le DPE (kWh/m²/an) : permet de retrouver le diagnostic officiel
  const mk = raw.match(/(\d{2,3}(?:[.,]\d)?)\s?kWh\s?(?:EP\s?|ep\s?)?(?:\/|par)\s?m(?:²|2)/i); if (mk) { const v = numFR(mk[1]); if (v >= 10 && v <= 800) set("dpeKwh", v); }
  // Photos
  const photos = [];
  const addP = u => { if (typeof u === "string" && /^https?:/.test(u) && !/logo|avatar|icon|sprite|placeholder/i.test(u) && !photos.includes(u) && photos.length < 40) photos.push(u); };
  // la galerie entière : les photos de la page (chargées ou non), puis celles des données structurées du bien (pas le logo de l'agence)
  (src.imgs || []).forEach(addP);
  nodes.filter(n => !/Organization|Agent|Agency|Person|Brand|WebSite|WebPage|Breadcrumb/i.test([].concat(n["@type"] || []).join(" ")))
    .forEach(n => [].concat(n.image || [], n.photo || []).forEach(x => addP(typeof x === "object" && x ? x.url || x.contentUrl : x)));
  addP(meta["og:image"]);
  f.photos = photos;
  f.url = src.url || ""; f.source = hostOf(src.url);
  // Signaux d'alerte lus dans le texte et les adresses des photos (les pixels ne sont pas analysés)
  const SCAM = [[/western union|moneygram|mandat cash|transcash|coupons? pcs|neosurf/, "paiement par mandat ou coupon"],
    [/(?:je suis|nous sommes|actuellement|je vis|je travaille)[^.\n]{0,20}(?:à|a) l['’]étranger|muté à l['’]étranger|en mission (?:humanitaire|à l['’]étranger)/, "propriétaire à l’étranger"],
    [/envo(?:i|yer|yé)[^.\n]{0,12}cl[ée]s|cl[ée]s[^.\n]{0,40}par (?:la )?poste|par (?:dhl|fedex|ups|chronopost)/, "clés envoyées par la poste"],
    [/(?:payer|paiement|régler|versement|virement|caution|dépôt)[^.\n]{0,40}avant (?:la |toute |votre )?visite/, "paiement demandé avant la visite"],
    [/whats ?app|(?:uniquement|seulement|exclusivement) par (?:e-?mail|mail|sms)/, "contact seulement par messagerie ou e-mail"],
    [/(?:via|par) (?:la |une )?plateforme (?:sécurisée|de paiement)|airbnb[^.\n]{0,40}(?:paiement|garantie)/, "paiement par une « plateforme » tierce"]];
  const PHOTO = [[/home[- ]?staging virtuel|mise en sc[eè]ne virtuelle|meubl[ée]e? virtuellement|d[ée]coration virtuelle|ameublement virtuel/, "home staging virtuel"],
    [/(?:images?|photos?|visuels?)[^.\n]{0,20}(?:g[ée]n[ée]r[ée]e?s?|cr[ée]{1,2}e?s?|retouch[ée]e?s?) (?:par|avec|grâce à) (?:l['’]|une )?(?:ia\b|intelligence artificielle)/, "images générées ou retouchées par IA"],
    [/photos? non contractuelles?|visuels? non contractuels?|(?:image|photo|visuel)s? d['’](?:illustration|ambiance)|perspectives? 3d|rendu 3d|images? de synth[eè]se/, "photos d’illustration ou de synthèse"]];
  const scam = SCAM.filter(([re]) => re.test(low)).map(x => x[1]), pho = PHOTO.filter(([re]) => re.test(low)).map(x => x[1]);
  if (photos.some(u => /midjourney|dall-?e|stable-?diffusion|ai[-_]generated|virtual[-_]?staging|[-_/]render(?:ing)?[-_.]/i.test(u)) && !pho.length) pho.push("nom de fichier d’image générée ou de rendu");
  if (scam.length) set("scam", scam);
  if (pho.length) set("aiPhoto", pho);
  if (f.kind === "location") ["charges", "taxe"].forEach(k => { delete f[k]; delete found[k]; });
  // Annonce retirée : la page le dit
  if (GONE_RE.test(raw.slice(0, 6000))) f.gone = true;
  // Agence ou particulier, d'après ce que la page affiche
  Object.assign(f, readAgency(nodes, raw, src.hints || {}, f.source));
  ["agencyName", "agencyPhone", "agencyEmail", "agencyUrl", "agencyAddress", "ref", "seller"].forEach(k => { if (f[k]) found[k] = true; else delete f[k]; });
  f.found = found;
  return f;
}
/* Rue citée dans l'annonce : « 12 rue Oberkampf », « boulevard de Clichy » ; on écarte l'adresse de l'agence et les repères (« proche de la place… ») */
const VOIES = ["rue", "avenue", "boulevard", "bd", "place", "quai", "passage", "impasse", "square", "cité", "villa", "allée", "cours", "chaussée", "faubourg", "rond-point", "sentier", "hameau"];
const VOIE_RE = new RegExp(`(?:\\b(\\d{1,3})(?:\\s?(?:bis|ter))?,?[ \\u00a0]+)?\\b(${VOIES.map(w => `[${w[0].toUpperCase()}${w[0]}]${w.slice(1)}`).join("|")})\\.?[ \\u00a0]+((?:de la |du |des |de l['’]|d['’]|de |la |le |les )?[A-ZÉÈÎÔ][\\wÀ-ÿ'’-]+(?:[ -](?:de la |du |des |de l['’]|d['’]|de |la |le |et )?[A-ZÉÈÎÔ][\\wÀ-ÿ'’-]+){0,3})`, "g");
function readStreet(raw) {
  for (const m of raw.matchAll(VOIE_RE)) {
    const line = raw.slice(raw.lastIndexOf("\n", m.index) + 1, m.index).toLowerCase(), before = raw.slice(Math.max(0, m.index - 30), m.index).toLowerCase();
    if (/agence|agency|bureau|contact|si[èe]ge|cabinet|notre|nos locaux|horaires/.test(line)) continue;
    if (/(?:proche|pr[èe]s|[àa] deux pas|[àa] proximit[ée]|[àa] \d+ ?(?:min|m\b)|m[ée]tro|station|face|vue sur|donnant sur|entre|non loin|depuis)\b[^.\n]{0,20}$/.test(before)) continue;
    const voie = m[2].toLowerCase() === "bd" ? "boulevard" : m[2].toLowerCase();
    return (m[1] ? m[1] + " " : "") + voie + " " + m[3].trim();
  }
  return null;
}

/* Tableaux de caractéristiques : « Libellé » puis valeur à la ligne (Leboncoin), « Libellé : valeur », « Libellé Oui » (sites d'agence) */
const TABLE = [[/^surface(?: habitable)?(?: \(?loi carrez\)?| carrez)?$/, "surface"], [/^(?:nombre de )?pi[eè]ces$/, "rooms"], [/^(?:nombre de )?chambres$/, "bedrooms"],
  [/^[ée]tage(?: du bien)?$/, "floor"], [/^nombre d['’][ée]tages(?: dans l['’]immeuble| de l['’]immeuble)?$/, "floors"], [/^ascenseur$/, "elevator"],
  [/^(?:classe [ée]nergie|dpe|consommation [ée]nerg[ée]tique|performance [ée]nerg[ée]tique)$/, "dpe"], [/^meubl[ée](?: \/ non meubl[ée])?$/, "furnished"],
  [/^ext[ée]rieurs?$/, "outdoor"], [/^(?:nombre de )?lots(?: principaux)?$/, "lots"], [/^(terrasse|jardin|balcon|loggia|parking|cave)s?$/, null]];
function readTable(raw) {
  const kv = {}, L = raw.split("\n").map(x => x.trim()).filter(Boolean);
  const key = l => { const t = l.toLowerCase().replace(/\s+/g, " "); for (const [re, k] of TABLE) { const m = t.match(re); if (m) return k || m[1]; } return null; };
  const put = (k, v) => { if (k && v != null && v !== "" && !(k in kv)) kv[k] = v.trim(); };
  for (let i = 0; i < L.length; i++) {
    const l = L[i], c = l.match(/^([^:]{3,40}?)\s*:\s*(.{1,30})$/), s = l.match(/^(.{3,40}?)\s+(oui|non|\d[\d ,.]*(?:\s?(?:\/|sur)\s?\d{1,2})?(?:\s?(?:m²|m2|€))?|[A-G])$/i);
    if (c && key(c[1])) put(key(c[1]), c[2]);
    else if (key(l)) {
      const k = key(l), nx = L[i + 1] || "", yn = /^(?:elevator|cave|parking|terrasse|jardin|balcon|loggia)$/.test(k);
      if (yn && !/^(?:oui|non)\b/i.test(nx)) put(k, "oui");                                  // « Cave » seul dans la liste : il y en a une
      else if (nx && nx.length <= 30 && (!key(nx) || key(nx) === k)) { put(k, nx); i++; }
    }
    else if (s && key(s[1])) put(key(s[1]), s[2]);
  }
  return kv;
}
/* Une annonce de location se reconnaît à son lien, à son vocabulaire et à un montant par mois */
function readRent(raw, low, url, salePrice, ldPrice) {
  const head = low.slice(0, 5000);
  const urlRent = /\/locations?(?:[\/_-]|$)|\/louer|\/a-louer|location-appartement|\/rent\b|categorie=locations|\/locations\/|type=location|transaction=location|\/location\//.test(url);
  const urlSale = /\/achat|\/vente|\/ventes|\/acheter|\/a-vendre|transaction=achat|\/ventes_immobilieres/.test(url);
  if (urlSale && !urlRent) return null;
  const N = t => { const v = parseFloat(String(t).replace(/[\s\u00a0\u202f.]/g, "").replace(",", ".")); return isFinite(v) ? v : null; };
  const AM = "(\\d{1,2}[\\s\\u00a0\\u202f.]?\\d{3}|\\d{3,4})(?:[.,](\\d{1,2}))?\\s?€";
  const grab = rx => { const m = low.match(rx); return m ? N(m[1] + (m[2] ? "." + m[2] : "")) : null; };
  let cc = grab(new RegExp(AM + "\\s?(?:\\/\\s?mois\\s?)?(?:cc\\b|c\\.c\\.?|charges comprises)")) ?? grab(new RegExp("loyer(?: mensuel)?(?: charges comprises| cc)\\s*:?\\s*" + AM));
  let hc = grab(new RegExp(AM + "\\s?(?:\\/\\s?mois\\s?)?(?:hc\\b|h\\.c\\.?|hors charges)")) ?? grab(new RegExp("loyer(?: de base| mensuel)?(?: hors charges| hc)\\s*:?\\s*" + AM));
  const perMonth = grab(new RegExp(AM + "\\s?(?:\\/\\s?mois|par mois|mensuel)")) ?? grab(new RegExp("loyer(?: mensuel)?\\s*:?\\s*" + AM));
  const charges = grab(new RegExp("(?:dont|provisions? (?:sur|pour) charges|charges(?: locatives| mensuelles| récupérables)?)\\s*:?\\s*(?:de\\s)?(\\d{1,4})(?:[.,](\\d{1,2}))?\\s?€"));
  const vocab = /(?:^|[^a-z])[àa] louer(?![a-z])|(?:^|[^a-z])location (?:vide|meubl|d['’]un|appartement)|(?:^|[^a-z])loyer(?![a-z])|charges comprises|dépôt de garantie|depot de garantie|(?:^|[^a-z])bail(?![a-z])|état des lieux|meubl/.test(head);
  const anyRent = [cc, hc, perMonth].some(v => v >= 150 && v <= 20000);
  const ldRent = ldPrice >= 150 && ldPrice <= 20000;
  if (!(urlRent || (anyRent && !(salePrice >= 30000)) || (vocab && ldRent && !(salePrice >= 30000)))) return null;
  const o = {kind: "location"};
  if (charges != null && charges < 2000) o.rentCharges = charges;
  if (cc == null && hc != null && o.rentCharges != null) cc = hc + o.rentCharges;
  if (cc == null) cc = perMonth ?? (ldRent ? ldPrice : null) ?? hc;
  if (hc == null && cc != null && o.rentCharges != null && o.rentCharges < cc) hc = cc - o.rentCharges;
  if (cc >= 150 && cc <= 20000) o.price = Math.round(cc);
  if (hc >= 100 && hc <= 20000) o.rentHC = Math.round(hc);
  if (o.rentHC && o.price && o.rentCharges == null && o.price > o.rentHC) o.rentCharges = o.price - o.rentHC;
  const dep = grab(new RegExp("d[ée]p[ôo]t de garantie\\s*:?\\s*(?:de\\s)?" + AM)); if (dep != null && dep < 30000) o.deposit = Math.round(dep);
  const fee = grab(new RegExp("(?:honoraires|frais d['’]agence)[^.\\n€]{0,70}?(\\d{1,2}[\\s\\u00a0\\u202f.]?\\d{3}|\\d{2,4})(?:[.,](\\d{1,2}))?\\s?€")); if (fee != null && fee < 15000) o.agencyFee = Math.round(fee);
  if (/non[- ]meubl|location vide(?![a-z])|vide de meubles/.test(low)) o.furnished = false; else if (/(?:^|[^a-z])meubl[ée]e?s?(?![a-z])/.test(head) || /meuble/.test(url)) o.furnished = true;
  const av = low.match(/(?:disponible|libre)\s(?:le |à partir du |a partir du |dès le |des le |au |à compter du |début |fin |mi-)?(\d{1,2}[\/.]\d{1,2}(?:[\/.]\d{2,4})?|\d{1,2}(?:er)? (?:janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)(?: \d{4})?|(?:janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)(?: \d{4})?|imm[ée]diatement|de suite|maintenant)/);
  if (av) o.available = av[1];
  const rm = low.match(/loyer de r[ée]f[ée]rence major[ée][^\d\n]{0,40}?(\d{1,2}(?:[.,]\d{1,2})?)\s?€/); if (rm) o.refMaj = N(rm[1]);
  const rb = low.match(/loyer de r[ée]f[ée]rence(?! major)(?! minor)[^\d\n]{0,40}?(\d{1,2}(?:[.,]\d{1,2})?)\s?€/); if (rb) o.refBase = N(rb[1]);
  const cp = low.match(/compl[ée]ment de loyer[^\d\n]{0,30}?(\d{1,4}(?:[.,]\d{1,2})?)\s?€/); if (cp) o.complement = N(cp[1]); else if (/(?:pas de|aucun|sans) compl[ée]ment de loyer/.test(low)) o.complement = 0;
  const yr = low.match(/(?:constru\w*|bâti|bati|édifi\w*|immeuble|résidence|residence)\s(?:en |de |des années |datant de )?(1[6-9]\d\d|20[0-2]\d)\b/), ey = yr ? +yr[1] : null;
  o.epoque = ey ? (ey < 1946 ? "a" : ey <= 1970 ? "b" : ey <= 1990 ? "c" : "d") : /haussmann|pierre de taille|immeuble ancien|\bancien\b|xixe|19e siècle|art d[ée]co|ann[ée]es 30|ann[ée]es 1930/.test(low) ? "a" : /neuf\b|r[ée]sidence r[ée]cente|immeuble r[ée]cent|construction r[ée]cente|\bbbc\b|rt ?2012|re ?2020/.test(low) ? "d" : undefined;
  return o;
}
const GONE_RE = /annonce (?:n['’]est plus (?:disponible|en ligne|active)|a (?:été )?(?:retirée|supprimée|désactivée|expiré)|(?:est )?expirée|n['’]existe plus|introuvable)|(?:ce |le )?bien (?:a été |est )?(?:déjà )?vendu|(?:ce |le )?bien n['’]est plus disponible|offre (?:n['’]est plus disponible|expirée)|plus disponible à la vente/i;
const PORTALS = /seloger|leboncoin|bienici|bien'ici|pap\b|logic-?immo|figaro|meilleursagents|avendrealouer|paruvendu|ouestfrance|superimmo|jinka|green-acres|lesiteimmo/i;
const cleanPhone = v => { const d = String(v || "").replace(/[^\d+]/g, "").replace(/^0033/, "+33"); return /^(\+33[1-9]\d{8}|0[1-9]\d{8})$/.test(d) ? d : null; };
const fmtPhone = v => { const d = cleanPhone(v); if (!d) return v || ""; const n = d.startsWith("+33") ? "0" + d.slice(3) : d; return n.replace(/(\d{2})(?=\d)/g, "$1 "); };
const cleanMail = v => { const m = String(v || "").trim().toLowerCase(); return /^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/.test(m) && !/noreply|no-reply|ne-pas-repondre|privacy|dpo@|rgpd|support@|contact@(?:seloger|leboncoin|bienici|pap)/.test(m) ? m : null; };
const cleanWeb = v => { try { const u = new URL(String(v)); return /^https?:$/.test(u.protocol) ? u.href : null; } catch (e) { return null; } };
function readAgency(nodes, raw, hints, host) {
  const o = {}, low = raw.toLowerCase(), notPortal = n => n && !PORTALS.test(n) && !(host && n.toLowerCase().includes(host.split(".").slice(-2, -1)[0]));
  // 1. données structurées : vendeur de l'offre, ou fiche d'agence immobilière
  const ag = nodes.map(n => n.seller || n.offeredBy || n.provider || (n.offers && !Array.isArray(n.offers) && (n.offers.seller || n.offers.offeredBy))).find(x => x && typeof x === "object" && x.name && notPortal(x.name))
    || nodes.find(n => /RealEstateAgent|RealEstateAgency/.test([].concat(n["@type"] || []).join(" ")) && n.name && notPortal(n.name));
  if (ag) {
    o.agencyName = String(ag.name).trim();
    o.agencyPhone = cleanPhone(ag.telephone) || undefined; o.agencyEmail = cleanMail(ag.email) || undefined; o.agencyUrl = cleanWeb(ag.url) || undefined;
    const ad = ag.address; if (ad && typeof ad === "object") o.agencyAddress = [ad.streetAddress, [ad.postalCode, ad.addressLocality].filter(Boolean).join(" ")].filter(Boolean).join(", ") || undefined; else if (typeof ad === "string") o.agencyAddress = ad;
    if (/Person/.test([].concat(ag["@type"] || []).join(" "))) o.seller = "particulier";
  }
  // 2. état de la page (sites en React, Next…) : objets « agency », « contact », « owner »…
  for (const sn of hints.state || []) {
    const nm = (sn.match(/"(?:agencyName|agency_name|advertiserName|sellerName|storeName|companyName|brandName|tradeName|name|displayName|legalName|commercialName)"\s*:\s*"([^"]{2,90})"/) || [])[1];
    if (!o.agencyName && nm && notPortal(nm) && !/^(?:agence|particulier|contact|pro|null|undefined)$/i.test(nm) && /agenc|advertis|seller|store|owner|contact|professional|annonceur|realEstate|brand|company|trade/i.test(sn.slice(0, 40))) o.agencyName = nm.trim();
    if (!o.agencyPhone) { const ph = (sn.match(/"(?:phone|phoneNumber|telephone|mobile|phoneNumbers?)"\s*:\s*\[?"(\+?[\d .()-]{8,20})"/) || [])[1]; if (cleanPhone(ph)) o.agencyPhone = cleanPhone(ph); }
    if (!o.agencyEmail) { const em = (sn.match(/"(?:email|mail|contactEmail)"\s*:\s*"([^"]{5,90})"/) || [])[1]; if (cleanMail(em)) o.agencyEmail = cleanMail(em); }
    if (!o.agencyUrl) { const w = (sn.match(/"(?:website|webSite|siteUrl|agencyUrl|url)"\s*:\s*"(https?:[^"]{4,200})"/) || [])[1]; if (w && !PORTALS.test(w) && cleanWeb(w.replace(/\\u002F/g, "/"))) o.agencyUrl = cleanWeb(w.replace(/\\u002F/g, "/")); }
    if (!o.seller && /"(?:type|ownerType|userType|accountType)"\s*:\s*"(?:private|particulier|part)"/i.test(sn)) o.seller = "particulier";
  }
  // 3. liens cliquables de la page
  if (!o.agencyPhone) for (const t of hints.tels || []) { const ph = cleanPhone(t.split("|")[0]); if (ph) { o.agencyPhone = ph; break; } }
  if (!o.agencyEmail) for (const m of hints.mails || []) { const em = cleanMail(m); if (em) { o.agencyEmail = em; break; } }
  // 4. texte : « Proposé par… », « Agence : … », numéro affiché, référence
  if (!o.agencyName) { const mn = raw.match(/(?:propos[ée]e? par|annonce (?:publi[ée]e|diffus[ée]e) par|vendu par|agence\s*:)\s*\n?\s*([A-Z0-9][^\n]{2,60})/i); if (mn && notPortal(mn[1]) && !/particulier/i.test(mn[1])) o.agencyName = mn[1].trim().replace(/\s{2,}/g, " "); }
  if (!o.agencyPhone) { const mp = raw.match(/(?:\+33\s?|\b0)[1-9](?:[\s.-]?\d{2}){4}\b/); if (mp && cleanPhone(mp[0])) o.agencyPhone = cleanPhone(mp[0]); }
  const mr = raw.match(/\br[ée]f(?:[ée]rence|\.)?(?:\s+de l['’]annonce)?\s*[:.°]?\s*(?:n°\s*)?([A-Z0-9][A-Z0-9\-_/]{2,24})\b/i); if (mr && /\d/.test(mr[1])) o.ref = mr[1];
  if (!o.seller) o.seller = /pap\.fr/.test(host || "") || /de particulier à particulier|\bparticulier\b(?! ou)/.test(low) && !o.agencyName ? "particulier" : o.agencyName ? "agence" : undefined;
  Object.keys(o).forEach(k => o[k] == null && delete o[k]);
  return o;
}

/* ---------- Plusieurs annonces sur une page (résultats de recherche, e-mail d'alerte) ----------
   Fonction autonome : la même tourne dans la page visitée (bouton + Heden) et dans Heden (e-mails).
   Une « carte » est le plus grand bloc qui ne contient qu'un seul prix de vente. */
function extractCards(root, base) {
  const BLK = /^(DIV|P|TD|TH|TR|LI|BR|H[1-6]|TABLE|TBODY|SECTION|ARTICLE|UL|OL|HEADER|FOOTER|DL|DT|DD|FIGURE|FIGCAPTION|ASIDE|MAIN)$/i;
  const SKIP = /^(SCRIPT|STYLE|NOSCRIPT|SVG|TEMPLATE|IFRAME|HEAD|SELECT|OPTION)$/i;
  const txt = el => { let o = ""; (function w(n) { if (n.nodeType === 3) { o += n.nodeValue; return; } if (n.nodeType !== 1 || SKIP.test(n.tagName)) return; const b = BLK.test(n.tagName); if (b) o += "\n"; for (let c = n.firstChild; c; c = c.nextSibling) w(c); if (b) o += "\n"; })(el); return o.replace(/[ \t   ]+/g, " ").replace(/ ?\n\s*/g, "\n").trim(); };
  const PR = /(\d{1,3}(?:[    .]\d{3})+|\d{5,8})\s?(?:€|eur\b|euros?\b)/gi;
  // loyers : un montant suivi de « /mois », « CC », « charges comprises » (ou sur une page de locations)
  const RR = /(\d{1,2}[\s\u00a0\u202f\u2009.]?\d{3}|\d{3,4})(?:[.,]\d{1,2})?\s?(?:€|eur\b|euros?\b)/gi;
  let page = ""; try { page = String(base || (root.ownerDocument && root.ownerDocument.defaultView && root.ownerDocument.defaultView.location.href) || ""); } catch (e) {}
  const rentPage = /\/locations?(?:[\/_-]|$)|\/louer|a-louer|transaction=location|categorie=locations/i.test(page);
  const prices = s => {
    const o = [];
    for (const m of s.matchAll(PR)) { const a = s.slice(m.index + m[0].length, m.index + m[0].length + 14).toLowerCase(); if (/^\s*(\/|par |le |du |hc|cc|charges)/.test(a)) continue; const v = +m[1].replace(/\D/g, ""); if (v >= 30000 && v <= 20000000) o.push(v); }
    for (const m of s.matchAll(RR)) {
      const a = s.slice(m.index + m[0].length, m.index + m[0].length + 20).toLowerCase(), b = s.slice(Math.max(0, m.index - 26), m.index).toLowerCase();
      if (/(dont|charges?|honoraires|frais|d[ée]p[ôo]t|garantie|caution|[ée]tat des lieux)[^\d]{0,18}$/.test(b) || /^\s*(hc\b|h\.c|hors charges|de charges|\/ ?m|par m|m²)/.test(a)) continue;
      const tagged = /^\s*(\/ ?mois|par mois|mensuel|cc\b|c\.c|charges comprises)/.test(a), v = +m[1].replace(/\D/g, "");
      if ((tagged || rentPage) && v >= 200 && v <= 15000 && !o.includes(v)) o.push(v);
    }
    return o;
  };
  const cand = [];
  for (const el of root.querySelectorAll("*")) {
    if (SKIP.test(el.tagName)) continue;
    const t = el.textContent || ""; if (t.length > 160 || t.length < 5) continue;
    const p = prices(t); if (p.length) { el.__hp = p[0]; cand.push(el); }
  }
  const cs = new Set(cand);
  const mins = cand.filter(el => { for (const d of el.querySelectorAll("*")) if (cs.has(d)) return false; return true; });
  const cards = new Set();
  for (const pe of mins) {
    let card = pe;
    for (let p = pe.parentElement; p && p !== root.parentElement; p = p.parentElement) {
      const vals = new Set(); for (const x of mins) if (p.contains(x)) vals.add(x.__hp);
      if (vals.size > 1 || (p.textContent || "").length > 2500) break;
      card = p;
    }
    cards.add(card);
  }
  const list = [...cards].filter(c => ![...cards].some(o => o !== c && o.contains(c)));
  const HOUSE = /m²|m2\b|pi[eè]ces?\b|chambres?\b|studio|\b[TF][1-9]\b/i;
  const BAD = /unsub|d[ée]sabonn|d[ée]sinscri|preferen|mailto:|\/aide|help|contact|cgu|privacy|confidential|facebook|twitter|instagram|linkedin|youtube|apps\.apple|play\.google|tel:/i;
  const abs = h => { try { return new URL(h, base || undefined).href; } catch (e) { try { return new URL(h, root.ownerDocument.baseURI).href; } catch (e2) { return ""; } } };
  const out = [];
  for (const c of list) {
    const live = !!(c.ownerDocument && c.ownerDocument.defaultView);
    const text = String(live && c.innerText ? c.innerText : txt(c)).replace(/[ \t  ]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
    if (!HOUSE.test(text)) continue;
    const as = [c.closest && c.closest("a[href]"), ...c.querySelectorAll("a[href]")].filter(Boolean);
    let url = "", best = -1;
    for (const a of as) {
      const h = abs(a.getAttribute("href")); if (!/^https?:/i.test(h) || BAD.test(h)) continue;
      const sc = (a.querySelector("img") ? 2 : 0) + (prices(a.textContent || "").length ? 2 : 0) + (/annonce|detail|\/ad\/|-r\d{5,}|\.htm/i.test(h) ? 3 : 0) + (a === as[0] ? 1 : 0);
      if (sc > best) { best = sc; url = h; }
    }
    if (!url) continue;
    // toutes les photos de la carte (carrousel compris), la plus grande d'abord
    const seen = new Map();
    for (const i of c.querySelectorAll("img")) {
      const s = i.currentSrc || i.getAttribute("src") || i.getAttribute("data-src") || i.getAttribute("data-lazy-src") || i.getAttribute("data-original") || (i.getAttribute("srcset") || i.getAttribute("data-srcset") || "").split(/\s/)[0];
      if (!s || /^data:|logo|pixel|spacer|tracking|icon|avatar|badge/i.test(s)) continue;
      const w = i.naturalWidth || +i.getAttribute("width") || 200, hh = i.naturalHeight || +i.getAttribute("height") || 150;
      if (w < 90 || hh < 60) continue;
      const u = abs(s); if (u && !seen.has(u)) seen.set(u, w * hh);
    }
    // e-mails : la photo est souvent le fond de la case (attribut background, style background-image), l'image posée dessus n'est qu'un cadre
    for (const el of [c, ...c.querySelectorAll("[background],[style*=background]")]) {
      const st = (el.getAttribute && el.getAttribute("style")) || "", m = st.match(/background(?:-image)?\s*:[^;]*url\(\s*['"]?([^'")]+)/i);
      for (const b of [el.getAttribute && el.getAttribute("background"), m && m[1]]) {
        if (!b || /^data:|logo|pixel|spacer|icon/i.test(b)) continue;
        const u = abs(b), q = (() => { try { const x = new URL(u).searchParams; return (+x.get("w") || 500) * (+x.get("h") || 370); } catch (e) { return 185000; } })();
        if (u && (!seen.has(u) || seen.get(u) < q)) seen.set(u, q);
      }
    }
    const big = [...seen].sort((a, b) => b[1] - a[1])[0], imgs = big ? [big[0], ...[...seen.keys()].filter(u => u !== big[0])].slice(0, 12) : [];
    out.push({url, img: imgs[0] || "", imgs, text: text.slice(0, 900)});
  }
  // une même image dans presque toutes les cartes est un décor de l'e-mail (cadre, pastille), pas une photo du bien
  if (out.length >= 3) {
    const n = new Map(); out.forEach(o => new Set(o.imgs).forEach(u => n.set(u, (n.get(u) || 0) + 1)));
    out.forEach(o => { o.imgs = o.imgs.filter(u => n.get(u) < Math.max(3, out.length * 0.6)); o.img = o.imgs[0] || ""; });
  }
  return out;
}
/* Page d'une seule annonce (et pas une page de résultats) */
const isDetailUrl = u => /-r\d{6,}\b|\/annonces\/achat\/[^?#]+\/\d+\.htm|\/ad\/[a-z_]+\/\d+|\/vi\/\d+\.htm|\/annonce\/(?:vente|achat)\/|detail-vente|\/annonces\/annonce-|\/annonce-[a-z0-9-]+-\d+\.htm|\/annonce-immobiliere\//i.test(u || "");
const SITE_NAMES = {"seloger.com": "SeLoger", "pap.fr": "PAP", "leboncoin.fr": "Leboncoin", "bienici.com": "Bien’ici", "logic-immo.com": "Logic-immo", "lefigaro.fr": "Figaro Immobilier", "orpi.com": "Orpi", "century21.fr": "Century 21", "laforet.com": "Laforêt", "guy-hoquet.com": "Guy Hoquet", "jinka.fr": "Jinka"};
const siteName = host => { const h = String(host || "").toLowerCase().replace(/^www\./, ""); const k = Object.keys(SITE_NAMES).find(x => h === x || h.endsWith("." + x)); return k ? SITE_NAMES[k] : h; };

const normUrl = u => { const x = String(u || "").split("#")[0]; return /emailing|click|track|link\.|\/c\//i.test(x) ? x : x.replace(/\?.*$/, ""); };
const cardImgs = c => Array.isArray(c.imgs) && c.imgs.length ? c.imgs : c.img ? [c.img] : [];

/* ---------- DPE officiel (base ADEME des DPE depuis juillet 2021) : confirme le DPE, la surface, et situe l'immeuble ----------
   Sans rue ni consommation, des centaines de logements se ressemblent dans un arrondissement : on ne cherche pas. */
const ADEME = "https://data.ademe.fr/data-fair/api/v1/datasets/meg-83tjwtg8dyz4vv7h1dqe/lines";
const ADEME_SEL = "numero_dpe,adresse_ban,nom_rue_ban,etiquette_dpe,surface_habitable_logement,conso_5_usages_par_m2_ep,date_etablissement_dpe,numero_etage_appartement,annee_construction,_geopoint";
const rueCore = s => sansAccent(String(s || "").replace(/^\d+\s*(?:bis|ter)?\s*/i, "")).replace(/^(?:rue|avenue|boulevard|place|quai|passage|impasse|square|cite|villa|allee|cours|chaussee|faubourg|rond-point|sentier|hameau)\s+(?:de la |du |des |de l'|d'|de |la |le |les )?/, "").replace(/[’']/g, "'").trim();
async function ademeCands(f) {
  if (!f.surface || !/^(?:75|9[1-5]|7[78])\d{3}$/.test(f.postcode || "") || (!f.street && !f.dpeKwh)) return null;
  const s = f.surface, qs = [`code_postal_ban:${f.postcode}`, `surface_habitable_logement:[${(s - 2).toFixed(1)} TO ${(s + 2).toFixed(1)}]`];
  if (f.dpeKwh) qs.push(`conso_5_usages_par_m2_ep:[${f.dpeKwh - 0.5} TO ${f.dpeKwh + 0.5}]`);   // valeur affichée arrondie à l'unité
  let u = `${ADEME}?size=30&select=${ADEME_SEL}&sort=-date_etablissement_dpe&qs=${encodeURIComponent(qs.join(" AND "))}`;
  if (!f.dpeKwh) u += `&q=${encodeURIComponent(rueCore(f.street))}&q_fields=nom_rue_ban`;
  try { const r = await fetch(u); if (!r.ok) return null; return (await r.json()).results || []; } catch (e) { return null; }
}
function ademeScore(f, r) {
  const dS = Math.abs(r.surface_habitable_logement - f.surface), rue = f.street && rueCore(r.nom_rue_ban) === rueCore(f.street);
  let sc = dS <= 0.5 ? 3 : dS <= 1 ? 2 : 1;
  if (rue) sc += 3; else if (f.street) sc -= 2;
  if (f.dpeKwh && Math.abs(r.conso_5_usages_par_m2_ep - f.dpeKwh) <= 0.5) sc += 4;
  if (f.dpe) sc += r.etiquette_dpe === f.dpe ? 1 : -1;
  if (f.floor > 0 && r.numero_etage_appartement === f.floor) sc += 1;
  return sc;
}
const ademeOf = r => { const [lat, lng] = String(r._geopoint || "").split(",").map(Number);
  return {n: r.numero_dpe, cls: r.etiquette_dpe, surf: r.surface_habitable_logement, kwh: r.conso_5_usages_par_m2_ep, date: r.date_etablissement_dpe, addr: r.adresse_ban, floor: r.numero_etage_appartement, year: r.annee_construction, lat, lng}; };
/* rattache le DPE retrouvé : position de l'immeuble, DPE manquant complété (jamais d'écrasement de ce que dit l'annonce) */
function adoptAdeme(f, a) {
  f.ademe = Object.assign(a, {sure: true}); delete f.ademeCands;
  if (a.lat && a.lng && !f.precise) { f.lat = a.lat; f.lng = a.lng; f.precise = true; f.placedBy = a.addr; f.placeLevel = "dpe"; f.est = null; }
  if (!f.dpe && a.cls) f.dpe = a.cls;
}
async function ademeCheck(f, force) {
  if (!force && f.ademeAt) return false;
  const rs = await ademeCands(f); if (!rs) return false;
  f.ademeAt = Date.now();
  // un même logement peut avoir plusieurs DPE successifs : le plus récent seulement
  const seen = new Set(), list = rs.map(r => [ademeScore(f, r), r]).filter(([sc]) => sc >= 4).sort((a, b) => b[0] - a[0])
    .filter(([, r]) => { const k = r.adresse_ban + "|" + r.surface_habitable_logement; if (seen.has(k)) return false; seen.add(k); return true; });
  if (list.length && list[0][0] >= 6 && (list.length === 1 || list[1][0] <= list[0][0] - 2)) adoptAdeme(f, ademeOf(list[0][1]));
  else if (list.length) f.ademeCands = list.slice(0, 3).map(([, r]) => ademeOf(r));
  else delete f.ademeCands;
  return true;
}

/* ---------- Vivier : un e-mail d'alerte → annonces (même lecture dans l'app et dans le traitement automatique) ---------- */
const VIVIER_CHAMPS = ["bedrooms", "floor", "floors", "top", "elevator", "outdoor", "outdoorArea", "dpe", "dpeKwh", "charges", "taxe", "lots", "works", "quiet", "traversant", "bright",
  "cave", "parking", "view", "building", "exposure", "street", "metro", "quartier", "city", "furnished", "rentHC", "rentCharges", "deposit", "agencyFee", "viager", "rente",
  "seller", "agencyName", "agencyPhone", "ref", "lat", "lng", "precise", "placeLevel", "placedBy", "ademe"];
const vivierData = f => { const d = {}; VIVIER_CHAMPS.forEach(k => { if (f[k] != null && f[k] !== "") d[k] = f[k]; }); return d; };
function vivierLire(m, parse = s => new DOMParser().parseFromString(s, "text/html")) {
  let doc = null; try { doc = parse(m.html || ""); } catch (e) {}
  const src = siteName((String(m.sender || "").match(/@([\w.-]+)/) || [])[1]), head = doc && doc.body ? (doc.body.textContent || "").replace(/\s+/g, " ").slice(0, 400) : "";
  const gone = GONE_RE.test((m.subject || "") + " " + head);
  let cards = []; try { if (doc && doc.body && !gone) cards = extractCards(doc.body); } catch (e) {}
  const ann = cards.map(c => {
    const f = parseListing({url: c.url, text: c.text, imgs: cardImgs(c)});
    if (!(f.price && (f.surface || f.rooms))) return null;
    return {f, a: {url: normUrl(c.url), source: src, kind: f.kind === "location" ? "location" : "achat", postcode: f.postcode || null, price: f.price, surface: f.surface || null,
      rooms: f.rooms || null, carte: {url: c.url, text: c.text.slice(0, 400), imgs: cardImgs(c).slice(0, 6)}, data: vivierData(f)}};
  }).filter(Boolean);
  const ret = gone && doc ? [...doc.querySelectorAll("a[href]")].map(a => normUrl(a.getAttribute("href"))).filter(u => /^https?:/.test(u)).slice(0, 40) : [];
  return {ann, ret};
}
/* rue lue dans l'annonce → Base Adresse Nationale (Géoplateforme IGN) ; sans mémoire, pour le traitement automatique */
async function banRue(f) {
  if (!f.street || !f.postcode || (f.lat && f.precise)) return;
  try {
    const r = await fetch(`https://data.geopf.fr/geocodage/search/?q=${encodeURIComponent(f.street)}&postcode=${f.postcode}&limit=1`); if (!r.ok) return;
    const x = ((await r.json()).features || [])[0], p = x && x.properties;
    if (p && p.score >= 0.55 && (p.type === "housenumber" || p.type === "street") && p.postcode === f.postcode)
      Object.assign(f, {lat: x.geometry.coordinates[1], lng: x.geometry.coordinates[0], precise: p.type === "housenumber", placedBy: p.label, placeLevel: p.type === "housenumber" ? "adresse" : "rue"});
  } catch (e) {}
}
