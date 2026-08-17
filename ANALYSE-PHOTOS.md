# Remplir les fiches à partir des photos

Comment faire décrire la garde-robe par un modèle de vision, sans jamais
exposer de clé d'API ni déplacer les photos hors du téléphone.

## Le principe

Analyser une photo n'oblige pas à la stocker ailleurs. Elle est envoyée une
fois, le modèle renvoie les caractéristiques, la copie est jetée. Les photos
continuent de vivre dans le téléphone, et seulement là.

Ce qui interdit de faire l'analyse depuis l'application, c'est autre chose :
**une page statique ne peut pas détenir une clé d'API** — n'importe qui la
lirait dans le code source. La clé reste donc sur l'ordinateur, et l'analyse
se fait par lots, en aller-retour.

```
  iPhone                    PC                        iPhone
  ──────                    ──                        ──────
  Journal → Exporter   →   analyse-photos.mjs    →   Journal → Fusionner
  (un fichier JSON,        (la clé est ici,          (les fiches enrichies
   photos comprises)        jamais ailleurs)          rejoignent l'app)
```

La fusion est importante : elle met à jour les fiches **sans toucher au
journal des tenues portées ni aux avis**. Le bouton rouge « Remplacer tout »
est réservé à la restauration d'une sauvegarde après un pépin.

## Mode d'emploi

**Une fois pour toutes**, sur le PC :

```bash
npm install
```

