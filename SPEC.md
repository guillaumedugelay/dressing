# Dressing — spécification

Application web personnelle de garde-robe, consultée le matin sur iPhone.
Elle répertorie les vêtements et propose des tenues adaptées à la météo, à
l'activité de la journée et au style de son propriétaire.

## 1. Contraintes et choix techniques

| Point | Décision |
|---|---|
| Plateforme | Application web, ouverte depuis Safari iOS, ajoutée à l'écran d'accueil |
| Développement | Poste Windows — pas de Mac, donc pas de compilation iOS native |
| Hébergement | Page unique autonome publiée sur une URL stable |
| Stockage | 100 % local au téléphone (IndexedDB). Aucune donnée envoyée nulle part |
| Sauvegarde | Export / import d'un fichier JSON, à la demande |
| Réseau | Facultatif : prévision météo et corpus de tendances. L'app reste utilisable hors ligne |

Conséquence assumée : effacer les données de Safari efface la garde-robe.
D'où l'export JSON, à faire après chaque grosse session de saisie.

## 2. Modèle de données

### Vêtement

| Champ | Valeurs | Rôle |
|---|---|---|
| `nom` | texte libre | identification |
| `categorie` | haut, bas, robe, pull, manteau, chaussures, accessoire | composition de la tenue |
| `chaleur` | 1 (léger) → 5 (très chaud) | adéquation à la température |
| `formalite` | 1 (sport) → 4 (habillé) | adéquation à l'activité |
| `couleurs` | 1 à 2 parmi 14 | harmonie chromatique |
| `saisons` | 0 à 4 saisons | **filtre strict** — aucune cochée = toute l'année |
| `coupe` | ajusté, droit, ample | contraste de silhouette |
| `dehors` | oui / non | résiste à la pluie et à la neige |
| `photo` | JPEG redimensionné à 640 px | reconnaissance visuelle ; les couleurs y sont lues automatiquement |
| `porteLe` | liste de dates | récence et statistiques |

### Tenue portée

Une entrée par jour validé : date, liste d'identifiants de vêtements,
météo et activité du jour. C'est la matière première de l'apprentissage.

### Avis

Un `j'aime` ou `je n'aime pas` sur une proposition, stocké par paire de
vêtements.

## 3. Composition d'une tenue

Une tenue valide est l'une de ces deux bases :

- haut + bas
- robe

à laquelle s'ajoutent obligatoirement des chaussures, puis, selon la
température, une couche intermédiaire (pull), une couche extérieure (manteau)
et au plus un accessoire. Aucune de ces trois additions n'est imposée : c'est
la note de chaleur qui met l'écharpe en janvier et la casquette en juillet.

## 4. Moteur de suggestion

Chaque tenue candidate reçoit un score, somme de six termes.

**Chaleur.** La somme des indices de chaleur des pièces est comparée à une
cible dérivée de la température déclarée : chaud → 4, doux → 7, frais → 11,
froid → 14. Chaque point d'écart coûte 1,5.

**Formalité.** L'activité fixe une cible : travail → 3, loisir → 2,
vacances → 1,5. L'écart moyen des pièces à cette cible coûte 1,4 par point.
Un écart de plus de 2 entre deux pièces de la même tenue est pénalisé
séparément : c'est ce qui interdit les baskets de sport sous un costume.

**Cohérence saisonnière.** La somme des chaleurs peut tomber juste sur un
assemblage absurde — un short sous une doudoune, des sandales sous une parka.
Un bas ou des chaussures d'été portent donc une pénalité proportionnelle à la
couche la plus chaude de la tenue.

**Météo.** Sous la pluie ou la neige, des chaussures `dehors` valent +3, un
manteau `dehors` +2, et des chaussures non protégées coûtent 2.

**Couleurs.** Les neutres — noir, blanc, gris, beige, marine, denim, marron —
s'accordent avec tout. Deux couleurs vives différentes coûtent 1,5 ; trois
coûtent 3.

