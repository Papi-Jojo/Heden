// Heden : le code de l'app est découpé par domaine dans src/app/, dans l'ordre du fichier ORDRE.
// Les morceaux partagent une seule portée (comme l'ancien index.html) : ce module virtuel les assemble.
import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const APP = resolve(__dirname, "src/app");
const ID = "virtual:heden-app", RID = "\0" + ID;

function assemblage() {
  return {
    name: "heden-assemblage",
    resolveId: id => (id === ID ? RID : null),
    load(id) {
      if (id !== RID) return null;
      const files = readFileSync(resolve(APP, "ORDRE"), "utf8").split("\n").map(s => s.trim()).filter(Boolean);
      files.forEach(f => this.addWatchFile(resolve(APP, f)));
      const body = files.map(f => `// ---- ${f} ----\n` + readFileSync(resolve(APP, f), "utf8")).join("\n");
      return `(() => {\n"use strict";\n${body}\n})();\n`;
    },
    handleHotUpdate({ file, server }) {
      if (file.startsWith(APP)) { server.ws.send({ type: "full-reload" }); return []; }
    }
  };
}

export default defineConfig({
  base: "./",
  plugins: [assemblage()],
  build: { outDir: "dist", emptyOutDir: true, target: "es2020", sourcemap: false }
});
