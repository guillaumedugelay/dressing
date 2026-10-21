/* Banc comparatif : le moteur de règles contre le jugement d'un modèle.
 *
 *   node outils/banc-llm.mjs export.json --situations 20
 *   node outils/banc-llm.mjs export.json --situations 4 --simuler
 *
 * Écrit deux fichiers à côté de l'export :
 *   …-comparatif.json   les données brutes, pour rejouer l'analyse
 *   …-comparatif.html   une page de comparaison À L'AVEUGLE, avec les photos
 *
 * POURQUOI À L'AVEUGLE. La question posée est « le modèle choisit-il mieux que
 * le moteur ». Aucun programme ne sait y répondre : le banc de `banc-tenues`
 * vérifie des invariants — pas de tenue sans chaussures, pas de conseil hors
 * de portée — et ne dira jamais laquelle de deux tenues est la plus belle.
 * Seule la propriétaire peut trancher, et seulement si elle ignore qui a
 * proposé quoi. La page mélange donc les six tenues de chaque situation et ne
 * révèle l'origine qu'après le vote.
 *
 * CE QUE CE BANC NE MESURE PAS. Le § 5 du cahier des charges demande au
 * modèle de juger l'adéquation « avec les goûts de l'utilisateur ». Ces goûts
 * se déduisent des j'aime, des rejets et des tenues portées : tout cela est
 * vide aujourd'hui. La personnalisation ne peut donc pas être évaluée ici, et
 * c'est précisément la dimension où un modèle devrait le plus se distinguer.
 * Ce que ce banc compare, c'est le jugement esthétique à froid.
 *
 * Requiert ANTHROPIC_API_KEY dans l'environnement.
 */

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync } from "fs";

const args = process.argv.slice(2);
const option = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
const drapeau = (n) => args.includes(n);
const fichier = args.find((a) => !a.startsWith("--") && a.endsWith(".json"));
if (!fichier) { console.error("Usage : node outils/banc-llm.mjs <export.json> [--situations 20] [--simuler]"); process.exit(1); }

const SITUATIONS_VOULUES = Number(option("--situations", 20));
const PLAFOND_CANDIDATES = Number(option("--candidates", 50));
const MODELE = process.env.MODELE || "claude-sonnet-5-5";
const EFFORT = process.env.EFFORT || "high";
/* DUEL=claude-opus-5-5 : un second modèle juge les mêmes candidates, et la
   page met trois sources en regard au lieu de deux. Pas d'exploration pour
   lui : on compare le jugement, pas la seconde passe. */
const DUEL = process.env.DUEL || "";
const SIMULER = drapeau("--simuler");
/* La seconde passe coûte 60 % de la première. On la déclenche à la demande,
   pour pouvoir comparer « passe 1 seule » et « passe 1 + exploration ». */
const EXPLORER = drapeau("--exploration");

/* Tarifs par million de jetons, repris de analyse-photos.mjs. */
const TARIFS = {
  "claude-opus-5-5":   { entree: 4, sortie: 20 },
  "claude-opus-5":     { entree: 5, sortie: 25 },
  "claude-sonnet-5-5": { entree: 2, sortie: 10 },
  "claude-sonnet-5":   { entree: 2, sortie: 10 },
  "claude-haiku-5-5":  { entree: 0.1, sortie: 0.5 },
  "claude-haiku-4-5":  { entree: 1, sortie: 5 },
};
function tarifDu(m) {
  const t = TARIFS[m]; if (!t) return null;
  const l = t.lancement, actif = l && new Date().toISOString().slice(0, 10) <= l.jusquA;
  return { entree: (actif ? l.entree : t.entree) / 1e6, sortie: (actif ? l.sortie : t.sortie) / 1e6, lancement: actif };
}

/* ═══════════ Le moteur, extrait de la page ═══════════
   Même procédé que banc-tenues.mjs, avec une couture de plus : on récupère
   les candidates, que proposerTenues garde d'ordinaire pour elle. */
function chargerMoteur() {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  let sc = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
  const i = sc.indexOf("(() => {"), j = sc.lastIndexOf("})();");
  if (i < 0 || j < 0) throw new Error("index.html : script introuvable ou de forme inattendue");
  sc = sc.slice(i + 8, j).replace("  const tenues = meilleures.concat(rotation);",
    "  const tenues = meilleures.concat(rotation);\n  __out.candidates = candidates;");
  const stubs = `
    var document = { addEventListener(){}, querySelector: () => null, querySelectorAll: () => [],
      createElement: () => ({ style:{}, classList:{add(){},remove(){}}, appendChild(){}, setAttribute(){}, getContext: () => null }),
      documentElement: { style: { setProperty(){} } }, body: { classList: { add(){}, remove(){} } }, getElementById: () => null };
    var window = { addEventListener(){}, matchMedia: () => ({ matches:false, addEventListener(){} }), location:{href:""}, navigator:{} };
    var navigator = { serviceWorker: { register: () => Promise.resolve() }, geolocation: null };
    var localStorage = { getItem: () => null, setItem(){}, removeItem(){} };
    var indexedDB = { open: () => ({ addEventListener(){}, result:null }) };
    var fetch = () => Promise.reject(new Error("banc : pas de réseau"));
    var setTimeout = () => 0, setInterval = () => 0, requestAnimationFrame = () => 0;
  `;
  const out = {};
  new Function("__out", stubs + sc +
    "\n;__out.proposerTenues = proposerTenues; __out.etat = etat; __out.portable = portable; __out.poserGardeRobe = poserGardeRobe;" +
    "\n;__out.poserTendances = (c) => { TENDANCES = c; }; __out.noteSur10 = noteSur10;" +
    "\n;__out.adaptee = adapteeALaSituation; __out.offre = offreDeLaGardeRobe;" +
    "\n;__out.noterTenue = noterTenue; __out.tableAffinites = tableAffinites; __out.formaliteMax = formaliteMax;")(out);
  if (typeof out.proposerTenues !== "function") throw new Error("moteur : proposerTenues introuvable");
  return out;
}

