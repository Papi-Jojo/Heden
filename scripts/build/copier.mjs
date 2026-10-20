// Après `vite build` : copie dans dist/ ce qui est servi tel quel (données, configuration, traductions, ancienne adresse /v2/).
import { cpSync, existsSync } from "node:fs";

for (const p of ["data", "i18n", "v2", "config.js"]) {
  if (existsSync(p)) cpSync(p, `dist/${p}`, { recursive: true });
}
console.log("Fichiers statiques copiés dans dist/");
