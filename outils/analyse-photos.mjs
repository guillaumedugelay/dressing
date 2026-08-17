/* Analyse par lots des photos de la garde-robe.
 *
 * Se lance sur ton PC, jamais dans le téléphone : la clé d'API reste ici et
 * n'est jamais exposée. Les photos ne font que transiter le temps d'un appel ;
 * elles ne sont stockées nulle part ailleurs que dans le téléphone.
 *
 *   node outils/analyse-photos.mjs dressing-2026-08-14.json
 *
 * Écrit un fichier « …-analyse.json » à réimporter dans l'application, en
 * choisissant « Fusionner » pour ne pas perdre le journal des tenues portées.
 *
 * Options :
 *   --limite 5    n'analyser que les 5 premières pièces (pour essayer)
 *   --simuler     afficher ce qui serait rempli, sans rien écrire
 *   --forcer      réanalyser les pièces déjà analysées, sauf celles que tu as
 *                 corrigées à la main depuis
 *   --tout        réanalyser vraiment tout, y compris tes corrections
 *
 * Requiert ANTHROPIC_API_KEY dans l'environnement.
 */

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync } from "fs";

const CATEGORIES = ["haut", "bas", "robe", "pull", "manteau", "chaussures", "accessoire"];
const COULEURS = ["noir", "blanc", "gris", "beige", "marine", "denim", "marron",
                  "rouge", "orange", "jaune", "vert", "bleu", "violet", "rose"];
const COUPES = ["ajuste", "droit", "ample"];
const SAISONS = ["printemps", "ete", "automne", "hiver"];
const MOTIFS = ["uni", "raye", "carreaux", "imprime"];
const LONGUEURS = ["court", "genoux", "long"];
const MATIERES = ["coton", "lin", "laine", "denim", "maille", "cuir", "soie", "synthetique"];

/* Sonnet 5 à effort élevé. L'effort moyen, essayé d'abord, s'est révélé
   instable : sur huit pièces il a produit deux réponses aberrantes — une
   question sans rapport sur un chauffe-eau, une phrase en chinois — et ignoré
   trois fois la consigne demandant de ne pas douter d'une nuance de fibre.
   À effort élevé, plus d'aberration et des doutes qui apprennent quelque
   chose, pour 14 % de plus. Se change avec MODELE= et EFFORT=. */
const MODELE = process.env.MODELE || "claude-sonnet-5";
const EFFORT = process.env.EFFORT || "high";
const PARALLELE = 4;

/* Tarifs par million de jetons, pour le décompte final. Claude Sonnet 5 est
   en tarif de lancement jusqu'au 31 août 2026 ; passée cette date, le calcul
   bascule tout seul sur le tarif normal. */
const TARIFS = {
  "claude-opus-5":    { entree: 5, sortie: 25 },
  "claude-sonnet-5":  { entree: 3, sortie: 15, lancement: { entree: 2, sortie: 10, jusquA: "2026-08-31" } },
  "claude-haiku-4-5": { entree: 1, sortie: 5 },
};

function tarifDu(modele) {
  const t = TARIFS[modele];
  if (!t) return null;                       // modèle inconnu : pas d'estimation inventée
  const l = t.lancement;
  const actif = l && new Date().toISOString().slice(0, 10) <= l.jusquA;
  return { entree: (actif ? l.entree : t.entree) / 1e6,
           sortie: (actif ? l.sortie : t.sortie) / 1e6,
           lancement: actif };
}

