# Dressing

Ma garde-robe, et la tenue du jour selon la météo, l'activité et mes habitudes.

Application web d'une seule page, sans serveur, sans compte et sans réseau.
Conçue pour être ouverte le matin sur iPhone, depuis l'écran d'accueil.

## Utilisation

Ouvrir l'adresse dans Safari, puis **Partager → Sur l'écran d'accueil**.
L'application s'ouvre alors en plein écran, sans barre de navigateur.

Trois écrans :

- **Aujourd'hui** — météo, température et activité, puis trois tenues proposées.
  Si un lieu est configuré, la prévision du jour est relevée à l'ouverture et
  pré-règle les boutons ; tu peux toujours les corriger.
- **Garde-robe** — photographier et décrire chaque pièce.
- **Journal** — historique, statistiques, météo, tendances, sauvegarde,
  garde-robe d'exemple.

Deux façons d'importer : **Fusionner** met à jour les fiches sans toucher au
journal des tenues portées — c'est le mode normal, notamment après une analyse
des photos. **Remplacer tout** est réservé à la restauration d'une sauvegarde.

## Les données

Ta garde-robe est stockée dans le navigateur du téléphone, via IndexedDB.
**Ni tes vêtements, ni tes photos, ni ton historique ne quittent l'appareil.**
Les seules requêtes réseau sont sortantes et anonymes : le corpus de tendances
téléchargé depuis GitHub, et — si tu configures un lieu — la prévision du jour
demandée à Open-Meteo, qui reçoit alors une position approchée. En contrepartie, **effacer
les données de Safari efface la garde-robe** : le bouton *Exporter* du Journal
produit un fichier JSON de sauvegarde, à faire après chaque grosse saisie.

## Comment les tenues sont choisies

Les pièces hors saison sont d'abord écartées, puis chaque tenue candidate est
notée : température, registre de l'activité, météo, harmonie des couleurs,
cohérence saisonnière, habitudes apprises, rotation de la garde-robe et
règles de style contemporaines.

Les habitudes viennent du bouton *Je porte ça* et des avis 👍/👎. Elles ne
peuvent que départager des tenues déjà adaptées à l'occasion — jamais imposer
un polo-baskets un jour de travail. Le bonus qui remonte les pièces oubliées
obéit à la même limite.

**Sur les photos.** À la prise de vue, les couleurs dominantes sont lues dans
le téléphone et pré-cochées — rien ne sort de l'appareil. Pour faire remplir
*tous* les champs par un modèle de vision, voir [ANALYSE-PHOTOS.md](ANALYSE-PHOTOS.md) :
l'analyse se fait par lots depuis un ordinateur, où la clé d'API peut vivre
sans être exposée.

**Sur la météo.** Le relevé se fait à l'ouverture, pas à heure fixe : iOS ne
réveille pas une page web en arrière-plan. Il porte sur la prévision de la
journée — temps dominant et ressenti maximal — via [Open-Meteo](https://open-meteo.com),
gratuit et sans clé. Un relevé par jour est conservé, donc rouvrir l'app hors
ligne retrouve celui du matin. Sans lieu configuré, tout reste manuel.

**Sur les tendances.** Une tâche hebdomadaire collecte les flux RSS de la
presse mode, en fait synthétiser des règles chiffrées par Claude, et dépose le
résultat dans `tendances.json` à côté de l'application. Celle-ci le télécharge au lancement et le garde : elle marche
hors ligne sur la dernière version connue. La date du corpus est rappelée sous
les propositions, et un réglage *classique ↔ tendance* dans le Journal en fixe
le poids, de 0 à 2. Détail de la chaîne dans [TENDANCES.md](TENDANCES.md).

Le détail des règles et des pondérations est dans [SPEC.md](SPEC.md).

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | l'application entière — structure, styles et code |
| `tendances.json` | le corpus de tendances, régénéré chaque semaine |
| `icone-180.png` | icône d'écran d'accueil |
| `manifest.webmanifest` | nom et affichage plein écran |
| `outils/analyse-photos.mjs` | remplit les fiches à partir des photos, depuis le PC |
| `outils/collecte.mjs` | collecte des sources publiques |
| `outils/synthese.mjs` | traduction de la prose en règles chiffrées |
| `outils/serveur-local.mjs` | petit serveur pour essayer l'app en local |
| `.github/workflows/tendances.yml` | la tâche hebdomadaire |
| `SPEC.md` | la spécification et les règles du moteur |
| `TENDANCES.md` | l'architecture de la chaîne de tendances |
| `ANALYSE-PHOTOS.md` | comment faire décrire la garde-robe par les photos |

## Essayer en local

```
node outils/serveur-local.mjs
```

Puis ouvrir `http://localhost:8137/`. Un vrai serveur est nécessaire : depuis
un fichier local, ni le stockage ni le chargement de `tendances.json` ne
fonctionnent.
