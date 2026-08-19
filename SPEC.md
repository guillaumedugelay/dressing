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
| `chaleur` | 1 (léger) → 4 (très chaud) | adéquation à la température — voir § 4 |
| `formaliteMin` / `formaliteMax` | 1 (sport) → 4 (habillé) | **intervalle** — adéquation à l'activité |
| `couleurs` | 1 à 2 parmi 14 | harmonie chromatique |
| `saisons` | 0 à 4 saisons | **filtre strict** — aucune cochée = toute l'année |
| `coupe` | ajusté, droit, ample | contraste de silhouette |
| `motif` | uni, rayé, carreaux, imprimé | un motif se porte seul |
| `longueur` | court, genoux, long — bas, robes et manteaux | prise pour les tendances |
| `matiere` | coton, lin, laine, denim, maille, cuir, soie, synthétique | prise pour les tendances |
| `dehors` | oui / non | résiste à la pluie et à la neige |
| `photo` | JPEG redimensionné à 640 px | reconnaissance visuelle ; les couleurs y sont lues automatiquement |
| `porteLe` | liste de dates | récence et statistiques |
| `description` | deux phrases, posées par l'analyse | mémoire de ce que la fiche ne sait pas stocker — matière, longueur, motif, détails |
| `confiance` / `doute` | posés par l'analyse par photo | signalent une fiche à relire ; effacés à l'enregistrement |

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
la note de chaleur qui décide du pull et du manteau. **L'accessoire, lui, ne
compte plus dans la chaleur** : un sac ou un serre-tête ne tient pas chaud, et
sa note déplaçait le total d'un cran sans rien dire du temps qu'il fait. Une
écharpe en janvier pose le problème inverse — le trancher suppose de savoir de
quel accessoire il s'agit, ce que le modèle ne sait pas encore dire.

## 4. Moteur de suggestion

Le moteur travaille en **deux temps, et il faut les garder distincts**.

1. **L'adéquation filtre.** La température, la saison, la météo et le type de
   journée disent si une tenue est *possible*. Ils ne notent rien.
2. **La note classe.** Parmi les tenues possibles, elle ne juge que le style :
   les pièces vont ensemble, la tenue est dans l'air du temps, elle ressemble
   à son propriétaire.

> Ce découpage date du 18 août 2026. Auparavant tout entrait dans une même
> somme, si bien qu'une tenue très tendance pouvait racheter son inadéquation
> et se faire proposer pour un temps où l'on grelotte. Une note de 4 ne
> voulait pas dire la même chose en août et en janvier ; maintenant si.

### Premier temps — l'adéquation, qui écarte

| Filtre | Rejette |
|---|---|
| Saison | une pièce dont les saisons cochées excluent celle du jour |
| Chaleur | **deux crans en dessous de la cible, un seul au-dessus** — une tenue légère en hiver n'est pas proposée, si tendance soit-elle |
| Assemblage | des pièces d'été sous une couche d'hiver, quand la somme tombe juste par accident |
| Registre | un écart moyen de plus d'un cran à la cible de la journée, ou une pièce sous le plancher exigé |
| Pluie et neige | des chaussures qui ne tiennent pas l'eau |

La cible se lit comme une somme de tenue : **chaud 3, doux 5, frais 7,
froid 9**. Trois pièces légères font 3, un pull moyen ajoute 2, un manteau
chaud 3, une doudoune 4.

**L'échelle est passée de cinq crans à quatre le 19 août 2026**, « léger » et
« fin » ayant fusionné. La distinction ne se voit pas sur une photo — le
modèle de vision lui-même hésitait — et personne ne la sent en s'habillant au
mois d'août. C'est elle qui produisait le classement erratique dont tout est
parti : la garde-robe vivant entière sur ces deux crans, un seul cran d'écart
faisait basculer les notes.

