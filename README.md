# Le défi lecture

Site du défi lecture de l'église : 90 jours (27 septembre → 25 décembre 2026), 3 000 pages ensemble.
En ligne : https://defi-lecture.vercel.app

## Comment c'est fait

- `public/index.html` : la page (HTML, CSS et JavaScript dans un seul fichier).
- `public/domain.js` : les règles partagées par la page et le serveur (dates, séries 🔥, validations).
- `api/` : les fonctions serveur Vercel (`state`, `profile`, `participants`, `entries`).
- `lib/db.js` : l'accès à la base (Upstash Redis, branchée par Vercel ; les clés ne sont jamais dans le code).
- `public/sw.js` + `public/manifest.webmanifest` : l'installation sur l'écran d'accueil.

## Contribuer

1. Crée une branche, fais tes changements, pousse-la : Vercel publie un **lien d'aperçu** de ta branche.
2. Ouvre une pull request ; une fois fusionnée dans `main`, le site en ligne se met à jour tout seul.
3. Avant de pousser, lance les tests (Node 22 ou plus) :

   ```
   node test/api.test.mjs
   node test/streak.test.mjs
   ```

Ne jamais ajouter de fichier `.env` au dépôt.
