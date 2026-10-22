/* Heden : dans la page (monde « MAIN »), dès son ouverture. Garde une copie des réponses JSON d'annonces que la page reçoit
   pour s'afficher (Bien'ici, Jinka… chargent leurs résultats ainsi) : description, étage, DPE, position approchée.
   Aucune requête de plus, rien n'est envoyé d'ici : lecture.js s'en sert quand la page est lue. */
(() => {
  if (window.__hedenEcoute) return; window.__hedenEcoute = 1;
  const BUF = [], MAX = 6, URL_OK = /annonce|classified|realestate|real-estate|listing|search|recherche|ads?\b|serp|results|biens?/i;
  Object.defineProperty(window, "__hedenJson", {value: BUF, enumerable: false});
  const garder = (u, txt) => {
    try {
      if (!txt || txt.length < 200 || txt.length > 6e6 || !/^\s*[[{]/.test(txt) || !URL_OK.test(String(u || ""))) return;
      if (!/descri|surface|price|prix|rooms|pieces/i.test(txt.slice(0, 200000))) return;
      BUF.push(JSON.parse(txt)); if (BUF.length > MAX) BUF.shift();
    } catch (e) {}
  };
  const f0 = window.fetch;
  if (typeof f0 === "function") window.fetch = function (...a) {
    const p = f0.apply(this, a);
    p.then(r => { try { if (/json/i.test(r.headers.get("content-type") || "")) r.clone().text().then(t => garder(r.url, t)).catch(() => {}); } catch (e) {} }).catch(() => {});
    return p;
  };
  const X = XMLHttpRequest.prototype, open0 = X.open, send0 = X.send;
  X.open = function (m, u, ...r) { this.__hu = u; return open0.call(this, m, u, ...r); };
  X.send = function (...a) {
    this.addEventListener("load", () => { try { if (!/json/i.test(this.getResponseHeader("content-type") || "")) return;
      if (this.responseType === "" || this.responseType === "text") garder(this.responseURL || this.__hu, this.responseText);
      else if (this.responseType === "json" && this.response && URL_OK.test(String(this.responseURL || this.__hu || ""))) { BUF.push(this.response); if (BUF.length > MAX) BUF.shift(); } } catch (e) {} });
    return send0.apply(this, a);
  };
})();