Le haut de l'échelle est conservé : une doudoune, un manteau de laine et un
gilet épais ne se valent pas, et c'est ce qui décidera des tenues d'hiver. On
n'a fusionné que là où ça coinçait.

La conversion est déterministe — 1 et 2 → léger, 3 → moyen, 4 → chaud,
5 → très chaud — donc **gratuite : aucune photo à renvoyer**. Elle s'applique
en place à la lecture, sur le patron déjà utilisé pour l'intervalle de
formalité, et son marqueur est porté par la pièce afin qu'un import d'ancien
export soit converti lui aussi. Sur la garde-robe réelle, 96 pièces deviennent
légères, 10 moyennes et 1 chaude — l'image honnête d'un vestiaire d'été.

**La tolérance est dissymétrique**, et c'est une mesure qui l'a voulu. Deux
crans de trop peu ne se sentent pas — entre léger et fin au mois d'août
personne ne tranche. Deux crans de trop couvert, en revanche, c'est un
vêtement entier en plus : un banc d'essai du 18 août 2026 a montré que **57 %**
des tenues proposées par temps chaud portaient une couche dont personne ne
veut à 22 degrés. Ramenée à un cran au-dessus, la proportion tombe à 32 %, et
ce qui reste est le seul vrai pull d'été de la garde-robe.

**Un filtre qui ne peut rien départager ne filtre pas, il vide.** Si aucune
paire de chaussures de la garde-robe ne résiste à l'eau, exiger la pluie ne
sélectionne rien : elle supprime toutes les tenues. Les filtres de ce genre ne
s'appliquent donc que si la garde-robe offre l'alternative. Sans cette
réserve, l'application n'aurait plus rien proposé le jour même de sa mise en
service, où il pleuvait sur Lyon.

Quand rien ne passe, l'application dit **pourquoi** — le motif de rejet le plus
fréquent — plutôt que de constater l'échec.

### Second temps — la note, qui ne juge que le style

Somme de cinq termes.

**Les pièces vont-elles ensemble ?** Deux pièces dont les intervalles de
formalité sont écartés jurent, quelle que soit l'occasion : un écart de plus
d'un cran coûte 2,5 par cran supplémentaire. C'est ce qui interdit le sweat à
capuche sous un pantalon de costume. Se juge sur les intervalles bruts.

> Ce point a failli m'échapper : rendre les pièces adaptables rapprochait
> artificiellement une veste de costume et des baskets, et neutralisait le
> garde-fou.

**Couleurs.** Les neutres — noir, blanc, gris, beige, marine, denim, marron —
s'accordent avec tout. Deux couleurs vives différentes coûtent 1,5 ; trois
coûtent 3.

**Composition.** Les principes durables du § 6, silhouette et motif compris.

> Les poids de silhouette ont été révisés le 18 août 2026 au banc d'essai. La
> coupe **droite** ne rapportait rien : ne jamais contraster équivalait à une
> pénalité de 1,2 face à toute tenue contrastée, alors que le droit est
> justement la coupe la plus portable. Sur garde-robe équilibrée, le jean brut
> sortait dans 3 % des tenues et le pantalon de costume dans 0 %. Et une
> **robe**, n'ayant pas de bas, ne déclenchait jamais la règle : les trois
> robes du banc sortaient à 0 %, 0 % et 4 %.
>
> Après correction — contraste ramené à 1,0, droit crédité de 0,6, robe de
> 0,5 — le jean passe à 9 % et les robes à 9-10 % chacune. Le balayage a
> montré qu'au-delà, aplatir davantage fait remonter la jupe ample : 1,0 / 0,6
> est le point d'équilibre.

**Tendances.** Le corpus hebdomadaire du § 6, borné à ±3 puis multiplié par le
curseur *classique ↔ tendance*.