/* ═══════════ Ce qu'on envoie au modèle ═══════════
   Ni les photos ni la garde-robe entière : les 50 meilleures candidates, et
   seulement les pièces qu'elles citent. Sur 1 000 pièces, cela reste une
   trentaine de fiches — le plafond de 50 tenues borne la charge, quelle que
   soit la taille du vestiaire. */
const fichePiece = (p) => ({
  id: p.id, nom: p.nom, categorie: p.categorie, couleurs: p.couleurs || [],
  coupe: p.coupe, motif: p.motif || "", longueur: p.longueur || "",
  matiere: p.matiere || "", formalite: [p.formaliteMin, p.formaliteMax],
  chaleur: p.chaleur, description: p.description || "",
  /* Les saisons disent aussi le caractère d'une pièce : une robe réservée aux
     beaux jours se porte seule, une ceinture qui fuit l'été fait automnal. */
  saisons: (p.saisons || []).length ? p.saisons : "toute l'année",
  ...(["bas", "robe"].includes(p.categorie) && p.passants !== undefined ? { passants: p.passants } : {}),
});

const SCHEMA = {
  type: "object",
  properties: {
    recommendations: {
      type: "array",
      description: "Exactement trois tenues, classées de la meilleure à la moins bonne.",
      items: {
        type: "object",
        properties: {
          rang: { type: "integer", description: "1, 2 ou 3" },
          candidate: { type: "integer", description: "Le rang de la candidate reprise, tel qu'il figure dans la liste fournie." },
          pieces: { type: "array", items: { type: "string" }, description: "Les identifiants exacts des pièces, repris de la liste fournie." },
          score: { type: "integer", description: "0 à 100, ton jugement d'ensemble." },
          harmonie_couleurs: { type: "integer", description: "0 à 100" },
          coherence_style: { type: "integer", description: "0 à 100" },
          accord_tendance: { type: "integer", description: "0 à 100" },
          raison: { type: "string", description: "Deux phrases en français, dites comme une conseillère : ce qui fait tenir la tenue, et sa réserve s'il y en a une. Nomme les vêtements, pas leurs identifiants." },
        },
        required: ["rang", "candidate", "pieces", "score", "harmonie_couleurs", "coherence_style", "accord_tendance", "raison"],
        additionalProperties: false,
      },
    },
    explorations: {
      type: "array",
      description: "Au plus trois recherches ciblées dans le reste de la garde-robe, et **au plus une par tenue** : si une tenue serait meilleure avec une pièce que tu ne vois pas ici, demande-la. Liste vide si les candidates suffisent.",
      items: {
        type: "object",
        properties: {
          candidate: { type: "integer", description: "Le rang de la candidate à améliorer." },
          categorie: { type: "string", description: "haut, bas, robe, pull, manteau, chaussures ou accessoire" },
          couleurs: { type: "array", items: { type: "string" }, description: "Les couleurs acceptables, dans le vocabulaire fourni." },
          pourquoi: { type: "string", description: "Une phrase : ce que cette pièce apporterait." },
        },
        required: ["candidate", "categorie", "couleurs", "pourquoi"],
        additionalProperties: false,
      },
    },
  },
  required: ["recommendations", "explorations"],
  additionalProperties: false,
};

const CONSIGNE = `Tu es styliste. On te soumet les meilleures tenues qu'un moteur de règles a retenues dans la garde-robe de quelqu'un, pour une journée précise, et tu choisis les trois plus réussies.

Le moteur a déjà tranché tout ce qui est objectif : la saison, la température, la pluie, le registre de la journée, la disponibilité des pièces. **Toutes les tenues qu'on te montre sont portables.** Ne les départage donc pas là-dessus — son score est indiqué, il vaut ce qu'il vaut, tu n'es pas tenu de le suivre.

Ce qu'on te demande de juger, c'est ce qu'un calcul ne sait pas voir :
- l'harmonie des couleurs, leur nombre, leur contraste ;
- les matières et les textures ensemble ;
- les proportions et la silhouette ;
- la cohérence du style — une tenue doit raconter une seule chose ;
- l'accord avec ce qui se porte en ce moment, sans en faire une obsession.

Les descriptions des pièces contiennent ce que la fiche ne sait pas stocker : tissage, coupe précise, détails de construction. C'est souvent là que se joue l'accord ou le désaccord.

**Les identifiants doivent être repris exactement.** N'invente aucune pièce, ne modifie aucune tenue : tu choisis parmi les candidates proposées, telles quelles.

**Tes trois tenues ne peuvent pas partager une pièce de base** — un haut, un bas ou une robe ne sort qu'une fois. Trois propositions bâties sur le même tee-shirt, où seule la jupe change, donnent l'impression de tourner en rond : c'est le haut et le bas qu'on regarde en premier. Les couches, les chaussures et les accessoires, eux, peuvent revenir.

**Si une tenue serait nettement meilleure avec une pièce que tu ne vois pas**, tu peux demander une recherche ciblée dans le reste de la garde-robe — au plus trois demandes, et **au plus une par tenue**. Une tenue ne se répare pas en changeant trois choses : si elle en demande autant, ce n'est pas la bonne tenue.

N'en fais aucune si les candidates te suffisent : une demande qui n'apporterait qu'un gain marginal fait perdre du temps à quelqu'un qui s'habille.

La raison s'adresse à la propriétaire, pas à un ingénieur. Nomme les vêtements, dis ce qui marche, et tais-toi sur les scores.`;

/* La consigne de la seconde passe. Elle est courte : le modèle a déjà jugé, on
   ne lui redonne ni les 50 candidates ni le catalogue — seulement ses trois
   tenues et les variantes que sa demande a fait remonter. */
const CONSIGNE2 = `Tu as retenu trois tenues, et tu as demandé à chercher dans le reste de la garde-robe. Voici ce que la recherche a rendu, sous forme de variantes : ce sont tes tenues, avec une pièce remplacée.

Chaque variante a déjà été vérifiée par le moteur — elle est portable pour la journée décrite. Tu n'as donc à juger que l'allure.

Rends de nouveau trois tenues. Pour chacune, garde ta version d'origine **ou** prends une variante, selon ce qui est le plus réussi. Ne change pas pour changer : une variante ne se retient que si elle fait nettement mieux.

Les identifiants doivent être repris exactement, et tes trois tenues ne peuvent toujours pas partager un haut, un bas ou une robe.

Ne redemande pas de recherche : rends une liste d'explorations vide.`;

