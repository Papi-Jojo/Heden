/* =========================================================
   Connexion : petit panneau qui s'ouvre de partout
   ========================================================= */
const auth = {open: false, note: "", cooldown: 0, timer: null};
const maskMail = m => { const [u, d] = String(m || "").split("@"); return d ? (u.length <= 2 ? u : u.slice(0, 2) + "•••") + "@" + d : m; };
function accountHTML() {
  if (!cloudReady) return "";
  return cloud.user
    ? `<div class="acctrow on"><i></i><span><b>${esc(cloud.user.email || "Connecté")}</b><small id="syncState">${esc(syncLabel())}</small></span><button class="link" type="button" data-auth>Gérer</button></div>`
    : `<div class="acctrow"><i></i><span><b>Sur cet appareil uniquement</b><small>Connectez-vous pour retrouver vos zones partout</small></span><button class="btn btn--sm btn--primary" type="button" data-auth>Se connecter</button></div>`;
}
function bindAccount(root = document) {
  $$("[data-auth]", root).forEach(b => b.onclick = e => { e.stopPropagation(); openAuth(); });
}
function openAuth(note) {
  if (!cloudReady) return;
  auth.open = true; auth.note = note || "";
  if (!cloud.user && cloud.step !== "code") cloud.step = "email";
  renderAuth();
  const el = $("#auth"); el.hidden = false;
  requestAnimationFrame(() => { el.classList.add("is-open"); const f = el.querySelector("input"); if (f && !cloud.user) f.focus({preventScroll: true}); });
}
function closeAuth() {
  const el = $("#auth"); if (!el || el.hidden) return;
  auth.open = false; el.classList.remove("is-open");
  if (document.activeElement && el.contains(document.activeElement)) document.activeElement.blur();
  setTimeout(() => { if (!auth.open) el.hidden = true; }, 200);
}
function startCooldown() {
  auth.cooldown = 30; clearInterval(auth.timer);
  auth.timer = setInterval(() => {
    auth.cooldown--; const r = $("#resend");
    if (r) { r.disabled = auth.cooldown > 0; r.textContent = auth.cooldown > 0 ? `Renvoyer le code (${auth.cooldown} s)` : "Renvoyer le code"; }
    if (auth.cooldown <= 0) clearInterval(auth.timer);
  }, 1000);
}
function renderAuth() {
  let el = $("#auth");
  if (!el) {
    el = document.createElement("div"); el.id = "auth"; el.className = "auth"; el.hidden = true;
    el.innerHTML = `<div class="auth__veil" data-close></div><div class="auth__card" role="dialog" aria-modal="true" aria-labelledby="authTitle"></div>`;
    document.body.appendChild(el);
    el.addEventListener("click", e => { if (e.target.closest("[data-close]")) closeAuth(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && auth.open) closeAuth(); });
  }
  const card = el.querySelector(".auth__card");
  const close = `<button class="x" type="button" data-close aria-label="Fermer"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>`;
  let last = ""; try { last = localStorage.getItem("heden.lastEmail") || ""; } catch (e) {}
  if (cloud.user) {
    card.innerHTML = `<div class="auth__head"><h2 id="authTitle">Votre compte</h2>${close}</div>
      <p class="auth__txt">Connecté avec <b>${esc(cloud.user.email || "")}</b>.</p>
      <p class="auth__small" id="syncState2">${esc(syncLabel())}</p>
      <div class="auth__foot"><button class="btn btn--sm btn--clair" type="button" id="logout">Se déconnecter</button></div>`;
    $("#logout").onclick = async () => { closeAuth(); await signOut(); };
    return;
  }
  if (cloud.step === "code") {
    card.innerHTML = `<div class="auth__head"><h2 id="authTitle">Saisissez le code</h2>${close}</div>
      <p class="auth__txt">Un code à 6 chiffres vient d’être envoyé à <b>${esc(maskMail(cloud.pendingEmail))}</b>. Pensez aux indésirables.${CFG.codeParEmail ? "" : " Ouvrez le lien de l’e-mail sur cet appareil."}</p>
      ${CFG.codeParEmail ? `<form id="codeForm" class="auth__form" autocomplete="on">
        <input type="text" id="loginCode" class="auth__code num" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6" placeholder="••••••" aria-label="Code à 6 chiffres">
        <button class="btn btn--primary btn--block" type="submit">Se connecter</button>
      </form>` : ""}
      <div class="auth__links"><button class="link" type="button" id="resend" ${auth.cooldown > 0 ? "disabled" : ""}>${auth.cooldown > 0 ? `Renvoyer le code (${auth.cooldown} s)` : "Renvoyer le code"}</button><button class="link" type="button" id="changeMail">Changer d’adresse</button></div>`;
    const cf = $("#codeForm"), ci = $("#loginCode");
    const submit = async () => {
      const code = ci.value.replace(/\D/g, "");
      if (code.length < 6) return toast("Le code fait 6 chiffres");
      const b = cf.querySelector("button"); b.disabled = true; b.textContent = "Vérification…"; ci.disabled = true;
      try { await verifyLoginCode(cloud.pendingEmail, code); }
      catch (err) { b.disabled = false; ci.disabled = false; b.textContent = "Se connecter"; ci.value = ""; ci.focus(); ci.classList.add("is-bad"); toast("Code incorrect ou expiré"); }
    };
    if (cf) {
      cf.onsubmit = e => { e.preventDefault(); submit(); };
      ci.oninput = () => { ci.classList.remove("is-bad"); ci.value = ci.value.replace(/\D/g, "").slice(0, 6); if (ci.value.length === 6) submit(); };
    }
    $("#resend").onclick = async e => {
      e.target.disabled = true;
      try { await sendLoginEmail(cloud.pendingEmail); toast("Nouveau code envoyé"); startCooldown(); }
      catch (err) { e.target.disabled = false; toast(/rate|seconds/i.test(err.message || "") ? "Trop de demandes : réessayez dans une minute" : "Envoi impossible pour le moment"); }
    };
    $("#changeMail").onclick = () => { cloud.step = "email"; renderAuth(); const f = $("#loginMail"); if (f) f.focus(); };
    return;
  }
  card.innerHTML = `<div class="auth__head"><h2 id="authTitle">Se connecter</h2>${close}</div>
    <p class="auth__txt">${auth.note ? esc(auth.note) : "Vos zones et annonces sur tous vos appareils, et des cartes de groupe."} Pas de mot de passe : un code par e-mail.</p>
    <form id="mailForm" class="auth__form">
      <input type="email" id="loginMail" autocomplete="email" inputmode="email" placeholder="prenom@exemple.fr" aria-label="Adresse e-mail" value="${esc(cloud.pendingEmail || last)}">
      <button class="btn btn--primary btn--block" type="submit">Recevoir un code</button>
    </form>`;
  $("#mailForm").onsubmit = async e => {
    e.preventDefault();
    const email = $("#loginMail").value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast("Adresse e-mail incomplète");
    const b = e.target.querySelector("button"); b.disabled = true; b.textContent = "Envoi…";
    try {
      await sendLoginEmail(email);
      cloud.pendingEmail = email; cloud.step = "code";
      try { localStorage.setItem("heden.lastEmail", email); } catch (err) {}
      startCooldown(); renderAuth(); const c = $("#loginCode"); if (c) c.focus();
    } catch (err) { b.disabled = false; b.textContent = "Recevoir un code"; toast(/rate|seconds/i.test(err.message || "") ? "Trop de demandes : réessayez dans une minute" : "Envoi impossible pour le moment"); }
  };
}
let ptab = (() => { try { return localStorage.getItem("heden.ptab") || "recherche"; } catch (e) { return "recherche"; } })();
function showPtab(k) {
  ptab = k; try { localStorage.setItem("heden.ptab", k); } catch (e) {}
  $$("[data-ptab]").forEach(x => { const on = x.dataset.ptab === k; x.setAttribute("aria-selected", String(on)); x.setAttribute("aria-pressed", String(on)); });
  $$(".ppane").forEach(pn => { pn.hidden = pn.dataset.pane !== k; if (!pn.hidden) { pn.classList.remove("swap-in"); void pn.offsetWidth; pn.classList.add("swap-in"); setTimeout(() => pn.classList.remove("swap-in"), 300); } });
  const v = $("#view-profile"); if (v) v.scrollTop = 0;
}
function renderProfile() { setTimeout(() => tipsKick(), 0);
  const p = state.profile;
  const cs = p.criteria;
  const wsum = cs.reduce((a, c) => a + (c.weight > 0 ? c.weight : 0), 0);
  const avail = Object.keys(LIB).filter(id => !cs.some(c => c.id === id));
  const tabs = [["recherche", "Recherche"], ["quartier", "Quartier"], ["logement", "Logement"], ["compte", "Compte"]];
  if (!tabs.some(t => t[0] === ptab)) ptab = "recherche";
  const pane = (k, html) => `<div class="ppane" data-pane="${k}" ${ptab === k ? "" : "hidden"}>${html}</div>`;
  $("#prof").innerHTML = `
    <div class="prof__top"><h1>Votre profil</h1>
      <div class="seg ptabs" role="tablist" aria-label="Sections du profil">${tabs.map(([k, l]) => `<button type="button" role="tab" data-ptab="${k}" aria-selected="${ptab === k}" aria-pressed="${ptab === k}">${l}</button>`).join("")}</div></div>
    ${pane("recherche", profileSummaryHTML() + `
    ${projet() !== "location" ? `<section class="sec setrow">
      <div><h3 class="sub3">Financement</h3>
      <p class="hint2">Apport ${finance().apport ? fmtInt(finance().apport) + " €" : "supposé de 10 %"}, prêt à ${String(finance().taux).replace(".", ",")}&nbsp;% sur ${finance().duree}&nbsp;ans.</p></div>
      <button class="btn btn--sm btn--clair" type="button" id="finProf">Modifier</button>
    </section>` : ""}
    ${projet() !== "achat" ? `<section class="sec setrow">
      <div><h3 class="sub3">Location</h3>
      <p class="hint2">${(() => { const lo = homeProfile().loc || {}; return [lo.colocs > 1 ? `Colocation à ${lo.colocs}` : null, lo.loyerMax ? `Loyer maximum ${fmtInt(lo.loyerMax)} € par mois` : "Pas de loyer maximum", lo.revenus ? `revenus de ${fmtInt(lo.revenus)} € par mois` : "revenus non indiqués", {vide: "vide", meuble: "meublé", indiff: "meublé ou vide"}[lo.meuble || "indiff"]].filter(Boolean).join(", ") + "."; })()}</p></div>
      <button class="btn btn--sm btn--clair" type="button" id="locProf">Modifier</button>
    </section>` : ""}
`)}
    ${pane("quartier", groupCritHTML() + `
    <section class="sec">
      <h2>${isShared() ? "Vos critères personnels" : "Ce qui compte dans un quartier"}</h2>
      <div class="cards">
        ${cs.map((c, i) => `
          <div class="crow" data-i="${i}">
            <div style="min-width:0">
              <input class="nm" value="${esc(c.name)}" aria-label="Nom du critère" maxlength="40" data-i18n-val>
              <input class="ds" value="${esc(c.desc || "")}" placeholder="Ce qu’on observe sur place" aria-label="Description" maxlength="120">
              ${c.id === "revente" && projet() !== "achat" ? `<span class="hint2 crow__note">Ne compte pas pour une location.</span>` : c.id === "prix" && projet() !== "achat" ? `<span class="hint2 crow__note">En location, comparé à votre loyer maximum.</span>` : ""}
            </div>
            <div class="wctl">
              <input type="range" min="0" max="40" step="5" value="${c.weight}" aria-label="Poids de ${esc(c.name)}">
              <output class="num"><span class="wv">${c.weight}</span><small class="ws">${wsum ? Math.round(Math.max(0, c.weight) / wsum * 100) : 0} %</small></output>
            </div>
            <button class="x" type="button" aria-label="Retirer ${esc(c.name)}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
          </div>`).join("")}
      </div>
      <div class="addrow">
        <select id="addSel" aria-label="Ajouter un critère">
          <option value="">Ajouter un critère…</option>
          ${avail.map(id => `<option value="${id}">${esc(LIB[id].name)}</option>`).join("")}
          <option value="__custom">Critère personnalisé</option>
        </select>
        <button class="chip" id="halfP" type="button" aria-pressed="${!!p.halfPoints}">Notes au demi-point</button>
      </div><span id="wtot" hidden></span>
    </section>

    <section class="sec">
      <h3 class="sub3">Partir d’un profil type</h3>
      <div class="chips">${PRESETS.map(pr => `<button class="chip pchip" type="button" data-p="${pr.id}" aria-pressed="${p.presetId === pr.id && !p.modified}" title="${esc(pr.tagline)}">${esc(pr.name)}</button>`).join("")}</div>
      <p class="hint2">${(() => { const cur = PRESETS.find(x => x.id === p.presetId); return cur && !p.modified ? esc(cur.tagline) + "." : p.modified ? "Profil ajusté à la main." : ""; })()} Changer remplace vos critères, garde vos notes.</p>
    </section>
    <section class="sec">
      <h3 class="sub3">Budget des zones</h3>
      ${projet() !== "location" ? `<div class="field">
        <label class="label" for="pbudget">Budget max €/m²${projet() === "deux" ? " à l’achat" : ""}</label>
        <input type="number" id="pbudget" inputmode="numeric" min="0" step="100" value="${p.budget ?? ""}" placeholder="Facultatif">
      </div>` : ""}
      ${projet() !== "achat" ? `<p class="hint2">Location : ${rentPpmBudget() ? `${fmt1(rentPpmBudget())} €/m² par mois au plus, d’après votre loyer maximum.` : "indiquez un loyer maximum dans Logement."}</p>` : ""}
      <p class="hint2">Au-dessus, la zone passe en pointillés.</p>
    </section>

`)}
    ${pane("logement", homeSectionHTML())}
    ${pane("compte", accountHTML() + `
    <section class="sec">
      <h2>Vous</h2>
      <div class="field">
        <label class="label" for="pname">Prénom</label>
        <input type="text" id="pname" value="${esc(p.name)}" placeholder="Affiché sur les zones que vous notez" maxlength="40">
      </div>
    </section>
    <section class="sec setrow">
      <div><h3 class="sub3">Langue · Language</h3></div>
      <div class="seg seg--sm" id="langSel" role="group" aria-label="Langue · Language" data-i18n-skip>${[["fr", "Français"], ["en", "English"]].map(([k, l]) => `<button type="button" data-lang="${k}" aria-pressed="${(window.HEDEN_LANG || "fr") === k}">${l}</button>`).join("")}</div>
    </section>
    <section class="sec setrow">
      <div><h3 class="sub3">Astuces</h3><p class="hint2">Une bulle au premier usage de chaque écran${tipsState().seen.length && !tipsState().off ? ` · <button class="linkbtn" type="button" id="tipsReset">Tout revoir</button>` : ""}</p></div>
      <div class="seg seg--sm" id="tipsSel" role="group" aria-label="Astuces">${[[1, "Oui"], [0, "Non"]].map(([k, l]) => `<button type="button" data-on="${k}" aria-pressed="${!tipsState().off === !!k}">${l}</button>`).join("")}</div>
    </section>
    ${sharedHTML()}
    <section class="sec">
      <h2>Vos données</h2>
      <div class="datarow">
        <button class="btn" id="exp" type="button">Exporter mes zones</button>
        <button class="btn" id="imp" type="button">Importer un fichier</button>
        <button class="btn btn--ghost btn--danger" id="wipe" type="button">Tout effacer</button>
      </div>
      <p class="hint2 num">${state.zones.length} zone${state.zones.length > 1 ? "s" : ""} enregistrée${state.zones.length > 1 ? "s" : ""}${storageOk ? "" : " · stockage local bloqué par ce navigateur"}.</p>
    </section>`)}`;
  $$("[data-ptab]", $("#prof")).forEach(b => b.onclick = () => showPtab(b.dataset.ptab));
  bindAccount($("#prof"));
  bindHomeSection();
  bindProfileSummary();
  const fp = $("#finProf"); if (fp) fp.onclick = openFinance;
  const lp = $("#locProf"); if (lp) lp.onclick = openRentSettings;
  bindShared();
  $("#pname").oninput = e => { p.name = e.target.value.trim(); save(); };
  $$("#tipsSel [data-on]").forEach(b => b.onclick = () => {
    const on = b.dataset.on === "1"; const st = tipsState();
    if (on === !st.off) return;
    st.off = !on; if (on) st.seen = []; else tipHide(false);
    tipsSave(); renderProfile(); toast(on ? "Astuces activées" : "Astuces désactivées");
  });
  if ($("#tipsReset")) $("#tipsReset").onclick = () => { tipsState().seen = []; tipsSave(); renderProfile(); toast("Les astuces reviendront au fil des écrans"); };
  $$("#langSel [data-lang]").forEach(b => b.onclick = () => {
    if (b.dataset.lang === (window.HEDEN_LANG || "fr")) return;
    try { localStorage.setItem("heden.lang", b.dataset.lang); } catch (e) {}
    $$("#langSel [data-lang]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    setTimeout(() => location.reload(), 120);
  });
  $("#halfP").onclick = e => { p.halfPoints = !p.halfPoints; e.currentTarget.setAttribute("aria-pressed", String(p.halfPoints)); save(); toast(p.halfPoints ? "Notes au demi-point activées" : "Notes au demi-point désactivées"); };
  if ($("#pbudget")) $("#pbudget").oninput = e => { const v = parseFloat(e.target.value); p.budget = isFinite(v) && v > 0 ? v : null; save(); };
  $$(".pchip").forEach(b => b.onclick = () => {
    const pr = PRESETS.find(x => x.id === b.dataset.p);
    p.criteria = presetCriteria(pr); p.presetId = pr.id; p.modified = false; save(); renderProfile();
    toast(`Profil « ${pr.name} » appliqué`);
  });
  $$(".crow[data-i]").forEach(row => {
    const c = cs[+row.dataset.i];
    $(".nm", row).oninput = e => { c.name = e.target.value; p.modified = true; save(); };
    $(".ds", row).oninput = e => { c.desc = e.target.value; save(); };
    const rg = $("input[type=range]", row);
    rg.oninput = () => {
      c.weight = +rg.value; p.modified = true; save();
      $(".wv", row).textContent = c.weight;
      const tot = cs.reduce((a, x) => a + (x.weight > 0 ? x.weight : 0), 0);
      $$(".crow[data-i]").forEach(r2 => { const c2 = cs[+r2.dataset.i]; $(".ws", r2).textContent = (tot ? Math.round(Math.max(0, c2.weight) / tot * 100) : 0) + " %"; });
      $("#wtot").textContent = `Total des poids : ${tot}${tot === 100 ? "" : " (ramené à 100 %)"}`;
      $$(".pchip").forEach(pb => pb.setAttribute("aria-pressed", "false"));
    };
    $(".x", row).onclick = () => { cs.splice(+row.dataset.i, 1); p.modified = true; save(); renderProfile(); };
  });
  bindGroupCrit();
  $("#addSel").onchange = e => {
    const v = e.target.value; if (!v) return;
    if (v === "__custom") cs.push({id: "c_" + uid(), name: "Nouveau critère", desc: "", weight: 10});
    else cs.push({id: v, name: LIB[v].name, desc: LIB[v].desc, weight: 10});
    p.modified = true; save(); renderProfile();
    if (v === "__custom") { const rows = $$(".crow"); const nm = $(".nm", rows[rows.length - 1]); nm.focus(); nm.select(); }
  };
  $("#exp").onclick = exportData;
  $("#imp").onclick = () => $("#importFile").click();
  const wipe = $("#wipe");
  wipe.onclick = async () => {
    if (!(await askConfirm({title: "Effacer toutes vos zones ?", text: "Toutes les zones de cette carte et leurs notes seront supprimées. Pensez à exporter une copie avant.", ok: "Tout effacer", danger: true}))) return;
    state.zones = []; save(); renderProfile(); toast("Toutes les zones ont été effacées");
  };
}

function exportData() {
  const blob = new Blob([JSON.stringify({app: "heden", version: 1, exportedAt: new Date().toISOString(), profile: state.profile, zones: state.zones}, null, 2)], {type: "application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `heden-${(state.profile.name || "zones").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${today()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
$("#importFile").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    if (!j || !Array.isArray(j.zones)) throw new Error("format");
    let added = 0, updated = 0;
    for (const z of j.zones) {
      const okPoly = Array.isArray(z.points) && z.points.length >= 3 && z.points.every(p => Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number");
      const okCircle = typeof z.lat === "number" && typeof z.lng === "number" && typeof z.radius === "number";
      if (!okPoly && !okCircle) continue;
      finishZoneGeometry(z);
      z.ratings = z.ratings && typeof z.ratings === "object" ? z.ratings : {};
      const i = state.zones.findIndex(x => x.id === z.id);
      if (i < 0) { const nz = Object.assign({}, z, {id: zoneId(), example: false}); if (cloud.user) { nz.mapId = cloud.mapId; nz.createdBy = cloud.user.id; } state.zones.push(nz); added++; }
      else if ((z.updatedAt || 0) > (state.zones[i].updatedAt || 0)) { state.zones[i] = Object.assign({}, state.zones[i], z, {mapId: state.zones[i].mapId, createdBy: state.zones[i].createdBy}); updated++; }
    }
    const unknown = new Set();
    j.zones.forEach(z => Object.keys(z.ratings || {}).forEach(k => { if (!crit().some(c => c.id === k)) unknown.add(k); }));
    save(); renderProfile();
    toast(`${added} zone${added > 1 ? "s" : ""} ajoutée${added > 1 ? "s" : ""}${updated ? `, ${updated} mise${updated > 1 ? "s" : ""} à jour` : ""}`);
  } catch (err) { toast("Fichier illisible : choisissez un export Heden (.json)"); }
});

/* Critères communs : le socle que chaque membre d'une carte de groupe note, en plus des siens */
function groupCritHTML() {
  if (!cloud.user) return "";
  if (!isShared()) return cloud.maps.some(m => m.kind === "partagee") ? `<p class="hint2 gcrit__off">Les critères communs se règlent quand une carte de groupe est affichée.</p>` : "";
  const m = curMap(), gc = m.criteria || [];
  if (!cloud.groupCritOk) return `<section class="sec"><h2>Critères communs</h2><p class="hint2">Bientôt disponibles sur cette carte.</p></section>`;
  const gsum = gc.reduce((a, c) => a + Math.max(0, c.weight || 0), 0);
  const avail = Object.keys(LIB).filter(id => !gc.some(c => c.id === id));
  return `<section class="sec gcrit">
      <h2>Critères communs</h2>
      <p class="hint2">Pour toute la carte « ${esc(m.name)} » : chaque membre les note, en plus de ses critères personnels. Une note de 0 chez un seul membre plafonne la zone.</p>
      ${gc.length ? `<div class="cards">${gc.map((c, i) => `
        <div class="crow" data-g="${i}">
          <div style="min-width:0">
            <input class="nm" value="${esc(c.name)}" aria-label="Nom du critère" maxlength="40" data-i18n-val>
            <input class="ds" value="${esc(c.desc || "")}" placeholder="Ce qu’on observe sur place" aria-label="Description" maxlength="120">
          </div>
          <div class="wctl">
            <input type="range" min="0" max="40" step="5" value="${c.weight}" aria-label="Poids de ${esc(c.name)}">
            <output class="num"><span class="wv">${c.weight}</span><small class="ws">${gsum ? Math.round(Math.max(0, c.weight) / gsum * 100) : 0} %</small></output>
          </div>
          <button class="x" type="button" aria-label="Retirer ${esc(c.name)}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
        </div>`).join("")}</div>` : ""}
      <div class="addrow">
        <select id="gAddSel" aria-label="Ajouter un critère commun">
          <option value="">Ajouter un critère commun…</option>
          ${avail.map(id => `<option value="${id}">${esc(LIB[id].name)}</option>`).join("")}
          <option value="__custom">Critère personnalisé</option>
        </select>
      </div>
    </section>`;
}
function bindGroupCrit() {
  const m = isShared() ? curMap() : null; if (!m || !cloud.groupCritOk) return;
  const gc = m.criteria = m.criteria || [];
  const changed = () => { saveGroupCrit(m); };
  $$(".crow[data-g]").forEach(row => {
    const c = gc[+row.dataset.g];
    $(".nm", row).oninput = e => { c.name = e.target.value; changed(); };
    $(".ds", row).oninput = e => { c.desc = e.target.value; changed(); };
    const rg = $("input[type=range]", row);
    rg.oninput = () => {
      c.weight = +rg.value; changed();
      $(".wv", row).textContent = c.weight;
      const tot = gc.reduce((a, x) => a + Math.max(0, x.weight || 0), 0);
      $$(".crow[data-g]").forEach(r2 => { const c2 = gc[+r2.dataset.g]; $(".ws", r2).textContent = (tot ? Math.round(Math.max(0, c2.weight) / tot * 100) : 0) + " %"; });
    };
    $(".x", row).onclick = () => { gc.splice(+row.dataset.g, 1); changed(); renderProfile(); };
  });
  const sel = $("#gAddSel");
  if (sel) sel.onchange = e => {
    const v = e.target.value; if (!v) return;
    if (v === "__custom") gc.push({id: "g_" + uid(), name: "Nouveau critère", desc: "", weight: 10});
    else gc.push({id: v, name: LIB[v].name, desc: LIB[v].desc, weight: 10});
    changed(); renderProfile();
    if (v === "__custom") { const rows = $$(".crow[data-g]"); const nm = $(".nm", rows[rows.length - 1]); nm.focus(); nm.select(); }
  };
}