const SCHEMA = {
  type: "object",
  properties: {
    nom: { type: "string", description: "Nom court en français, tel qu'on le dirait à l'oral : « chemise en lin blanc », « bottines en cuir marron »." },
    categorie: { type: "string", enum: CATEGORIES },
    couleurs: {
      type: "array",
      items: { type: "string", enum: COULEURS },
      description: "Une couleur, ou deux si la pièce en porte vraiment deux de façon marquée. Jamais plus de deux.",
    },
    chaleur: { type: "integer", description: "1 très léger, 2 fin, 3 moyen, 4 chaud, 5 très chaud. Juge la matière et l'épaisseur, pas la couleur." },
    formaliteMin: { type: "integer", description: "Registre le plus décontracté où la pièce se porte. 1 sport, 2 décontracté, 3 soigné, 4 habillé." },
    formaliteMax: { type: "integer", description: "Registre le plus habillé où la pièce se porte. Égal à formaliteMin si la pièce ne se porte que d'une façon." },
    coupe: { type: "string", enum: COUPES },
    saisons: {
      type: "array",
      items: { type: "string", enum: SAISONS },
      description: "Liste vide = toute l'année, et c'est la réponse attendue dans la grande majorité des cas. Ne coche des saisons que si la pièce elle-même l'impose physiquement.",
    },
    dehors: { type: "boolean", description: "Vrai seulement si la pièce résiste réellement à la pluie ou à la neige (imperméable, ciré, bottines étanches, doudoune déperlante)." },
    motif: { type: "string", enum: MOTIFS, description: "La grande majorité des vêtements sont unis." },
    longueur: { type: "string", description: "court, genoux ou long. Chaîne vide pour un haut, un pull, des chaussures ou un accessoire, où la notion n'a pas de sens." },
    matiere: { type: "string", enum: MATIERES, description: "La matière dominante. Choisis la plus proche si elle n'est pas dans la liste." },
    description: { type: "string", description: "Deux phrases décrivant la pièce telle qu'on la verrait en main : matière et tissage, longueur, coupe précise, motif, détails de construction — col, poches, boutons, taille, doublure, fermeture. Consigne le concret et l'observable, pas le jugement : « coton épais non extensible » plutôt que « jolie matière ». C'est la mémoire de ce que la fiche ne sait pas encore stocker." },
    confiance: { type: "string", enum: ["haute", "moyenne", "basse"], description: "Ton degré de certitude sur l'ensemble, pour signaler les pièces à revérifier." },
    doute: { type: "string", description: "Si la confiance n'est pas haute : une phrase courte disant ce dont tu doutes et pourquoi, assez précise pour que le propriétaire sache quoi regarder — « la matière pourrait être du lin ou du coton mélangé », « la jupe est posée à plat, la coupe est difficile à juger ». Chaîne vide si la confiance est haute." },
  },
  required: ["nom", "description", "categorie", "couleurs", "chaleur", "formaliteMin", "formaliteMax", "coupe", "motif", "longueur", "matiere", "saisons", "dehors", "confiance", "doute"],
  additionalProperties: false,
};

const CONSIGNE = `Tu regardes la photo d'un vêtement, prise chez son propriétaire, pour remplir sa fiche dans une application de garde-robe.

Décris la pièce **telle qu'elle est**, pas telle qu'elle devrait être. Si la photo est mauvaise, mal éclairée, ou si la pièce est pliée au point d'être ambiguë, choisis l'option la plus probable et baisse ta confiance.

La **matière** se juge à la famille dominante et visible : coton, lin, laine, denim, maille, cuir, soie, synthétique. Distinguer un coton pur d'un mélange coton-synthétique est impossible sur une photo et **sans conséquence** pour s'habiller : choisis la famille la plus probable et n'en fais pas un doute. Une confiance abaissée doit signaler quelque chose que le propriétaire peut corriger et qui change l'usage de la pièce — une catégorie douteuse, un registre mal cerné, une longueur invisible — pas une nuance de fibre que personne ne tranchera jamais.

Quand tu n'es pas sûr, **dis où exactement**. Le propriétaire a plusieurs centaines de vêtements à relire : « confiance moyenne » l'oblige à tout réexaminer, tandis qu'une phrase précise lui dit quoi regarder. Nomme le champ qui te pose problème et la raison.

Trois pièges à éviter :
- **Le registre est un intervalle, pas un chiffre.** Beaucoup de vêtements se portent de plusieurs façons selon le reste de la tenue : une jupe unie est décontractée avec des baskets et soignée avec des escarpins, une chemise blanche va du décontracté à l'habillé, un jean brut du sport au soigné. Donne alors deux bornes différentes. Ne les égalise que pour une pièce réellement univoque — un sweat à capuche, un smoking, des tongs. Dans le doute, élargis : une pièce décrite trop étroitement sera écartée à tort de la moitié des tenues.
- **La chaleur se juge à la matière et à l'épaisseur**, pas à la couleur. Un pull noir fin n'est pas chaud parce qu'il est noir.
- **Les saisons se restreignent très rarement.** La liste vide est la réponse par défaut, pas un aveu d'ignorance. Applique ce test : la pièce est-elle *impossible* à porter dans les autres saisons, une fois la tenue complétée ? Une jupe se porte en hiver avec des collants, une robe sans manches sous un gilet, une chemise fine sous un pull : toutes ces pièces sont **toute l'année**. Ne coche des saisons que si la pièce elle-même l'impose — doudoune, sandales, short de bain, manteau d'hiver. Ne te laisse pas guider par le motif ou la couleur : un imprimé fleuri n'est pas une pièce d'été.

La **description** mérite un mot. Les champs de la fiche ne retiennent qu'une fraction de ce que tu vois : ni la matière, ni la longueur, ni le motif, ni un détail de construction n'y ont de place aujourd'hui. La description est ce qui en garde trace, pour qu'un champ ajouté plus tard puisse en être déduit sans repasser par les photos. Écris donc ce que tu observes, pas ce que la fiche sait déjà.

Le nom doit être utile dans une liste de plusieurs centaines de vêtements : ce qui distingue cette pièce des autres du même type. « Chemise blanche Oxford » plutôt que « chemise ».`;


