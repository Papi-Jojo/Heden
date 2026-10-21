/* Traitement automatique du vivier (toutes les 10 minutes, .github/workflows/vivier.yml).
   Lit les e-mails d'alerte arrivés dans Supabase, en tire les annonces avec le lecteur de l'app (src/app/01b-lecture.js,
   chargé tel quel), situe la rue (Base Adresse Nationale), retrouve le DPE officiel (ADEME), puis dépose le tout.
   Variable d'environnement : VIVIER_CLE (secret GitHub). Sans elle, le script ne fait rien.
     VIVIER_CLE=… node scripts/vivier/traiter.mjs */
import fs from "node:fs";
import vm from "node:vm";
import {JSDOM} from "jsdom";

const RACINE = new URL("../../", import.meta.url);
const CLE = process.env.VIVIER_CLE;
const cfg = fs.readFileSync(new URL("config.js", RACINE), "utf8");
const URL_SB = process.env.HEDEN_SUPABASE_URL || cfg.match(/supabaseUrl:\s*"([^"]+)"/)[1], CLE_PUB = cfg.match(/supabaseAnonKey:\s*"([^"]+)"/)[1];

// le lecteur de l'app, dans un bac à sable qui a un DOM (jsdom) et fetch
const {window} = new JSDOM("");
const ctx = vm.createContext({DOMParser: window.DOMParser, URL, fetch, console, setTimeout, dataStore: {}});
const L = vm.runInContext(fs.readFileSync(new URL("src/app/01b-lecture.js", RACINE), "utf8") + "\n;({vivierLire, vivierData, banRue, ademeCheck})", ctx);
if (!CLE) { console.log("Lecteur chargé ; VIVIER_CLE absente : rien à traiter."); process.exit(0); }

async function rpc(nom, args) {
  const r = await fetch(`${URL_SB}/rest/v1/rpc/${nom}`, {method: "POST", headers: {apikey: CLE_PUB, "Content-Type": "application/json"}, body: JSON.stringify(args)});
  if (!r.ok) throw new Error(`${nom} : ${r.status} ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

const jours = +process.env.RETRAITER || 0;
if (jours) console.log(`Relecture : ${await rpc("vivier_retraiter", {p_cle: CLE, p_jours: jours})} e-mail(s) des ${jours} derniers jours.`);
const t0 = Date.now(); let mails = 0, annonces = 0, situees = 0, dpe = 0;
while (Date.now() - t0 < 7 * 60e3) {                          // le workflow est coupé à 9 minutes
  const lot = await rpc("vivier_prendre", {n: 10, p_cle: CLE});
  if (!lot.length) break;
  for (const m of lot) {
    const {ann, ret} = L.vivierLire(m);
    for (const x of ann) {
      await L.banRue(x.f);
      await L.ademeCheck(x.f);
      if (x.f.lat) situees++; if (x.f.ademe) dpe++;
      x.a.data = L.vivierData(x.f);
    }
    await rpc("vivier_poser", {p_courrier: m.id, p_annonces: ann.map(x => x.a), p_retirees: ret, p_cle: CLE});
    mails++; annonces += ann.length;
  }
}
console.log(`${mails} e-mail(s), ${annonces} annonce(s) déposée(s), ${situees} située(s) à la rue ou à l'immeuble, ${dpe} DPE officiel(s) retrouvé(s).`);
