/* =========================================================
   Onglet profil
   ========================================================= */
/* =========================================================
   Confirmation : petite fenêtre au lieu d'un double appui
   ========================================================= */
function askConfirm({title, text = "", ok = "Confirmer", cancel = "Annuler", danger = false, abandon = false}) {
  return new Promise(resolve => {
    const prev = document.activeElement;
    const el = document.createElement("div");
    el.className = "ask";
    el.innerHTML = `<div class="ask__veil" data-no></div>
      <div class="ask__card" role="alertdialog" aria-modal="true" aria-labelledby="askT" aria-describedby="askD">
        <h2 id="askT">${esc(title)}</h2>${text ? `<p id="askD">${esc(text)}</p>` : ""}
        <div class="ask__acts"><button class="btn ${abandon ? "btn--primary" : ""}" type="button" data-no>${esc(cancel)}</button><button class="btn ${abandon ? "btn--clair" : danger ? "btn--danger" : "btn--primary"}" type="button" data-yes>${esc(ok)}</button></div>
      </div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => { el.classList.add("is-open"); el.querySelector(abandon ? "[data-no]" : "[data-yes]").focus({preventScroll: true}); });
    const done = v => {
      document.removeEventListener("keydown", key);
      el.classList.remove("is-open"); setTimeout(() => el.remove(), 180);
      try { prev && prev.focus && prev.focus({preventScroll: true}); } catch (e) {}
      resolve(v);
    };
    const key = e => { if (e.key === "Escape") { e.stopPropagation(); done(false); } };
    document.addEventListener("keydown", key);
    el.addEventListener("click", e => { if (e.target.closest("[data-yes]")) done(true); else if (e.target.closest("[data-no]")) done(false); });
  });
}
