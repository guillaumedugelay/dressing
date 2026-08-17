/* Synthèse : transforme la prose collectée en règles chiffrées.
 *
 * L'application ne sait comparer que ce qu'elle mesure — 14 couleurs, 3 coupes,
 * 7 catégories. Ce script demande à Claude de projeter les tendances de la
 * semaine sur ce vocabulaire, et rien d'autre : aucun texte d'article n'est
 * conservé dans le résultat.
 *
 *   node outils/synthese.mjs < corpus.json > tendances.json
 *
 * Requiert ANTHROPIC_API_KEY dans l'environnement.
 */

import Anthropic from "@anthropic-ai/sdk";

const COULEURS = ["noir", "blanc", "gris", "beige", "marine", "denim", "marron",
                  "rouge", "orange", "jaune", "vert", "bleu", "violet", "rose"];
const COUPES = ["ajuste", "droit", "ample"];
const CATEGORIES = ["haut", "bas", "robe", "pull", "manteau", "chaussures", "accessoire"];
const MOTIFS = ["uni", "raye", "carreaux", "imprime"];
const LONGUEURS = ["court", "genoux", "long"];
const MATIERES = ["coton", "lin", "laine", "denim", "maille", "cuir", "soie", "synthetique"];

const SCHEMA = {
  type: "object",
  properties: {
    resume: {
      type: "string",
      description: "Deux phrases en français, lisibles par le propriétaire de la garde-robe.",
    },
    regles: {
      type: "array",
      description: "Entre 5 et 12 règles. Un poids négatif signale une tendance en retrait.",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["silhouette", "couleur", "association", "categorie", "motif", "longueur", "matiere", "descriptive"] },
          haut: { type: "string", enum: COUPES, description: "type silhouette uniquement" },
          bas: { type: "string", enum: COUPES, description: "type silhouette uniquement" },
          valeur: { type: "string", description: "couleur : une couleur ; categorie : une catégorie ; motif, longueur, matiere : une valeur de la liste correspondante" },
          couleurs: { type: "array", items: { type: "string" }, description: "type association : exactement deux couleurs" },
          coupe: { type: "string", enum: COUPES, description: "type categorie : coupe attendue, facultatif" },
          poids: { type: "number", description: "entre -2 et 2" },
          note: { type: "string", description: "quatre à huit mots en français, affichés dans l'application" },
          texte: { type: "string", description: "type descriptive uniquement : la tendance formulée en une phrase, telle qu'on la reconnaîtrait dans la description d'un vêtement. Chaîne vide pour les autres types." },
        },
        required: ["type", "poids", "note"],
        additionalProperties: false,
      },
    },
  },
  required: ["resume", "regles"],
  additionalProperties: false,
};

const CONSIGNE = `Tu es styliste. On te donne les titres et chapôs de la presse mode et des forums vêtement de la semaine écoulée.

Ta tâche : en dégager les tendances vestimentaires du moment, puis les traduire dans le vocabulaire fermé d'une application de garde-robe. C'est une traduction, pas une invention : chaque règle doit s'appuyer sur ce que tu lis, et une tendance que le vocabulaire ne sait pas exprimer doit être écartée plutôt que déformée.

Le vocabulaire disponible :
- couleurs : ${COULEURS.join(", ")}
- coupes : ${COUPES.join(", ")}
- catégories : ${CATEGORIES.join(", ")}
- motifs : ${MOTIFS.join(", ")}
- longueurs : ${LONGUEURS.join(", ")}
- matières : ${MATIERES.join(", ")}

Les formes de règle :
- silhouette : une combinaison de coupes haut/bas qui fonctionne (ou pas, si le poids est négatif)
- couleur : une couleur qui monte (poids positif) ou qui reflue (poids négatif)
- association : deux couleurs qui vont bien ensemble cette saison
- motif : un motif qui monte ou reflue — uni, rayé, carreaux, imprimé
- longueur : une longueur qui monte ou reflue — court, genoux, long
- matiere : une matière qui monte ou reflue
- descriptive : une tendance que rien de ce qui précède ne sait dire (voir plus bas)
- categorie : une catégorie de vêtement mise en avant, éventuellement dans une coupe précise. **Uniquement parmi manteau, pull, robe et accessoire** : toute tenue comporte déjà un haut, un bas et des chaussures, si bien qu'une règle sur ces trois-là s'applique à tout et ne départage rien.

Le poids dit la force de la tendance, de -2 à 2. Réserve les valeurs au-delà de 1,5 aux tendances vraiment dominantes ; une tendance mentionnée une seule fois mérite 0,5.

Une tendance que ce vocabulaire ne sait toujours pas dire — un col, une coupe de chaussure, un détail de construction — ne doit **jamais** être rabattue sur l'approximation la plus proche. Donne-lui le type **descriptive** et écris-la en clair dans le champ texte, telle qu'on la reconnaîtrait dans la description d'un vêtement : « bottines à bout carré », « manches ballon ». Ces règles-là ne sont pas appliquées par le moteur ; elles sont conservées pour être rapprochées plus tard des descriptions de la garde-robe. Mieux vaut une tendance mise de côté qu'une tendance déformée.

Ne reprends aucune phrase des articles. La note est ta formulation, courte et concrète.

Écris pour une personne qui s'habille le matin, pas pour un défilé : si la semaine n'a rien produit d'exploitable sur un point, ne comble pas le vide.`;

