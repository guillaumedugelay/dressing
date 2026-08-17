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
  │                   (Vogue, Hypebeast, WWD, WhoWhatWear)│
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
| Coût de l'API Claude | **≈ 0,16 $ par passage, soit ≈ 8 $ par an** (mesuré, voir section 7) |
| Fonctionne hors ligne | oui, sur la dernière version téléchargée |
| Auditable | `tendances.json` est versionné dans git : chaque révision hebdomadaire est lisible et réversible |

## 3. Les sources réellement exploitables

État vérifié en août 2026.

### Gratuites et légitimes — le socle

- **Flux RSS de la presse mode.** Vogue, Hypebeast, Who What Wear, WWD. Un
  flux RSS est publié *pour* être consommé par des programmes : aucune
  ambiguïté juridique. **Mesuré le 14 août 2026 : les quatre répondent, pour
  90 articles par passage.**
- **Reddit — écarté après essai.** Les points d'accès JSON publics répondent
  désormais `403` sans jeton OAuth. Les rebrancher demanderait de créer une
  application Reddit et d'en déposer les identifiants en secrets GitHub ;
  reporté tant que les flux de presse suffisent.

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
  "sources": ["Vogue", "Hypebeast", "WWD"],
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

L'application charge ce fichier et lui applique les mêmes mécanismes de
notation que ses règles de composition. Le moteur n'a presque pas changé :
seule la table des règles est devenue mobile.

### Deux garde-fous appris du premier passage réel

Le premier corpus généré, le 15 août 2026, a produit une règle
`categorie: chaussures` valant +1. Or **toute tenue comporte des chaussures** :
la règle s'ajoutait à chaque candidate sans jamais les départager. Même chose
pour `haut` et `bas`. Seuls `manteau`, `pull`, `robe` et `accessoire` sont
facultatifs, donc discriminants — le script écarte désormais les autres, et la
consigne l'explique.

La cause profonde mérite d'être notée : la presse disait « chaussures plates
confortables », une nuance que le vocabulaire ne sait pas exprimer. Le modèle
l'a rabattue sur l'approximation la plus proche plutôt que de l'abandonner. La
consigne lui demande maintenant explicitement de **renoncer** à une tendance
inexprimable : mieux vaut dix règles justes que douze dont deux sont fausses.

### Le vocabulaire s'est agrandi, sans rien demander à personne

Motif, longueur et matière ont été ajoutés le 17 août 2026. Les règles de
tendance peuvent désormais dire « les jupes longues montent » ou « le lin
domine », là où elles se rabattaient sur la catégorie.

Ces trois champs **ne sont demandés à personne** : l'analyse par photo les
remplit, « non précisé » reste neutre pour le moteur, et ils sont rangés dans
une section repliée de la fiche.

### Ce qui échappe encore au vocabulaire

Un col, une coupe de chaussure, un détail de construction : rien ne les
exprime. Ces tendances ne sont plus **abandonnées** pour autant — elles
reçoivent le type `descriptive` et sont conservées en clair dans le corpus :

```json
{ "type": "descriptive", "texte": "bottines à bout carré",
  "poids": 1.2, "note": "le bout carré revient" }
```

Le moteur ne sait pas les appliquer et les ignore. Elles attendent l'étape
suivante : un rapprochement entre ces phrases et les **descriptions** des
pièces, produites par l'analyse photo. Cette étape tournera sur l'ordinateur,
comme l'analyse, et écrira une affinité par pièce que l'application n'aura
plus qu'à lire.

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
| Clé d'API Anthropic, déposée en secret GitHub | toi | ≈ 0,67 $ par mois (section 7) |
| Compte affilié Awin (facultatif) | toi | gratuit |
| Script de collecte et de synthèse | moi | — |
| Tâche programmée GitHub Actions | moi | gratuit |
| Chargement et cache dans l'application | moi | — |
| Curseur classique ↔ tendance | moi | — |

## 7. Ce que ça coûte, et pourquoi

Mesuré sur une collecte réelle du 14 août 2026 : **90 articles, 22 786
caractères, environ 6 200 jetons d'entrée.**

| Poste | Volume | Tarif Claude Opus 5 | Coût |
|---|---|---|---|
| Téléchargement des flux | 90 articles | — | **0 $** |
| Entrée (la collecte envoyée au modèle) | ≈ 6 200 jetons | 5 $ / million | ≈ 0,03 $ |
| Sortie (les règles, plus le raisonnement) | ≈ 5 000 jetons | 25 $ / million | ≈ 0,13 $ |
| **Total par passage** | | | **≈ 0,16 $** |

Soit **≈ 0,67 $ par mois** et **≈ 8 $ par an**.

### Le coût ne suit pas les flux téléchargés

C'est le point contre-intuitif. Télécharger les flux ne coûte rien — c'est du
HTTP ordinaire. Et le texte collecté ne représente que **20 % de la facture** :
les 80 % restants sont ce que le modèle *produit*, essentiellement sa propre
réflexion avant d'écrire les règles, dont le volume est à peu près constant.

Conséquence : doubler le nombre de sources ferait passer un passage de 0,16 $ à
0,19 $. Ajouter des flux est donc presque gratuit ; c'est la fréquence des
passages qui compte.

### Les leviers, si le coût devenait un sujet

| Levier | Effet |
|---|---|
| `MODELE=claude-sonnet-5 EFFORT=medium` | agit sur les 80 % — la baisse la plus efficace |
| Espacer à un passage tous les quinze jours | divise la facture par deux |
| Utiliser Claude Sonnet 5 plutôt qu'Opus 5 | environ 40 % moins cher, au prix d'une lecture moins fine |
| Réduire `PLAFOND` ou `EXTRAIT` dans `collecte.mjs` | agit sur les 20 % — effet marginal |

À ce niveau de dépense, aucun de ces réglages ne se justifie ; ils sont
documentés pour le jour où la chaîne grossirait.

**Choix retenu : Claude Opus 5 à effort élevé.** Dégager des tendances d'une
prose éditoriale demande du jugement, pas de l'extraction — contrairement à
l'analyse des photos, répétée cinq cents fois, qui tourne sur Sonnet 5. À
0,16 $ la semaine, économiser ici n'aurait pas de sens. À revoir quand la
chaîne aura tourné quelques semaines et qu'on pourra comparer des corpus réels
plutôt que spéculer :

```bash
MODELE=claude-sonnet-5 EFFORT=medium node outils/synthese.mjs < corpus.json
```

## 8. Ce qui restera vrai malgré tout

Une chaîne hebdomadaire donne une tendance **datée à la semaine**, dérivée de
sources généralistes. Ce n'est pas la lecture d'un styliste qui te connaît, et
ce ne le sera jamais. La partie qui te ressemble vraiment restera celle que
l'application apprend de toi — le bouton *Je porte ça* et les avis. La
tendance est un ingrédient de plus, pas le chef d'orchestre.