**Style appris.** Pour chaque paire de vêtements de la tenue, un score
d'affinité : `1 × (fois portés ensemble) + 0,8 × (j'aime) − 1,2 ×
(je n'aime pas)`. C'est ce terme qui, au fil des semaines, fait émerger le
style réel. Deux garde-fous, ajoutés après des essais qui proposaient un
polo-baskets pour aller travailler :

- une tenue portée pour une **autre activité** ne compte que pour 0,35 — une
  habitude prise au bureau ne fait pas loi en vacances ;
- un coefficient de crédibilité **atténuait** ce bonus à mesure que la tenue
  s'éloignait de la formalité et de la température visées. Il a été retiré le
  18 août 2026 avec le passage aux deux temps : une tenue qui ne convient pas
  n'arrive plus jusqu'à la note, il n'y a donc plus rien à racheter.

**Rotation — hors de la note, et en moyenne par pièce.** Ces termes se
calculent en **moyenne**, jamais en somme.

> En somme, chaque pièce jamais portée valant 1,4, une tenue de cinq pièces
> partait avec 2,8 d'avance sur une tenue de trois. Le moteur ajoutait donc un
> sac ou un gilet non parce qu'il allait bien, mais parce qu'il faisait une pièce
> de plus : le banc du 18 août 2026 sortait le sac à main dans 68 % des tenues.
> Ramené à une moyenne, il tombe à 37 %. C'était le biais dominant du moteur,
> et il masquait tous les autres — trois hypothèses successives sur la
> silhouette se sont révélées fausses tant qu'il était là.

L'objectif reste que la garde-robe tourne entièrement, mais **faire tourner
n'est pas une qualité de tenue**. La rotation départage des tenues d'égale allure sans entrer dans la note affichée.

> Les mêler rendait la jauge muette. Aucune pièce n'ayant encore été portée,
> chaque tenue recevait le même gros bonus d'oubli : les 432 tenues mesurées
> le 18 août s'affichaient toutes « excellente ». Le classement utilise le
> score complet, l'affichage montre la note de style seule.

Deux effets opposés, volontairement dissymétriques :

- une pièce portée dans les cinq derniers jours est **écartée fermement**,
  d'autant plus qu'elle est récente ;
- une pièce oubliée est **remontée** : +1,4 si elle n'est jamais sortie du
  placard, +1,1 au-delà de deux mois, +0,7 au-delà d'un mois.

**Motif.** Un imprimé se porte seul : un seul motif dans la tenue vaut +0,5,
deux ou plus coûtent 1,8. Une pièce sans motif renseigné ne compte ni pour ni
contre.

> Ce terme comble un angle mort mesuré. Le moteur ne voyait que des couleurs :
> il pénalisait un imprimé sur un uni — une bonne association — et laissait
> passer deux motifs de même gamme, qu'aucune règle de couleur ne distingue.
> Après correction : imprimé + uni **0,70**, uni + uni **−0,50**, deux motifs
> **−2,30**.

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

### Le panneau « pourquoi cette tenue »

Deux blocs, et deux seulement dans le cas courant : **ce qui marche**, puis
**ce qui l'aurait améliorée**.

> *Ce qui marche.* Des couleurs d'une même famille, des coupes droites qui ne
> se contrarient pas et un seul motif, porté par la marinière écrue.
>
> *Ce qui l'aurait améliorée.* Du volume en haut sur ce bas ajusté, ou
> l'inverse — c'est ce qui dessine une silhouette. Et, côté mode, du denim.

Il en comptait sept, dont trois devenus creux. « Face au temps » annonçait
invariablement que le compte de chaleur tombait juste — vrai par construction
depuis que la chaleur est un filtre. « En loisir » répétait que chaque pièce
atteignait le registre attendu, vrai pour la même raison. Et « À ressortir »
énumérait les cinq pièces de la tenue tant qu'aucune n'avait été portée. Trois
blocs qui ne disaient rien et noyaient les deux qui disent quelque chose ; ils
n'apparaissent plus que lorsqu'ils ont une information à donner.

**Un seul point par axe.** Deux remarques sur la couleur dans la même phrase,
ce n'est pas une synthèse : chaque atout et chaque manque porte un axe —
silhouette, couleur, motif, chaussures, accessoire, proportion — et seul le
mieux noté de chaque axe est retenu. La mode fait exception, ses règles étant
plusieurs choses distinctes et non plusieurs façons de dire la même.

**Une incohérence corrigée au passage.** Le camaïeu se juge sur la famille
chromatique, l'accent unique sur le drapeau « neutre » : une tenue beige et
marron affichait donc « des couleurs d'une même famille » en atout et « tout
est neutre ici » en manque, dans le même panneau. Les deux étaient vrais,
ensemble ils se contredisaient. Le camaïeu se dit désormais autrement selon
qu'il porte sur des vives ou sur des neutres.

### Ne conseiller que l'atteignable

Un conseil nomme une règle non cochée. Encore faut-il que la cocher fasse
réellement mieux — sinon on désigne un gain hors de portée.

> Cas réel du 19 août 2026. Une tenue notée 4,63 s'entendait conseiller « du
> denim », alors que la meilleure tenue en denim de la garde-robe plafonnait à
> 4,31. La règle était bien décochée, mais la cocher aurait coûté ailleurs plus
> qu'elle n'aurait rapporté. Le conseil était juste sur la règle et faux sur le
> fond.

L'énumération des candidates retient donc, pour chaque règle, **la meilleure
note atteignable par une tenue qui la coche**. Un conseil n'est affiché que si
ce plafond dépasse la note de la tenue commentée. Le calcul est gratuit : les
candidates sont déjà toutes notées.

Conséquence vérifiable, et vérifiée sur 1 500 tenues : **la tenue la mieux
notée ne reçoit jamais de conseil de mode**, puisque rien ne peut la dépasser.

### La pièce qui la sublimerait

Dire « du volume en haut » est un principe ; dire « une chemise oversize
rentrée devant » est une pièce qu'on peut aller chercher. Le manque le mieux
noté est donc traduit en vêtement concret, par une table — le vocabulaire
étant fermé, la traduction l'est aussi.

**Le bloc nomme une pièce et se tait sur qui la possède.** Sa première version
ajoutait « tu ne l'as pas, sinon elle serait déjà dans la proposition » : c'était
faux. Qu'une pièce comblant le manque ne figure pas dans la proposition ne
prouve pas son absence — elle peut coûter ailleurs ce qu'elle rapporte ici.
Sur une tenue à 9,5/10, le moteur conseillait un sac uni là où le seul
accessoire de la maison est un foulard imprimé, qui aurait fait un second
motif. Le conseil était bon, l'affirmation ne l'était pas.

### Ce qui manque à la garde-robe

Le panneau d'une tenue dit ce qui lui manque. Répété sur toutes les situations
de la saison, **le même manque revient** — et c'est cela qui devient une
décision d'achat. Un conseil isolé se contourne ; un manque présent dans un
quart des tenues est un trou dans la garde-robe.

Le Journal propose donc un bouton qui rejoue le moteur sur les douze
situations de la saison en cours, quatre fois chacune, et classe les pièces
manquantes par fréquence. Tout est local : mesuré à **191 ms** pour 107
tenues examinées, sur la garde-robe réelle.

Deux précautions de méthode. Le comptage ne porte que sur **les trois
premières propositions** de chaque situation, celles retenues sur la note
seule — les deux dernières servent à faire tourner la garde-robe et ne disent
rien de ce qui lui manque. Et il ne balaie que **la saison en cours** :
acheter pour l'hiver au mois d'août n'aide personne.

> Premier relevé réel, été 2026, sur 107 tenues : un sac structuré en cuir
> camel manque dans **28 %** des tenues, une chemise oversize dans 15 %, une
> touche de couleur vive dans 10 %.

### Ce qui retient la note

Une note resserrée n'apprend rien si elle ne dit pas ce qui lui manque. Chaque
règle dépose donc, dans un collecteur facultatif, **ce qu'elle n'a pas accordé**
et pourquoi ; l'explication affiche les deux manques les plus coûteux, chiffrés
dans l'unité de la note.

> « Un volume ample répondant à une coupe ajustée (+0,4) et suivre « denim
> omniprésent » (+0,3). »

Le collecteur est **facultatif par construction** : la boucle de notation ne le
passe pas, seules les trois tenues retenues le demandent. Le coût est donc nul
à l'échelle des milliers de candidates, et surtout il n'y a **qu'un seul calcul** —
un second, écrit à côté pour l'explication, aurait fini par diverger du premier.

Le style et la tendance sont distingués à l'affichage : l'un est un principe
durable, l'autre ne vaut que cette semaine. Les règles `descriptive` sont
écartées des suggestions — le moteur ne sait pas les appliquer, les proposer
reviendrait à donner un conseil qu'il ne saurait pas noter.

## 5. Écrans

**Aujourd'hui** — si un lieu est configuré, un bandeau donne la prévision du
jour et pré-règle les boutons. Puis quatre boutons météo (soleil, nuages,
pluie, neige), quatre boutons température, trois boutons activité (travail, loisir, vacances) et
quatre boutons saison, celle du jour étant présélectionnée d'après la date.
Puis `Proposer des tenues`. Chaque proposition s'affiche en une bande de
vignettes, avec `j'aime`, `je n'aime pas` et `Je porte ça`. En dessous,
`Montre-moi autre chose` relance en écartant les pièces déjà vues, et la
révision du corpus de style est rappelée.

Chaque proposition porte une **jauge en cinq blocs** — bancale, passable,
correcte, bonne, excellente — assortie du score brut en petit. Les paliers
évitent une fausse précision : le chiffre ne veut rien dire pour qui s'habille,
mais il explique pourquoi une tenue passe devant une autre.

Chaque proposition porte aussi un repli **« Pourquoi cette tenue ? »** qui met le
calcul en mots : adéquation à l'occasion et au temps, harmonie des couleurs,
proportion de la silhouette, motif, règles de tendance touchées, pièces
oubliées qui ressortent. L'application n'ayant ni réseau ni modèle de langage,
ces phrases ne sont pas rédigées : elles sont **dérivées des mêmes fonctions
que la notation**, ce qui interdit à l'explication de diverger du score.

**Garde-robe** — grille de photos filtrable par catégorie, ajout et
modification d'une pièce. Une pièce que l'analyse par photo n'a pas su décrire
avec certitude porte une pastille **à vérifier**, et un filtre du même nom les
regroupe. Ouvrir la fiche affiche la phrase de doute du modèle ; l'enregistrer
efface la marque — enregistrer vaut arbitrage.

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
| Contraste de silhouette | +1,0 si un volume ample répond à une coupe ajustée ; **+0,6 si une coupe droite en rencontre une autre** ; −1,0 si tout est ample, −0,5 si tout est ajusté ; **+0,5 pour une robe**, qui est une silhouette à elle seule. Se lit sur la **couche visible** — manteau, sinon pull, sinon le haut |
| Camaïeu | +1,0 si toutes les couleurs marquées relèvent d'une même famille chromatique |
| Accent unique | +0,7 pour une seule couleur vive sur une base neutre |
| Ancrage par la chaussure | +0,4 si la chaussure est au moins aussi habillée que le reste ; −0,8 si elle le tire nettement vers le bas |
| Accessoire | +0,3 — un accessoire signe une tenue ; la composition n'en autorise qu'un |
| Motif | +0,5 pour un seul imprimé qui ressort ; −1,8 dès que deux se concurrencent |
| Proportion du manteau | +0,4 s'il descend au moins un cran plus bas que le bas ou la robe ; −0,3 pour un cran au-dessus, −0,7 pour deux |

**Les tendances** sont un corpus mobile, chargé depuis `tendances.json` et
régénéré chaque semaine hors de l'application (voir [TENDANCES.md](TENDANCES.md)
pour la chaîne complète). L'application le télécharge au lancement, le range
dans IndexedDB, et continue de fonctionner hors ligne sur la dernière version
connue.

