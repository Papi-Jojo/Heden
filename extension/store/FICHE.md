# Publier l'extension Heden sur le Chrome Web Store

Publication « non répertoriée » : l'extension n'apparaît pas dans les recherches du Store, seules les personnes qui ont le lien peuvent l'installer. Chrome la met ensuite à jour tout seul.

## 1. Créer le compte développeur (une fois, 5 $)

1. Aller sur https://chrome.google.com/webstore/devconsole avec le compte Google qui gérera l'extension.
2. Accepter le contrat développeur et payer les frais d'inscription (5 $, une seule fois).
3. Renseigner l'adresse e-mail de contact et la vérifier (le Store l'exige avant toute publication).

## 2. Envoyer le paquet

1. Télécharger le paquet pour le Store : https://papi-jojo.github.io/Heden/heden-extension-store.zip (ne pas le décompresser : c'est ce fichier qu'on envoie).
2. Dans la console : « Nouvel élément » → choisir `heden-extension-store.zip`.

## 3. Onglet « Fiche Play Store » (Store listing)

- **Description** (copier-coller) :

  > Heden envoie dans votre app Heden les annonces immobilières que vous consultez sur SeLoger, PAP, Leboncoin, Bien'ici, Jinka et d'autres sites.
  >
  > Sur une liste de résultats, les annonces affichées partent dans Explorer, le flux partagé avec vos proches, avec ce que le site donne pour les afficher (description, étage, DPE, quartier). Sur une annonce ouverte, sa fiche complète (photos, étage, DPE, rue) suit. Les prix qui baissent et les annonces retirées sont mis à jour.
  >
  > L'extension ne lit que les pages que vous ouvrez vous-même. Elle ne charge aucune autre page et ne clique sur rien. Il faut un compte Heden et l'onglet Heden ouvert.

- **Catégorie** : Productivité (ou « Outils »)
- **Langue** : Français
- **Icône** : `icones/128.png` du paquet (déjà incluse ; si demandée : https://papi-jojo.github.io/Heden/extension/icones/128.png)
- **Captures d'écran** (1280 × 800) : `capture-1-bulle.png`, `capture-2-explorer.png` (dossier `extension/store/` du dépôt)
- **Petite vignette promotionnelle** (440 × 280) : `promo-440x280.png`
- **Site officiel** : https://papi-jojo.github.io/Heden/

## 4. Onglet « Pratiques de confidentialité »

- **Objectif unique** :
  > Envoyer à l'app Heden de l'utilisateur les annonces immobilières des pages qu'il consulte, pour les noter et les partager avec ses proches.
- **Justification des autorisations** :
  - `storage` : garder le réglage de lecture automatique, le compteur du jour et les pages en attente quand Heden n'est pas ouvert.
  - `scripting` : relier l'extension à un onglet Heden déjà ouvert avant l'installation.
  - Script de page au chargement (`ecoute.js`) : garde une copie des réponses d'annonces que le site envoie à sa propre page, pour les lire avec elle ; aucune requête de plus.
  - **Autorisations d'hôte** (sites immobiliers) : lire les annonces des pages de ces sites que l'utilisateur ouvre.
  - **Autorisation d'hôte** (papi-jojo.github.io/Heden) : transmettre les annonces à l'onglet Heden.
- **Code distant** : « Non, je n'utilise pas de code distant ».
- **Utilisation des données** : cocher uniquement **Contenu du site Web**. Puis cocher les trois certifications (pas de vente, pas d'usage hors de l'objectif unique, pas d'usage pour la solvabilité ou le crédit).
- **Règles de confidentialité (URL)** : https://papi-jojo.github.io/Heden/confidentialite.html

## 5. Onglet « Distribution »

- **Visibilité** : **Non répertoriée**.
- **Régions** : toutes (ou France seulement).
- Envoyer pour examen. L'examen prend en général de quelques jours à deux semaines ; les autorisations sur plusieurs sites peuvent l'allonger.

## 6. Après la publication

Envoyer le lien de la fiche (forme `https://chromewebstore.google.com/detail/heden/<identifiant>`) : Heden proposera alors « Installer depuis le Chrome Web Store » au lieu du dossier à charger à la main. Pour les versions suivantes : console → l'élément Heden → « Paquet » → envoyer le nouveau `heden-extension-store.zip`.
