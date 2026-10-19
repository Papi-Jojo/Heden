"""Refonte Heden : applique la nouvelle direction (amande, café, galets) à index.html -> fichier cible."""
import sys
import os
SP = os.path.dirname(os.path.abspath(__file__)) + "/"
src, dst = sys.argv[1], sys.argv[2]
s = open(src).read()
def rep(a, b, c=1):
    global s
    n = s.count(a)
    assert n == c, (n, a[:100])
    s = s.replace(a, b)

# 1. tête : polices, couleurs du navigateur, icône
rep('family=Archivo:wdth,wght@62..125,400..800&family=Figtree', 'family=Fraunces:opsz,wght,SOFT,WONK@9..144,300..900,0..100,0..1&family=Archivo:wdth,wght@62..125,400..800&family=Figtree')
rep('<meta name="theme-color" content="#F8F5F0" media="(prefers-color-scheme: light)">', '<meta name="theme-color" content="#F8F2EC" media="(prefers-color-scheme: light)">')
rep('<meta name="theme-color" content="#221F1B" media="(prefers-color-scheme: dark)">', '<meta name="theme-color" content="#271D16" media="(prefers-color-scheme: dark)">')
i = s.index('<link rel="icon" href="data:image/svg+xml,'); j = s.index('>', i)
s = s[:i] + """<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cpath d='M32 5c4 0 7.5 1.6 18 7.7 9.6 5.6 10.8 8.4 10.8 19.3s-1.2 13.7-10.8 19.3C39.5 57.4 36 59 32 59s-7.5-1.6-18-7.7C4.4 45.7 3.2 42.9 3.2 32s1.2-13.7 10.8-19.3C24.5 6.6 28 5 32 5z' fill='%233B2A1E'/%3E%3Cpath d='M35.2 36.4c2.9-4.2 9.7-5.3 13.4-2 3.3 3 2.6 8.7-1.3 11.6-4 3-10 2.9-12.6-.4-2-2.5-1.5-6.4.5-9.2z' fill='%23DDB892'/%3E%3Cpath d='M17.5 22.8c1.8-4.6 7.9-6.5 12-4.6 3.7 1.7 4.5 6.5 2.2 9.9-2.6 3.9-8.1 5.2-11.8 3.4-2.8-1.4-3.5-5.1-2.4-8.7z' fill='%23F8F2EC'/%3E%3C/svg%3E">""" + s[j+1:]

# 2. styles de la refonte, après les styles existants
css = open(SP + "refonte.css").read()
rep('@media (prefers-reduced-motion: reduce){*{transition:none!important;animation:none!important}}\n</style>',
    '#map,.leaflet-container{background:#EEE4D9}\n' + css + '\n@media (prefers-reduced-motion: reduce){*{transition:none!important;animation:none!important}}\n</style>')

# 3. logo : un îlot de galets
i = s.index('<div class="brand">'); j = s.index('<b>heden</b>', i)
s = s[:i] + '''<div class="brand">
      <svg viewBox="0 0 64 64" aria-hidden="true"><path class="lg" d="M32 5c4 0 7.5 1.6 18 7.7 9.6 5.6 10.8 8.4 10.8 19.3s-1.2 13.7-10.8 19.3C39.5 57.4 36 59 32 59s-7.5-1.6-18-7.7C4.4 45.7 3.2 42.9 3.2 32s1.2-13.7 10.8-19.3C24.5 6.6 28 5 32 5z" style="fill:var(--ardoise)"/><path class="lg" d="M17.5 22.8c1.8-4.6 7.9-6.5 12-4.6 3.7 1.7 4.5 6.5 2.2 9.9-2.6 3.9-8.1 5.2-11.8 3.4-2.8-1.4-3.5-5.1-2.4-8.7z" style="fill:var(--pierre)"/><path class="lg" d="M37.4 16.9c3.6-1.6 9 .4 10.4 4.3 1.2 3.4-1.4 6.6-5.1 7.2-3.9.6-7.6-1.4-8.3-4.6-.6-2.8.4-5.6 3-6.9z" style="fill:var(--pierre)"/><path class="lg" d="M16.8 39.6c.9-3.6 5.4-5.7 9-4.3 3.9 1.5 5.3 6.4 3.3 9.8-1.8 3.1-6.2 4-9.3 2.2-2.6-1.5-3.7-4.6-3-7.7z" style="fill:var(--pierre)"/><path class="lg" d="M35.2 36.4c2.9-4.2 9.7-5.3 13.4-2 3.3 3 2.6 8.7-1.3 11.6-4 3-10 2.9-12.6-.4-2-2.5-1.5-6.4.5-9.2z" style="fill:var(--bourgeon)"/></svg>
      ''' + s[j:]

# 4. échelle des notes accordée à la palette
rep('const STOPS = [[0,[217,120,95]],[25,[226,148,85]],[50,[226,182,84]],[75,[169,186,104]],[100,[118,180,154]]];',
    'const STOPS = [[0,[224,142,114]],[25,[231,166,108]],[50,[224,192,104]],[75,[182,198,108]],[100,[124,176,108]]];')
