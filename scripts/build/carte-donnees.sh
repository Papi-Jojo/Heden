#!/usr/bin/env bash
# Tuiles et polices du fond de carte, posées dans dist/carte/ (en intégration continue, après npm run build).
# Les tuiles : un extrait de Paris et de la petite couronne du fond Protomaps (données OpenStreetMap), zoom 0 à 15,
# tiré une fois par mois et gardé en cache. Les polices : Noto Sans, latin seulement. Rien n'est demandé à un service tiers
# quand la carte s'affiche : tout est servi avec le site.
set -euo pipefail
CACHE="${CARTE_CACHE:-.carte-cache}"; OUT="dist/carte"
BBOX="2.13,48.72,2.57,48.99"
mkdir -p "$CACHE" "$OUT/fonts"

if [ ! -s "$CACHE/paris.pmtiles" ]; then
  V=$(curl -fsSL https://api.github.com/repos/protomaps/go-pmtiles/releases/latest | python3 -c "import json,sys; print(json.load(sys.stdin)['tag_name'])")
  curl -fsSL "https://github.com/protomaps/go-pmtiles/releases/download/${V}/go-pmtiles_${V#v}_Linux_x86_64.tar.gz" | tar xz -C "$CACHE" pmtiles
  for d in 1 2 3 4 5 6 7 8 9 10; do   # le fond complet du jour, ou de l'un des jours précédents
    J=$(date -u -d "-$d day" +%Y%m%d)
    if "$CACHE/pmtiles" extract "https://build.protomaps.com/$J.pmtiles" "$CACHE/paris.pmtiles" --bbox="$BBOX" --maxzoom=15 --download-threads=8; then
      echo "Fond de carte du $J"; break; fi
    rm -f "$CACHE/paris.pmtiles"
  done
  [ -s "$CACHE/paris.pmtiles" ] || { echo "Fond de carte introuvable"; exit 1; }
fi
cp "$CACHE/paris.pmtiles" "$OUT/paris.pmtiles"

for f in "Noto Sans Regular" "Noto Sans Medium" "Noto Sans Italic"; do
  mkdir -p "$CACHE/fonts/$f" "$OUT/fonts/$f"
  for r in 0-255 256-511 512-767 768-1023 8192-8447 8448-8703; do
    [ -s "$CACHE/fonts/$f/$r.pbf" ] || curl -fsSL "https://protomaps.github.io/basemaps-assets/fonts/${f// /%20}/$r.pbf" -o "$CACHE/fonts/$f/$r.pbf" || true
    [ -s "$CACHE/fonts/$f/$r.pbf" ] && cp "$CACHE/fonts/$f/$r.pbf" "$OUT/fonts/$f/$r.pbf"
  done
done
ls -la "$OUT" | head; du -sh "$OUT/paris.pmtiles"