/* ═══════════ Contrôle de la réponse ═══════════
   Une réponse structurée reste du texte engendré : elle peut dérailler. Un
   essai du 17 août 2026 a produit, dans le champ « doute » de deux jupes, une
   question sans rapport sur un chauffe-eau et une phrase en chinois. Sans ce
   contrôle, ces textes seraient entrés dans la garde-robe — et comme leur
   confiance était « haute », rien ne les aurait signalés.
   Une pièce dont la réponse est suspecte est comptée en échec : mieux vaut la
   réanalyser que salir la fiche. */

const ECRITURES_ETRANGERES = /[　-鿿Ѐ-ӿ؀-ۿ가-힯]/;

function reponseSaine(lu) {
  const griefs = [];
  const texte = `${lu.doute || ""} ${lu.description || ""} ${lu.nom || ""}`;
  if (ECRITURES_ETRANGERES.test(texte)) griefs.push("écriture non latine");
  if ((lu.doute || "").length > 300) griefs.push("doute anormalement long");
  if ((lu.description || "").length > 600) griefs.push("description anormalement longue");
  if ((lu.nom || "").length > 90) griefs.push("nom anormalement long");
  /* Un doute sur une pièce jugée sûre n'a pas lieu d'être : c'est le signe
     que le champ a été rempli par autre chose que du jugement. */
  if (lu.confiance === "haute" && (lu.doute || "").trim()) griefs.push("doute alors que la confiance est haute");
  return griefs;
}

/* ═══════════ Arguments ═══════════ */

const args = process.argv.slice(2);
const fichier = args.find((a) => !a.startsWith("--"));
const option = (nom) => args.includes(nom);
const valeur = (nom) => { const i = args.indexOf(nom); return i >= 0 ? args[i + 1] : null; };

if (!fichier) {
  console.error("Usage : node outils/analyse-photos.mjs <export.json> [--limite N] [--simuler] [--forcer]");
  process.exit(1);
}

/* Sans cette vérification, l'absence de clé se manifesterait par une erreur
   anglaise répétée une fois par pièce. */
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY n'est pas dans l'environnement.\n");
  console.error("  Crée une clé sur https://console.anthropic.com puis, dans ce terminal :");
  console.error('    export ANTHROPIC_API_KEY="sk-ant-..."      (bash)');
  console.error('    $env:ANTHROPIC_API_KEY = "sk-ant-..."      (PowerShell)\n');
  console.error("La clé reste sur cet ordinateur : ne la mets ni dans le dépôt ni dans l'application.");
  process.exit(1);
}

const limite = valeur("--limite") ? parseInt(valeur("--limite"), 10) : Infinity;
const simuler = option("--simuler");
const tout = option("--tout");
const forcer = option("--forcer") || tout;

const donnees = JSON.parse(readFileSync(fichier, "utf8"));
if (!Array.isArray(donnees.pieces)) {
  console.error("Ce fichier n'est pas un export Dressing (pas de tableau « pieces »).");
  process.exit(1);
}

/* ═══════════ Sélection des pièces ═══════════ */

const sansPhoto = donnees.pieces.filter((p) => !p.photo).length;

/* Une fiche que tu as ouverte et enregistrée après son analyse porte une date
   de correction. Une réanalyse la saute : ton arbitrage vaut mieux qu'une
   nouvelle hypothèse, et le contraire ferait perdre des heures de relecture.
   --tout passe outre, en connaissance de cause. */
const protegees = donnees.pieces.filter((p) => p.photo && p.corrigeeLe && !tout);
const aTraiter = donnees.pieces
  .filter((p) => p.photo && (forcer || !p.analyseeLe) && !(p.corrigeeLe && !tout))
  .slice(0, limite);

