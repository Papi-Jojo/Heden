# Mise en route de Supabase pour Heden

1. **Créer le projet** : supabase.com → New project. Nom : `heden`. Région : Paris (eu-west-3) ou Francfort. Notez le mot de passe de la base quelque part, il ne servira pas au site.
2. **Créer les tables** : SQL Editor → New query → coller tout le contenu de `schema.sql` → Run. Le message attendu est « Success. No rows returned ».
   Puis, de la même façon, `photos.sql` : il crée la table des photos et l’espace de stockage privé « photos » avec ses règles d’accès.
3. **Adresses autorisées** : Authentication → URL Configuration.
   - Site URL : `https://papi-jojo.github.io/Heden/`
   - Redirect URLs : ajouter `https://papi-jojo.github.io/Heden/**`
4. **Code à 6 chiffres dans l'e-mail** (indispensable sur téléphone, quand le lien s'ouvre dans l'application Mail plutôt que dans le navigateur) : Authentication → Emails → Templates → **Magic Link**. Remplacer le contenu par :

   ```html
   <h2>Connexion à Heden</h2>
   <p>Votre code : <strong style="font-size:22px;letter-spacing:4px">{{ .Token }}</strong></p>
   <p>Ou ouvrez ce lien sur l'appareil où vous avez demandé la connexion :</p>
   <p><a href="{{ .ConfirmationURL }}">Se connecter à Heden</a></p>
   ```

   Faire de même pour le modèle **Confirm signup** (premier envoi à une nouvelle adresse).
2 bis. **Cartes de groupe** : de la même façon, coller et exécuter `groupe.sql` (critères communs des cartes partagées).
2 ter. **Garde-fous** : de la même façon, `limites.sql` (taille maximale des noms et des données, nombre de cartes et de membres).
2 quater. **Vivier d'annonces commun** (adresse d'alertes de Heden) :
   - coller et exécuter `vivier.sql` ;
   - créer la clé du vivier, dans une nouvelle requête : `insert into vivier_cles(cle, nom) values (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 'gmail') returning cle;` et copier la valeur affichée (elle reste secrète : ne la mettez ni dans le dépôt ni dans `config.js`) ;
   - créer un compte Gmail dédié (par exemple heden.alertes@gmail.com), y installer `scripts/vivier/gmail.gs` en y collant la clé ;
   - avec cette adresse, créer des alertes larges sur les sites (Paris, achat et location) : chaque e-mail reçu nourrit le vivier, que tous les membres connectés voient dans Annonces.
   - pour que le vivier se remplisse toutes les 10 minutes sans qu'un membre ait l'app ouverte : GitHub > Settings > Secrets and variables > Actions > New repository secret, nom `VIVIER_CLE`, valeur : la même clé. Le workflow « Vivier (alertes → annonces) » lit alors les e-mails, situe les rues (Base Adresse Nationale) et retrouve les DPE officiels (ADEME).
   Pour changer de clé : `delete from vivier_cles;` puis recréer (et mettre à jour le script Gmail et le secret GitHub).
5. **Récupérer les clés** : Project Settings → API (ou Data API / API Keys) :
   - Project URL (`https://xxxx.supabase.co`)
   - clé publique `anon` ou `publishable`
   Les coller dans `config.js` à la racine du dépôt. Ne jamais y mettre la clé `service_role` / `secret`.

Le réveil automatique (`.github/workflows/reveil-supabase.yml`) interroge la base deux fois par semaine pour éviter la mise en pause du projet gratuit après sept jours sans visite.

Limite connue de l'offre gratuite : Supabase envoie peu d'e-mails de connexion par heure avec son serveur d'envoi intégré. Pour un groupe d'amis cela suffit ; au-delà, brancher un service d'envoi (Authentication → Emails → SMTP).