rep('const TRAIT_JOUR = [[0,[158,58,39]],[25,[154,77,27]],[50,[125,94,14]],[75,[85,112,46]],[100,[38,97,79]]];',
    'const TRAIT_JOUR = [[0,[150,62,40]],[25,[148,84,34]],[50,[122,98,22]],[75,[84,108,40]],[100,[44,92,46]]];')
rep('const TRAIT_NUIT = [[0,[230,139,115]],[25,[235,162,106]],[50,[230,194,107]],[75,[183,201,123]],[100,[140,199,174]]];',
    'const TRAIT_NUIT = [[0,[232,146,118]],[25,[236,170,112]],[50,[232,204,114]],[75,[198,214,120]],[100,[150,204,128]]];')
# 5. fond de carte amande
rep('const MAPTONES = {fond: "#F3EEE5", rue: "#FFFDF9", bord: "#E2DACD", bati: "#E6DFD3", eau: "#CCD7E0", vert: "#DCE3CD", libelle: "#6B655D", halo: "#F7F3EC", limite: "#C3B9AC"};',
    'const MAPTONES = {fond: "#EEE4D9", rue: "#FAF5EF", bord: "#DCCBB9", bati: "#E5D7C8", eau: "#C9D2D8", vert: "#DDD6C1", libelle: "#664530", halo: "#F5EEE6", limite: "#BFA58C"};')

# 6. zones dessinées en formes souples (lissage d'affichage, les points restent ceux tracés)
rep('''function renderZones() {
  zoneLayer.clearLayers();''', '''/* Lissage de Chaikin : les angles du tracé deviennent des courbes, pour l'affichage seulement */
function smoothRing(pts, it = 3) {
  if (!Array.isArray(pts) || pts.length < 3 || pts.length > 400) return pts;
  let r = pts;
  for (let k = 0; k < it; k++) {
    const o = [];
    for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; o.push([a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25], [a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75]); }
    r = o;
  }
  return r;
}
let justSaved = null;
function renderZones() {
  zoneLayer.clearLayers();''')
rep('''    const circle = L.polygon(z.points, {
      color: traitMap(score), weight: selectedId === z.id ? 3 : 2, opacity: 1,''', '''    const circle = L.polygon(smoothRing(z.points), {
      color: traitMap(score), weight: selectedId === z.id ? 3 : 2, opacity: 1, className: justSaved === z.id ? "zone-new" : "",''')
rep('''    circle.addTo(zoneLayer); badge.addTo(zoneLayer);
  }
}''', '''    circle.addTo(zoneLayer); badge.addTo(zoneLayer);
    if (justSaved === z.id && circle._path && circle._path.getTotalLength) circle._path.style.setProperty("--len", Math.ceil(circle._path.getTotalLength()));
  }
}''')
rep('''  selectedId = z.id; ui.mode = "detail";
  renderZones(); renderPanel();''', '''  selectedId = z.id; ui.mode = "detail";
  justSaved = z.id; setTimeout(() => { if (justSaved === z.id) justSaved = null; }, 1600);
  renderZones(); renderPanel();''')

# 7. transitions d'onglets
rep('''  if (t === "map") { setTimeout(() => map.invalidateSize(), 0); renderZones(); renderPanel(); renderListingPins(); }
  else if (t === "annonces") renderListings();
  else renderProfile();''', '''  if (t === "map") { setTimeout(() => map.invalidateSize(), 0); renderZones(); renderPanel(); renderListingPins(); }
  else if (t === "annonces") renderListings();
  else renderProfile();
  const vw = t === "annonces" ? $("#view-annonces") : t === "profile" ? $("#view-profile") : null;
  if (vw) { vw.classList.remove("view--in"); void vw.offsetWidth; vw.classList.add("view--in"); }''')

# 8. galets décoratifs pour les écrans vides
GALETS = '''const GALETS = `<svg class="galets" viewBox="0 0 120 92" aria-hidden="true"><path class="g1" d="M14 50c2-14 18-24 33-20 13 4 18 18 11 29-7 12-25 17-37 11-6-3-8-12-7-20z"/><path class="g2" d="M62 22c6-9 21-11 29-4 7 6 5 17-3 22-9 6-22 5-27-2-3-5-2-11 1-16z"/><path class="g3" d="M70 58c5-8 18-10 26-4 7 6 6 16-2 21-8 6-21 5-25-2-3-4-2-10 1-15z"/><path class="g4" d="M38 12c3-6 12-8 17-4 4 3 4 10-1 13-5 4-13 3-16-1-2-2-1-6 0-8z"/></svg>`;
'''
rep('const HEART = ', GALETS + 'const HEART = ')
rep('''        <div class="empty">
          <ol>
            <li><span>Répondez aux six questions''', '''        <div class="empty">
          ${GALETS}
          <ol>
            <li><span>Répondez aux six questions''')