/* --- lecture du corpus sur l'entrée standard --- */
const brut = await new Promise((ok, ko) => {
  let t = ""; process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => { t += c; });
  process.stdin.on("end", () => ok(t));
  process.stdin.on("error", ko);
});
const corpus = JSON.parse(brut);

const materiau = corpus.articles
  .map((a) => `[${a.source}] ${a.titre}${a.extrait ? ` — ${a.extrait}` : ""}`)
  .join("\n");

/* Opus 5 à effort élevé : lire de la prose éditoriale et en dégager des
   tendances demande du jugement, pas de l'extraction. À 0,16 $ le passage
   hebdomadaire, l'enjeu ne justifie pas d'économiser ici — contrairement à
   l'analyse des photos, répétée cinq cents fois.
   Se change au coup par coup avec MODELE= et EFFORT=, pour comparer. */
const MODELE = process.env.MODELE || "claude-opus-5";
const EFFORT = process.env.EFFORT || "high";

if (!process.env.ANTHROPIC_API_KEY) {
  process.stderr.write("ANTHROPIC_API_KEY n'est pas dans l'environnement — tendances inchangées.\n");
  process.stderr.write("La clé se dépose en secret GitHub pour la tâche hebdomadaire,\n");
  process.stderr.write("ou dans l'environnement de ce terminal pour un essai à la main.\n");
  process.exit(1);
}

process.stderr.write(`Synthèse de ${corpus.articles.length} articles avec ${MODELE}, effort ${EFFORT}…\n`);

const client = new Anthropic();
const reponse = await client.messages.create({
  model: MODELE,
  max_tokens: 16000,
  system: CONSIGNE,
  output_config: {
    effort: EFFORT,
    format: { type: "json_schema", schema: SCHEMA },
  },
  messages: [{ role: "user", content: `Voici la collecte de la semaine :\n\n${materiau}` }],
});

if (reponse.stop_reason === "refusal") {
  process.stderr.write("La demande a été déclinée — tendances inchangées.\n");
  process.exit(1);
}

const texte = reponse.content.find((b) => b.type === "text")?.text;
if (!texte) {
  process.stderr.write("Réponse vide — tendances inchangées.\n");
  process.exit(1);
}

const { resume, regles } = JSON.parse(texte);

/* Garde-fou : le moteur ne sait appliquer que le vocabulaire fermé. Une règle
   hors vocabulaire est écartée ici plutôt que ignorée silencieusement dans
   l'application. */
/* Un haut, un bas et des chaussures figurent dans toute tenue : une règle qui
   les vise s'ajouterait à chaque candidate sans jamais les départager. */
const TOUJOURS_PRESENTES = ["haut", "bas", "chaussures"];
const connu = (v, liste) => !v || liste.includes(v);
const valides = regles.filter((r) => {
  const ok = connu(r.haut, COUPES) && connu(r.bas, COUPES) && connu(r.coupe, COUPES)
    && (r.type !== "couleur" || COULEURS.includes(r.valeur))
    && (r.type !== "categorie" || (CATEGORIES.includes(r.valeur) && !TOUJOURS_PRESENTES.includes(r.valeur)))
    && (r.type !== "motif" || MOTIFS.includes(r.valeur))
    && (r.type !== "longueur" || LONGUEURS.includes(r.valeur))
    && (r.type !== "matiere" || MATIERES.includes(r.valeur))
    && (r.type !== "descriptive" || (r.texte || "").length > 3)
    && (r.type !== "association" || (Array.isArray(r.couleurs) && r.couleurs.length === 2
        && r.couleurs.every((c) => COULEURS.includes(c))))
    && Math.abs(r.poids) <= 2;
  if (!ok) process.stderr.write(`  règle écartée : ${r.note || JSON.stringify(r)}\n`);
  return ok;
});

if (!valides.length) {
  process.stderr.write("Aucune règle exploitable — tendances inchangées.\n");
  process.exit(1);
}

process.stderr.write(`${valides.length} règles retenues sur ${regles.length}.\n`);
process.stderr.write(`Jetons : ${reponse.usage.input_tokens} entrée, ${reponse.usage.output_tokens} sortie.\n`);

process.stdout.write(JSON.stringify({
  revision: new Date().toISOString().slice(0, 10),
  origine: "synthese-automatique",
  sources: corpus.sources,
  resume,
  regles: valides,
}, null, 2) + "\n");
