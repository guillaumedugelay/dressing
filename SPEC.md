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
| Réseau | Aucun appel externe. La météo est saisie manuellement |

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
| `dehors` | oui / non | résiste à la pluie et à la neige |
| `photo` | JPEG redimensionné à 640 px | reconnaissance visuelle |
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

**Récence.** Une pièce portée dans les cinq derniers jours est pénalisée,
d'autant plus fortement qu'elle est récente.

Les trois tenues affichées diffèrent entre elles d'au moins deux pièces,
pour proposer un choix et non trois variantes de la même idée.

## 5. Écrans

**Aujourd'hui** — quatre boutons météo (soleil, nuages, pluie, neige), trois
boutons température, trois boutons activité (travail, loisir, vacances),
puis `Proposer des tenues`. Chaque proposition s'affiche en une bande de
vignettes, avec `j'aime`, `je n'aime pas` et `Je porte ça`.

**Garde-robe** — grille de photos filtrable par catégorie, ajout et
modification d'une pièce.

**Journal** — historique des tenues portées, pièces jamais mises, chargement
ou retrait de la garde-robe d'exemple, boutons d'export et d'import.

## 5 bis. Garde-robe d'exemple

Vingt-deux pièces passe-partout et sans photo — hauts, bas, pulls, manteaux,
chaussures, accessoires — chargeables en un bouton depuis le Journal ou depuis
la garde-robe vide. Elles couvrent les quatre températures et les trois
activités, ce qui permet d'essayer les suggestions avant d'avoir photographié
quoi que ce soit. Le retrait ne touche pas aux pièces personnelles ; il
supprime aussi les tenues du journal qui contenaient une pièce d'exemple.

## 6. Hors périmètre de la première version

Météo automatique par géolocalisation, notifications, partage entre
plusieurs personnes, reconnaissance automatique du vêtement sur la photo,
valise de voyage. Toutes restent possibles ensuite.