/* ═══════════ La recherche ciblée, côté moteur ═══════════

   C'est le moteur qui cherche, pas le modèle : il connaît les mille pièces, et
   il sait lesquelles sont portables aujourd'hui. Mesuré à 0 ms sur une
   garde-robe de mille pièces — la recherche est gratuite, seule la seconde
   passe se paie.

   D'où la règle : **on ne déclenche la seconde passe que si la recherche a
   trouvé quelque chose.** Sur un essai réel, 5 demandes sur 13 réclamaient un
   manteau que la garde-robe ne contient pas : un tiers des explorations serait
   allé chercher le vide et payé une passe pour rien. */
function chercher(M, demande, deja) {
  const voulu = (demande.couleurs || []).filter(Boolean);
  return M.etat.pieces.filter((p) =>
    p.categorie === demande.categorie
    && M.portable(p)
    && !deja.has(p.id)
    && (!voulu.length || (p.couleurs || []).some((c) => voulu.includes(c))))
    .slice(0, 5);
}

/* Une variante remplace, dans la tenue visée, la pièce de même catégorie — ou
   l'ajoute si la tenue n'en portait pas.

   Elle doit ensuite **repasser le filtre d'adéquation**. Sans cela, une
   substitution pourrait faire sortir la tenue de la fenêtre de chaleur ou du
   registre de la journée, et le modèle choisirait une tenue que le moteur
   aurait refusée. C'est le premier temps du moteur qui garde le dernier mot. */
function variantes(M, tenue, nouvelles, offre) {
  const sorties = [];
  for (const np of nouvelles) {
    const pieces = tenue.pieces.filter((p) => p.categorie !== np.categorie).concat([np]);
    if (!M.adaptee(pieces, offre).ok) continue;
    sorties.push(pieces);
  }
  return sorties;
}

/* ═══════════ Exécution ═══════════ */
const donnees = JSON.parse(readFileSync(fichier, "utf8"));
const corpus = JSON.parse(readFileSync(new URL("../tendances.json", import.meta.url), "utf8"));

/* `--rejouer` refait la page à partir d'un comparatif déjà obtenu. La mise en
   forme se corrige souvent — les appels, eux, ne se rejouent pas à 1,23 $
   la fournée. */
const REJOUER = drapeau("--rejouer");
const M = REJOUER ? null : chargerMoteur();
if (M) {
  M.poserTendances(corpus);

  M.poserGardeRobe(donnees.pieces);
  M.etat.tenues = donnees.tenues || [];
  M.etat.avis = donnees.avis || [];
  M.etat.poidsTendance = 1;
}

/* On balaie les situations plausibles et on garde celles qui ont de la
   matière, réparties sur les occasions. Jusqu'en octobre 2026 le balayage
   s'arrêtait à l'été : la garde-robe n'avait ni manteau ni chaussure d'hiver.
   Chaque saison n'a que ses températures vraisemblables — un été froid ne
   dirait rien du moteur. */
const TEMPERATURES = { printemps: ["froid", "doux"], ete: ["doux", "chaud"], automne: ["froid", "doux"], hiver: ["froid"] };
const toutes = [];
for (const saison of ["printemps", "ete", "automne", "hiver"])
  for (const meteo of ["soleil", "nuages", "bruine", "pluie", ...(saison === "hiver" ? ["neige"] : [])])
    for (const temp of TEMPERATURES[saison])
      for (const activite of ["travail", "chill", "habille"])
        toutes.push({ saison, meteo, temp, activite });

const utilisables = [];
for (const st of (REJOUER ? [] : toutes)) {
  Object.assign(M.etat, st, { ecartees: new Set() });
  M.candidates = [];
  const r = M.proposerTenues();
  if (!r.erreur && M.candidates.length >= 10)
    utilisables.push({ ...st, moteur: r.tenues.filter((t) => t.origine !== "rotation") });
}
/* Étaler l'échantillon sur toute la liste, et non prendre les premières. Un
   pas entier donnait 18 printemps sur 20 : les situations sont engendrées
   saison par saison, si bien qu'un pas de 1 ne quitte jamais la première. */
const retenues = SITUATIONS_VOULUES >= utilisables.length ? utilisables
  : Array.from({ length: SITUATIONS_VOULUES }, (_, i) =>
      utilisables[Math.round(i * (utilisables.length - 1) / (SITUATIONS_VOULUES - 1))]);

console.error(`${utilisables.length} situations exploitables, ${retenues.length} retenues.`);
console.error(`Modèle ${MODELE}, effort ${EFFORT}.${SIMULER ? "  (--simuler : aucun appel, aucune dépense)" : ""}\n`);

const client = (SIMULER || REJOUER) ? null : new Anthropic();
const COMPTER = SIMULER && drapeau("--compter");
const compteur = COMPTER ? new Anthropic() : null;
const comptes = [];
const usage = { entree: 0, sortie: 0 };
const usageDuel = { entree: 0, sortie: 0 };
const resultats = [];

/* --photos joint la photo de chaque pièce citée, devant la fiche. Sans elles,
   le modèle juge sur des descriptions qu'un autre modèle a écrites depuis les
   photos — une copie de copie, qui perd la nuance exacte d'un beige, l'éclat
   d'une matière, l'échelle d'un motif. La propriétaire, elle, vote photos
   sous les yeux. Une photo compacte pèse environ 420 jetons. */
