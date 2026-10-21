// Heden — boîte d'alertes du vivier.
// À installer une seule fois, dans le compte Gmail dédié aux alertes de Heden (pas dans votre Gmail personnel) :
// 1. script.google.com > Nouveau projet > coller tout ce texte > Enregistrer.
// 2. Remplacer COLLER_LA_CLE_DU_VIVIER par la clé obtenue dans Supabase (voir supabase/LISEZMOI.md, étape « vivier »).
// 3. En haut, choisir la fonction « installer », Exécuter, autoriser l'accès.
// Ensuite, toutes les 10 minutes, les nouveaux e-mails des sites d'annonces partent vers Heden.
const VIVIER_CLE = "COLLER_LA_CLE_DU_VIVIER";
const HEDEN_URL = "https://qrorhjypoppeplndpmyj.supabase.co/rest/v1/rpc/vivier_recevoir";
const HEDEN_CLE_PUBLIQUE = "sb_publishable_-3v-JqBfx38pvpdInzfaYg_dZE-8Zh5";
const EXPEDITEURS = "seloger.com OR pap.fr OR leboncoin.fr OR bienici.com OR logic-immo.com OR lefigaro.fr OR orpi.com OR century21.fr OR laforet.com OR guy-hoquet.com OR stephaneplazaimmobilier.com OR avendrealouer.fr OR jinka.fr OR paruvendu.fr OR superimmo.com OR meilleursagents.com";

function installer() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("envoyerAHeden").timeBased().everyMinutes(10).create();
  envoyerAHeden();
}

// À lancer à la main si besoin : renvoie à Heden les alertes des 7 derniers jours (Heden ignore ce qu'il connaît déjà)
function renvoyerTout() {
  PropertiesService.getScriptProperties().deleteProperty("heden_vus");
  envoyerAHeden(7);
}

function envoyerAHeden(jours) {
  const props = PropertiesService.getScriptProperties();
  const vus = JSON.parse(props.getProperty("heden_vus") || "[]");
  GmailApp.search("from:(" + EXPEDITEURS + ") newer_than:" + (typeof jours === "number" ? jours : 2) + "d", 0, 100).forEach(fil => fil.getMessages().forEach(m => {
    if (vus.indexOf(m.getId()) >= 0) return;
    const r = UrlFetchApp.fetch(HEDEN_URL, {method: "post", contentType: "application/json", muteHttpExceptions: true,
      headers: {apikey: HEDEN_CLE_PUBLIQUE},
      payload: JSON.stringify({p_cle: VIVIER_CLE, p_from: m.getFrom(), p_subject: m.getSubject(), p_html: m.getBody()})});
    if (r.getResponseCode() === 200 && r.getContentText() === "true") vus.push(m.getId());
  }));
  props.setProperty("heden_vus", JSON.stringify(vus.slice(-400)));   // une propriété tient 9 Ko : les 400 derniers suffisent sur deux jours
}