Sept formes de règle, toutes exprimées dans le vocabulaire fermé de
l'application — 14 couleurs, 3 coupes, 7 catégories, 4 motifs, 3 longueurs,
8 matières :

| Forme | Ce qu'elle dit |
|---|---|
| `silhouette` | une combinaison de coupes haut/bas qui fonctionne |
| `couleur` | une couleur qui monte, ou qui reflue si le poids est négatif |
| `association` | deux couleurs qui s'accordent cette saison |
| `categorie` | une catégorie mise en avant, éventuellement dans une coupe précise |
| `motif` | un imprimé de la saison |
| `longueur` | une longueur qui domine — c'est ce que le vocabulaire ne savait pas dire avant le 17 août 2026 |
| `matiere` | une matière mise en avant |

Une huitième valeur, `descriptive`, existe dans le schéma de synthèse : elle
recueille ce que la presse dit et que le moteur ne sait pas noter. Elle
n'entre dans aucun calcul et sert à ne pas forcer une règle inexprimable dans
une forme qui la trahirait.

La note de tendance est **rapportée au total des poids positifs du corpus**,
puis multipliée par le réglage **classique ↔ tendance** du Journal — de 0
(ignorer) à 2 (suivre franchement). Une tenue qui coche tout vaut 3, une qui
ne coche rien vaut 0, et la note reste comparable d'une semaine à l'autre :
un corpus de vingt règles ne pèse pas plus lourd qu'un corpus de huit.

