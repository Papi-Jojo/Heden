/* Heden : dans la page elle-même (monde « MAIN »), pour voir ses données (galerie complète, description) que le script isolé ne voit pas.
   Ne fait que lire, à la demande de lecteur.js. */
(() => {
  if (window.__hedenLecture) return; window.__hedenLecture = 1;
  /*LECTEUR*/
  window.addEventListener("message", e => {
    const m = e.data; if (e.source !== window || !m || m.type !== "heden-lire" || typeof m.n !== "string") return;
    let d = null; try { d = lirePage(X); } catch (er) {}
    window.postMessage({type: "heden-lu", n: m.n, d}, location.origin);
  });
})();
