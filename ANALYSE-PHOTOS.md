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
| `formalite` | oui | sport, décontracté, soigné, habillé |
| `coupe` | oui | ajusté, droit, ample |
| `saisons` | oui | vide = toute l'année, et c'est le cas courant |
| `dehors` | oui | vrai seulement si la pièce résiste réellement à l'eau |
| `confiance` | oui | haute, moyenne ou basse — voir ci-dessous |

**La confiance est le point utile.** Le modèle signale lui-même les pièces
dont il n'est pas sûr — photo floue, vêtement plié, matière ambiguë. Le script
les liste à la fin. Sur cinq cents pièces, tu ne revérifies que celles-là au
lieu de tout relire.

Une pièce déjà analysée porte `analyseeLe` et sera sautée aux passages
suivants : tu peux relancer le script après chaque série de photos sans tout
refaire. `--forcer` recommence quand même.

## Ce que ça coûte

Le script affiche le compte exact à la fin — jetons consommés, coût du
passage, coût par pièce, et projection sur cinq cents pièces.

Ordre de grandeur : quelques centimes par pièce, soit une dizaine de dollars
pour une garde-robe entière, **une fois pour toutes**. Les vêtements achetés
ensuite s'ajoutent à l'unité, pour une fraction de centime.

Le modèle se change par variable d'environnement si tu veux arbitrer
autrement :

```bash
MODELE=claude-sonnet-5 EFFORT=medium node outils/analyse-photos.mjs export.json
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
