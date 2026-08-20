/* Tri du corpus : ne garder que ce qui parle de vêtements.
 *
 *   node outils/collecte.mjs | node outils/trier.mjs > corpus.json
 *   node outils/trier.mjs < corpus.json > corpus-trie.json
 *   node outils/trier.mjs < corpus.json --montrer   (détaille les rejets)
 *
 * POURQUOI. Le corpus est le socle : les règles de tendance en sortent, et les
 * tenues proposées s'appuient sur ces règles. Un article hors sujet ne fait pas
 * qu'ajouter du bruit — il produit des règles fausses.
 *
 * Cas réel du 19 août 2026 : sur 260 articles, une règle « couleur noir » a été
 * émise avec des poids opposés selon le modèle, +0,8 pour Opus et −1 pour
 * Sonnet. En allant lire les 9 mentions du noir : une paire de sneakers, une
 * manette de jeu, un intérieur de BMW, un appareil photo, et la métaphore
 * « tomber dans le trou noir d'une vente flash ». Aucun des deux modèles
 * n'avait de quoi trancher. La divergence ne disait pas qu'un modèle lisait
 * mal — elle disait que le corpus était sale.
 *
 * POURQUOI PAS UN FILTRE PAR MOTS-CLÉS. Essayé, et raté : sur 21 articles
 * écartés, sept étaient de vrais articles de mode — une capsule westernwear,
 * une collection C2H4, des sneakers Jordan, un mariage dont l'article décrit
 * les tenues. La presse mode mêle les sujets dans un même texte : un lancement
 * de collection dans un hôtel, un portrait de créateur qui évoque un
 * restaurant. Un mot-clé ne distingue pas le sujet du décor.
 *
 * Haiku suffit : trancher « cet article parle-t-il d'une pièce qu'on porte ? »
 * est une classification binaire sur un texte court, pas un travail de
 * jugement. Mesuré : 0,036 $ par passage, 1,88 $ par an — 15 % du coût de la
 * synthèse qu'il protège.
 *
 * Requiert ANTHROPIC_API_KEY dans l'environnement.
 */

import Anthropic from "@anthropic-ai/sdk";

const args = process.argv.slice(2);
const drapeau = (n) => args.includes(n);
const MODELE = process.env.MODELE_TRI || "claude-haiku-4-5";
const MONTRER = drapeau("--montrer");

const SCHEMA = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      description: "Un verdict par article, dans l'ordre, sans en omettre aucun.",
      items: {
        type: "object",
        properties: {
          i: { type: "integer", description: "Le numéro de l'article, tel qu'il est donné." },
          garder: { type: "boolean", description: "Vrai si l'article parle d'une pièce qu'on porte." },
          motif: { type: "string", description: "Deux ou trois mots, seulement si tu écartes : « manette de jeu », « voiture », « série télé ». Chaîne vide si tu gardes." },
        },
        required: ["i", "garder", "motif"],
        additionalProperties: false,
      },
    },
  },
  required: ["verdicts"],
  additionalProperties: false,
};

const CONSIGNE = `Tu tries des titres et chapôs de presse. Une seule question par article : **parle-t-il d'une pièce qu'on porte sur soi ?**

Garde tout ce qui touche aux vêtements, aux chaussures et aux accessoires portés — sacs, bijoux, ceintures, foulards, chapeaux, lunettes. Une collaboration de baskets, une capsule westernwear, une collection de créateur, un article sur ce qu'une actrice portait : tout cela se garde. **Les sneakers sont des chaussures**, donc elles restent.

Écarte ce qui n'a rien à voir avec s'habiller : consoles et manettes, voitures, appareils photo, meubles, disques, séries et films, restaurants et hôtels, jouets. Écarte aussi ce qui ne décrit aucun vêtement — un carnet mondain, une nécrologie, une interview sans tenue, un article de forme ou de bien-être.

**Le décor n'est pas le sujet.** Un lancement de collection dans un hôtel reste un article de mode ; un palmarès d'hôtels n'en est pas un. Un portrait de créateur qui mentionne un restaurant se garde ; un article sur une mascotte de restaurant, non. Demande-toi de quoi l'article parle, pas des mots qu'il contient.

**Garde toujours un article de tendances vestimentaires**, quelle que soit sa forme : compte rendu de fashion week, palmarès de saison, revue de ce qui se porte. C'est la matière la plus utile du corpus. Un premier essai a écarté « 5 tendances de la Paris Fashion Week approuvées par TikTok » — exactement ce qu'il fallait garder.

**Un serre-tête, une barrette, une paire de lunettes se portent**, donc se gardent. Ce qui s'applique sur la peau ou les cheveux — vernis, maquillage, soin, coloration, autobronzant — ne se porte pas au sens où l'entend une garde-robe : écarte-le.

Dans le doute, **garde**. Un article inutile coûte quelques jetons à la synthèse ; un article de mode écarté fait disparaître une tendance réelle.

Rends un verdict pour chaque numéro, sans en sauter aucun.`;