**Style appris.** Pour chaque paire de vêtements de la tenue, un score
d'affinité : `1 × (fois portés ensemble) + 0,8 × (j'aime) − 1,2 ×
(je n'aime pas)`. C'est ce terme qui, au fil des semaines, fait émerger le
style réel. Deux garde-fous, ajoutés après des essais qui proposaient un
polo-baskets pour aller travailler :

- une tenue portée pour une **autre activité** ne compte que pour 0,35 — une
  habitude prise au bureau ne fait pas loi en vacances ;
- le bonus d'habitude est **atténué à mesure que la tenue s'éloigne** de la
  formalité et de la température visées. Le style appris départage des tenues
  déjà correctes ; il n'en rachète pas une qui ne convient pas. Les rejets,
  eux, s'appliquent toujours pleinement.

**Rotation.** L'objectif est que la garde-robe tourne entièrement. Deux
effets opposés, volontairement dissymétriques :

- une pièce portée dans les cinq derniers jours est **écartée fermement**,
  d'autant plus qu'elle est récente ;
- une pièce oubliée est **remontée** : +1,4 si elle n'est jamais sortie du
  placard, +1,1 au-delà de deux mois, +0,7 au-delà d'un mois.

**Style contemporain.** Un corpus de règles daté (voir section 6) :
contraste de silhouette entre le haut et le bas, camaïeu, accent unique sur
base neutre, chaussure qui tire la tenue vers le haut, accessoire qui signe.

### La règle qui gouverne les bonus

Le style appris et le bonus d'oubli sont tous deux multipliés par un facteur
qui s'annule à mesure que la tenue s'éloigne de la formalité et de la
température visées. **Ils départagent des tenues déjà adaptées ; ils n'en
imposent jamais une qui ne convient pas.** Sans cette règle, le moteur
proposait un short et des baskets pour aller travailler, au motif qu'ils
n'avaient jamais été portés. Les pénalités, elles, s'appliquent toujours
pleinement.

Les trois tenues affichées diffèrent entre elles d'au moins deux pièces,
pour proposer un choix et non trois variantes de la même idée.

## 5. Écrans

**Aujourd'hui** — si un lieu est configuré, un bandeau donne la prévision du
jour et pré-règle les boutons. Puis quatre boutons météo (soleil, nuages,
pluie, neige), quatre boutons température, trois boutons activité (travail, loisir, vacances) et
quatre boutons saison, celle du jour étant présélectionnée d'après la date.
Puis `Proposer des tenues`. Chaque proposition s'affiche en une bande de
vignettes, avec `j'aime`, `je n'aime pas` et `Je porte ça`. En dessous,
`Montre-moi autre chose` relance en écartant les pièces déjà vues, et la
révision du corpus de style est rappelée.

**Garde-robe** — grille de photos filtrable par catégorie, ajout et
modification d'une pièce.

**Journal** — réglage de la météo automatique (position ou nom de ville),
réglage classique ↔ tendance, historique des tenues portées,
`Ce que tu ne portes plus`
(les pièces jamais mises ou délaissées depuis plus de trente jours, nommées
et datées), pourcentage de garde-robe déjà portée, chargement ou retrait de
la garde-robe d'exemple, boutons d'export et d'import.

## 5 bis. Garde-robe d'exemple

Vingt-deux pièces passe-partout et sans photo — hauts, bas, pulls, manteaux,
chaussures, accessoires — chargeables en un bouton depuis le Journal ou depuis
la garde-robe vide. Elles couvrent les quatre températures et les trois
activités, ce qui permet d'essayer les suggestions avant d'avoir photographié
quoi que ce soit. Le retrait ne touche pas aux pièces personnelles ; il
supprime aussi les tenues du journal qui contenaient une pièce d'exemple.

## 5 ter. Météo automatique

Une page web sur iPhone **ne peut pas s'exécuter à heure fixe** : iOS ne
réveille pas une application épinglée pour lui faire faire du réseau en
arrière-plan. Le relevé se fait donc à l'ouverture de l'application.

Ce n'est pas un pis-aller. Le relevé porte sur la **prévision de la journée** —
temps dominant et température maximale ressentie — et non sur l'instant : ce
qu'il fera à quatorze heures décide de la tenue, pas ce qu'il fait au réveil.

| Point | Décision |
|---|---|
| Source | [Open-Meteo](https://open-meteo.com) — gratuit, sans clé ni compte |
| Lieu | position de l'appareil (nommée par géocodage inverse OpenStreetMap), ou nom de ville cherché dans l'application |
| Correspondance | codes temps de l'OMM → soleil / nuages / pluie / neige |
| Température | ressenti maximal → chaud ≥ 22°, doux ≥ 12°, frais ≥ 3°, froid < 3° |
| Cache | un relevé par jour, conservé : rouvrir hors ligne retrouve celui du matin |
| Repli | sans lieu, sans réseau ou position refusée, les boutons restent manuels |

Le relevé **pré-règle** les boutons, il ne les verrouille pas : un appui sur un
autre bouton reste souverain, et le bandeau le dit explicitement.

## 5 quater. Lecture des couleurs sur la photo

À la prise de vue, l'application lit les couleurs dominantes du vêtement et
pré-coche les pastilles correspondantes. **Tout se passe dans le téléphone** :
les pixels sont analysés sur place, la photo ne part nulle part.

L'image est échantillonnée sur ses 60 % centraux, là où se trouve le vêtement,
pour éviter le fond. Chaque pixel est classé non pas par ressemblance avec les
pastilles de la palette — un beige photographié ne tombe jamais pile sur
`#CDBBA0` — mais par teinte, saturation et clarté, ce qui résiste aux
variations d'éclairage. Une seconde couleur n'est proposée que si elle occupe
plus d'un quart de la pièce, faute de quoi un reflet deviendrait un motif.

La lecture **propose** : elle ne s'applique que si aucune couleur n'a encore
été choisie, et le premier clic sur une pastille efface la mention.

Mesuré sur 17 cas, dont un marine sous-exposé, un jean délavé et un noir
photographié (jamais pur) : **17 sur 17**.

Ce que cette lecture ne sait pas faire : deviner la catégorie, la coupe, la
formalité ou la chaleur. Ces champs restent à remplir à la main — les déduire
supposerait d'envoyer la photo à un modèle de vision, décision non prise.

## 6. Composition et tendances

Deux termes distincts, et il faut les garder distincts.

**La composition** est un jeu de principes durables, écrits dans le code et
indépendants de la saison :

| Règle | Effet |
|---|---|
| Contraste de silhouette | +1,2 si un volume ample répond à une coupe ajustée ; −1,0 si tout est ample, −0,5 si tout est ajusté |
| Camaïeu | +1,0 si toutes les couleurs marquées relèvent d'une même famille chromatique |
| Accent unique | +0,7 pour une seule couleur vive sur une base neutre |
| Ancrage par la chaussure | +0,4 si la chaussure est au moins aussi habillée que le reste ; −0,8 si elle le tire nettement vers le bas |
| Accessoire | +0,3 — un accessoire signe une tenue ; la composition n'en autorise qu'un |

**Les tendances** sont un corpus mobile, chargé depuis `tendances.json` et
régénéré chaque semaine hors de l'application (voir [TENDANCES.md](TENDANCES.md)
pour la chaîne complète). L'application le télécharge au lancement, le range
dans IndexedDB, et continue de fonctionner hors ligne sur la dernière version
connue.

Quatre formes de règle, toutes exprimées dans le vocabulaire fermé de
l'application — 14 couleurs, 3 coupes, 7 catégories :

| Forme | Ce qu'elle dit |
|---|---|
| `silhouette` | une combinaison de coupes haut/bas qui fonctionne |
| `couleur` | une couleur qui monte, ou qui reflue si le poids est négatif |
| `association` | deux couleurs qui s'accordent cette saison |
| `categorie` | une catégorie mise en avant, éventuellement dans une coupe précise |

La somme des règles est bornée à ±3, puis multipliée par le réglage
**classique ↔ tendance** du Journal — de 0 (ignorer) à 2 (suivre franchement).
La date du corpus est rappelée sous les propositions, et l'application indique
si les règles ont été relevées automatiquement ou écrites à la main.

Enfin, le bonus de tendance obéit à la règle qui gouverne tous les bonus : il
s'éteint à mesure que la tenue s'éloigne de l'occasion. Aucune saison ne fera
porter un short au bureau.

## 7. Tenir la charge à 500 pièces

Énumérer toutes les combinaisons devient impossible à cette échelle — une
garde-robe de 500 pièces en produit des milliards. Le moteur **présélectionne**
donc les meilleures candidates par catégorie (7 hauts, 6 bas, 5 paires de
chaussures, 3 pulls, 3 manteaux, 4 accessoires) sur un score individuel
combinant proximité de formalité, plausibilité thermique et bonus d'oubli,
plus une **part de hasard**. Ce hasard sert deux fins : deux demandes
identiques ne donnent pas deux fois la même tenue, et la garde-robe tourne.

Mesuré sur 500 pièces : **140 à 190 ms** par demande.

Le bouton *Montre-moi autre chose* écarte les pièces déjà affichées et
relance. La pénalité correspondante s'applique dans la notation des tenues et
non dans la seule présélection — sans quoi une petite garde-robe, où la
présélection ne filtre rien, reproposerait à l'identique.

## 8. Hors périmètre de cette version

Météo automatique par géolocalisation, notifications, partage entre
plusieurs personnes, reconnaissance automatique du vêtement sur la photo,
valise de voyage. Toutes restent possibles ensuite.