# 9. chiffres qui comptent jusqu'à leur valeur
rep('function setTab(t) {', '''function countUp(root = document) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  $$("[data-count]", root).forEach(el => {
    const to = +el.dataset.count; el.removeAttribute("data-count");
    if (reduce || !isFinite(to) || to <= 0) return;
    const t0 = performance.now(), d = 520;
    const step = t => { const k = Math.min(1, (t - t0) / d), e = 1 - Math.pow(1 - k, 3); el.textContent = Math.round(to * e); if (k < 1) requestAnimationFrame(step); };
    el.textContent = "0"; requestAnimationFrame(step);
  });
}
function setTab(t) {''')
rep('''        <div class="big ${big.score == null ? "none" : ""}" style="--c:${colorFor(big.score)}">${big.score == null ? "–" : big.score}</div>''',
    '''        <div class="big ${big.score == null ? "none" : ""}" style="--c:${colorFor(big.score)}" ${big.score != null ? `data-count="${big.score}"` : ""}>${big.score == null ? "–" : big.score}</div>''')
rep('''      <div class="ldet__score" style="--c:${colorFor(s.total)}"><b class="num">${s.total ?? "–"}</b><span>correspondance</span></div>''',
    '''      <div class="ldet__score" style="--c:${colorFor(s.total)}"><b class="num" ${s.total != null ? `data-count="${s.total}"` : ""}>${s.total ?? "–"}</b><span>correspondance</span></div>''')
rep('''  $("#lback").onclick = () => { lui.openId = null; renderListings(); };
  paintFair(f);''', '''  $("#lback").onclick = () => { lui.openId = null; renderListings(); };
  countUp(box);
  paintFair(f);''')

# 10. annonce vedette en tête de liste
rep('''  const counts = {actives:''', '''  const best = lui.filter === "actives" && lui.sort === "match" ? shown.find(x => x.s.total != null && !x.s.fails.length && x.f.status !== "ecartee") : null;
  const counts = {actives:''')
rep('''    ${all.length ? `<div class="ann__list">
      ${shown.map(({f, s}) =>''', '''    ${best ? heroHTML(best.f, best.s) : ""}
    ${all.length ? `<div class="ann__list">
      ${shown.filter(x => x !== best).map(({f, s}) =>''')
rep('''  bindSources();
  if (cloud.user && cloud.alert === undefined''', '''  bindSources();
  const hero = $(".hero", box);
  if (hero) {
    hero.onclick = e => { if (e.target.closest("[data-hst]")) return; lui.openId = hero.dataset.id; renderListings(); $("#view-annonces").scrollTop = 0; };
    $$("[data-hst]", hero).forEach(b => b.onclick = () => { const f = listings().find(x => x.id === hero.dataset.id); if (!f) return; f.status = b.dataset.hst; f.updatedAt = Date.now(); save(); renderListings(); renderListingPins(); toast(f.status === "gardee" ? "Annonce gardée" : "Annonce écartée"); });
    countUp(hero);
  }
  if (cloud.user && cloud.alert === undefined''')
rep('function renderListingDetail(id) {', '''function heroHTML(f, s) {
  const ph = f.photos && f.photos[0];
  return `<article class="hero" data-id="${f.id}" style="--c:${colorFor(s.total)}" aria-label="Meilleure correspondance">
    <div class="hero__ph">${ph ? `<img src="${esc(ph)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : GALETS}</div>
    <b class="hero__s num" data-count="${s.total}">${s.total}</b>
    <div class="hero__b">
      <span class="hero__k">Meilleure correspondance</span>
      <h2>${esc(f.title || listingTitle(f))}</h2>
      <p class="hero__p num">${f.price ? fmtInt(f.price) + "&#8239;€" : ""}${s.ppm ? `<small>${fmtInt(s.ppm)}&#8239;€/m²</small>` : ""}</p>
      ${s.plus.length ? `<ul class="hero__why">${s.plus.slice(0, 3).map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      <div class="hero__acts"><button class="chip" type="button" data-hst="gardee">Garder</button><button class="chip" type="button" data-hst="ecartee">Écarter</button></div>
    </div>
  </article>`;
}
function renderListingDetail(id) {''')

# 11. ouverture : les galets s'assemblent au centre, une fois par session (jamais avec le mouvement réduit)
LOGO = s[s.index('<svg viewBox="0 0 64 64" aria-hidden="true"><path class="lg"'):]
LOGO = LOGO[:LOGO.index('</svg>') + 6]
rep('<body>\n<div id="app">', '''<body>
<div id="splash" aria-hidden="true">''' + LOGO + '''<b>heden</b></div>
<script>try{var sp=document.getElementById("splash");if(sessionStorage.getItem("heden.intro")||matchMedia("(prefers-reduced-motion: reduce)").matches)sp.remove();else{sessionStorage.setItem("heden.intro","1");setTimeout(function(){sp.classList.add("out");setTimeout(function(){sp.remove()},480)},1150)}}catch(e){var s2=document.getElementById("splash");s2&&s2.remove()}</script>
<div id="app">''')
open(dst, "w").write(s)
print("ok", len(s))
