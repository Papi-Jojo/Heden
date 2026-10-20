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
  const f = {}, found = {};
  const set = (k, v) => { if (v != null && v !== "" && !(typeof v === "number" && !isFinite(v))) { f[k] = v; found[k] = true; } };
  // Prix
  let price = numFR(pick(n => n.price ?? (n.offers && (n.offers.price ?? (Array.isArray(n.offers) && n.offers[0] && n.offers[0].price)))));
  if (!(price >= 30000 && price <= 20e6)) {
    const c = [...raw.matchAll(/(\d{1,3}(?:[ .]\d{3})+|\d{5,8})\s?€(?!\s*(?:\/|par)\s*(?:m|mois))/g)].map(m => numFR(m[1])).filter(v => v >= 30000 && v <= 20e6);
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
  if (rent) { delete f.price; delete found.price; for (const [k, v] of Object.entries(rent)) set(k, v); }
  // Surface
  let surf = numFR(pick(n => n.floorSize && (n.floorSize.value ?? n.floorSize)));
  if (!(surf >= 9 && surf <= 500)) {
    surf = null;
    for (const m of raw.matchAll(/(\d{1,3}(?:[.,]\d{1,2})?)\s?m(?:²|2(?![\d²]))/g)) {
      const near = low.slice(Math.max(0, m.index - 28), m.index), before = near.split(/[\n·•|\/]/).pop();
      // « 2 chambres 64 m² » : la surface totale suit le nombre de chambres ; « chambre de 12 m² » : surface d'une pièce
      if (!/\d\s*chambres?\s*[,·-]?\s*$/.test(before) && /terrasse|balcon|jardin|cave|parking|terrain|loggia|box|séjour|sejour|chambre|cuisine|€/.test(before)) continue;
      const v = numFR(m[1]); if (v >= 9 && v <= 500) { surf = v; break; }
    }
  }
  set("surface", surf);
  // Pièces, chambres
  let rooms = numFR(pick(n => n.numberOfRooms && (n.numberOfRooms.value ?? n.numberOfRooms)));
  if (!(rooms != null && rooms >= 1 && rooms <= 15)) { const m = low.match(/(\d{1,2})\s?pi[eè]ces?\b/) || raw.match(/\b[TF](\d)\b/); rooms = m ? +m[1] : (/\bstudio\b/.test(low) ? 1 : null); }
  set("rooms", rooms);
  let beds = numFR(pick(n => n.numberOfBedrooms ?? n.numberOfBedroomsTotal));
  if (!(beds != null && beds >= 0 && beds <= 10)) {
    const WN = {une: 1, un: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6};
    const m = low.match(/(\d{1,2}|une?|deux|trois|quatre|cinq|six)\s(?:belles?\s|grandes?\s|vraies?\s)?chambres?\b/); beds = m ? (WN[m[1]] || +m[1]) : null;
  }
  set("bedrooms", beds);
  // Étage
  let floor = null, floors = null;
  if (/\b(rez[- ]de[- ]chauss[ée]e|rdc)\b/.test(low) && !/au-dessus du rez/.test(low)) floor = 0;
  let m = low.match(/(\d{1,2})\s?(?:er|e|ème|eme|è)\s?(?:et\s)?(?:dernier\s)?[ée]tage/) || low.match(/[ée]tage\s*:?\s*(\d{1,2})(?:\s?\/\s?(\d{1,2}))?/);
  if (m) { floor = +m[1]; if (m[2]) floors = +m[2]; }
  const mf = low.match(/sur\s(\d{1,2})\s[ée]tages?/) || low.match(/immeuble de\s(\d{1,2})\s[ée]tages?/); if (mf) floors = +mf[1];
  set("floor", floor); set("floors", floors);
  if (/dernier [ée]tage/.test(low)) set("top", true);
  if (/sans ascenseur|pas d['’]ascenseur/.test(low)) set("elevator", false); else if (/ascenseur/.test(low)) set("elevator", true);
  // Extérieur
  const ext = /terrasse/.test(low) ? "terrasse" : /jardin privatif|jardin de \d|avec jardin/.test(low) ? "jardin" : /balcon/.test(low) ? "balcon" : /loggia/.test(low) ? "loggia" : null;
  set("outdoor", ext);
  if (ext) { const ma = low.match(new RegExp(ext + "[^.\\n]{0,18}?(\\d{1,3})\\s?m")); if (ma) set("outdoorArea", +ma[1]); }
  // Lumière, exposition
  const me = low.match(/expos[ée]e?s?\s(?:plein\s)?(sud[- ]ouest|sud[- ]est|nord[- ]ouest|nord[- ]est|sud|nord|est|ouest)/);
  if (me) set("exposure", me[1].replace(" ", "-"));
  if (/traversant/.test(low)) set("traversant", true);
  if (/lumineu|tr[eè]s clair|baign[ée] de lumi|ensoleill|lumi[eè]re naturelle/.test(low)) set("bright", true);
  if (/\bsombre\b/.test(low)) set("dark", true);
  // DPE, charges, taxe foncière
  const md = raw.match(/(?:DPE|[Cc]lasse [ée]nergie|[Cc]onsommation [ée]nerg[ée]tique|[Pp]erformance [ée]nerg[ée]tique)[^A-Za-z\n]{0,14}\b([A-G])\b/);
  if (md) set("dpe", md[1]);
  const mc = low.match(/charges?(?: de copropri[ée]t[ée])?(?: annuelles| mensuelles| courantes)?\s*:?\s*(?:(?:de|d['’]|environ|env\.|d['’]environ|approx\.?|±)\s*)*(\d[\d .]{0,6}?)\s?(?:€|euros?)\s?(?:\/\s?|par\s)?(an|mois|année)?/);
  if (mc) { let v = numFR(mc[1]); const unit = mc[2] || (v > 600 ? "an" : "mois"); if (/mois/.test(unit)) v *= 12; if (v > 0 && v < 30000) set("charges", Math.round(v)); }
  const mt = low.match(/taxe fonci[eè]re\s*:?\s*(?:de\s)?(\d[\d ]{0,6})\s?€/); if (mt) set("taxe", numFR(mt[1]));
  // Annexes, état, ambiance
  if (/\bcaves?\b/.test(low) && !/sans cave/.test(low)) set("cave", true);
  if (/\b(parking|box|garage|place de stationnement)\b/.test(low) && !/parking (?:public|à proximité)/.test(low)) set("parking", true);
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
  const ma2 = low.match(/paris\s?(\d{1,2})\s?(?:er|e|ème|eme)\b/) || low.match(/\b(\d{1,2})\s?(?:er|e|ème|eme)\s+arr(?:ondissement|\.|\b)/); if (!pc && ma2 && +ma2[1] >= 1 && +ma2[1] <= 20) pc = "750" + String(ma2[1]).padStart(2, "0");
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
  const mm = near.length ? null : raw.match(/[Mm][ée]tro\s*:?\s+([A-ZÉÈ][\wÀ-ÿ'’\- ]{2,28}?)(?=[,.\n(]| à | et | - |$)/);
  if (near.length) set("metro", near[0][1].trim()); else if (mm && !/^Ligne\b/i.test(mm[1])) set("metro", mm[1].trim());
  const mq = raw.match(/[Qq]uartier\s(?:de\s|du\s|des\s|d['’])?([A-ZÉÈ][\wÀ-ÿ'’\- ]{2,28}?)(?=[,.\n(/]| à | et |$)/); if (mq) set("quartier", mq[1].trim());
  else { const mp = raw.match(/\b(?:75\d{3}\s+)?Paris\s+\d{1,2}(?:e|er|ème)?\s*\(([A-ZÉÈ][^()\n]{2,40}?)\)/); if (mp && !/^\d/.test(mp[1])) set("quartier", mp[1].split(/\s+-\s+/)[0].trim()); }
  // Photos
  const photos = [];
  const addP = u => { if (typeof u === "string" && /^https?:/.test(u) && !photos.includes(u) && photos.length < 12) photos.push(u); };
  addP(meta["og:image"]); (src.imgs || []).forEach(addP);
  const ldi = pick(n => n.image); (Array.isArray(ldi) ? ldi : [ldi]).forEach(x => addP(typeof x === "object" && x ? x.url : x));
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
  const ex = {terrasse: 5, jardin: 5, balcon: 3, loggia: 3}[f.outdoor];
  k("exterieur", ex != null ? Math.min(5, ex + (f.outdoorArea >= 8 ? .5 : 0)) : 1, ex != null);
  k("calme", f.quiet === true ? 5 : f.quiet === false ? 1.5 : 2.5, f.quiet != null);
  k("etat", {neuf: 5, bon: 4, rafraichir: 2.5, travaux: 1}[f.works] ?? 3, !!f.works);
  k("energie", f.dpe ? [5, 5, 4, 3, 2, 1, 0][DPE.indexOf(f.dpe)] : 2.5, !!f.dpe);
  if (kindOf(f) === "location" && f.rentCharges && f.surface) { const c = f.rentCharges * 12 / f.surface; k("charges", c < 25 ? 5 : c < 35 ? 4 : c < 45 ? 3 : c < 60 ? 2 : 1, true); }
  else if (f.charges && f.surface) { const c = f.charges / f.surface; k("charges", c < 25 ? 5 : c < 35 ? 4 : c < 45 ? 3 : c < 60 ? 2 : 1, true); } else k("charges", 3, false);
  if (f.surface && f.rooms) { const r = f.surface / f.rooms; k("agencement", (r >= 20 ? 5 : r >= 16 ? 4 : r >= 13 ? 3 : 2) + (f.bedrooms != null && f.rooms >= 3 && f.bedrooms >= f.rooms - 1 ? .5 : 0), true); } else k("agencement", 2.5, false);
  k("annexes", f.cave || f.parking ? (f.cave && f.parking ? 5 : 3.5) : 1, !!(f.cave || f.parking));
  k("cachet", f.cachet ? (f.cachet >= 2 ? 5 : 3.5) : 2, !!f.cachet);
  k("vue", f.view ? 5 : 2.5, !!f.view);
  k("immeuble", f.building === "gardien" ? 5 : f.building === "securise" ? 3.5 : 2.5, !!f.building);
  const cm = commutes(f);
  if (cm.length) { const t = Math.max(...cm.map(x => x.min)); k("trajets", t <= 20 ? 5 : t <= 30 ? 4 : t <= 40 ? 3 : t <= 50 ? 2 : t <= 60 ? 1 : 0, true); } else k("trajets", 2.5, false);
  /* corrections faites après lecture ou visite : elles priment sur la lecture de l'annonce */
  const fixed = {};
  if (!raw && f.fix && f.fix.crit) for (const [id, val] of Object.entries(f.fix.crit)) if (id in v && val != null) { v[id] = val; known[id] = true; fixed[id] = true; }
  return {v, known, fixed};
}
function listingFilters(f, h) {
  const fails = [], lo = h.loc || {};
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
/* Quartier : la zone qui contient l'annonce, sinon la plus proche (moins de 300 m), sinon l'estimation des données du coin */
function listingArea(f) {
  if (!(f.lat && f.lng)) return null;
  const p = {lat: f.lat, lng: f.lng};
  const inside = state.zones.find(z => Array.isArray(z.points) && inPoly(f.lat, f.lng, z.points));
  if (inside) return {zone: inside, score: zoneScore(inside).score, how: "dans"};
  let best = null;
  for (const z of state.zones) { if (!z.points) continue; const d = Math.min(...z.points.map(q => distM(p, {lat: q[0], lng: q[1]}))); if (d < 300 && (!best || d < best.d)) best = {zone: z, d}; }
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
  const h = homeProfile(), {v, known, fixed} = homeValues(f, raw), W = homeWeights(), fx = raw ? null : f.fix;
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
  let range = null;
  if (total != null && logLo != null && cover < 1) {
    const qUnc = partial ? (1 - (partial.cover ?? .5)) * 8 : 0;
    const lo = Math.round(Math.max(0, (mkTotal(logLo) ?? total) + bonus - malus - qUnc)), hi = Math.round(Math.min(100, (mkTotal(logHi) ?? total) + bonus - malus + qUnc));
    if (hi - lo >= 12) range = [Math.min(lo, total), fails.length ? Math.min(hi, 35) : Math.max(hi, total)];
  }
  const hasFix = !!(fx && ((fx.crit && Object.keys(fx.crit).length) || fx.quartier != null || fx.total != null));
  const heden = hasFix ? scoreListing(f, true).total : total;
  if (fx && fx.total != null) total = fx.total;
  // raisons, les plus parlantes d'abord
  const plus = [], minus = (f.scam || []).length ? ["Annonce suspecte"] : [];
  if (f.dropped && f.priceHistory && f.priceHistory.length) plus.push(`Prix baissé de ${fmtInt(f.priceHistory[f.priceHistory.length - 1].price - f.price)} €`);
  if (fx && fx.quartier != null) (fx.quartier >= 60 ? plus : minus).push(`Quartier corrigé à ${fx.quartier}`);
  else if (area && area.zone) (area.score >= 65 ? plus : area.score < 45 ? minus : plus).push(`${area.how === "dans" ? "Dans" : "Près de"} votre zone « ${area.zone.name} » (${area.score ?? "–"})`);
  else if (area) (area.score >= 60 ? plus : minus).push(`Quartier estimé à ${area.score} d’après les données du coin`);
  if (ecart != null) (ecart <= -0.03 ? plus : ecart >= 0.08 ? minus : plus).push(ecart <= -0.03 ? `${Math.round(-ecart * 100)} % sous les ${rentK ? "loyers" : "ventes"} du quartier` : ecart >= 0.08 ? `${Math.round(ecart * 100)} % au-dessus des ${rentK ? "loyers" : "ventes"} du quartier${pa.adj.length ? ", à atouts égaux" : ""}` : rentK ? "Dans les loyers du quartier" : "Au prix des ventes du quartier");
  const label = {lumiere: f.bright || f.traversant ? "Lumineux" + (f.traversant ? ", traversant" : "") : f.exposure ? `Exposé ${f.exposure}` : "Luminosité",
    etage: f.floor === 0 ? "Rez-de-chaussée" : f.floor != null ? `${f.floor === 1 ? "1er" : f.floor + "e"} étage${f.elevator ? " avec ascenseur" : f.elevator === false ? " sans ascenseur" : ""}` : "Étage",
    exterieur: f.outdoor ? (f.outdoor[0].toUpperCase() + f.outdoor.slice(1)) + (f.outdoorArea ? ` de ${f.outdoorArea} m²` : "") : "Pas d’extérieur",
    calme: f.quiet ? "Au calme, sur cour" : "Sur rue", etat: {neuf: "Rénové", bon: "Bon état", rafraichir: "À rafraîchir", travaux: "Travaux à prévoir"}[f.works],
    energie: f.dpe ? `DPE ${f.dpe}` : "DPE", charges: f.charges ? `Charges de ${fmtInt(f.charges)} € par an` : "Charges", agencement: f.surface && f.rooms ? `${fmtInt(f.surface / f.rooms)} m² par pièce` : "Agencement",
    annexes: [f.cave && "Cave", f.parking && "Parking"].filter(Boolean).join(" et "), cachet: "Cachet de l’ancien", vue: "Vue dégagée", immeuble: f.building === "gardien" ? "Gardien" : "Immeuble sécurisé",
    trajets: (() => { const cm = commutes(f); return cm.length ? cm.map(x => `${x.min} min ${x.p.label ? "vers " + x.p.label : "de trajet"}`).join(", ") : ""; })()};
  const ranked = Object.entries(W).filter(([id, w]) => w > 0 && known[id]).sort((a, b) => b[1] - a[1]);
  for (const id in fixed) label[id] = `${HOME_LIB[id].name} : ${fmtNote(v[id])}/5, corrigé`;
  ranked.forEach(([id]) => { if (v[id] >= 4 && label[id]) plus.push(label[id]); else if (v[id] <= 1.5 && label[id]) minus.push(label[id]); });
  const unknown = Object.entries(W).filter(([id, w]) => w >= 10 && !known[id] && id !== "trajets").map(([id]) => HOME_LIB[id].name.toLowerCase());
  return {total, logement, quartier, prix, ecart, ppm, med, medRaw, adj: pa.adj, area, partial, fails, plus: plus.slice(0, 4), minus: minus.slice(0, 3), unknown, values: v, known, fixed, hasFix, heden, fixTotal: !!(fx && fx.total != null), fixQuartier: !!(fx && fx.quartier != null),
    cover, range: fx && fx.total != null ? null : range, redhib: redhib.map(([id, p]) => ({id, name: HOME_LIB[id].name, label: label[id] || HOME_LIB[id].name, p})), coeur: coeur.map(([id, p]) => ({id, name: HOME_LIB[id].name, label: label[id] || HOME_LIB[id].name, p})), malus, bonus};
}

/* ---------- Onglet Annonces ---------- */
const LSTAT = {nouvelle: "À trier", gardee: "Gardée", visite: "Visite prévue", ecartee: "Écartée"};
let lui = {filter: "atrier", sort: "reco", openId: null};
const isKept = f => f.status === "gardee" || f.status === "visite";
const ICO = {
  keep: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/></svg>',
  drop: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  visit: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>',
  back: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 7 4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 0 12"/></svg>'
};
function setStatus(f, st, after) {
  const prev = f.status || "nouvelle";
  if (prev === st) return;
  f.status = st; f.updatedAt = Date.now(); learnMemo.key = null; save(); renderListingPins();
  if (after) after(); else renderListings();
  toast({gardee: "Annonce gardée", visite: "Visite prévue", ecartee: "Annonce écartée", nouvelle: "Annonce remise à trier"}[st], {label: "Annuler", fn: () => { f.status = prev; f.updatedAt = Date.now(); learnMemo.key = null; save(); renderListingPins(); renderListings(); }});
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
function renderListingsView() {
  const box = $("#annonces"); if (!box) return;
  if (lui.openId && listings().some(x => x.id === lui.openId)) return renderListingDetail(lui.openId);
  const all = modeListings().map(f => ({f, s: scoreListing(f)}));
  if (!["atrier", "gardees", "ecartees"].includes(lui.filter)) lui.filter = "atrier";
  if (!["reco", "match", "prix", "recent"].includes(lui.sort)) lui.sort = "reco";
  const shown = all.filter(({f}) => lui.filter === "gardees" ? isKept(f) : lui.filter === "ecartees" ? f.status === "ecartee" : !isKept(f) && f.status !== "ecartee")
    .sort((a, b) => (!!a.f.gone - !!b.f.gone) || (lui.sort === "prix" ? (a.f.price ?? 1e12) - (b.f.price ?? 1e12) : lui.sort === "recent" ? (b.f.addedAt || 0) - (a.f.addedAt || 0) : lui.sort === "match" ? (b.s.total ?? -1) - (a.s.total ?? -1) : recoScore(b) - recoScore(a)));
  const counts = {atrier: all.filter(x => !isKept(x.f) && x.f.status !== "ecartee").length, gardees: all.filter(x => isKept(x.f)).length, ecartees: all.filter(x => x.f.status === "ecartee").length};
  box.innerHTML = `
    <div class="ann__head">
      <div>${modeSelHTML("ann__mode")}<h1>${projet() === "deux" ? (isRent() ? "Locations" : "Achats") : "Annonces"}</h1><p class="lead">${all.length ? (counts.atrier ? `${plural(counts.atrier, "annonce à trier", "annonces à trier")}.` : "Tout est trié.") : ""}</p></div>
      <button class="btn btn--primary" type="button" id="addListing">+ Ajouter une annonce</button>
    </div>
    ${all.length ? `<div class="ann__bar">
      <div class="seg seg--sm" role="group" aria-label="Filtrer">${[["atrier", "À trier"], ["gardees", "Gardées"], ["ecartees", "Écartées"]].map(([k, l]) => `<button type="button" data-f="${k}" aria-pressed="${lui.filter === k}">${l}<span class="num">${counts[k]}</span></button>`).join("")}</div>
      <label class="ann__sort">Trier par <select id="lsort">${[["reco", "Recommandé"], ["match", "Note"], ["prix", "Prix"], ["recent", "Ajout récent"]].map(([v, l]) => `<option value="${v}" ${lui.sort === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    </div>` : ""}
    ${(() => { const other = projet() === "deux" ? 0 : listings().filter(f => kindOf(f) !== curMode()).length; return other ? `<p class="hint2 ann__other">${plural(other, curMode() === "achat" ? "annonce de location masquée" : "annonce de vente masquée", curMode() === "achat" ? "annonces de location masquées" : "annonces de vente masquées")} : votre projet est ${curMode() === "achat" ? "l’achat" : "la location"}. <button class="link" type="button" id="addOther">Ajouter ${curMode() === "achat" ? "la location" : "l’achat"} à mon projet</button></p>` : ""; })()}
    ${all.length ? `<div class="ann__feed">${shown.map(({f, s}, k) => heroHTML(f, s, k)).join("") || `<p class="hint2 ann__none">${lui.filter === "gardees" ? "Aucune annonce gardée : touchez le cœur d’une annonce pour la garder." : lui.filter === "ecartees" ? "Aucune annonce écartée." : "Rien à trier."}</p>`}</div>` : ""}
    ${all.length ? "" : `<div class="ann__empty">${GALETS}<p>Vos annonces apparaîtront ici, notées et placées sur la carte.</p></div>`}`;
  $("#addListing").onclick = () => openAddFlow();
  $$("[data-f]", box).forEach(b => b.onclick = () => { lui.filter = b.dataset.f; renderListings(); });
  const so = $("#lsort"); if (so) so.onchange = e => { lui.sort = e.target.value; renderListings(); };
  $$(".hero", box).forEach(card => {
    bindSwipe(card);
    card.onclick = e => {
      if (e.target.closest("[data-hst]") || card.dataset.dragged) return;
      const vw = $("#view-annonces"); lui.listScroll = vw.scrollTop;
      morph([[card.querySelector(".hero__ph"), "lph"], [card.querySelector(".hero__s"), "lsc"]],
        () => { lui.openId = card.dataset.id; renderListings(); vw.scrollTop = 0; },
        () => [[$(".ldet .lgal"), "lph"], [$(".ldet__score b"), "lsc"]]);
    };
    $$("[data-hst]", card).forEach(b => b.onclick = () => {
      const f = listings().find(x => x.id === card.dataset.id); if (!f) return;
      let st = b.dataset.hst; if (st === "visite") st = f.status === "visite" ? "gardee" : "visite";
      const stays = (st === "visite" || st === "gardee") && lui.filter === "gardees";
      if (stays || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setStatus(f, st);
      card.style.height = card.offsetHeight + "px"; card.classList.add(st === "ecartee" ? "hero--out-l" : "hero--out-r");
      setTimeout(() => setStatus(f, st), 260);
    });
  });
  const first = $(".hero", box); if (first) countUp(first);
  bindModeSel(box);
  const ao = $("#addOther", box); if (ao) ao.onclick = () => { const h = homeProfile(), k = curMode() === "achat" ? "location" : "achat"; h.projet = "deux"; if (h.setup) h.setup.projet = "deux"; save(); setMode(k); toast(k === "location" ? "Location ajoutée à votre projet" : "Achat ajouté à votre projet"); };
  if (cloud.user && cloud.alert === undefined && !cloud.noInbox) { cloud.alert = null; loadAlertState().then(() => { if (currentTab === "annonces" && !lui.openId) renderListings(); }); }
}
/* Recommandé : la note, plus un bonus pour les annonces récentes (qui s'efface en deux à trois semaines), hors critères en dernier */
function recoScore({f, s}) {
  const days = Math.max(0, (Date.now() - (f.addedAt || f.firstSeen || 0)) / 864e5);
  return (s.total ?? 45) + 14 * Math.exp(-days / 6) - (s.fails.length ? 25 : 0) + (f.dropped ? 3 : 0);
}
/* Fiabilité : signaux d'annonce douteuse (à vérifier, pas un verdict) */
function trustSignals(f, s) {
  const risk = [...(f.scam || [])];
  if (s.ecart != null && s.ecart <= (kindOf(f) === "location" ? -0.3 : -0.35)) risk.unshift(`prix ${Math.round(-s.ecart * 100)} % sous le marché`);
  // une photo reprise par une seule autre annonce (une image présente partout est un visuel par défaut du site)
  const all = listings(), shared = (f.photos || []).some(u => { const w = all.filter(x => x.id !== f.id && (x.photos || []).includes(u)); return w.length === 1 && !sameListing(w[0], f); });
  if (shared) risk.push("mêmes photos qu’une autre annonce");
  return {risk, photo: f.aiPhoto || [], level: risk.length > 1 || (f.scam || []).length ? "fort" : risk.length ? "moyen" : null};
}
/* Glisser une carte au doigt : à droite pour garder, à gauche pour écarter ; une pichenette suffit, un petit geste revient en place */
function bindSwipe(card) {
  if (!matchMedia("(pointer: coarse)").matches || !card.querySelector(".hero__keep")) return;
  let d = null;
  card.addEventListener("pointerdown", e => { if (!e.isPrimary || e.target.closest("button, a")) return; d = {x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, on: false, dx: 0}; });
  card.addEventListener("pointermove", e => {
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.on) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { d = null; return; }   // défilement vertical : la page garde la main
      if (Math.abs(dx) < 10) return;
      d.on = true; card.classList.add("hero--drag"); try { card.setPointerCapture(e.pointerId); } catch (err) {}
      d.tag = document.createElement("span"); d.tag.className = "hero__swipe"; card.appendChild(d.tag);
    }
    d.dx = dx; card.style.transform = `translateX(${dx}px) rotate(${dx / 45}deg)`;
    card.dataset.swipe = dx > 50 ? "keep" : dx < -50 ? "drop" : "";
    const lab = dx > 0 ? card.querySelector(".hero__keep").textContent.trim() : card.querySelector(".hero__drop").textContent.trim();
    if (d.tag.textContent !== lab) d.tag.textContent = lab;
    d.tag.className = "hero__swipe hero__swipe--" + (dx > 0 ? "keep" : "drop"); d.tag.style.opacity = Math.min(1, Math.abs(dx) / 90);
  });
  const end = e => {
    if (!d || e.pointerId !== d.id) return;
    const g = d; d = null; if (!g.on) return;
    card.dataset.dragged = "1"; setTimeout(() => delete card.dataset.dragged, 400);
    card.classList.remove("hero--drag"); delete card.dataset.swipe; if (g.tag) g.tag.remove();
    const v = Math.abs(g.dx) / Math.max(1, performance.now() - g.t), sign = Math.sign(g.dx);
    const btn = (Math.abs(g.dx) > card.offsetWidth * 0.32 || (v > 0.5 && Math.abs(g.dx) > 40)) && card.querySelector(sign > 0 ? ".hero__keep" : ".hero__drop");
    if (!btn) { card.style.transform = ""; return; }
    card.style.transform = `translateX(${sign * 110}%) rotate(${sign * 7}deg)`; card.style.opacity = "0";
    btn.click();
  };
  card.addEventListener("pointerup", end); card.addEventListener("pointercancel", end);
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
  if (k === 0 && lui.sort === "reco" && lui.filter === "atrier" && s.total != null) return "Recommandée";
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
function heroHTML(f, s, k = 0) {
  const ph = f.photos && f.photos[0], why = s.fails.length ? s.fails.slice(0, 1).map(x => "Hors critères : " + x).concat(s.plus.slice(0, 2)) : s.plus.slice(0, 3);
  const acts = lui.filter === "gardees"
    ? `<button class="chip hero__drop" type="button" data-hst="ecartee">${ICO.drop}Écarter</button><button class="chip hero__keep" type="button" data-hst="visite" aria-pressed="${f.status === "visite"}">${ICO.visit}${f.status === "visite" ? "Visite prévue" : "Prévoir la visite"}</button>`
    : lui.filter === "ecartees"
    ? `<button class="chip hero__drop" type="button" data-hst="nouvelle">${ICO.back}Remettre à trier</button><button class="chip hero__keep" type="button" data-hst="gardee">${ICO.keep}Garder</button>`
    : `<button class="chip hero__drop" type="button" data-hst="ecartee">${ICO.drop}Écarter</button><button class="chip hero__keep" type="button" data-hst="gardee">${ICO.keep}Garder</button>`;
  return `<article class="hero${ph ? "" : " hero--nophoto"}${f.gone || f.status === "ecartee" ? " hero--off" : ""}${s.fails.length ? " hero--fail" : ""}" data-id="${f.id}" style="--c:${colorFor(s.total)}">
    <div class="hero__ph">${ph ? `<img src="${esc(ph)}" alt="" loading="${k < 2 ? "eager" : "lazy"}" referrerpolicy="no-referrer" onerror="this.remove()">` : GALETS}</div>
    <b class="hero__s num"${k === 0 && s.total != null ? ` data-count="${s.total}"` : ""}>${s.total ?? "–"}</b>
    <div class="hero__b">
      <span class="hero__k">${esc(heroKicker(f, s, k))}</span>
      <h2${(f.title || listingTitle(f)).length > 70 ? ' class="is-long"' : ""}>${esc(f.title || listingTitle(f))}</h2>
      <p class="hero__p num">${f.price ? priceTxt(f) : kindOf(f) === "location" ? "Loyer ?" : "Prix ?"}${s.ppm ? `<small>${ppmTxt(f)}</small>` : ""}</p>
      ${why.length ? `<ul class="hero__why">${why.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p class="hero__why hero__why--none">${f.lat ? "À compléter" : placeQ.tried.has(f.id) ? "Lieu introuvable : ouvrez-la pour le préciser" : "Placement sur la carte…"}</p>`}
      <div class="hero__acts">${acts}</div>
    </div>
  </article>`;
}
function renderListingDetail(id) { setTimeout(() => tipsKick(), 0);
  const f = listings().find(x => x.id === id), box = $("#annonces"); if (!f) { lui.openId = null; return renderListings(); }
  const s = scoreListing(f), h = homeProfile();
  const bar = (label, val, hint) => `<div class="mbar"><span>${label}</span><span class="bar"><i style="width:${val ?? 0}%;--c:${traitFor(val)}"></i></span><b class="num">${val ?? "–"}</b>${hint ? `<small>${hint}</small>` : ""}</div>`;
  const crits = Object.entries(homeWeights()).filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]);
  box.innerHTML = `
    <div class="ldet__top"><button class="link ann__back" type="button" id="lback">‹ Toutes les annonces</button><button class="x x--del" type="button" id="ldel" aria-label="Supprimer l’annonce" title="Supprimer"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg></button></div>
    ${f.photos && f.photos.length ? `<div class="lgal">${f.photos.map(u => `<img src="${esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`).join("")}</div>` : ""}
    <div class="ldet__head">
      <div><h1${(f.title || listingTitle(f)).length > 70 ? ' class="is-long"' : ""}>${esc(f.title || listingTitle(f))}</h1>
        <p class="ldet__price num">${f.price ? priceTxt(f) : kindOf(f) === "location" ? "Loyer non trouvé" : "Prix non trouvé"}${s.ppm ? ` <small>${ppmTxt(f)}</small>` : ""}</p>
        ${f.priceHistory && f.priceHistory.length ? `<p class="ldet__hist num">${f.priceHistory.map(x => `<s>${fmtInt(x.price)}&#8239;€</s>`).join(" ")} ${f.dropped ? "<em class=\"drop\">Baisse de prix</em>" : ""}</p>` : ""}
        <p class="hint2">${esc([...(f.sources || [f.source]).filter(Boolean)].join(", "))}${f.source || f.sources ? ", " : ""}${f.origin === "alerte" ? "reçue par alerte le" : "ajoutée le"} ${esc(fmtDate(new Date(f.firstSeen || f.addedAt || Date.now()).toISOString().slice(0, 10)))}</p></div>
      <div class="ldet__score" style="--c:${colorFor(s.total)}"><b class="num" ${s.total != null ? `data-count="${s.total}"` : ""}>${s.total ?? "–"}</b><span>${s.hasFix ? `corrigée${s.heden != null && s.heden !== s.total ? ` · Heden&nbsp;${s.heden}` : ""}` : "note"}</span>${s.range ? `<span class="ldet__rng num" title="Fourchette tant que l’annonce ne dit pas tout">${s.range[0]} à ${s.range[1]}</span>` : ""}${(() => { const others = modeListings().filter(x => x.id !== f.id && x.status !== "ecartee").map(x => scoreListing(x).total).filter(v => v != null); if (others.length < 3 || s.total == null) return ""; const pct = Math.round(others.filter(v => v < s.total).length / others.length * 100); return `<span class="ldet__pct">${pct >= 50 ? `mieux que ${pct} %` : `moins bien que ${100 - pct} %`} de vos annonces</span>`; })()}</div>
    </div>
    <div class="lstat">
      <button class="lst lst--keep" type="button" data-st="gardee" aria-pressed="${isKept(f)}">${ICO.keep}<span>${isKept(f) ? "Gardée" : "Garder"}</span></button>
      <button class="lst lst--drop" type="button" data-st="ecartee" aria-pressed="${f.status === "ecartee"}">${ICO.drop}<span>${f.status === "ecartee" ? "Écartée" : "Écarter"}</span></button>
    </div>
    <div class="lact">
      ${isKept(f) ? `<button class="chip chip--sm" type="button" data-st="visite" aria-pressed="${f.status === "visite"}">${ICO.visit}Visite prévue</button>` : ""}
      ${cleanWeb(f.url) ? `<a class="chip chip--sm" href="${esc(cleanWeb(f.url))}" target="_blank" rel="noopener noreferrer">Voir l’annonce ↗</a>` : ""}
    </div>
    ${s.fails.length ? `<div class="banner banner--alerte">Hors de vos critères : ${esc(s.fails.join(", "))}.</div>` : ""}
    ${trustHTML(trustSignals(f, s))}
    <div class="feel" role="group" aria-label="Votre avis sur la note"><span>Cette note vous semble</span>${[["juste", "Juste"], ["haut", "Trop haute"], ["bas", "Trop basse"]].map(([k, l]) => `<button class="chip chip--sm" type="button" data-feel="${k}" aria-pressed="${!!(f.feel && f.feel.v === k)}">${l}</button>`).join("")}
      ${f.feel && f.feel.v !== "juste" ? `<p class="feel__next">Noté. Une info mal lue ? <button class="link" type="button" id="feelFix">Corrigez-la</button>.</p>` : ""}</div>
    ${freshHTML(f)}
    ${contactHTML(f)}
    <section class="lsec">
      <div class="lsec__head"><h2>Pourquoi ce score</h2><button class="btn btn--sm btn--clair" type="button" id="lfix">${s.hasFix ? "Revoir mes corrections" : "Corriger la note"}</button></div>
      ${s.fixTotal ? `<p class="banner">Note fixée à ${s.total} par ${f.fix.by && cloud.user && f.fix.by !== cloud.user.id ? esc(personName(f.fix.by)) : "vous"}. Le détail ci-dessous reste celui de l’analyse${s.heden != null ? `, qui donne ${s.heden}` : ""}.</p>` : ""}
      ${bar("Logement", s.logement, `compte pour ${h.mix.logement} %${s.cover < .999 ? `, ${Math.round(s.cover * 100)} % des critères connus` : ""}`)}
      ${bar("Quartier", s.quartier, s.fixQuartier ? "corrigé" : s.partial ? `estimé, sans ${esc((s.partial.missing || []).slice(0, 3).join(", ") || "vos critères de terrain")}` : s.area ? (s.area.zone ? (s.area.how === "dans" ? "dans « " + esc(s.area.zone.name) + " »" : "près de « " + esc(s.area.zone.name) + " »") : "estimé") : "lieu inconnu")}
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
        ["DPE", f.dpe], ["Charges", f.charges && fmtInt(f.charges) + " € par an"], ["Taxe foncière", f.taxe && fmtInt(f.taxe) + " €"], ["Lieu", [f.metro && "métro " + f.metro, f.quartier, f.postcode, f.city].filter(Boolean).join(", ") + (f.lat && !f.precise ? " (position approximative)" : "")]]
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
  $("#lfix").onclick = () => openScoreFix(f);
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
  const crits = Object.entries(homeWeights()).filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const preview = () => { const sv = f.fix; f.fix = fx; const r = scoreListing(f); f.fix = sv; return r; };
  const scale = (key, cur, est) => `<div class="scale" data-k="${key}">${[0, 1, 2, 3, 4, 5].map(n => `<button type="button" data-v="${n}" aria-pressed="${cur != null && Math.round(cur) === n}" class="${cur == null && est === n ? "is-est" : cur != null && est === n && Math.round(cur) !== n ? "est-mark" : ""}" style="--c:${colorFor(n * 20)}">${n}</button>`).join("")}</div>`;
  const draw = () => {
    const r = preview(), qa = raw.quartier != null ? Math.round(raw.quartier / 20) : null;
    card.innerHTML = `<div class="auth__head"><h2 id="lsTitle">Corriger la note</h2><button class="x" type="button" data-lclose aria-label="Fermer"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
      <div class="fixsum"><b class="fixsum__s num" style="--c:${colorFor(r.total)}">${r.total ?? "–"}</b><span><b>${r.hasFix ? "Avec vos corrections" : "Analyse de Heden"}</b><small>${r.hasFix && raw.total != null ? `Heden seul : ${raw.total}.` : ""}${isShared() ? " Vaut aussi pour votre binôme." : ""}</small></span></div>
      <section class="fixsec"><h3>Le logement</h3><p class="hint2">En pointillés : la lecture de Heden.</p>
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

/* ---------- Ajouter ou corriger une annonce ---------- */
const FIELDS = [["price", "Prix", "num", "€"], ["surface", "Surface", "num", "m²"], ["rooms", "Pièces", "num"], ["bedrooms", "Chambres", "num"], ["floor", "Étage (0 = RDC)", "num"],
  ["elevator", "Ascenseur", "bool"], ["outdoor", "Extérieur", "sel", ["", "balcon", "loggia", "terrasse", "jardin"]], ["dpe", "DPE", "sel", ["", ..."ABCDEFG"]], ["charges", "Charges par an", "num", "€"],
  ["works", "État", "sel", ["", "neuf", "bon", "rafraichir", "travaux"]], ["quiet", "Au calme, sur cour", "bool"], ["traversant", "Traversant", "bool"], ["bright", "Lumineux", "bool"],
  ["cave", "Cave", "bool"], ["parking", "Parking", "bool"], ["view", "Vue dégagée", "bool"], ["postcode", "Code postal", "txt"], ["metro", "Métro le plus proche", "txt"],
  ["seller", "Vendu par", "sel", ["", "agence", "particulier"]], ["agencyName", "Agence", "txt"], ["agencyPhone", "Téléphone", "txt"], ["agencyEmail", "E-mail", "txt"], ["agencyUrl", "Site de l’agence", "txt"], ["agencyAddress", "Adresse de l’agence", "txt"], ["ref", "Référence de l’annonce", "txt"]];
const FIELDS_LOC = [["rentHC", "Loyer hors charges", "num", "€ par mois"], ["rentCharges", "Dont charges", "num", "€ par mois"], ["furnished", "Meublé ou vide", "sel", ["", "true", "false"]],
  ["deposit", "Dépôt de garantie", "num", "€"], ["agencyFee", "Frais d’agence", "num", "€"], ["available", "Disponible", "txt"], ["epoque", "Construction", "sel", ["", "a", "b", "c", "d"]],
  ["refMaj", "Loyer de référence majoré", "num", "€/m²"], ["complement", "Complément de loyer", "num", "€ par mois"]];
function fieldsFor(f) {
  const loc = kindOf(f) === "location";
  let F = FIELDS.map(x => x[0] === "price" ? ["price", loc ? "Loyer charges comprises" : "Prix", "num", loc ? "€ par mois" : "€"] : x);
  if (loc) F = F.filter(x => x[0] !== "charges" && x[0] !== "taxe").concat(FIELDS_LOC);
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
    card.innerHTML = `<div class="auth__head"><h2 id="lsTitle">${existing ? "Corriger l’annonce" : "Vérifier l’annonce"}</h2>${close}</div>
      <p class="auth__txt">${existing ? "Corrigez ce que l’annonce ne disait pas." : `Heden a trouvé ${Object.keys(f.found || {}).filter(k => k !== "kind" && fieldsFor(f).some(x => x[0] === k)).length} informations. Complétez ou corrigez avant d’enregistrer.`}</p>
      <form class="lform" id="lform">
        ${fieldsFor(f).map(([k, label, type, opt]) => {
          const v = k === "kind" ? (kindOf(f) === "location" ? "location" : "vente") : f[k], tag = f.found && f.found[k] && k !== "kind" ? ` <em>trouvé</em>` : "";
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
      if (!existing && !(await kindAllowed(kindOf(f)))) return;
      const b = $("#lsave"); b.disabled = true; b.textContent = "Placement sur la carte…";
      const moved = existing && (existing.postcode !== f.postcode || existing.metro !== f.metro);
      if (moved && !f.precise) { f.lat = f.lng = null; f.est = null; }
      await placeListing(f); f.updatedAt = Date.now();
      if (existing) Object.assign(existing, f);
      else { f.id = zoneId(); f.status = "nouvelle"; f.addedAt = f.firstSeen = Date.now(); f.origin = "manuel"; f.mapId = cloud.user ? cloud.mapId : null; f.createdBy = cloud.user ? cloud.user.id : null; listings().unshift(f); lui.openId = f.id; }
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
(function listenImport() {
  let done = false;
  const use = d => {
    if (done || !d) return; done = true;
    const safe = {url: String(d.url || "").slice(0, 2000), title: String(d.title || "").slice(0, 300), text: String(d.text || "").slice(0, 40000),
      meta: typeof d.meta === "object" && d.meta ? d.meta : {}, ld: Array.isArray(d.ld) ? d.ld.map(x => String(x).slice(0, 60000)).slice(0, 8) : [], imgs: Array.isArray(d.imgs) ? d.imgs.map(String).slice(0, 12) : []};
    const hi = d.hints && typeof d.hints === "object" ? d.hints : {}, arr = (a, n, len) => Array.isArray(a) ? a.slice(0, n).map(x => String(x).slice(0, len)) : [];
    safe.hints = {tels: arr(hi.tels, 6, 100), mails: arr(hi.mails, 4, 120), state: arr(hi.state, 24, 1600)};
    try { localStorage.setItem("heden.bmk", "1"); } catch (e) {}
    const items = Array.isArray(d.items) ? d.items.slice(0, 80).map(c => ({url: String(c.url || "").slice(0, 2000), img: String(c.img || "").slice(0, 2000), imgs: Array.isArray(c.imgs) ? c.imgs.slice(0, 12).map(x => String(x).slice(0, 2000)) : [], text: String(c.text || "").slice(0, 1200)})) : [];
    setTab("annonces");
    if (items.length >= 3 && !isDetailUrl(safe.url)) return openBatchImport(items, safe.url, (+d.v || 0) < 4);
    const p = parseListing(safe), ex = listings().find(x => sameListing(x, p));
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
