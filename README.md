# Le défi lecture

Le défi lecture de l'église : **90 jours** (27 septembre → 25 décembre 2026), **3 000 pages** à lire ensemble,
chacun à son rythme. En ligne : **https://defi-lecture.vercel.app**

|                                  Avant le départ                                   |                                       Pendant le défi                                       |                                       Profil d'un lecteur                                        |
| :--------------------------------------------------------------------------------: | :-----------------------------------------------------------------------------------------: | :----------------------------------------------------------------------------------------------: |
| <img src="docs/avant-depart.jpg" width="250" alt="Page d'accueil avant le départ"> | <img src="docs/pendant-le-defi.jpg" width="250" alt="Compteur et lecteurs pendant le défi"> | <img src="docs/profil.jpg" width="250" alt="Profil avec la série et le calendrier des 90 jours"> |

<sub>Captures faites avec des prénoms fictifs.</sub>

## Ce que fait le site

- **Inscription** avec un prénom et un objectif (100, 300 ou 500 pages), sans compte ni mot de passe.
- **Ajout des pages lues** à partir du 27 septembre ; chaque ajout peut être annulé depuis l'historique.
- **Compteur commun** des 3 000 pages. Dès le premier jour, la page d'accueil s'efface d'elle-même pour laisser
  le compteur et les lecteurs en haut.
- **Séries 🔥** : jours de lecture d'affilée. La série casse à minuit à la fin du jour qui suit la dernière lecture ;
  le sablier ⏳ apparaît 18 h après la dernière lecture.
- **Calendrier des 90 jours** dans chaque profil, et classements (pages, séries, objectif).
- **Installable sur l'écran d'accueil** du téléphone, comme une app.

## Organisation du code

```
public/
  index.html        la page
  style.css         la mise en forme
  app.js            le fonctionnement de la page
  domain.js         les règles communes à la page et au serveur (dates, séries, vérifications)
  sw.js, manifest.webmanifest, *.png   l'app sur l'écran d'accueil
api/                les fonctions serveur Vercel : state, profile, participants, entries
lib/db.js           l'accès à la base de données
test/               les tests (sans base de données, date simulée)
scripts/            outil pour redessiner les icônes
docs/               les captures de ce README
```

Aucune dépendance à installer : Node 22 suffit.

## Travailler sur le site

1. Crée une branche et pousse-la : Vercel publie un **lien d'aperçu** de ta branche (pour l'instant, seul le
   propriétaire du projet Vercel peut l'ouvrir). Les aperçus ont leur **propre espace de données** : on y teste sans
   toucher aux vrais lecteurs.
2. Ouvre une pull request. Une fois fusionnée dans `main`, le site en ligne se met à jour tout seul (environ 30 s).
3. Avant de pousser :

   ```
   npm test                       # tests du serveur et des séries
   npx prettier@3 --write .       # mise en forme du code
   ```

## Données

Les inscrits et leurs pages sont dans une base **Upstash Redis** branchée par Vercel. Les clés d'accès restent dans
les réglages Vercel : ne jamais ajouter de fichier `.env` au dépôt.
