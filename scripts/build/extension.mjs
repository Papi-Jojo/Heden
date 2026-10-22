// Construit l'extension Heden (Chrome, Edge, Brave, Arc) dans dist/extension/ et dist/heden-extension.zip.
// Le lecteur de pages est celui de l'app (src/app/01b-lecture.js) : extractCards, lirePage, isDetailUrl, copiés tels quels.
//   HEDEN_URL=… (adresse de l'app, par défaut le site en ligne) · HEDEN_EXT_OUT=… (dossier de sortie, pour les essais)
import fs from "node:fs";
import vm from "node:vm";
import zlib from "node:zlib";

const RACINE = new URL("../../", import.meta.url);
const HEDEN = process.env.HEDEN_URL || "https://papi-jojo.github.io/Heden/";
const OUT = process.env.HEDEN_EXT_OUT || new URL("dist/extension/", RACINE).pathname;
const lire = p => fs.readFileSync(new URL(p, RACINE), "utf8");
const app = lire("src/app/18-annonces-avance.js"), VERSION = (app.match(/const EXT_VERSION = "([\d.]+)"/) || [])[1];
if (!VERSION) throw new Error("EXT_VERSION introuvable dans 18-annonces-avance.js");
const SITES = ["seloger.com", "bellesdemeures.com", "pap.fr", "leboncoin.fr", "bienici.com", "jinka.fr", "logic-immo.com", "orpi.com", "century21.fr", "laforet.com", "guy-hoquet.com",
  "stephaneplazaimmobilier.com", "avendrealouer.fr", "paruvendu.fr", "superimmo.com", "meilleursagents.com", "figaroimmo.fr"].flatMap(h => [`https://${h}/*`, `https://*.${h}/*`])
  .concat(["https://immobilier.lefigaro.fr/*"], (process.env.HEDEN_EXT_SITES || "").split(",").filter(Boolean));

const L = vm.runInContext(lire("src/app/01b-lecture.js") + "\n;({extractCards, lirePage, isDetailUrl})", vm.createContext({URL, console, setTimeout, dataStore: {}}));
const lecteur = `const X = ${L.extractCards.toString()};\n  const lirePage = ${L.lirePage.toString()};\n  const isDetailUrl = ${L.isDetailUrl.toString()};`;
const u = new URL(HEDEN), chemin = u.pathname.replace(/\/$/, "") || "/", HEDENM = JSON.stringify([...new Set([u.origin + chemin + "*", u.origin + chemin.toLowerCase() + "*"])]);   // avec ou sans « / » final
const sub = s => s.replaceAll("__HEDENM__", HEDENM).replaceAll("__HEDEN__", HEDEN).replaceAll("__VERSION__", VERSION).replaceAll("__SITES__", JSON.stringify(SITES)).replace("/*LECTEUR*/", lecteur);

fs.rmSync(OUT, {recursive: true, force: true}); fs.mkdirSync(OUT, {recursive: true});
const files = {};
for (const f of ["manifest.json", "fond.js", "pont.js", "ecoute.js", "lecture.js", "lecteur.js", "popup.html", "popup.js"]) files[f] = Buffer.from(sub(lire("extension/" + f)));
for (const n of [16, 32, 48, 128]) files[`icones/${n}.png`] = fs.readFileSync(new URL(`extension/icones/${n}.png`, RACINE));
JSON.parse(files["manifest.json"].toString());   // manifeste valide
fs.mkdirSync(OUT + "icones", {recursive: true});
for (const [n, b] of Object.entries(files)) fs.writeFileSync(OUT + n, b);

// zip (méthode deflate), dans un dossier « heden-extension » : on décompresse, puis « Charger l'extension non empaquetée »
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = b => { let c = 0xFFFFFFFF; for (const x of b) c = CRC[(c ^ x) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zip(prefix, dest) {
  const parts = [], central = []; let off = 0;
  for (const [n, b] of Object.entries(files)) {
    const name = Buffer.from(prefix + n), z = zlib.deflateRawSync(b), crc = crc32(b);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(z.length, 18); h.writeUInt32LE(b.length, 22); h.writeUInt16LE(name.length, 26);
    parts.push(h, name, z);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(z.length, 20); c.writeUInt32LE(b.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(off, 42);
    central.push(c, name); off += 30 + name.length + z.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  fs.writeFileSync(dest, Buffer.concat([...parts, cd, end]));
}
const DIST = OUT.replace(/extension\/?$/, "");
zip("heden-extension/", DIST + "heden-extension.zip");          // à décompresser, puis « Charger l'extension non empaquetée »
zip("", DIST + "heden-extension-store.zip");                     // pour le Chrome Web Store : le manifeste à la racine
console.log(`Extension ${VERSION} pour ${HEDEN} : ${OUT}`);
