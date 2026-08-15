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
          type: { type: "string", enum: ["silhouette", "couleur", "association", "categorie"] },
          haut: { type: "string", enum: COUPES, description: "type silhouette uniquement" },
          bas: { type: "string", enum: COUPES, description: "type silhouette uniquement" },
          valeur: { type: "string", description: "type couleur : une couleur ; type categorie : une catégorie" },
          couleurs: { type: "array", items: { type: "string" }, description: "type association : exactement deux couleurs" },
          coupe: { type: "string", enum: COUPES, description: "type categorie : coupe attendue, facultatif" },
          poids: { type: "number", description: "entre -2 et 2" },
          note: { type: "string", description: "quatre à huit mots en français, affichés dans l'application" },
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

Le vocabulaire disponible, et rien d'autre :
- couleurs : ${COULEURS.join(", ")}
- coupes : ${COUPES.join(", ")}
- catégories : ${CATEGORIES.join(", ")}

Les quatre formes de règle :
- silhouette : une combinaison de coupes haut/bas qui fonctionne (ou pas, si le poids est négatif)
- couleur : une couleur qui monte (poids positif) ou qui reflue (poids négatif)
- association : deux couleurs qui vont bien ensemble cette saison
- categorie : une catégorie de vêtement mise en avant, éventuellement dans une coupe précise

Le poids dit la force de la tendance, de -2 à 2. Réserve les valeurs au-delà de 1,5 aux tendances vraiment dominantes ; une tendance mentionnée une seule fois mérite 0,5.

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
const connu = (v, liste) => !v || liste.includes(v);
const valides = regles.filter((r) => {
  const ok = connu(r.haut, COUPES) && connu(r.bas, COUPES) && connu(r.coupe, COUPES)
    && (r.type !== "couleur" || COULEURS.includes(r.valeur))
    && (r.type !== "categorie" || CATEGORIES.includes(r.valeur))
    && (r.type !== "association" || (Array.isArray(r.couleurs) && r.couleurs.length === 2
        && r.couleurs.every((c) => COULEURS.includes(c))))
    && Math.abs(r.poids) <= 2;
  if (!ok) process.stderr.write(`  règle écartée (hors vocabulaire) : ${JSON.stringify(r)}\n`);
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