/* --- lecture du corpus sur l'entrée standard --- */
const brut = await new Promise((ok, ko) => {
  let t = ""; process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => { t += c; });
  process.stdin.on("end", () => ok(t));
  process.stdin.on("error", ko);
});
const corpus = JSON.parse(brut);

if (!process.env.ANTHROPIC_API_KEY) {
  process.stderr.write("ANTHROPIC_API_KEY absente — corpus laissé tel quel.\n");
  process.stdout.write(brut);
  process.exit(0);
}

/* Titres et chapôs seuls, tronqués : la nature du sujet se voit dans les
   premières lignes, et l'article entier n'apporterait que du coût. */
const materiau = corpus.articles
  .map((a, i) => `${i}. [${a.source}] ${a.titre}${a.extrait ? ` — ${a.extrait.slice(0, 240)}` : ""}`)
  .join("\n");

process.stderr.write(`Tri de ${corpus.articles.length} articles avec ${MODELE}…\n`);

const client = new Anthropic();
const reponse = await client.messages.create({
  model: MODELE, max_tokens: 16000, system: CONSIGNE,
  output_config: { format: { type: "json_schema", schema: SCHEMA } },
  messages: [{ role: "user", content: materiau }],
});

if (reponse.stop_reason === "refusal") {
  process.stderr.write("Tri décliné — corpus laissé tel quel.\n");
  process.stdout.write(brut);
  process.exit(0);
}
const texte = reponse.content.find((b) => b.type === "text")?.text;
const { verdicts } = JSON.parse(texte);

/* Un article sans verdict est gardé : l'oubli du trieur ne doit pas faire
   disparaître une tendance. */
const parIndice = new Map(verdicts.map((v) => [v.i, v]));
const gardes = [], rejetes = [];
corpus.articles.forEach((a, i) => {
  const v = parIndice.get(i);
  if (!v || v.garder) gardes.push(a); else rejetes.push({ ...a, motif: v.motif });
});

const manquants = corpus.articles.length - parIndice.size;
process.stderr.write(`  ${gardes.length} gardés, ${rejetes.length} écartés` +
  (manquants > 0 ? `, ${manquants} sans verdict (gardés par défaut)` : "") + ".\n");

const tarifs = { "claude-haiku-4-5": [1, 5], "claude-sonnet-5": [2, 10], "claude-opus-5": [5, 25] };
const t = tarifs[MODELE];
if (t) {
  const cout = (reponse.usage.input_tokens * t[0] + reponse.usage.output_tokens * t[1]) / 1e6;
  process.stderr.write(`  ${reponse.usage.input_tokens} jetons entrée, ${reponse.usage.output_tokens} sortie — ${cout.toFixed(3)} $.\n`);
}

if (MONTRER) {
  const parMotif = {};
  for (const r of rejetes) (parMotif[r.motif || "sans motif"] ||= []).push(r);
  process.stderr.write("\n  ÉCARTÉS :\n");
  for (const [motif, l] of Object.entries(parMotif).sort((a, b) => b[1].length - a[1].length))
    for (const r of l) process.stderr.write(`    [${motif}] ${r.titre.slice(0, 100)}\n`);
}

/* Le corpus garde trace de ce qui a été retiré : sans cela on ne saurait pas
   distinguer une semaine calme d'un tri trop zélé. */
process.stdout.write(JSON.stringify({
  ...corpus,
  articles: gardes,
  tri: { modele: MODELE, gardes: gardes.length, ecartes: rejetes.length,
         motifs: rejetes.map((r) => ({ source: r.source, titre: r.titre, motif: r.motif })) },
}, null, 2));
