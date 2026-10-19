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
5. **Récupérer les clés** : Project Settings → API (ou Data API / API Keys) :
   - Project URL (`https://xxxx.supabase.co`)
   - clé publique `anon` ou `publishable`
   Les coller dans `config.js` à la racine du dépôt. Ne jamais y mettre la clé `service_role` / `secret`.

Le réveil automatique (`.github/workflows/reveil-supabase.yml`) interroge la base deux fois par semaine pour éviter la mise en pause du projet gratuit après sept jours sans visite.

Limite connue de l'offre gratuite : Supabase envoie peu d'e-mails de connexion par heure avec son serveur d'envoi intégré. Pour un groupe d'amis cela suffit ; au-delà, brancher un service d'envoi (Authentication → Emails → SMTP).