const PHOTOS = drapeau("--photos");
function contenu(charge) {
  if (!PHOTOS) return JSON.stringify(charge);
  const parId = new Map(donnees.pieces.map((p) => [p.id, p]));
  const blocs = [];
  for (const f of charge.pieces) {
    const m = /^data:(image\/[a-z+]+);base64,(.+)$/s.exec(parId.get(f.id)?.photo || "");
    if (!m) continue;
    blocs.push({ type: "text", text: `Photo de la pièce ${f.id} — ${f.nom}` },
               { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
  }
  blocs.push({ type: "text", text: "Les photos ci-dessus montrent les pièces telles qu'elles sont, prises à plat ou sur cintre chez la propriétaire ; le fond et la lumière varient. Voici la journée, les fiches et les candidates :\n\n" + JSON.stringify(charge) });
  return blocs;
}

/* Le premier appel, partagé par les deux modèles d'un duel. */
async function premierePasse(modele, compteur, charge) {
  let lu = null, erreur = null;
  try {
    const reponse = await client.messages.create({
      model: modele, max_tokens: 16000, system: CONSIGNE,
      output_config: { effort: EFFORT, format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: contenu(charge) }],
    });
    compteur.entree += reponse.usage.input_tokens;
    compteur.sortie += reponse.usage.output_tokens;
    if (reponse.stop_reason === "refusal") throw new Error("demande déclinée");
    const texte = reponse.content.find((b) => b.type === "text")?.text;
    if (!texte) throw new Error("réponse vide");
    lu = JSON.parse(texte);
    /* Les identifiants doivent exister, et la tenue correspondre à une
       candidate : sans ce contrôle, une tenue inventée entrerait dans la
       comparaison et la fausserait. */
    const connus = new Set(donnees.pieces.map((p) => p.id));
    for (const rec of lu.recommendations) {
      const inconnus = rec.pieces.filter((x) => !connus.has(x));
      if (inconnus.length) throw new Error(`identifiants inconnus : ${inconnus.join(", ")}`);
    }
    if (lu.recommendations.length !== 3) throw new Error(`${lu.recommendations.length} tenues au lieu de 3`);
    /* La même contrainte que le moteur : une pièce de base ne sort qu'une
       fois. Sans ce contrôle, la comparaison opposerait un moteur bridé à un
       modèle libre de répéter, et le verdict ne vaudrait rien. */
    const BASES = ["haut", "bas", "robe"];
    const parPiece = new Map(M.etat.pieces.map((p) => [p.id, p])); // les traductions pour le moteur : catégories d'avant
    const bases = [];
    for (const rec of lu.recommendations)
      for (const x of rec.pieces)
        if (BASES.includes(parPiece.get(x)?.categorie)) bases.push(x);
    const repetees = bases.filter((x, k) => bases.indexOf(x) !== k);
    if (repetees.length) throw new Error(`pièce de base répétée : ${[...new Set(repetees)].map((x) => parPiece.get(x)?.nom).join(", ")}`);
  } catch (e) { erreur = e.message; lu = null; }
  return { lu, erreur };
}

if (REJOUER) {
  const chemin = fichier.replace(/\.json$/i, "") + "-comparatif.json";
  resultats.push(...JSON.parse(readFileSync(chemin, "utf8")).resultats);
  console.error(`Rejeu de ${chemin} — ${resultats.filter((r) => r.llm).length} situations, aucun appel.`);
}

for (const [i, st] of (REJOUER ? [] : retenues).entries()) {
  Object.assign(M.etat, st, { ecartees: new Set() });
  M.candidates = [];
  const r = M.proposerTenues();
  const top = [...M.candidates].sort((a, b) => b.note - a.note).slice(0, PLAFOND_CANDIDATES);
  const vues = new Map();
  for (const t of top) for (const p of t.pieces) vues.set(p.id, p);

  const charge = {
    contexte: { saison: st.saison, meteo: st.meteo, temperature: st.temp, occasion: st.activite },
    tendances: corpus.regles.filter((x) => x.type !== "descriptive")
      .map((x) => ({ type: x.type, valeur: x.valeur, poids: x.poids, note: x.note })),
    gouts: {
      aimes: (donnees.avis || []).filter((a) => a.score > 0).length,
      rejetes: (donnees.avis || []).filter((a) => a.score < 0).length,
      tenuesPortees: (donnees.tenues || []).length,
    },
    pieces: [...vues.values()].map(fichePiece),
    candidates: top.map((t, k) => ({ rang: k + 1, pieces: t.pieces.map((p) => p.id), scoreMoteur: Number(t.note.toFixed(2)) })),
  };

  const etiquette = `${st.saison}/${st.meteo}/${st.temp}/${st.activite}`;
  if (SIMULER) {
    /* --compter remplace l'estimation par le comptage exact de l'API, qui est
       gratuit : avec les photos, la longueur du texte ne dit plus rien. */
    let jetons = `~${Math.round(JSON.stringify(charge).length / 3.5)}`;
    if (COMPTER) {
      const n = await compteur.messages.countTokens({ model: MODELE, system: CONSIGNE, messages: [{ role: "user", content: contenu(charge) }] });
      comptes.push(n.input_tokens);
      jetons = String(n.input_tokens);
    }
    console.error(`  [${i + 1}/${retenues.length}] ${etiquette} — ${top.length} candidates, ${vues.size} pièces, ${jetons} jetons`);
    resultats.push({ situation: st, moteur: st.moteur, llm: null, charge: { candidates: top.length, pieces: vues.size } });
    continue;
  }

  let { lu, erreur } = await premierePasse(MODELE, usage, charge);

  console.error(`  [${i + 1}/${retenues.length}] ${etiquette} — ${top.length} candidates` +
    (erreur ? `  ÉCHEC : ${erreur}` : `  → ${lu.recommendations.map((x) => "#" + x.candidate).join(" ")}` +
      (lu.explorations.length ? `, ${lu.explorations.length} exploration(s)` : "")));

  /* Le second modèle reçoit exactement la même charge : mêmes candidates,
     même tirage. Deux passages séparés compareraient aussi deux tirages au
     sort du moteur, et on ne saurait plus lequel des deux on juge. */
  let duel = null;
  if (DUEL) {
    duel = await premierePasse(DUEL, usageDuel, charge);
    console.error(`        ${DUEL} :` + (duel.erreur ? ` ÉCHEC : ${duel.erreur}`
      : ` → ${duel.lu.recommendations.map((x) => "#" + x.candidate).join(" ")}`));
  }

  /* ═══════════ Seconde passe : l'exploration ═══════════
     Au plus une demande par tenue — une tenue ne se répare pas en changeant
     trois choses — et **rien n'est envoyé si la recherche locale n'a rien
     trouvé**. La recherche coûte 0 ms, la passe coûte 60 % de la première :
     autant savoir avant de payer. */
  let explo = null;
  if (EXPLORER && !erreur && lu.explorations.length) {
    const parPiece = new Map(M.etat.pieces.map((p) => [p.id, p])); // les traductions pour le moteur : catégories d'avant
    const viseesa = new Set();
    const demandes = lu.explorations
      .filter((e) => !viseesa.has(e.candidate) && (viseesa.add(e.candidate), true))
      .slice(0, 3);

    const offre = M.offre();
    const deja = new Set(top.flatMap((t) => t.pieces.map((p) => p.id)));
    const trouvailles = [];
    for (const d of demandes) {
      const rec = lu.recommendations.find((x) => x.candidate === d.candidate);
      if (!rec) continue;
      const tenue = { pieces: rec.pieces.map((x) => parPiece.get(x)).filter(Boolean) };
      const nouvelles = chercher(M, d, deja);
      if (!nouvelles.length) continue;
      const v = variantes(M, tenue, nouvelles, offre);
      if (v.length) trouvailles.push({ demande: d, base: rec, nouvelles, variantes: v });
    }

    if (!trouvailles.length) {
      console.error(`        exploration : ${demandes.length} demande(s), rien de trouvé — pas de seconde passe`);
      explo = { demandes: demandes.length, trouvees: 0, appel: false };
    } else {
      const vus2 = new Map();
      for (const rec of lu.recommendations) for (const x of rec.pieces) if (parPiece.get(x)) vus2.set(x, parPiece.get(x));
      for (const t of trouvailles) for (const p of t.nouvelles) vus2.set(p.id, p);
      const variantesPlates = trouvailles.flatMap((t, k) =>
        t.variantes.map((v, j) => ({ rang: 100 + k * 10 + j, pieces: v.map((p) => p.id), venantDe: t.base.candidate })));

      const charge2 = {
        contexte: charge.contexte, tendances: charge.tendances,
        pieces: [...vus2.values()].map(fichePiece),
        retenues: lu.recommendations.map((x) => ({ rang: x.rang, pieces: x.pieces })),
        variantes: variantesPlates,
      };
      try {
        const rep2 = await client.messages.create({
          model: MODELE, max_tokens: 16000, system: CONSIGNE2,
          output_config: { effort: EFFORT, format: { type: "json_schema", schema: SCHEMA } },
          messages: [{ role: "user", content: JSON.stringify(charge2) }],
        });
        usage.entree += rep2.usage.input_tokens;
        usage.sortie += rep2.usage.output_tokens;
        const t2 = rep2.content.find((b) => b.type === "text")?.text;
        const lu2 = JSON.parse(t2);
        const connus = new Set(donnees.pieces.map((p) => p.id));
        for (const rec of lu2.recommendations)
          if (rec.pieces.some((x) => !connus.has(x))) throw new Error("identifiant inconnu");
        const change = lu2.recommendations.filter((x, k) =>
          x.pieces.slice().sort().join("|") !== (lu.recommendations[k]?.pieces || []).slice().sort().join("|")).length;
        console.error(`        exploration : ${trouvailles.length} recherche(s) fructueuse(s), ${variantesPlates.length} variante(s) → ${change} tenue(s) changée(s)`);
        explo = { demandes: demandes.length, trouvees: trouvailles.length, variantes: variantesPlates.length, appel: true, changees: change, avant: lu.recommendations, cherche: demandes };
        lu = lu2;
      } catch (e) {
        console.error(`        exploration : ÉCHEC de la seconde passe — ${e.message}`);
        explo = { demandes: demandes.length, trouvees: trouvailles.length, appel: true, erreur: e.message };
      }
    }
  }

  resultats.push({
    situation: st,
    moteur: st.moteur.map((t) => ({ pieces: t.pieces.map((p) => p.id), note: Number(t.note.toFixed(2)) })),
    llm: erreur ? null : lu,
    erreur, exploration: explo,
    ...(DUEL ? { llm2: duel.erreur ? null : duel.lu, erreur2: duel.erreur } : {}),
    candidatesEnvoyees: top.map((t) => t.pieces.map((p) => p.id)),
  });
}

/* ═══════════ Sorties ═══════════ */
const base = fichier.replace(/\.json$/i, "");
if (!REJOUER) writeFileSync(`${base}-comparatif.json`, JSON.stringify({
  fait: new Date().toISOString(), modele: MODELE, effort: EFFORT, duel: DUEL || undefined,
  corpus: corpus.revision, resultats,
}, null, 1));

if (!SIMULER && !REJOUER) {
  const tarif = tarifDu(MODELE);
  console.error(`\nJetons : ${usage.entree} entrée, ${usage.sortie} sortie.`);
  if (tarif) {
    const cout = usage.entree * tarif.entree + usage.sortie * tarif.sortie;
    console.error(`Coût : environ ${cout.toFixed(2)} $${tarif.lancement ? " (tarif de lancement)" : ""}, soit ${(cout / retenues.length).toFixed(3)} $ par situation.`);
    console.error(`Projection à un appel par jour : ${(cout / retenues.length * 365).toFixed(2)} $ par an.`);
  }
  const tarif2 = DUEL && tarifDu(DUEL);
  if (tarif2) {
    const cout2 = usageDuel.entree * tarif2.entree + usageDuel.sortie * tarif2.sortie;
    console.error(`${DUEL} : ${usageDuel.entree} entrée, ${usageDuel.sortie} sortie — environ ${cout2.toFixed(2)} $, soit ${(cout2 / retenues.length).toFixed(3)} $ par situation.`);
  }
}

/* La page de comparaison, avec les photos : c'est le seul format où un
   jugement esthétique se porte honnêtement. */
const parId = new Map(donnees.pieces.map((p) => [p.id, p]));
const echapper = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
/* Les photos sont posées une fois dans une table, et les vignettes s'y
   réfèrent. Inlinées à chaque occurrence, les 381 vignettes de 18 situations
   pesaient 44 Mo pour une soixantaine de photos distinctes — le navigateur
   n'ouvrait plus la page. */
const photos = new Map();
const vignette = (id) => {
  const p = parId.get(id);
  if (!p) return `<div class="p">?</div>`;
  if (p.photo) photos.set(id, p.photo);
  return `<div class="p">${p.photo ? `<img data-p="${id}" alt="">` : ""}<span>${echapper(p.nom)}</span></div>`;
};
const tenueHtml = (ids, cle) => `<div class="t" data-cle="${cle}"><span class="rang"></span><div class="pieces">${ids.map(vignette).join("")}</div>
  <button class="vote">Classer</button></div>`;

/* En simulation il n'y a rien à comparer : on n'écrit pas de page vide. */
if (SIMULER) {
  const total = resultats.reduce((n, r) => n + r.charge.candidates, 0);
  console.error(`\nSimulation : ${resultats.length} situations, ${total} candidates au total.`);
  if (comptes.length) console.error(`Entrée exacte : ${comptes.reduce((a, b) => a + b, 0)} jetons, soit ${Math.round(comptes.reduce((a, b) => a + b, 0) / comptes.length)} par situation.`);
  console.error("Aucune page écrite — sans appel, il n'y a rien à mettre en regard.");
  process.exit(0);
}

/* Les noms ne paraissent qu'après le vote. En duel, une situation où l'un des
   deux modèles a échoué est écartée : elle opposerait deux sources à trois. */
const lisible = (m) => m.replace(/^claude-/, "").replace(/-(\d)-(\d)$/, " $1.$2").replace(/^./, (c) => c.toUpperCase());
const meta = REJOUER ? JSON.parse(readFileSync(`${base}-comparatif.json`, "utf8")) : { modele: MODELE, duel: DUEL };
const NOMS = { moteur: "règles actuelles", llm: `IA (${lisible(meta.modele)})`, llm2: meta.duel ? `IA (${lisible(meta.duel)})` : "" };
const enDuel = Boolean(meta.duel);
const blocs = resultats.filter((r) => r.llm && (!enDuel || r.llm2)).map((r, i) => {
  const st = r.situation;
  /* On mélange tout, et on ne dit rien de l'origine avant le vote. Une tenue
     choisie par plusieurs sources n'apparaît qu'une fois, et son vote compte
     pour chacune : au premier duel, Sonnet et Opus en partageaient 19 sur 51,
     et le doublon aurait attribué le vote au hasard. */
  const parTenue = new Map();
  const poser = (ids, cle) => {
    const k = ids.slice().sort().join("|");
    if (!parTenue.has(k)) parTenue.set(k, { ids, cles: [] });
    if (!parTenue.get(k).cles.includes(cle)) parTenue.get(k).cles.push(cle);
  };
  r.moteur.forEach((t) => poser(t.pieces, "moteur"));
  r.llm.recommendations.forEach((x) => poser(x.pieces, "llm"));
  if (enDuel) r.llm2.recommendations.forEach((x) => poser(x.pieces, "llm2"));
  const lot = [...parTenue.values()].map((t) => ({ ids: t.ids, cle: t.cles.join("+") }));
  for (let k = lot.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [lot[k], lot[j]] = [lot[j], lot[k]]; }
  const explos = r.llm.explorations.map((e) => `<li>${echapper(e.categorie)} ${echapper((e.couleurs || []).join(", "))} — ${echapper(e.pourquoi)}</li>`).join("");
  const raisons = (cle, l) => l.recommendations.map((x) => `<p class="raison"><b>${echapper(NOMS[cle])} — son choix n° ${x.rang}</b> (${x.score}/100) — ${echapper(x.raison)}</p>`).join("");
  return `<section>
    <h2>Situation ${i + 1} — ${echapper(st.saison)} · ${echapper(st.meteo)} · ${echapper(st.temp)} · ${echapper(st.activite)}</h2>
    <div class="lot">${lot.map((x) => tenueHtml(x.ids, x.cle)).join("")}</div>
    <div class="actions"><button class="valider" disabled>Valider ce classement</button><button class="effacer">Recommencer</button></div>
    <div class="reveal" hidden>
      <p><b>Origine :</b> ${lot.map((x, k) => `${k + 1} = ${x.cle.split("+").map((c) => echapper(NOMS[c])).join(" et ")}`).join(" · ")}</p>
      ${raisons("llm", r.llm)}${enDuel ? raisons("llm2", r.llm2) : ""}
      ${explos ? `<p><b>Recherches demandées :</b></p><ul>${explos}</ul>` : `<p><i>Aucune recherche demandée.</i></p>`}
    </div>
  </section>`;
}).join("");

const page = `<!doctype html><meta charset="utf-8">
<title>Règles actuelles contre IA — comparaison à l'aveugle</title>
<style>
 body{font:15px/1.5 system-ui,sans-serif;max-width:1100px;margin:0 auto;padding:20px;background:#faf8f4;color:#1f2534}
 h1{font-size:22px} h2{font-size:16px;margin:28px 0 10px;color:#5a6274;font-weight:600}
 .lot{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}
 .t{position:relative;background:#fff;border:1px solid #e6e1d8;border-radius:10px;padding:10px}
 .t.classee{border-color:#3e5288;box-shadow:0 0 0 2px #e2e6f2}
 .rang{position:absolute;top:-10px;right:-10px;min-width:30px;height:30px;border-radius:15px;background:#3e5288;color:#fff;font-weight:700;display:none;align-items:center;justify-content:center;font-size:14px}
 .t.classee .rang{display:flex}
 .pieces{display:flex;gap:5px;flex-wrap:wrap;min-height:88px}
 .p{width:62px;font-size:10px;text-align:center;color:#5a6274}
 .p img{width:62px;height:62px;object-fit:cover;border-radius:6px;display:block}
 .p span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 button{margin-top:8px;width:100%;padding:6px;border:1px solid #cfc9bd;border-radius:7px;background:#f4f1ea;cursor:pointer;font:inherit;font-size:13px}
 button:disabled{opacity:.45;cursor:default}
 .actions{display:flex;gap:10px;margin-top:10px} .actions button{width:auto;padding:7px 14px}
 .valider{background:#3e5288;color:#fff;border-color:#3e5288}
 section.validee .vote,section.validee .actions{display:none}
 .reveal{background:#fff;border-left:3px solid #3e5288;padding:10px 14px;margin-top:10px;font-size:13.5px}
 .raison{color:#3d4354} .bilan{position:sticky;bottom:0;background:#1f2534;color:#fff;padding:12px;border-radius:10px;margin-top:24px}
</style>
<h1>Règles actuelles contre IA — comparaison à l'aveugle</h1>
<p>Pour chaque situation, jusqu'à ${enDuel ? "neuf" : "six"} tenues : trois choisies par le <b>moteur de règles actuel</b>, ${enDuel ? "trois par chacune des <b>deux IA</b>" : "trois par l'<b>IA</b>"}, mélangées et sans étiquette. Une tenue choisie par plusieurs n'apparaît qu'une fois, et ses points comptent pour chacune.</p>
<p><b>Classe-les</b> : clique « Classer » sur ta préférée, puis sur la suivante, et ainsi de suite — au moins trois, autant que tu veux. Re-cliquer une tenue la retire du classement, avec celles qui la suivent. « Valider » révèle l'origine. Ton classement est gardé si tu fermes la page.</p>
<p>Points : 3 pour la 1<sup>re</sup> place, 2 pour la 2<sup>e</sup>, 1 pour la 3<sup>e</sup>.</p>
${blocs}
<div class="bilan" id="bilan">Aucun classement pour l'instant.</div>
<script>
 const PHOTOS = __PHOTOS__;
 const NOMS = ${JSON.stringify(NOMS)};
 /* La clé change à chaque page écrite : le mélange des tenues aussi. */
 const CLE = "classement-${new Date().toISOString()}";
 document.querySelectorAll("img[data-p]").forEach((i) => { i.src = PHOTOS[i.dataset.p] || ""; });
 const sections = [...document.querySelectorAll("section")];
 /* état : pour chaque section, l'ordre des tenues classées et si c'est validé */
 let etat = sections.map(() => ({ ordre: [], validee: false }));
 try { const lu = JSON.parse(localStorage.getItem(CLE)); if (Array.isArray(lu) && lu.length === sections.length) etat = lu; } catch {}
 const garder = () => { try { localStorage.setItem(CLE, JSON.stringify(etat)); } catch {} };
 const ORD = (n) => n === 1 ? "1re" : n + "e";

 function peindre(k) {
   const s = sections[k], e = etat[k], tenues = [...s.querySelectorAll(".t")];
   tenues.forEach((t, j) => {
     const r = e.ordre.indexOf(j);
     t.classList.toggle("classee", r >= 0);
     t.querySelector(".rang").textContent = r >= 0 ? ORD(r + 1) : "";
   });
   s.querySelector(".valider").disabled = e.ordre.length < Math.min(3, tenues.length);
   s.classList.toggle("validee", e.validee);
   s.querySelector(".reveal").hidden = !e.validee;
 }

 function bilan() {
   const pts = {}, premiers = {};
   Object.keys(NOMS).forEach((c) => { pts[c] = 0; premiers[c] = 0; });
   let n = 0;
   etat.forEach((e, k) => {
     if (!e.validee) return;
     n++;
     const tenues = [...sections[k].querySelectorAll(".t")];
     e.ordre.slice(0, 3).forEach((j, r) => {
       for (const c of tenues[j].dataset.cle.split("+")) {
         pts[c] += 3 - r;
         if (r === 0) premiers[c]++;
       }
     });
   });
   document.getElementById("bilan").textContent = n
     ? n + " situation(s) classée(s) — " + Object.entries(NOMS).filter(([, x]) => x)
         .map(([c, x]) => x + " : " + pts[c] + " pts, " + premiers[c] + " fois 1re").join("  |  ")
     : "Aucun classement pour l'instant.";
 }

 sections.forEach((s, k) => {
   s.querySelectorAll(".t").forEach((t, j) => t.querySelector(".vote").onclick = () => {
     const e = etat[k];
     if (e.validee) return;
     const r = e.ordre.indexOf(j);
     if (r >= 0) e.ordre = e.ordre.slice(0, r); else e.ordre.push(j);
     garder(); peindre(k);
   });
   s.querySelector(".valider").onclick = () => { etat[k].validee = true; garder(); peindre(k); bilan(); };
   s.querySelector(".effacer").onclick = () => { etat[k] = { ordre: [], validee: false }; garder(); peindre(k); };
   peindre(k);
 });
 bilan();
</script>`;

/* La table des photos est injectee une seule fois, apres coup : les vignettes
   ny referent que par identifiant. */
writeFileSync(`${base}-comparatif.html`, page.replace("__PHOTOS__", JSON.stringify(Object.fromEntries(photos))));

/* ═══════════ La page de l'exploration ═══════════
   Une moyenne ne dit rien de la pertinence d'un remplacement : il faut voir la
   tenue d'avant et celle d'après, côte à côte, sans savoir laquelle est
   laquelle. La pièce qui change est signalée des deux côtés — cela accélère la
   lecture sans trahir l'origine. */
if (EXPLORER) {
  const memesPieces = (a, b) => a.slice().sort().join("|") === b.slice().sort().join("|");
  const paires = [];
  resultats.forEach((r, i) => {
    if (!r.exploration?.avant || !r.llm) return;
    r.exploration.avant.forEach((av, k) => {
      const ap = r.llm.recommendations[k];
      if (!ap || memesPieces(av.pieces, ap.pieces)) return;
      const demande = (r.exploration.cherche || []).find((d) => d.candidate === av.candidate);
      paires.push({ situation: i + 1, st: r.situation, rang: k + 1, avant: av, apres: ap, demande });
    });
  });

  if (!paires.length) {
    console.error("Exploration : aucune tenue changée — pas de page avant/après à écrire.");
  } else {
    const photos2 = new Map();
    /* Une pièce sans photo montre sa description : c'est ce que le modèle a lu,
       et sans cela un remplacement ne se juge pas — un nom seul ne dit pas si
       la ceinture est fine ou large. */
    const vign = (id, change) => {
      const p = parId.get(id);
      if (!p) return `<div class="p">?</div>`;
      if (p.photo) photos2.set(id, p.photo);
      const dsc = !p.photo && p.description ? `<em title="${echapper(p.description)}">${echapper(p.description.slice(0, 70))}…</em>` : "";
      return `<div class="p${change ? " chg" : ""}${p.photo ? "" : " sansphoto"}">${p.photo ? `<img data-p="${id}" alt="">` : ""}<span>${echapper(p.nom)}</span>${dsc}</div>`;
    };
    const bloc = (pr, k) => {
      /* Ce qui n'est pas dans l'autre tenue est la pièce qui change. */
      const A = pr.avant.pieces, B = pr.apres.pieces;
      const cote = (ids, autre, cle) => `<div class="t" data-cle="${cle}">
        <div class="pieces">${ids.map((id) => vign(id, !autre.includes(id))).join("")}</div>
        <button class="vote">Je préfère celle-ci</button></div>`;
      const lot = [cote(A, B, "avant"), cote(B, A, "apres")];
      const ordre = ["avant", "apres"];
      if (Math.random() < 0.5) { lot.reverse(); ordre.reverse(); }
      const st = pr.st;
      const d = pr.demande;
      return `<section>
        <h2>${k + 1}. ${echapper(st.saison)} · ${echapper(st.meteo)} · ${echapper(st.temp)} · ${echapper(st.activite)}
          <span class="rg">tenue n° ${pr.rang} de la situation ${pr.situation}</span></h2>
        <div class="lot">${lot.join("")}</div>
        <div class="reveal" hidden>
          <p><b>${ordre[0] === "avant" ? "Gauche" : "Droite"} = avant l'exploration · ${ordre[0] === "avant" ? "Droite" : "Gauche"} = après.</b></p>
          ${d ? `<p><b>Ce que l'IA cherchait :</b> ${echapper(d.categorie)}${(d.couleurs || []).length ? " " + echapper(d.couleurs.join(", ")) : ""} — ${echapper(d.pourquoi)}</p>` : ""}
          <p class="raison"><b>Avant</b> (${pr.avant.score}/100) — ${echapper(pr.avant.raison)}</p>
          <p class="raison"><b>Après</b> (${pr.apres.score}/100) — ${echapper(pr.apres.raison)}</p>
        </div>
      </section>`;
    };

    const pageE = `<!doctype html><meta charset="utf-8">
<title>L'exploration change-t-elle les tenues en mieux ?</title>
<style>
 body{font:15px/1.5 system-ui,sans-serif;max-width:900px;margin:0 auto;padding:20px;background:#faf8f4;color:#1f2534}
 h1{font-size:22px} h2{font-size:15px;margin:28px 0 10px;color:#5a6274;font-weight:600}
 .rg{font-weight:400;color:#9a9384;font-size:13px;margin-left:8px}
 .lot{display:grid;grid-template-columns:1fr 1fr;gap:14px}
 .t{background:#fff;border:1px solid #e6e1d8;border-radius:10px;padding:10px}
 .t.choisi{border-color:#3e5288;box-shadow:0 0 0 2px #e2e6f2}
 .pieces{display:flex;gap:5px;flex-wrap:wrap;min-height:88px}
 .p{width:62px;font-size:10px;text-align:center;color:#5a6274}
 .p img{width:62px;height:62px;object-fit:cover;border-radius:6px;display:block}
 .p.chg img{outline:2px solid #b8763a;outline-offset:1px}
 .p.chg span{color:#b8763a;font-weight:600}
 .p.sansphoto{width:150px;text-align:left;background:#f4f1ea;border:1px solid #e6e1d8;border-radius:6px;padding:6px}
 .p.sansphoto span{white-space:normal;font-size:11px;font-weight:600;color:#1f2534}
 .p.sansphoto em{display:block;margin-top:3px;font-style:normal;color:#7a7365}
 .p.chg.sansphoto{border-color:#b8763a}
 .p span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 button{margin-top:8px;width:100%;padding:6px;border:1px solid #cfc9bd;border-radius:7px;background:#f4f1ea;cursor:pointer;font:inherit;font-size:13px}
 .reveal{background:#fff;border-left:3px solid #3e5288;padding:10px 14px;margin-top:10px;font-size:13.5px}
 .raison{color:#3d4354}
 .bilan{position:sticky;bottom:0;background:#1f2534;color:#fff;padding:12px;border-radius:10px;margin-top:24px}
</style>
<h1>L'exploration change-t-elle les tenues en mieux ?</h1>
<p>L'IA a le droit, après avoir choisi ses trois tenues, de demander à fouiller le reste de la garde-robe. Voici les tenues qu'elle a effectivement modifiées : <b>celle d'avant et celle d'après</b>, mélangées et sans étiquette. La pièce qui diffère est <b class="chgx" style="color:#b8763a">encadrée</b> des deux côtés.</p>
<p>Choisis celle que tu porterais. L'origine n'apparaît qu'après ton vote — si « après » ne gagne pas nettement, la seconde passe ne vaut pas son prix.</p>
${paires.map(bloc).join("")}
<div class="bilan" id="bilan">Aucun vote pour l'instant.</div>
<script>
 const PHOTOS = __PHOTOS__;
 document.querySelectorAll("img[data-p]").forEach((i) => { i.src = PHOTOS[i.dataset.p] || ""; });
 const votes = [];
 document.querySelectorAll("section").forEach((s) => {
   s.querySelectorAll(".vote").forEach((b) => b.onclick = () => {
     if (s.dataset.vote) return;
     const t = b.closest(".t");
     s.dataset.vote = t.dataset.cle;
     t.classList.add("choisi");
     s.querySelector(".reveal").hidden = false;
     votes.push(t.dataset.cle);
     const av = votes.filter((v) => v === "avant").length;
     document.getElementById("bilan").textContent =
       votes.length + " paire(s) jugée(s) — avant : " + av + "  |  après exploration : " + (votes.length - av);
   });
 });
</script>`;
    writeFileSync(`${base}-exploration.html`, pageE.replace("__PHOTOS__", JSON.stringify(Object.fromEntries(photos2))));
    console.error(`Écrit : ${base}-exploration.html — ${paires.length} paire(s) avant/après.`);
  }
}

console.error(`\nÉcrit : ${base}-comparatif.html`);
console.error("Ouvre-le, vote sur chaque situation, le bilan s'affiche en bas.");