Puis crée une clé sur [console.anthropic.com](https://console.anthropic.com) et
mets-la dans l'environnement (elle ne doit jamais entrer dans le dépôt) :

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

**À chaque session**, depuis le téléphone : Journal → `Exporter`. Le fichier
part dans Fichiers ; transfère-le sur le PC comme tu veux. Puis :

```bash
node outils/analyse-photos.mjs dressing-2026-08-14.json --limite 5 --simuler
```

`--simuler` n'écrit rien et `--limite 5` s'arrête à cinq pièces : de quoi
juger la qualité avant d'y passer la garde-robe entière. Si le résultat
convient :

```bash
node outils/analyse-photos.mjs dressing-2026-08-14.json
```

Le script écrit `dressing-2026-08-14-analyse.json`. Renvoie-le sur le
téléphone, puis Journal → `Fusionner un fichier`.

## Ce que le script remplit

| Champ | Rempli | Remarque |
|---|---|---|
| `nom` | si vide | un nom tapé à la main n'est jamais écrasé |
| `categorie` | oui | haut, bas, robe, pull, manteau, chaussures, accessoire |
| `couleurs` | oui | une ou deux parmi les quatorze |
| `chaleur` | oui | jugée sur la matière et l'épaisseur, pas sur la couleur |
| `formaliteMin` / `formaliteMax` | oui | un **intervalle** : une jupe unie est « décontracté à soigné ». Les pièces univoques ont min = max |
| `coupe` | oui | ajusté, droit, ample |
| `saisons` | oui | vide = toute l'année, et c'est le cas courant |
| `dehors` | oui | vrai seulement si la pièce résiste réellement à l'eau |
| `description` | oui | deux phrases : matière, longueur, motif, détails de construction — voir ci-dessous |
| `confiance` | oui | haute, moyenne ou basse — voir ci-dessous |

**La description est une assurance sur l'avenir.** Les champs de la fiche ne
retiennent qu'une fraction de ce que le modèle voit : ni la matière, ni la
longueur, ni le motif n'y ont de place aujourd'hui. Une fois l'analyse faite,
cette information serait perdue — sur ta jupe, le modèle avait vu « évasée
plissée », la fiche n'a gardé que « ample ».

La description en garde trace, en deux phrases stockées avec la pièce. Le jour
où le modèle de données gagnera un champ — `longueur` est déjà prévu — il
pourra en être déduit **sans renvoyer les photos** : plus rapide, dix fois
moins cher, et faisable même sans les images sous la main.

Elle coûte une cinquantaine de jetons par pièce, soit environ 10 % de plus, et
s'affiche dans la fiche : sur plusieurs centaines de vêtements, elle aide aussi
à s'y retrouver.

**Attention à ce qu'elle n'est pas.** Le moteur de suggestion ne lit pas de
texte : c'est une fonction de score sur des nombres et des listes fermées, qui
tourne hors ligne dans le téléphone. La description ne participe donc à aucune
suggestion. Elle sert à faire grandir le vocabulaire à moindre coût — et c'est
l'agrandissement du vocabulaire, lui, qui permettra aux tendances de mordre.

**La confiance est le point utile.** Le modèle signale lui-même les pièces
dont il n'est pas sûr, et dit **en une phrase ce dont il doute** — photo floue,
vêtement plié, matière ambiguë. Le script les liste à la fin.

Ce marquage **survit à la fusion** : dans l'application, ces pièces portent une
pastille « à vérifier » et un filtre du même nom les regroupe. Ouvrir la fiche
montre la phrase de doute ; l'enregistrer efface la marque. Sur cinq cents
pièces, tu ne relis donc que ce que le modèle a lui-même signalé, sans avoir à
noter quoi que ce soit au passage.

Une pièce déjà analysée porte `analyseeLe` et sera sautée aux passages
suivants : tu peux relancer le script après chaque série de photos sans tout
refaire. `--forcer` recommence quand même.

**Tes corrections sont protégées.** Une fiche que tu as ouverte et enregistrée
après son analyse porte une date de correction, et `--forcer` la saute : ton
arbitrage vaut mieux qu'une nouvelle hypothèse. C'est ce qui rend sûre une
réanalyse générale — par exemple le jour où le modèle de données gagnera un
champ. `--tout` passe outre, en connaissance de cause.

## Quand le modèle déraille

Une réponse structurée reste du texte engendré, et elle peut partir en vrille.
Un essai du 17 août 2026 a produit, dans le champ « doute » de deux jupes en
jean, une question sans rapport sur un chauffe-eau et une phrase en chinois —
avec une confiance « haute », donc sans le moindre signalement.

Le script **refuse désormais une réponse suspecte** et compte la pièce en
échec, à réanalyser : écriture non latine, textes anormalement longs, ou doute
exprimé alors que la confiance est haute. Mieux vaut une pièce à refaire qu'une
fiche salie.

Si les échecs se multiplient, le premier levier est l'effort :

```bash
EFFORT=high node outils/analyse-photos.mjs export.json --limite 8 --simuler
```

## Ce que ça coûte

Le script affiche le compte exact à la fin — jetons consommés, coût du
passage, coût par pièce, et projection sur cinq cents pièces.

Par défaut, **Claude Sonnet 5 à effort moyen** : le bon compromis pour une
extraction structurée répétée cinq cents fois.

| Réglage | 500 pièces |
|---|---|
| Sonnet 5, effort moyen — **par défaut** | ≈ 3,70 $ au tarif de lancement, ≈ 5,60 $ ensuite |
| Opus 5, effort élevé | ≈ 9,30 $ |

Sonnet 5 est en tarif de lancement jusqu'au 31 août 2026 ; passée cette date
le script bascule tout seul sur le tarif normal, sans rien à changer.

Une fois pour toutes, donc. Les vêtements achetés ensuite s'ajoutent à
l'unité, pour moins d'un centime pièce.

Pour arbitrer autrement le temps d'un passage :

```bash
MODELE=claude-opus-5 EFFORT=high node outils/analyse-photos.mjs export.json
```

## Bien photographier

Le premier essai a donné ce doute, formulé par le modèle lui-même :

> « La jupe est froissée et posée à plat, la coupe exacte (évasée plissée) et
> la matière précise sont difficiles à confirmer. »

Aucune consigne ne rattrape ça : quand le doute porte sur ce que la photo ne
montre pas, la correction est en amont. Quatre habitudes qui coûtent quelques
secondes par pièce et évitent des dizaines de relectures :

- **Suspendre plutôt que poser à plat**, sur un cintre ou une poignée de porte.
  C'est ce qui révèle la coupe et le tombé — l'information la plus difficile à
  retrouver autrement.
- **Défroisser** d'un geste. Un vêtement froissé masque sa propre structure.
- **Un fond uni et contrasté** : la pièce se détache, et la lecture des
  couleurs y gagne aussi.
- **Toute la pièce dans le cadre**, à la lumière du jour si possible. Une
  photo cadrée serré perd la longueur, les manches, la forme générale.

Le champ `doute` est là pour dire quand ça n'a pas suffi. Si les mêmes
reproches reviennent sur beaucoup de pièces, c'est la façon de photographier
qu'il faut ajuster, pas la consigne.

## Modifier la consigne

La consigne donnée au modèle est du texte français ordinaire, dans
`outils/analyse-photos.mjs`. C'est le levier principal quand un champ est
systématiquement mal rempli.

Elle vit dans une chaîne de gabarit délimitée par des accents graves : **n'en
utilise aucun à l'intérieur**, sous peine de terminer la chaîne au milieu d'une
phrase. Après toute modification :

```bash
npm run verifier
```

Cette commande contrôle la syntaxe des quatre outils sans les exécuter.
Puis compare le résultat sur quelques pièces, sans rien écrire :

```bash
node outils/analyse-photos.mjs export.json --forcer --simuler
```

## Ce qui reste manuel

Rien d'obligatoire — mais l'analyse propose, elle ne décide pas. Relis au
moins les pièces marquées « à revérifier », et corrige dans l'application ce
qui te paraît faux. C'est ce qui distingue une garde-robe utilisable d'une
garde-robe approximative, et le moteur de suggestion s'appuie entièrement sur
ces champs.

## Vie privée

Les photos transitent par l'API le temps de l'analyse et ne sont pas
conservées ailleurs. Si les vêtements ne sont pas les tiens, c'est à leur
propriétaire de dire oui — pas à toi de le supposer.
