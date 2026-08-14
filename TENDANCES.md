# Relier Dressing aux tendances

Comment l'application peut suivre les tendances du moment sans cesser d'être
une page statique, sans serveur à louer ni à maintenir.

## 1. Le contresens à éviter

Le réflexe est de dresser un serveur que l'application interrogerait à chaque
demande de tenue. C'est le mauvais découpage, pour trois raisons :

- **Le rythme.** Les tendances bougent par saisons, au mieux par semaines.
  Interroger le réseau à chaque demande de tenue, c'est mille fois trop
  souvent pour une information qui change douze fois par an.
- **La panne.** Un serveur dans la boucle, c'est une application qui ne
  répond plus quand le réseau tombe, le matin, au moment de s'habiller.
- **Le coût.** Un serveur qui tourne en continu se paie tous les mois, pour
  répondre à une poignée de requêtes par jour.

## 2. L'architecture retenue : une chaîne de production, pas un serveur

La tendance n'est pas une donnée à consulter en direct : c'est un **fichier à
régénérer chaque semaine**. Une tâche programmée collecte les sources, un
modèle de langage les synthétise en règles structurées, et le résultat est
déposé à côté de l'application, sur le même hébergement statique.

```
  ┌─ chaque lundi, GitHub Actions ────────────────────────┐
  │                                                       │
  │  1. collecte      flux RSS de la presse mode          │
  │                   API Reddit (forums vêtement)        │
  │                        │                              │
  │  2. synthèse      appel à l'API Claude :              │
  │                   prose éditoriale → règles chiffrées │
  │                        │                              │
  │  3. dépôt         tendances.json commité dans le dépôt│
  └────────────────────────┼──────────────────────────────┘
                           ▼
                  GitHub Pages sert le fichier
                           │
                           ▼
  l'app le télécharge au lancement, le range dans IndexedDB,
  et continue de fonctionner hors ligne avec la dernière version connue
```

Ce que cela donne :

| | |
|---|---|
| Serveur à maintenir | aucun |
| Coût d'hébergement | 0 € — GitHub Actions est gratuit sur dépôt public |
| Coût de l'API Claude | quelques centimes par semaine |
| Fonctionne hors ligne | oui, sur la dernière version téléchargée |
| Auditable | `tendances.json` est versionné dans git : chaque révision hebdomadaire est lisible et réversible |

## 3. Les sources réellement exploitables

État vérifié en août 2026.

### Gratuites et légitimes — le socle

- **Flux RSS de la presse mode.** Vogue, Business of Fashion, Hypebeast, Who
  What Wear, WWD. Un flux RSS est publié *pour* être consommé par des
  programmes : aucune ambiguïté juridique.
- **API Reddit.** Forums vêtement et style. API officielle, palier gratuit
  suffisant pour une collecte hebdomadaire. Signal utile : ce dont les gens
  parlent, pas ce que les marques poussent.

### Signal marchand — la meilleure approximation

- **Flux catalogues d'affiliation** (Awin, Rakuten). Gratuits avec un compte
  affilié. Ce que les enseignes mettent réellement en avant cette semaine est
  un indicateur de tendance plus fiable que le discours éditorial, parce
  qu'il engage leur argent.

### Payantes — hors de proportion ici

- **Heuritech** analyse les images des réseaux sociaux pour quantifier
  l'adoption réelle d'un vêtement. C'est l'outil sérieux du secteur, vendu
  aux marques, à un tarif d'entreprise.
- **Google Trends** : l'API officielle annoncée en juillet 2025 reste, un an
  après, une *alpha sur dossier* inaccessible au tout-venant. Les
  intermédiaires payants qui la revendent facturent à la requête.

### À exclure

Aspirer le contenu des sites de mode viole leurs conditions d'utilisation et
le droit d'auteur. La chaîne ne republie d'ailleurs jamais le texte des
articles : elle n'en conserve que des **règles dérivées**, chiffrées, sans
contenu rédactionnel.

## 4. Le vrai obstacle : traduire de la prose en score

Le blocage n'est pas de récupérer l'information, c'est de la rendre
calculable. La presse écrit « le pantalon fuselé cède la place à des volumes
plus larges, portés avec des hauts près du corps ». L'application, elle, ne
sait comparer que ce qu'elle mesure : 14 couleurs, 3 coupes, 7 catégories,
4 niveaux de formalité.

C'est exactement le travail d'un modèle de langage : lire la prose, et la
projeter sur ce vocabulaire. Le résultat attendu :

```json
{
  "revision": "2026-08-17",
  "sources": ["vogue.com/rss", "reddit.com/r/…"],
  "resume": "Volumes larges en bas, hauts ajustés. Bordeaux et…",
  "regles": [
    { "type": "silhouette", "haut": "ajuste", "bas": "ample", "poids": 1.8,
      "note": "la proportion de la saison" },
    { "type": "couleur",    "valeur": "marron", "poids": 1.2,
      "note": "les bruns dominent la rentrée" },
    { "type": "association","couleurs": ["marine", "marron"], "poids": 0.9 },
    { "type": "categorie",  "valeur": "manteau", "coupe": "ample", "poids": 0.7 }
  ]
}
```

L'application remplace alors son corpus figé — l'actuelle *révision août
2026* — par ce fichier, et applique les mêmes mécanismes de notation. Le code
du moteur ne change presque pas : seule la table des règles devient mobile.

### Ce que le vocabulaire actuel ne sait pas dire

Une tendance porte souvent sur la **matière** (lin, cuir, maille), le
**motif** (uni, rayé, imprimé) ou un **détail** (col, poche, taille haute).
Ces trois dimensions manquent au modèle de données. Les ajouter est simple
côté code, mais coûte trois champs à renseigner sur chaque pièce — décision à
prendre en connaissance de cause sur une garde-robe de 500 pièces.

## 5. Tendance et goût personnel : qui l'emporte ?

Les deux ne doivent pas se disputer le même terrain.

- Un **curseur « classique ↔ tendance »** dans l'application règle le poids
  du terme de tendance, de 0 (ignorer) à 2 (le suivre franchement). C'est un
  réglage, pas un arbitrage caché.
- Le **style appris** garde son terme propre, inchangé. Les tendances ne
  l'écrasent pas : elles s'ajoutent.
- La **règle des bonus reste souveraine** : comme le style appris et le bonus
  d'oubli, le terme de tendance est atténué à mesure que la tenue s'éloigne
  de l'occasion. Une tendance ne fera jamais porter un short au bureau.

## 6. Ce qu'il faut pour démarrer

| Élément | Qui | Coût |
|---|---|---|
| Clé d'API Anthropic, déposée en secret GitHub | toi | quelques centimes par mois |
| Compte Reddit développeur (facultatif) | toi | gratuit |
| Compte affilié Awin (facultatif) | toi | gratuit |
| Script de collecte et de synthèse | moi | — |
| Tâche programmée GitHub Actions | moi | gratuit |
| Chargement et cache dans l'application | moi | — |
| Curseur classique ↔ tendance | moi | — |

## 7. Ce qui restera vrai malgré tout

Une chaîne hebdomadaire donne une tendance **datée à la semaine**, dérivée de
sources généralistes. Ce n'est pas la lecture d'un styliste qui te connaît, et
ce ne le sera jamais. La partie qui te ressemble vraiment restera celle que
l'application apprend de toi — le bouton *Je porte ça* et les avis. La
tendance est un ingrédient de plus, pas le chef d'orchestre.