console.error(`${donnees.pieces.length} pièces dans l'export.`);
if (sansPhoto) console.error(`  ${sansPhoto} sans photo — ignorées.`);
const dejaFaites = donnees.pieces.filter((p) => p.photo && p.analyseeLe).length;
if (dejaFaites && !forcer) console.error(`  ${dejaFaites} déjà analysées — ignorées (--forcer pour refaire).`);
if (protegees.length) console.error(`  ${protegees.length} corrigées à la main — préservées (--tout pour les écraser).`);
console.error(`  ${aTraiter.length} à analyser avec ${MODELE}, effort ${EFFORT}.\n`);

if (!aTraiter.length) { console.error("Rien à faire."); process.exit(0); }

/* ═══════════ Analyse ═══════════ */

const client = new Anthropic();
const usage = { entree: 0, sortie: 0 };
const rapport = [];

function imageDepuisDataUrl(dataUrl) {
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/s.exec(dataUrl);
  if (!m) throw new Error("photo illisible");
  return { type: "base64", media_type: m[1], data: m[2] };
}

async function analyser(piece) {
  const reponse = await client.messages.create({
    model: MODELE,
    max_tokens: 4000,
    system: CONSIGNE,
    output_config: { effort: EFFORT, format: { type: "json_schema", schema: SCHEMA } },
    messages: [{
      role: "user",
      content: [
        { type: "image", source: imageDepuisDataUrl(piece.photo) },
        { type: "text", text: piece.nom
          ? `Le propriétaire a nommé cette pièce « ${piece.nom} ». Garde ce nom s'il est juste, corrige-le s'il est manifestement faux.`
          : "Cette pièce n'a pas encore de nom." },
      ],
    }],
  });

  usage.entree += reponse.usage.input_tokens;
  usage.sortie += reponse.usage.output_tokens;

  if (reponse.stop_reason === "refusal") throw new Error("analyse déclinée");
  const texte = reponse.content.find((b) => b.type === "text")?.text;
  if (!texte) throw new Error("réponse vide");
  const lu = JSON.parse(texte);
  normaliserDoute(lu);
  const griefs = reponseSaine(lu);
  if (griefs.length) throw new Error(`réponse suspecte (${griefs.join(", ")}) — à réanalyser`);
  return lu;
}

/* Le nom tapé par le propriétaire est le seul champ qu'on ne remplace pas :
   c'est le seul qu'il a forcément saisi volontairement. */
/* Sur 49 pièces réelles, 19 des 25 doutes portaient sur la fibre exacte —
   coton pur ou mélange, viscose ou polyester. La consigne demandait déjà de ne
   pas en faire un doute ; le modèle ne l'a pas suivie. Plutôt que d'insister,
   on le normalise ici : un doute qui ne parle que de matière est écarté, et la
   pièce n'est plus signalée. L'information reste dans la description, et
   personne ne relit 500 fiches pour une nuance que la photo ne dira jamais. */
const DOUTE_MATIERE = /mati[èe]re|coton|viscose|polyester|synth[ée]tique|lin|laine|fibre|tissu|maille/i;
const DOUTE_AUTRE = /couleur|teinte|coupe|longueur|cat[ée]gorie|registre|saison|surcouche|superpos|pli[ée]|froiss|flou|cadr|sombre|à plat/i;

function normaliserDoute(lu) {
  if (lu.confiance === "haute" || !lu.doute) return;
  if (DOUTE_MATIERE.test(lu.doute) && !DOUTE_AUTRE.test(lu.doute)) {
    lu.confiance = "haute";
    lu.doute = "";
  }
}

function appliquer(piece, lu) {
  const avant = { ...piece };
  if (!piece.nom) piece.nom = lu.nom;
  piece.description = lu.description;
  piece.categorie = lu.categorie;
  piece.couleurs = lu.couleurs.slice(0, 2);
  piece.chaleur = Math.min(5, Math.max(1, lu.chaleur));
  const borne = (v) => Math.min(4, Math.max(1, v));
  piece.formaliteMin = Math.min(borne(lu.formaliteMin), borne(lu.formaliteMax));
  piece.formaliteMax = Math.max(borne(lu.formaliteMin), borne(lu.formaliteMax));
  delete piece.formalite;
  piece.coupe = lu.coupe;
  piece.motif = MOTIFS.includes(lu.motif) ? lu.motif : "";
  piece.longueur = LONGUEURS.includes(lu.longueur) ? lu.longueur : "";
  piece.matiere = MATIERES.includes(lu.matiere) ? lu.matiere : "";
  piece.saisons = lu.saisons;
  piece.dehors = lu.dehors;
  piece.analyseeLe = new Date().toISOString().slice(0, 10);
  piece.confiance = lu.confiance;
  if (lu.doute) piece.doute = lu.doute; else delete piece.doute;

  const change = [];
  for (const champ of ["nom", "categorie", "chaleur", "formaliteMin", "formaliteMax", "coupe", "motif", "longueur", "matiere", "dehors"])
    if (JSON.stringify(avant[champ]) !== JSON.stringify(piece[champ])) change.push(champ);
  for (const champ of ["couleurs", "saisons"])
    if (JSON.stringify(avant[champ] || []) !== JSON.stringify(piece[champ])) change.push(champ);
  return change;
}

