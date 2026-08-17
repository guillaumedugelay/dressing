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

- **Flux RSS de la presse mode.** Vogue, Hypebeast, Who What Wear, WWD,
  Fashionista, Harper's Bazaar, Elle, Refinery29, Glamour. Un flux RSS est
  publié *pour* être consommé par des programmes : aucune ambiguïté juridique.
  **Mesuré le 17 août 2026 : les neuf répondent, pour 259 articles et 79 000
  caractères par passage.**

  Cinq flux ont été ajoutés le 17 août, sur le principe qu'un corpus tronqué
  est perdu pour toujours — une fenêtre RSS ne se rattrape pas la semaine
  suivante — et que la garde-robe grandira jusqu'à rendre exploitables des
  nuances aujourd'hui ignorées.

  Quatre candidats essayés et écartés le même jour : **Business of Fashion**
  répond, mais publie cent articles par semaine de nominations et de levées
  de fonds, qui auraient noyé le reste ; **Dazed** et **i-D** sont trop
  éditoriaux pour une garde-robe de tous les jours ; **Highsnobiety** fait
  double emploi avec Hypebeast. **The Cut** ne répond plus — 404.
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
  ],
  "vocabulaire": [
    { "terme": "taille basse",  "axe": "taille",   "occurrences": 3 },
    { "terme": "col polo",      "axe": "col",      "occurrences": 2 },
    { "terme": "coupe cigarette","axe": "tombé",   "occurrences": 1 }
  ]
}
```

L'application charge ce fichier et lui applique les mêmes mécanismes de
notation que ses règles de composition. Le moteur n'a presque pas changé :
seule la table des règles est devenue mobile.

### Le relevé de vocabulaire — le journal des manques

`vocabulaire` n'entre dans aucun calcul, et c'est voulu. Il relève **tout mot
concret de vêtement que le vocabulaire fermé ne sait pas dire**, qu'il fasse
tendance ou non, cité une fois ou vingt. Là où le type de règle `descriptive`
ne retient que les tendances inexprimables, le relevé ratisse plus large : il
ne sert pas à habiller quelqu'un cette semaine, mais à savoir **quels champs
manquent au modèle de données**.

C'est la réponse systématique à une question qui s'était posée à la main. En
août 2026, une règle avait rabattu « robe longue fluide » sur `categorie: robe`
faute de pouvoir dire la longueur, et il avait fallu le remarquer en relisant
onze notes. Le relevé rend ce constat automatique et cumulatif.

Il est **archivé sans rien faire** : chaque `tendances.json` hebdomadaire est
un commit de la tâche programmée, donc git en garde l'historique complet. Et
comme il s'agit d'un dérivé — des termes, jamais des phrases d'articles — il
est publiable sans la réserve qui interdit de republier la prose collectée.

Premier relevé réel, 17 août 2026 : **30 termes sur 12 axes.** Les plus
fournis étaient `texture` (dentelle, transparence, satin, daim, fourrure),
`détail` (bord coupé franc, découpes, capuche) et `chaussure` (bout fermé,
ballerines plates, sabots). Deux enseignements immédiats : la liste des
matières est trop courte — dentelle, satin, daim, fourrure et velours en sont
absents — et celle des motifs rabat pois, fleuri et vichy sur le seul
`imprime`. Élargir deux listes existantes coûte moins qu'ajouter un champ.

**Une réserve de méthode** : un relevé, c'est une semaine. Les occurrences
tournent autour de 1 à 3, et la mode a des semaines à thème. Attendre
plusieurs relevés avant de faire évoluer le modèle sur cette base.

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

Mesuré sur un passage réel du 17 août 2026, neuf sources et relevé de
vocabulaire compris : **259 articles, 79 194 caractères, 36 758 jetons
d'entrée et 6 898 de sortie.**

| Poste | Volume | Tarif Claude Opus 5 | Coût |
|---|---|---|---|
| Téléchargement des flux | 259 articles | — | **0 $** |
| Entrée (la collecte envoyée au modèle) | 36 758 jetons | 5 $ / million | ≈ 0,18 $ |
| Sortie (les règles, le relevé, le raisonnement) | 6 898 jetons | 25 $ / million | ≈ 0,17 $ |
| **Total par passage** | | | **≈ 0,36 $** |

Soit **≈ 1,50 $ par mois** et **≈ 19 $ par an**.

### La prévision de coût était fausse, et voici pourquoi

Ce document annonçait qu'un doublement des sources ferait passer le passage de
0,16 $ à 0,19 $, au motif que la sortie serait constante et dominerait la
facture. Le passage à neuf sources l'a démenti sur les deux termes : l'entrée
a été multipliée par six, et **la sortie a doublé elle aussi**, le relevé de
vocabulaire étant trente entrées à écrire en plus des règles.

Le vrai enseignement tient donc en une ligne : **l'entrée et la sortie
grandissent ensemble**, parce qu'un corpus plus riche donne plus à dire. La
répartition est aujourd'hui de moitié-moitié, et non de 20/80.

Cela reste 19 $ par an pour une veille hebdomadaire. Le levier qui compte
demeure la fréquence des passages, pas le nombre de flux.

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