> Ce rapport a remplacé un simple écrêtage à ±3 le 18 août 2026, après une
> mesure sans appel. Les 13 règles du corpus pesant 13 points en tout,
> presque toute tenue dépassait le plafond : la note de tendance médiane
> valait **3,00**, soit le plafond, et **98 % des trios proposaient trois
> tenues à la note de tendance identique**. Le terme n'ajoutait qu'une
> constante — être tendance ne changeait rien à ce qui était proposé.
>
> Après normalisation : note étalée de 0,39 à 2,25, et 9 % de trios plats.
>
> Ce défaut était invisible jusque-là parce que le banc d'essai coupe le
> réseau : le moteur retombait sur le corpus de secours, vide, et le terme
> était purement mort. Le banc charge désormais tendances.json depuis le
> disque.
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

## 8. La longueur, ajoutée le 17 août 2026

Un champ `longueur` — court, aux genoux, long — sur les bas, robes et
manteaux, et lui seul : la notion n'a pas de sens sur un haut, des chaussures
ou un accessoire, où le champ reste caché à la saisie et vide à l'analyse.

**Ce qu'il débloque.** Le premier corpus de tendances réel avait produit une
règle `categorie: robe` dont la note était « robe longue fluide ou
robe-chemise » : la presse parlait de longueur, le vocabulaire ne sachant pas
la dire, la règle valorisait *toutes* les robes. Les règles de tendance
peuvent désormais porter sur `longueur`.

**Ce qu'a coûté l'ajout tardif.** Une réanalyse des photos plutôt que le
remplissage à la main de centaines de champs. Les corrections manuelles
étaient protégées d'une réanalyse (`corrigeeLe`) : sans cela, cet ajout
différé aurait effacé le travail de relecture.

Ce qui reste hors du modèle : les proportions calculées — jupe longue avec
bottines, mini avec manteau long. La longueur les rend possibles ; la règle
n'est pas écrite.

## 9. Hors périmètre de cette version

Météo automatique par géolocalisation, notifications, partage entre
plusieurs personnes, reconnaissance automatique du vêtement sur la photo,
valise de voyage. Toutes restent possibles ensuite.