const REGISTRES = ["", "sport", "décontracté", "soigné", "habillé"];
const registreLisible = (lu) => lu.formaliteMin === lu.formaliteMax
  ? REGISTRES[lu.formaliteMin]
  : `${REGISTRES[lu.formaliteMin]} à ${REGISTRES[lu.formaliteMax]}`;

let faits = 0, echecs = 0;
const file = [...aTraiter];

async function ouvrier() {
  while (file.length) {
    const piece = file.shift();
    const etiquette = piece.nom || piece.id;
    try {
      const lu = await analyser(piece);
      const change = simuler ? [] : appliquer(piece, lu);
      faits++;
      const marque = lu.confiance === "basse" ? " ⚠ à revérifier" : lu.confiance === "moyenne" ? " ·" : "";
      console.error(`  [${faits + echecs}/${aTraiter.length}] ${lu.nom} — ${lu.categorie}, ${lu.couleurs.join("+")}, `
        + `chaleur ${lu.chaleur}, ${registreLisible(lu)}, ${lu.coupe}`
        + `${lu.motif && lu.motif !== "uni" ? ", " + lu.motif : ""}`
        + `${lu.longueur ? ", " + lu.longueur : ""}${lu.matiere ? ", " + lu.matiere : ""}`
        + `${lu.saisons.length ? `, ${lu.saisons.join("/")}` : ", toute l'année"}${lu.dehors ? ", imperméable" : ""}${marque}`);
      if (lu.doute) console.error(`        ↳ ${lu.doute}`);
      rapport.push({ id: piece.id, nom: lu.nom, confiance: lu.confiance, doute: lu.doute, change });
    } catch (e) {
      echecs++;
      console.error(`  [${faits + echecs}/${aTraiter.length}] ${etiquette} — ÉCHEC : ${e.message}`);
    }
  }
}

const debut = Date.now();
await Promise.all(Array.from({ length: Math.min(PARALLELE, aTraiter.length) }, ouvrier));

/* ═══════════ Bilan ═══════════ */

const tarif = tarifDu(MODELE);
console.error(`\n${faits} analysées, ${echecs} en échec, en ${Math.round((Date.now() - debut) / 1000)} s.`);
console.error(`Jetons : ${usage.entree} en entrée, ${usage.sortie} en sortie.`);
if (tarif) {
  const cout = usage.entree * tarif.entree + usage.sortie * tarif.sortie;
  console.error(`Coût : environ ${cout.toFixed(2)} $${tarif.lancement ? " (tarif de lancement)" : ""}.`);
  if (faits) console.error(`Soit ${(cout / faits).toFixed(4)} $ par pièce ; pour 500 pièces, environ ${(cout / faits * 500).toFixed(2)} $.`);
} else {
  console.error(`Tarif inconnu pour ${MODELE} — pas d'estimation de coût.`);
}

const douteuses = rapport.filter((r) => r.confiance !== "haute");
if (douteuses.length) {
  console.error(`\n${douteuses.length} pièce(s) à revérifier dans l'application :`);
  for (const d of douteuses)
    console.error(`  ${d.confiance === "basse" ? "⚠" : "·"} ${d.nom}${d.doute ? ` — ${d.doute}` : ""}`);
}

/* Pas de process.exit() ici : couper le processus pendant que les connexions
   du SDK se referment déclenche une assertion de libuv sous Windows
   (« UV_HANDLE_CLOSING »), après coup et sans conséquence, mais alarmante et
   assortie d'un code d'erreur. On laisse la boucle d'événements se vider. */
if (simuler) {
  console.error("\n(--simuler : aucun fichier écrit)");
} else {
  const sortie = fichier.replace(/\.json$/i, "") + "-analyse.json";
  writeFileSync(sortie, JSON.stringify(donnees, null, 1));
  console.error(`\nÉcrit : ${sortie}`);
  console.error("À réimporter dans l'application, en choisissant « Fusionner ».");
}
if (echecs) process.exitCode = 1;
