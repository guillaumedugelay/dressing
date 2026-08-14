# Dressing

Ma garde-robe, et la tenue du jour selon la météo, l'activité et mes habitudes.

Application web d'une seule page, sans serveur, sans compte et sans réseau.
Conçue pour être ouverte le matin sur iPhone, depuis l'écran d'accueil.

## Utilisation

Ouvrir l'adresse dans Safari, puis **Partager → Sur l'écran d'accueil**.
L'application s'ouvre alors en plein écran, sans barre de navigateur.

Trois écrans :

- **Aujourd'hui** — météo, température et activité, puis trois tenues proposées.
- **Garde-robe** — photographier et décrire chaque pièce.
- **Journal** — historique, statistiques, sauvegarde, garde-robe d'exemple.

## Les données

Tout est stocké dans le navigateur du téléphone, via IndexedDB. Rien ne sort
de l'appareil, aucune requête réseau n'est faite. En contrepartie, **effacer
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

**Sur les tendances.** L'application n'a aucun accès au réseau : elle ne peut
pas connaître les tendances du moment. Ce qu'elle applique est un corpus de
règles de composition écrit à la main et daté — silhouette, camaïeu, accent
unique, ancrage par la chaussure — dont la révision est affichée sous les
propositions. Le rafraîchir suppose de republier l'application.

Le détail des règles et des pondérations est dans [SPEC.md](SPEC.md).

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | l'application entière — structure, styles et code |
| `icone-180.png` | icône d'écran d'accueil |
| `manifest.webmanifest` | nom et affichage plein écran |
| `SPEC.md` | la spécification et les règles du moteur |
