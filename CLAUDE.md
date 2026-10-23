# Heden : repères pour Claude

Lu au début de chaque session. Le README décrit l'app ; ici, ce qu'il faut savoir pour travailler vite et sans casser.

## Où est quoi (`src/app/`, assemblés dans l'ordre de `ORDRE`)
- `00-reference` critères de quartier (`LIB`), profils types (`PRESETS`) · `01-utilitaires` `esc`, `colorFor`, formats · `02-etat` état et `save()`
- `01b-lecture` lecture des annonces, sans DOM de l'app (chargé aussi par Node) : `parseListing`, `extractCards`, `vivierLire`, rue (BAN), DPE officiel (ADEME)
- `03-projet` achat / location, note des zones (`scoreOf`) · `04-estimations` données par quartier (`estimate`)
- `05-onglets` `setTab` · `06-carte` zones sur la carte · `07-panneau`, `08-feuille` fiche de zone · `09-geocodage` recherche, zones prédéfinies (`data/lieux.json`) · `10-position` filtres de carte · `11-balade` · `13-connexion` profil · `15-astuces` guide pas à pas
- `16-compte` Supabase : synchro par différence (`syncNow`, `cloudRefresh`), cartes de groupe, zones jumelles, partage automatique des zones perso (`autoShare`)
- `17-annonces` note d'une annonce (`scoreListing`, fiabilité `reliable` / `need`, note provisoire « ≈ »), zones superposées (`stackZones` : la plus petite prime critère par critère), flux Explorer / Mes ajouts / Favoris (un favori quitte les flux : `flyToFav`), pictogrammes (`PIC`, `svgI`), fiche
- `18-annonces-avance` questionnaire (`QORDER`, `applySetup`), bouton + Heden (`bookmarkletCode`), vivier (`loadVivier`, `processVivier`), épingles de la carte

Extension de navigateur (`extension/`, construite par `scripts/build/extension.mjs` dans `dist/extension/`, `dist/heden-extension.zip` et `dist/heden-extension-store.zip`) : `ecoute.js` (dès le chargement) garde les réponses JSON d'annonces que la page reçoit, `lecture.js` lit la page dans son monde (`lirePage`, recopié depuis `01b-lecture.js` ; les fiches de l'état de la page et du JSON sont rattachées aux cartes), `lecteur.js` envoie, `fond.js` relaie vers l'onglet Heden, `pont.js` passe à l'app (`recevoirPage` → `vivier_deposer`). Version : `EXT_VERSION` dans `18-annonces-avance.js` ; publiée (non répertoriée) sur le Chrome Web Store, lien `EXT_STORE` : chaque nouvelle version se dépose dans la console du Store (`dist/heden-extension-store.zip`).

Pas besoin de graphe : `graphify-out/` n'est pas versionné et vieillit vite. Chercher dans `src/app/` avec grep.

## Règles du code
- Une seule portée pour tous les fichiers : deux `const` du même nom dans deux fichiers cassent la construction.
- Toute modification d'interface arrive en français **et** en anglais dans le même commit : `python3 scripts/i18n/ajouter.py "Texte" "Text"` (`#` nombre, `*` morceau variable). Après un changement de `i18n/en.json`, monter `en.json?v=` dans `i18n/runtime.js` et `runtime.js?v=` dans `index.html`. Une phrase faite de morceaux : une `<span>` par morceau. Contrôle : `localStorage["heden.i18ndebug"] = "1"` (console `I18NMISS`).
- Styles : tokens de `src/styles/08-direction-artistique.css` (pierre, émail, laiton ; clair et sombre). Vérifier l'esthétique et les espacements à côté de l'existant : captures à 390 px et 1280 px, clair et sombre, avant de pousser.
- Modifications multilignes faites par script : un fichier Python dans le dossier temporaire, pas de heredoc aux guillemets imbriqués.

## Construire, essayer, pousser
- `npm run build`, puis `python3 tests/essais.py [noms d'essais]` : parcours réels dans Chromium, faux Supabase (`tests/faux-supabase.js`), réseau simulé (`tests/outils.py`). Banc de lecture des annonces : `tests/lecture.py` et `tests/annonces/fiches.py`.
- Chaque push sur `main` lance « Site » : les essais d'abord, un échec bloque la mise en ligne. Le workflow « Lieux » peut réécrire `data/lieux.json` : `git pull --rebase` avant de pousser.
- Logs GitHub bruts inaccessibles d'ici : lire les annotations (`gh api repos/Papi-Jojo/Heden/check-runs/<job>/annotations`). `gh workflow run` marche ; les écritures d'API (secrets, suppression de branche) sont bloquées.
- Les tâches planifiées de GitHub partent avec des heures de retard : ne pas en dépendre. Lecture du vivier à la main : `gh workflow run vivier.yml --ref main`.
- Commits en français.

## Supabase et vivier
- SQL dans `supabase/*.sql`, relançables, dans l'ordre de `supabase/LISEZMOI.md` ; exécutés dans l'éditeur SQL du tableau de bord, avec l'accord du propriétaire.
- `config.js` ne contient que la clé publique (publishable). Jamais la clé `service_role` / `secret`.
- Vivier (flux Explorer) : Gmail dédié + `scripts/vivier/gmail.gs` → `vivier_recevoir` ; lecture par `scripts/vivier/traiter.mjs` (workflow `vivier.yml`, secret `VIVIER_CLE`) ou par l'app d'un membre connecté ; `vivier_enrichir` partage la fiche complète lue avec + Heden.

## Sécurité, non négociable
- Ne jamais saisir, demander ni écrire dans le dépôt un mot de passe, une clé ou un jeton : le propriétaire les colle lui-même (clé du vivier, `VIVIER_CLE`, `GITHUB_JETON`). Le dépôt est public.
- Ne pas créer de comptes, ne pas contourner de captcha.
- Pas d'aspiration automatique des portails (risque juridique) : + Heden lit seulement la page que l'utilisateur regarde, le vivier seulement les alertes e-mail.

## Façon de travailler
- Réponses courtes, en français. Poser une question quand la demande est floue ; proposer une migration ou un changement de structure quand c'est utile.
