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

/* Sonnet 5.5 à effort élevé. Sur Sonnet 5, l'effort moyen, essayé d'abord,
   s'est révélé instable : sur huit pièces il a produit deux réponses
   aberrantes — une question sans rapport sur un chauffe-eau, une phrase en
   chinois — et ignoré trois fois la consigne demandant de ne pas douter d'une
   nuance de fibre. À effort élevé, plus d'aberration et des doutes qui
   apprennent quelque chose, pour 14 % de plus.
   Sonnet 5.5 coûte le même prix, mais ses niveaux d'effort ont été
   recalibrés : « high » n'y veut pas dire exactement la même chose. Le
   passage a été vérifié sur dix pièces déjà analysées (21 octobre 2026).
   Se change avec MODELE= et EFFORT=. */
const MODELE = process.env.MODELE || "claude-sonnet-5-5";
const EFFORT = process.env.EFFORT || "high";
const PARALLELE = 4;

/* Tarifs par million de jetons, pour le décompte final. Le tarif de
   lancement de Sonnet 5 est devenu son tarif normal. Un modèle absent de la
   table n'a pas d'estimation : l'ajouter ici en même temps que le modèle. */
const TARIFS = {
  "claude-opus-5-5":   { entree: 4, sortie: 20 },
  "claude-opus-5":     { entree: 5, sortie: 25 },
  "claude-sonnet-5-5": { entree: 2, sortie: 10 },
  "claude-sonnet-5":   { entree: 2, sortie: 10 },
  "claude-haiku-5-5":  { entree: 0.1, sortie: 0.5 },
  "claude-haiku-4-5":  { entree: 1, sortie: 5 },
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

/* La palette s'agrandit au fil des analyses : une couleur créée pour une
   pièce est proposée aux suivantes, pour qu'il n'y ait pas un « doré » par
   ceinture. Le schéma est donc bâti à l'exécution, sur la palette de
   l'export. */
const schemaPour = (palette) => ({
  type: "object",
  properties: {
    nom: { type: "string", description: "Nom court en français, tel qu'on le dirait à l'oral : « chemise en lin blanc », « bottines en cuir marron »." },
    categorie: { type: "string", enum: CATEGORIES },
    couleurs: {
      type: "array",
      items: { type: "string", enum: palette },
      description: "Une couleur, ou deux si la pièce en porte vraiment deux de façon marquée. Jamais plus de deux. Si tu crées une couleur dans « nouvelleCouleur », ne la mets pas ici : elle sera ajoutée d'office.",
    },
    nouvelleCouleur: {
      type: "object",
      description: "Une couleur absente de la liste, quand la plus proche tromperait sur les associations — doré, argenté, bordeaux. Identifiant vide si la liste suffit, ce qui est le cas presque toujours. Une nuance (écru, kaki, camel) n'en est pas une : elle a sa couleur dans la liste.",
      properties: {
        id: { type: "string", description: "Minuscules sans accent ni espace : « dore », « argente », « bordeaux ». Vide si aucune." },
        nom: { type: "string", description: "Le nom affiché, avec majuscule et accents : « Doré »." },
        hex: { type: "string", description: "Sa teinte en #RRVVBB." },
        neutre: { type: "boolean", description: "Vrai si elle se porte avec tout, comme le noir ou le beige — les métaux le sont." },
        famille: { type: "string", enum: ["chaud", "froid", "achrome"] },
      },
      required: ["id", "nom", "hex", "neutre", "famille"],
      additionalProperties: false,
    },
    chaleur: { type: "integer", description: "1 léger, 2 moyen, 3 chaud, 4 très chaud. Juge la matière et l'épaisseur, pas la couleur. Un tee-shirt, une chemise fine, une robe d'été sont légers ; un sweat, un jean épais, un cardigan sont moyens ; un pull de laine, un manteau sont chauds ; une doudoune est très chaude." },
    formaliteMin: { type: "integer", description: "Registre le plus décontracté où la pièce se porte. 1 sport, 2 décontracté, 3 soigné, 4 habillé." },
    formaliteMax: { type: "integer", description: "Registre le plus habillé où la pièce se porte. Égal à formaliteMin si la pièce ne se porte que d'une façon." },
    coupe: { type: "string", enum: COUPES },
    saisons: {
      type: "array",
      items: { type: "string", enum: SAISONS },
      description: "Liste vide = toute l'année : la réponse attendue pour les bas, les robes et les hauts qui se portent sous un pull. Un haut qui ne se porte pas sous un pull (bretelles fines, crop top, body, ajouré, dénudé, orné) : printemps et été.",
    },
    dehors: { type: "boolean", description: "Vrai seulement si la pièce résiste réellement à la pluie ou à la neige (imperméable, ciré, bottines étanches, doudoune déperlante)." },
    motif: { type: "string", enum: MOTIFS, description: "La grande majorité des vêtements sont unis." },
    longueur: { type: "string", description: "court, genoux ou long. Chaîne vide pour un haut, un pull, des chaussures ou un accessoire, où la notion n'a pas de sens." },
    matiere: { type: "string", enum: MATIERES, description: "La matière dominante. Choisis la plus proche si elle n'est pas dans la liste." },
    description: { type: "string", description: "Deux phrases décrivant la pièce telle qu'on la verrait en main : matière et tissage, longueur, coupe précise, motif, détails de construction — col, poches, boutons, taille, doublure, fermeture. Consigne le concret et l'observable, pas le jugement : « coton épais non extensible » plutôt que « jolie matière ». C'est la mémoire de ce que la fiche ne sait pas encore stocker." },
    confiance: { type: "string", enum: ["haute", "moyenne", "basse"], description: "Ton degré de certitude sur l'ensemble, pour signaler les pièces à revérifier." },
    doute: { type: "string", description: "Si la confiance n'est pas haute : une phrase courte disant ce dont tu doutes et pourquoi, assez précise pour que le propriétaire sache quoi regarder — « la matière pourrait être du lin ou du coton mélangé », « la jupe est posée à plat, la coupe est difficile à juger ». Chaîne vide si la confiance est haute." },
  },
  required: ["nom", "description", "categorie", "couleurs", "nouvelleCouleur", "chaleur", "formaliteMin", "formaliteMax", "coupe", "motif", "longueur", "matiere", "saisons", "dehors", "confiance", "doute"],
  additionalProperties: false,
});

const CONSIGNE = `Tu regardes la photo d'un vêtement, prise chez son propriétaire, pour remplir sa fiche dans une application de garde-robe.

Décris la pièce **telle qu'elle est**, pas telle qu'elle devrait être. Une pièce posée à plat, sur cintre ou pliée est le cas ordinaire, pas une raison de douter : choisis l'option la plus probable pour la longueur, la coupe ou la matière, et garde ta confiance haute.

**Un doute n'a sa place que s'il change la façon d'assembler la pièce** et que ni la photo, ni le nom, ni ce que la propriétaire a déjà rempli ne permet de trancher : la catégorie (se porte-t-elle par-dessus un autre haut ?), le registre, la chaleur à deux crans près, la couleur dominante, la tenue à la pluie. La longueur exacte, la coupe, la fibre, une doublure, une fermeture, la taille d'un foulard ne changent aucune tenue : écris ce que tu vois dans la description, sans en faire un doute. « Le registre dépend du reste de la tenue » n'est pas un doute non plus — c'est ce que dit déjà l'intervalle. Une combinaison, une salopette ou un combishort se classe en **robe**, pièce d'un seul tenant, sans en faire un doute.

La **matière** se juge à la famille dominante et visible : coton, lin, laine, denim, maille, cuir, soie, synthétique. Distinguer un coton pur d'un mélange coton-synthétique est impossible sur une photo et **sans conséquence** pour s'habiller : choisis la famille la plus probable et n'en fais pas un doute. Une confiance abaissée doit signaler quelque chose que le propriétaire peut corriger et qui change l'usage de la pièce — une catégorie douteuse, un registre mal cerné, une longueur invisible — pas une nuance de fibre que personne ne tranchera jamais.

Quand tu n'es pas sûr, **dis où exactement**. Le propriétaire a plusieurs centaines de vêtements à relire : « confiance moyenne » l'oblige à tout réexaminer, tandis qu'une phrase précise lui dit quoi regarder. Nomme le champ qui te pose problème et la raison.

**Le motif est une affaire de couleur, pas de relief.** Un motif se voit parce que des couleurs dessinent quelque chose : rayures, carreaux, fleurs, léopard, une inscription imprimée. Une dentelle, un crochet ajouré, une maille côtelée, un tissage gaufré, une broderie ton sur ton n'en sont pas — ce sont des textures, et la pièce reste **unie**. Note la texture dans la description, jamais dans le motif : la confondre fait croire à l'application que deux pièces à motif se concurrencent, et lui fait écarter des associations parfaitement justes.

**Un pull se porte PAR-DESSUS un autre haut.** C'est ce qui le distingue, pas sa matière : la catégorie dit la place dans la tenue, pas le tissu. Un tee-shirt en maille fine à manches courtes est un **haut**, même tricoté ; un gilet, un cardigan, un sweat, un pull à manches longues qui se porte sur un top sont des **pull**. Dans le doute, demande-toi si on met quelque chose dessous : si non, c'est un haut. Se tromper ici ne se voit pas sur la fiche mais produit des tenues absurdes — l'application superpose la pièce à un autre haut, et propose un tee-shirt sur un tee-shirt.

Trois pièges à éviter :
- **Le registre est un intervalle, pas un chiffre.** Beaucoup de vêtements se portent de plusieurs façons selon le reste de la tenue : une jupe unie est décontractée avec des baskets et soignée avec des escarpins, une chemise blanche va du décontracté à l'habillé, un jean brut du sport au soigné. Donne alors deux bornes différentes. Ne les égalise que pour une pièce réellement univoque — un sweat à capuche, un smoking, des tongs. Dans le doute, élargis : une pièce décrite trop étroitement sera écartée à tort de la moitié des tenues.
- **La chaleur se juge à la matière et à l'épaisseur**, pas à la couleur. Un pull noir fin n'est pas chaud parce qu'il est noir.
- **Les saisons dépendent de ce qu'on met par-dessus.** La liste vide, « toute l'année », reste la réponse par défaut pour les bas, les robes et les hauts qui servent de base : une jupe se porte en hiver avec des collants, une robe sans manches sous un gilet, un tee-shirt uni à manches courtes, un débardeur basique en jersey ou une chemise fine sous un pull. Mais un haut qui **ne se porte pas sous un pull** est un haut des beaux jours : fines bretelles, crop top, body, dos ou épaules dénudés, maille ajourée ou tissu transparent, volants, broderie ou ornement qu'un pull cacherait. Coche alors **printemps et été**. Un haut en maille à manches courtes, assez couvrant pour se porter seul à la mi-saison, va du **printemps à l'automne**. Pour le reste, ne coche des saisons que si la pièce elle-même l'impose — doudoune, sandales, short de bain, manteau d'hiver. Ne te laisse pas guider par le motif ou la couleur : un imprimé fleuri n'est pas, à lui seul, une pièce d'été.

La **description** mérite un mot. La fiche retient désormais la matière, la longueur et le motif, mais elle les réduit chacun à un mot d'une liste fermée : le tissage, la coupe précise, les détails de construction — col, poches, boutons, taille, doublure, fermeture — n'y ont toujours pas de place. La description est ce qui en garde trace, pour qu'un champ ajouté plus tard puisse en être déduit sans repasser par les photos. Écris donc ce que tu observes au-delà des cases, pas la paraphrase de ce que la fiche sait déjà.

La **couleur** se choisit dans la liste. Si aucune ne convient sans tromper sur la façon de l'associer — une ceinture dorée n'est pas beige, un sweat bordeaux n'est pas rouge vif —, crée-la dans « nouvelleCouleur » au lieu de te rabattre sur la plus proche, et n'en fais pas un doute. Ne crée rien pour une simple nuance : un écru reste blanc ou beige, un kaki reste vert. Un détail ne compte pas : une boucle dorée sur une ceinture noire laisse la ceinture noire.

Le nom doit être utile dans une liste de plusieurs centaines de vêtements : ce qui distingue cette pièce des autres du même type. « Chemise blanche Oxford » plutôt que « chemise ».`;


/* ═══════════ Contrôle de la réponse ═══════════
   Une réponse structurée reste du texte engendré : elle peut dérailler. Un
   essai du 17 août 2026 a produit, dans le champ « doute » de deux jupes, une
   question sans rapport sur un chauffe-eau et une phrase en chinois. Sans ce
   contrôle, ces textes seraient entrés dans la garde-robe — et comme leur
   confiance était « haute », rien ne les aurait signalés.
   Une pièce dont la réponse est suspecte est comptée en échec : mieux vaut la
   réanalyser que salir la fiche.

   Tous les griefs ne se valent pas, et les traiter pareil coûtait cher. Une
   écriture non latine ou un texte qui déraille salissent vraiment la fiche :
   on jette. Mais un doute exprimé sous une confiance « haute » n'est qu'une
   incohérence entre deux champs, et l'analyse qui va avec est bonne. Le
   passage du 19 août a perdu trois analyses correctes sur ce seul motif, et
   deux pièces ont échoué deux fois de suite — le modèle refaisant la même
   incohérence, les relancer n'y changeait rien. On répare donc plutôt que de
   jeter : la confiance retombe à « moyenne », ce qui range la pièce parmi
   celles à revérifier, exactement là où elle a sa place. */

const ECRITURES_ETRANGERES = /[　-鿿Ѐ-ӿ؀-ۿ가-힯]/;

function reponseSaine(lu) {
  const griefs = [];
  const texte = `${lu.doute || ""} ${lu.description || ""} ${lu.nom || ""}`;
  if (ECRITURES_ETRANGERES.test(texte)) griefs.push("écriture non latine");
  if ((lu.doute || "").length > 300) griefs.push("doute anormalement long");
  if ((lu.description || "").length > 600) griefs.push("description anormalement longue");
  if ((lu.nom || "").length > 90) griefs.push("nom anormalement long");

  /* Un doute doit dire quelque chose. Le 17 août, une pièce est repartie avec
     « , » pour tout doute ; le 19, une autre avec « L extest placeholder ».
     Ni l'un ni l'autre n'est une phrase, et tous deux envoient le propriétaire
     relire une fiche sans lui dire quoi regarder. On exige donc quelques mots
     et une longueur plausible. */
  const doute = (lu.doute || "").trim();
  if (doute && (doute.length < 15 || doute.split(/\s+/).length < 4))
    griefs.push("doute vide de sens");

  /* Le champ « doute » attire les artefacts : trois passages, trois formes
     différentes. Une virgule seule le 17 août, « L extest placeholder » le 19,
     et le 20 un commentaire méta en anglais — « I need to check the schema ».
     Les trois avaient en commun de ne rien dire du vêtement, et les deux
     derniers passaient les contrôles de longueur et d'écriture.

     Un doute est une phrase française sur la pièce ; ces marqueurs-là n'y
     figurent jamais. */
  if (/\b(i need|let me|the schema|check the|should i|placeholder|todo|i should|the field)\b/i.test(doute))
    griefs.push("doute méta ou en anglais");

  return griefs;
}

/* Réparable, par opposition aux griefs ci-dessus : l'analyse est bonne, seule
   la cohérence entre deux champs cloche. */
/* Quatrième forme d'artefact, apparue avec Sonnet 5.5 le 21 octobre 2026 :
   14 doutes sur 272 finissaient par « } », « </br> » ou « ]}<br> », débris de
   JSON ou de HTML collés à une phrase par ailleurs juste. On coupe la traîne
   plutôt que de jeter l'analyse. */
const TRAINE = /\s*(?:[{}\[\]]|<\/?br\s*\/?>)+\s*$/i;

function reparer(lu) {
  for (const champ of ["doute", "description", "nom"])
    if (TRAINE.test(lu[champ] || "")) lu[champ] = lu[champ].replace(TRAINE, "");
  if (lu.confiance === "haute" && (lu.doute || "").trim()) {
    lu.confiance = "moyenne";
    return "confiance ramenée à moyenne — un doute était exprimé";
  }
  return null;
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
donnees.couleurs ||= [];
const SCHEMA = schemaPour([...COULEURS, ...donnees.couleurs.map((c) => c.id)]);

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
const usage = { entree: 0, sortie: 0, cacheEcrit: 0, cacheLu: 0 };
const rapport = [];

function imageDepuisDataUrl(dataUrl) {
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/s.exec(dataUrl);
  if (!m) throw new Error("photo illisible");
  return { type: "base64", media_type: m[1], data: m[2] };
}

const dejaSaisi = (piece) => [
  piece.categorie && `catégorie « ${piece.categorie} »`,
  (piece.saisons || []).length && `saisons ${piece.saisons.join(", ")}`,
  piece.dehors === true && "elle résiste à la pluie",
].filter(Boolean).join(" ; ");

async function analyser(piece) {
  /* La consigne est mise en cache. Comptage exact du 20 août 2026 : sur les
     4 419 jetons d'entrée d'une pièce, la photo n'en pèse que 417 — tout le
     reste est la consigne (1 733) et le schéma de sortie (2 262), renvoyés à
     l'identique à chaque appel. On paie donc surtout de la répétition.

     Ici le cache tient, contrairement au moteur de tenues : les centaines
     d'appels s'enchaînent en quelques minutes et chaque lecture repousse
     l'expiration, là où un appel quotidien le laisserait mourir entre deux
     fois. Le premier appel écrit le cache à 1,25× ; les suivants le lisent à
     0,1×. */
  const reponse = await client.messages.create({
    model: MODELE,
    max_tokens: 4000,
    system: [{ type: "text", text: CONSIGNE, cache_control: { type: "ephemeral" } }],
    output_config: { effort: EFFORT, format: { type: "json_schema", schema: SCHEMA } },
    messages: [{
      role: "user",
      content: [
        { type: "image", source: imageDepuisDataUrl(piece.photo) },
        /* Le nom fait foi. Le 21 octobre 2026, 26 doutes sur 272 contestaient
           ce que le nom affirmait : « couleur grenat » relu en aubergine,
           « écru » en gris, « en soie », « ouvert dans le dos » mis en doute.
           Elle a la pièce en main, à la lumière du jour ; la photo, elle,
           ment sur les couleurs sombres et cache le dos. */
        { type: "text", text: piece.nom
          ? `La propriétaire a nommé cette pièce « ${piece.nom} ». Ce que ce nom affirme fait foi — couleur, matière, détail comme un dos ouvert : elle a la pièce en main, la photo peut tromper. Sers-t'en pour remplir la fiche, ne le mets pas en doute, et ne doute que de ce qu'il ne dit pas. Ne corrige le nom que s'il est manifestement faux sur la nature de la pièce.`
          : "Cette pièce n'a pas encore de nom." },
        /* Ce qu'elle a rempli et que appliquer() conserve : le lui dire évite
           qu'il le devine, puis en doute. */
        ...(dejaSaisi(piece) ? [{ type: "text", text: `Elle a déjà indiqué, et cela fait foi : ${dejaSaisi(piece)}. Ne le mets pas en doute.` }] : []),
      ],
    }],
  });

  usage.entree += reponse.usage.input_tokens;
  usage.sortie += reponse.usage.output_tokens;
  /* Le seul moyen de savoir si le cache mord vraiment. S il reste a zero,
     c est qu un invalidateur silencieux est a l oeuvre. */
  usage.cacheEcrit += reponse.usage.cache_creation_input_tokens || 0;
  usage.cacheLu += reponse.usage.cache_read_input_tokens || 0;

  if (reponse.stop_reason === "refusal") throw new Error("analyse déclinée");
  const texte = reponse.content.find((b) => b.type === "text")?.text;
  if (!texte) throw new Error("réponse vide");
  const lu = JSON.parse(texte);
  normaliserDoute(lu);
  const griefs = reponseSaine(lu);
  if (griefs.length) throw new Error(`réponse suspecte (${griefs.join(", ")}) — à réanalyser`);
  const repare = reparer(lu);
  if (repare) lu.repare = repare;
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

/* Même logique, élargie le 21 octobre 2026 : sur 176 pièces signalées,
   146 doutes ne portaient que sur la longueur exacte, la coupe, la fibre ou
   une doublure — ce qu'une photo à plat ne montre pas et qui ne change
   aucune tenue. Un doute n'est gardé que s'il touche à ce qui décide d'un
   assemblage. */
const DOUTE_ENJEU = /cat[ée]gorie|registre|formalit|soign[ée]|habill|chaleur|chaud|[ée]paisseur|rembourr|doubl[ée]|couleur|teinte|imperm|pluie|dehors|d[ée]perlant|saison|par-dessus|sous un|se porte seul/i;

function normaliserDoute(lu) {
  if (lu.confiance === "haute" || !lu.doute) return;
  if ((DOUTE_MATIERE.test(lu.doute) && !DOUTE_AUTRE.test(lu.doute)) || !DOUTE_ENJEU.test(lu.doute)) {
    lu.confiance = "haute";
    lu.doute = "";
  }
}

/* Ce que la propriétaire a saisi et qu'une photo ne montre pas, on le garde.
   Le 21 octobre 2026, l'analyse de 292 pièces saisies avec soin a décoché
   « résiste à la pluie » sur 23 d'entre elles — tous les manteaux de pluie,
   les doudounes et les bottes —, réécrit 198 saisons sur 248 et changé
   44 catégories. Elle sait ce qui tient la pluie, quand elle porte une pièce
   et si elle la met par-dessus un autre haut ; le modèle le devine.
   Le reste — chaleur, registre, coupe — garde la réponse du modèle : la
   saisie y pose des valeurs par défaut qu'on ne distingue pas d'un choix. */
const DOUTE_PLUIE = /imperm[ée]ab|[ée]tanche|pluie|d[ée]perlant|\bdehors\b/i;

function appliquer(piece, lu) {
  const avant = { ...piece };
  if (!piece.nom) piece.nom = lu.nom;
  piece.description = lu.description;
  if (!piece.categorie) piece.categorie = lu.categorie;
  piece.couleurs = lu.couleurs.slice(0, 2);
  /* Une couleur créée entre dans la palette de l'export, une seule fois :
     les quatre ouvriers tournent en parallèle, et deux ceintures dorées
     peuvent la proposer coup sur coup. Elle prend la première place, celle
     de la couleur dominante — on ne la crée que parce qu'elle domine. */
  const nc = lu.nouvelleCouleur;
  const id = (nc?.id || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
  if (id && !COULEURS.includes(id)) {
    if (!donnees.couleurs.some((c) => c.id === id)) {
      donnees.couleurs.push({ id, nom: nc.nom || id, hex: /^#[0-9a-f]{6}$/i.test(nc.hex) ? nc.hex : "#999999",
                              neutre: Boolean(nc.neutre), famille: nc.famille });
      console.error(`        ✚ couleur ajoutée à la palette : ${nc.nom}`);
    }
    piece.couleurs = [id, ...piece.couleurs.filter((c) => c !== id)].slice(0, 2);
  }
  piece.chaleur = Math.min(5, Math.max(1, lu.chaleur));
  const borne = (v) => Math.min(4, Math.max(1, v));
  piece.formaliteMin = Math.min(borne(lu.formaliteMin), borne(lu.formaliteMax));
  piece.formaliteMax = Math.max(borne(lu.formaliteMin), borne(lu.formaliteMax));
  delete piece.formalite;
  piece.coupe = lu.coupe;
  piece.motif = MOTIFS.includes(lu.motif) ? lu.motif : "";
  piece.longueur = LONGUEURS.includes(lu.longueur) ? lu.longueur : "";
  piece.matiere = MATIERES.includes(lu.matiere) ? lu.matiere : "";
  if (!(piece.saisons || []).length) piece.saisons = lu.saisons;
  piece.dehors = piece.dehors === true || lu.dehors;
  piece.analyseeLe = new Date().toISOString().slice(0, 10);
  piece.confiance = lu.confiance;
  if (lu.doute) piece.doute = lu.doute; else delete piece.doute;
  /* Un doute qui porte sur un champ qu'elle a elle-même rempli ne lui
     apprend rien : « vérifie si c'est imperméable » sur une botte qu'elle a
     cochée l'oblige à refaire ce qu'elle a déjà fait. */
  const saisi = (avant.dehors === true && DOUTE_PLUIE.test(piece.doute || ""))
    || ((avant.saisons || []).length && /saison/i.test(piece.doute || ""))
    || (avant.categorie && /cat[ée]gorie/i.test(piece.doute || ""));
  if (piece.doute && saisi) {
    delete piece.doute;
    piece.confiance = "haute";
  }

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
if (usage.cacheLu || usage.cacheEcrit) {
  const part = Math.round(100 * usage.cacheLu / (usage.entree || 1));
  console.error(`Cache : ${usage.cacheEcrit} jetons écrits, ${usage.cacheLu} relus — ${part} % de l entrée servie depuis le cache.`);
} else {
  console.error("Cache : aucune lecture. Un invalidateur silencieux est à l oeuvre, ou le lot est trop court pour en profiter.");
}
if (tarif) {
  /* L entrée rapportée par l API compte déjà les jetons non cachés seuls ;
     l écriture se facture 1,25× et la relecture 0,1×. */
  const cout = usage.entree * tarif.entree + usage.sortie * tarif.sortie
             + usage.cacheEcrit * tarif.entree * 1.25 + usage.cacheLu * tarif.entree * 0.1;
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
