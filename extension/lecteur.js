/* Heden : sur une page immobilière ouverte par l'utilisateur, lit ce qu'elle montre (cartes d'une liste de résultats,
   ou fiche complète d'une annonce) et l'envoie à Heden. Ne charge aucune autre page, ne clique sur rien. */
(() => {
  if (window.top !== window || window.__hedenExt) return; window.__hedenExt = true;
  /*LECTEUR*/
  const vus = new Set(); let tm = null, href = location.href, lectures = 0, lang = "fr", auto = true, coupe = false;
  chrome.storage.local.get({lang: "fr", auto: true}, o => { lang = o.lang === "en" ? "en" : "fr"; auto = o.auto !== false; });
  chrome.storage.onChanged.addListener(c => { if (c.auto) auto = c.auto.newValue !== false; if (c.lang) lang = c.lang.newValue === "en" ? "en" : "fr"; });
  const T = (fr, en) => lang === "en" ? en : fr;
  const pl = (n, fr1, frN, en1, enN) => `${n} ${n > 1 ? T(frN, enN) : T(fr1, en1)}`;

  function lire(force) {
    if ((!auto && !force) || coupe) return;
    const page = location.href.split("#")[0];
    if (!force && isDetailUrl(page) && vus.has(page)) return;
    if (++lectures > 40 && !force) return;                   // page qui bouge sans arrêt : on s'arrête là
    lireMain().then(d => { if (d) envoyer(d, page, force); });
  }
  // lecture dans la page (données JavaScript du site : galerie complète) ; à défaut, lecture du DOM seul
  function lireMain() {
    return new Promise(ok => {
      const n = Math.random().toString(36).slice(2), fin = d => { window.removeEventListener("message", ec); clearTimeout(t); ok(d); };
      const ec = e => { const m = e.data; if (e.source === window && m && m.type === "heden-lu" && m.n === n) fin(m.d && typeof m.d === "object" ? m.d : null); };
      const t = setTimeout(() => { let d = null; try { d = lirePage(X); } catch (er) {} fin(d); }, 2500);
      window.addEventListener("message", ec); window.postMessage({type: "heden-lire", n}, location.origin);
    });
  }
  function envoyer(d, page, force) {
    if (!Array.isArray(d.items)) d.items = [];
    const liste = d.items.length >= 3 && !isDetailUrl(page);
    if (liste) {
      const neuves = d.items.filter(c => c.url && !vus.has(c.url));
      if (!neuves.length && !force) return;
      neuves.forEach(c => vus.add(c.url));
      d.items = force ? d.items : neuves; d.liste = true;
    } else {
      if (vus.has(page) && !force) return;
      vus.add(page); d.items = []; d.liste = false;
    }
    d.ext = 1;
    try { chrome.runtime.sendMessage({type: "page", d}); } catch (e) { coupe = true; }   // extension rechargée : cette page ne parle plus à rien
  }
  const plan = ms => { if (tm) return; tm = setTimeout(() => { tm = null; lire(); }, ms); };   // au plus une lecture toutes les 3 s
  setTimeout(() => lire(), 1800);
  new MutationObserver(() => plan(3000)).observe(document.documentElement, {childList: true, subtree: true});
  setInterval(() => { if (location.href !== href) { href = location.href; lectures = 0; setTimeout(() => lire(), 1500); } }, 1000);

  // page suivante d'une liste de résultats : un lien que l'utilisateur touche lui-même
  function suivante() {
    const a = document.querySelector('a[rel="next"], link[rel="next"]');
    if (a && a.href) return a.href;
    const c = [...document.querySelectorAll("a[href]")].find(x => /^(page )?suivante?\b|^next\b|^›$|^»$/i.test((x.getAttribute("aria-label") || x.textContent || "").trim()));
    return c ? c.href : null;
  }
  let bulleEl = null, bulleT = null;
  function bulle(txt, lien) {
    if (!bulleEl) {
      bulleEl = document.createElement("div"); bulleEl.style.cssText = "all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647";
      const r = bulleEl.attachShadow({mode: "open"});
      r.innerHTML = `<style>
        .b{display:flex;align-items:center;gap:12px;max-width:min(380px,calc(100vw - 32px));padding:12px 14px 12px 12px;border-radius:18px;background:#3B2A1E;color:#F8F2EC;
          font:500 13.5px/18px system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 10px 30px rgba(42,29,20,.28);opacity:0;transform:translateY(8px);transition:opacity .2s,transform .25s}
        .b.on{opacity:1;transform:none}
        .g{flex:none;width:26px;height:22px;border-radius:58% 42% 55% 45%/52% 48% 52% 48%;background:#DDB892}
        .t{flex:1}.t b{display:block;font-weight:700;margin-bottom:1px}
        a{flex:none;color:#3B2A1E;background:#DDB892;border-radius:999px;padding:7px 12px;font-weight:650;text-decoration:none;white-space:nowrap}
        a:hover{background:#E6CCB2}
        @media (prefers-reduced-motion:reduce){.b{transition:none}}
      </style><div class="b" role="status"><span class="g"></span><span class="t"></span></div>`;
      document.documentElement.appendChild(bulleEl);
    }
    const r = bulleEl.shadowRoot, b = r.querySelector(".b");
    r.querySelector(".t").innerHTML = txt;
    const old = r.querySelector("a"); if (old) old.remove();
    if (lien) { const a = document.createElement("a"); a.href = lien; a.textContent = T("Page suivante →", "Next page →"); b.appendChild(a); }
    requestAnimationFrame(() => b.classList.add("on"));
    clearTimeout(bulleT); bulleT = setTimeout(() => b.classList.remove("on"), lien ? 9000 : 5500);
    b.onmouseenter = () => clearTimeout(bulleT); b.onmouseleave = () => { bulleT = setTimeout(() => b.classList.remove("on"), 3000); };
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  let erreurDite = false;
  chrome.runtime.onMessage.addListener(m => {
    if (m.type === "relire") { vus.clear(); lire(true); return; }
    if (m.type !== "ack") return;
    if (m.err) {
      if (erreurDite) return; erreurDite = true;
      return bulle(`<b>Heden</b>${esc(m.err === "connexion" ? T("Connectez-vous dans l’onglet Heden pour envoyer les annonces.", "Sign in in the Heden tab to send listings.")
        : m.err === "base" ? T("La base de Heden n’est pas encore à jour (vivier.sql).", "Heden’s database is not up to date yet (vivier.sql).")
        : m.err === "heden" ? T("L’onglet Heden ne répond pas : rechargez-le.", "The Heden tab is not responding: reload it.")
        : T("Envoi impossible pour l’instant, nouvel essai à la prochaine page.", "Could not send for now; it will retry on the next page."))}`);
    }
    if (m.gone) return bulle(`<b>Heden</b>${esc(T("Annonce retirée du site : elle sort d’Explorer.", "Listing removed from the site: it leaves Explore."))}`);
    if (m.liste) {
      if (!m.n) return;
      const nv = m.nouvelles || 0, next = suivante();
      return bulle(nv ? `<b>${esc(pl(nv, "nouvelle annonce", "nouvelles annonces", "new listing", "new listings"))} ${esc(T("dans Explorer", "in Explore"))}</b>${esc(m.revues ? T(`${m.revues} déjà connue${m.revues > 1 ? "s" : ""}, prix et dates à jour.`, `${m.revues} already known, prices and dates refreshed.`) : T("Envoyées à tout le groupe.", "Shared with the whole group."))}`
        : `<b>${esc(T("Rien de nouveau sur cette page", "Nothing new on this page"))}</b>${esc(T(`${m.revues || m.n} annonces déjà connues, mises à jour. Triée par date, la suite l’est aussi.`, `${m.revues || m.n} listings already known, refreshed. Sorted by date, the next pages are too.`))}`, nv ? next : null);
    }
    if (m.n || m.maj) bulle(`<b>${esc(T("Fiche complète envoyée à Heden", "Full listing sent to Heden"))}</b>${esc(m.maj ? T("Votre annonce est à jour (prix, photos, disponibilité).", "Your listing is up to date (price, photos, availability).") : m.nouvelles ? T("Nouvelle dans Explorer.", "New in Explore.") : T("Explorer est à jour.", "Explore is up to date."))}`);
  });
})();
