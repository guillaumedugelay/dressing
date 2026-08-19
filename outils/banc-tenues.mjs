/* Banc d'essai du moteur de suggestion.
 *
 * Le moteur vit dans index.html et tourne dans le navigateur : le modifier ne
 * coûte rien, contrairement aux consignes envoyées à un modèle. Autant rendre
 * chaque essai reproductible plutôt que de juger à l'œil sur trois tirages.
 *
 *   node outils/banc-tenues.mjs                 garde-robe synthétique
 *   node outils/banc-tenues.mjs export.json     garde-robe réelle
 *   node outils/banc-tenues.mjs --tirages 500
 *   node outils/banc-tenues.mjs --montrer       affiche quelques tenues
 *
 * Sort en code 1 si un détecteur dépasse son seuil : utilisable comme
 * garde-fou avant de publier.
 *
 * POURQUOI UNE GARDE-ROBE SYNTHÉTIQUE. Celle de la maison compte 55 pièces
 * d'été, sans manteau, sans robe, sans accessoire et sans rien de chaud : la
 * moitié des règles du moteur n'y sont jamais déclenchées. Trois d'entre
 * elles ont été écrites, testées et publiées dans le vide avant qu'on ne s'en
 * aperçoive. La garde-robe ci-dessous couvre les sept catégories, les quatre
 * crans de chaleur, les quatre registres et les quatre saisons.
 */

import { readFileSync } from "fs";

const args = process.argv.slice(2);
const option = (n, def) => { const i = args.indexOf(n); return i < 0 ? def : args[i + 1]; };
const drapeau = (n) => args.includes(n);
const fichier = args.find((a) => !a.startsWith("--") && a.endsWith(".json"));
const TIRAGES = Number(option("--tirages", 200));

/* ═══════════ Garde-robe synthétique ═══════════
   [nom, categorie, couleurs, chaleur, formalité (n ou [min,max]), saisons,
    coupe, motif, longueur, dehors] */
const TOUTES = null;
const ETE = ["printemps", "ete"], HIVER = ["automne", "hiver"];
const BRUT = [
  ["Tee-shirt blanc coton",       "haut", ["blanc"],          1, [1,2], TOUTES, "ajuste", "uni"],
  ["Chemise blanche Oxford",      "haut", ["blanc"],          1, [2,4], TOUTES, "droit",  "uni"],
  ["Débardeur noir",              "haut", ["noir"],           1, [1,2], ETE,    "ajuste", "uni"],
  ["Marinière écrue",             "haut", ["blanc","marine"], 1, [1,3], TOUTES, "droit",  "raye"],
  ["Blouse en soie ivoire",       "haut", ["blanc"],          1, [3,4], TOUTES, "ample",  "uni"],
  ["Chemise flanelle à carreaux", "haut", ["rouge","noir"],   2, [1,2], HIVER,  "droit",  "carreaux"],
  ["Top ajusté noir",             "haut", ["noir"],           1, [2,3], TOUTES, "ajuste", "uni"],

  ["Jean brut droit",             "bas",  ["denim"],          1, [1,3], TOUTES, "droit",  "uni", "long"],
  ["Pantalon de costume marine",  "bas",  ["marine"],         1, [3,4], TOUTES, "droit",  "uni", "long"],
  ["Short en coton kaki",         "bas",  ["vert"],           1, [1,2], ETE,    "droit",  "uni", "court"],
  ["Jupe plissée midi",           "bas",  ["beige"],          1, [2,3], TOUTES, "ample",  "uni", "genoux"],
  ["Pantalon large en lin",       "bas",  ["beige"],          1, [2,3], ETE,    "ample",  "uni", "long"],
  ["Jupe crayon noire",           "bas",  ["noir"],           1, [3,4], TOUTES, "ajuste", "uni", "genoux"],

  ["Robe fleurie d'été",          "robe", ["bleu","blanc"],   1, [2,3], ETE,    "ample",  "imprime", "court"],
  ["Robe fourreau noire",         "robe", ["noir"],           1, [3,4], TOUTES, "ajuste", "uni", "genoux"],
  ["Robe longue fluide bordeaux", "robe", ["rouge"],          1, [2,4], TOUTES, "ample",  "uni", "long"],

  ["Pull en laine marine",        "pull", ["marine"],         3, [2,3], HIVER,  "droit",  "uni"],
  ["Gilet fin gris",              "pull", ["gris"],           1, [2,3], TOUTES, "droit",  "uni"],
  ["Sweat à capuche noir",        "pull", ["noir"],           2, 1,     TOUTES, "ample",  "uni"],
  ["Cardigan long beige",         "pull", ["beige"],          2, [2,3], TOUTES, "ample",  "uni"],

  ["Trench beige",                "manteau", ["beige"],       2, [2,4], TOUTES, "droit",  "uni", "long",  true],
  ["Doudoune noire",              "manteau", ["noir"],        4, [1,2], HIVER,  "ample",  "uni", "court", true],
  ["Veste de costume marine",     "manteau", ["marine"],      1, [3,4], TOUTES, "ajuste", "uni", "court"],
  ["Manteau long en laine gris",  "manteau", ["gris"],        3, [2,4], HIVER,  "droit",  "uni", "long"],

  ["Sandales en cuir camel",      "chaussures", ["marron"],   1, [2,3], ETE,    "droit",  "uni"],
  ["Baskets blanches",            "chaussures", ["blanc"],    1, [1,2], TOUTES, "droit",  "uni"],
  ["Derbies en cuir noir",        "chaussures", ["noir"],     1, [3,4], TOUTES, "droit",  "uni"],
  ["Bottines en cuir marron",     "chaussures", ["marron"],   2, [2,3], TOUTES, "droit",  "uni", "", true],
  ["Bottes de pluie",             "chaussures", ["marine"],   2, [1,2], TOUTES, "droit",  "uni", "", true],
  ["Escarpins noirs",             "chaussures", ["noir"],     1, [3,4], TOUTES, "ajuste", "uni"],

  ["Écharpe en laine grise",      "accessoire", ["gris"],     3, [1,3], HIVER,  "droit",  "uni"],
  ["Casquette bleue",             "accessoire", ["bleu"],     1, [1,2], TOUTES, "droit",  "uni"],
  ["Sac structuré en cuir",       "accessoire", ["marron"],   1, [2,4], TOUTES, "droit",  "uni"],
];

/* Les règles de tendance portent sur la matière autant que sur la couleur :
   une garde-robe toute en coton ne peut rien en départager. Le corpus du
   17 août 2026 comptait trois règles `matiere` sur treize. */
const MATIERES = {
  "Blouse en soie ivoire": "soie", "Marinière écrue": "maille",
  "Chemise flanelle à carreaux": "laine", "Jean brut droit": "denim",
  "Pantalon de costume marine": "laine", "Pantalon large en lin": "lin",
  "Jupe crayon noire": "laine", "Robe fourreau noire": "synthetique",
  "Robe longue fluide bordeaux": "soie", "Pull en laine marine": "laine",
  "Gilet fin gris": "maille", "Cardigan long beige": "maille",
  "Doudoune noire": "synthetique", "Manteau long en laine gris": "laine",
  "Sandales en cuir camel": "cuir", "Derbies en cuir noir": "cuir",
  "Bottines en cuir marron": "cuir", "Escarpins noirs": "cuir",
  "Sac structuré en cuir": "cuir", "Écharpe en laine grise": "laine",
};

function gardeRobeSynthetique() {
  return BRUT.map(([nom, categorie, couleurs, chaleur, f, saisons, coupe, motif, longueur, dehors], i) => ({
    id: "s" + i, nom, categorie, couleurs, chaleur,
    formaliteMin: Array.isArray(f) ? f[0] : f,
    formaliteMax: Array.isArray(f) ? f[1] : f,
    saisons: saisons || [],
    coupe, motif, longueur: longueur || "", matiere: MATIERES[nom] || "coton",
    dehors: !!dehors, porteLe: [], description: "", chaleurV: 4,
  }));
}

/* ═══════════ Chargement du moteur ═══════════
   index.html est une page unique dont le script est une IIFE. On l'exécute
   dans un contexte sans DOM, en n'exposant que ce qui sert au banc. Si cette
   extraction casse, c'est que la page a changé de forme : mieux vaut échouer
   bruyamment que de mesurer un moteur fantôme. */
function chargerMoteur() {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  let sc = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
  const i = sc.indexOf("(() => {"), j = sc.lastIndexOf("})();");
  if (i < 0 || j < 0) throw new Error("index.html : script introuvable ou de forme inattendue");
  sc = sc.slice(i + 8, j);
  const stubs = `
    var document = { addEventListener(){}, querySelector: () => null, querySelectorAll: () => [],
      createElement: () => ({ style:{}, classList:{add(){},remove(){}}, appendChild(){}, setAttribute(){}, getContext: () => null }),
      documentElement: { style: { setProperty(){} } }, body: { classList: { add(){}, remove(){} } }, getElementById: () => null };
    var window = { addEventListener(){}, matchMedia: () => ({ matches:false, addEventListener(){} }), location:{href:""}, navigator:{} };
    var navigator = { serviceWorker: { register: () => Promise.resolve() }, geolocation: null };
    var localStorage = { getItem: () => null, setItem(){}, removeItem(){} };
    var indexedDB = { open: () => ({ addEventListener(){}, result:null }) };
    var fetch = () => Promise.reject(new Error("banc : pas de reseau"));
    var setTimeout = () => 0, setInterval = () => 0, requestAnimationFrame = () => 0;
  `;
  const out = {};
  new Function("__out", stubs + sc +
    "\n;__out.proposerTenues = proposerTenues; __out.etat = etat; __out.portable = portable;" +
    "\n;__out.poserTendances = (c) => { TENDANCES = c; }; __out.noteTendances = noteTendances;" +
    "\n;__out.argumenter = argumenter; __out.conseilsUtiles = conseilsUtiles; __out.pieceQuiManque = pieceQuiManque;")(out);
  if (typeof out.proposerTenues !== "function") throw new Error("moteur : proposerTenues introuvable");
  return out;
}

/* ═══════════ Détecteurs ═══════════
   Deux familles. Les **structurels** ne tolèrent rien : une tenue sans
   chaussures ou une pièce hors saison est un bug, pas une affaire de goût.
   Les **qualitatifs** ont un seuil, parce qu'une troisième proposition
   moyenne vaut mieux que deux propositions seulement. */
const NEUTRES = ["noir","blanc","gris","beige","marine","denim","marron"];
const CIBLES = { chaud: 3, doux: 5, frais: 7, froid: 9 };   // échelle à 4 crans
const PLANCHERS = { travail: 3, loisir: 1, vacances: 1 };
const sommeChaleur = (t) => t.pieces.reduce((n, p) => p.categorie === "accessoire" ? n
  : n + p.chaleur * (p.categorie === "robe" ? 2 : 1), 0);

const DETECTEURS = [
  { nom: "tenue sans chaussures", dur: true,
    test: (t) => !t.pieces.some((p) => p.categorie === "chaussures") },
  { nom: "deux pièces de la même catégorie", dur: true,
    test: (t) => ["haut","bas","robe","pull","manteau","chaussures","accessoire"]
      .some((c) => t.pieces.filter((p) => p.categorie === c).length > 1) },
  { nom: "ni haut ni robe", dur: true,
    test: (t) => !t.pieces.some((p) => p.categorie === "haut" || p.categorie === "robe") },
  { nom: "un haut et une robe ensemble", dur: true,
    test: (t) => t.pieces.some((p) => p.categorie === "robe") && t.pieces.some((p) => p.categorie === "haut") },
  { nom: "une robe avec un bas", dur: true,
    test: (t) => t.pieces.some((p) => p.categorie === "robe") && t.pieces.some((p) => p.categorie === "bas") },
  { nom: "pièce hors saison", dur: true,
    test: (t, s) => t.pieces.some((p) => (p.saisons||[]).length && !p.saisons.includes(s.saison)) },
  { nom: "pièce sous le plancher de l'occasion", dur: true,
    test: (t, s) => t.pieces.some((p) => p.formaliteMax < PLANCHERS[s.activite]) },
  { nom: "fuite du filtre de chaleur", dur: true,
    test: (t, s) => { const e = sommeChaleur(t) - CIBLES[s.temp]; return e > 1 || e < -2; } },
  { nom: "chaussures non étanches sous la pluie, alors qu'il en existe", dur: true,
    test: (t, s, ctx) => (s.meteo === "pluie" || s.meteo === "neige") && ctx.chaussuresDehors
      && t.pieces.some((p) => p.categorie === "chaussures" && !p.dehors) },

  { nom: "deux motifs qui se concurrencent", seuil: 0.05,
    test: (t) => t.pieces.filter((p) => p.motif && p.motif !== "uni").length >= 2 },
  { nom: "trois couleurs vives ou plus", seuil: 0.02,
    test: (t) => new Set(t.pieces.flatMap((p) => p.couleurs||[]).filter((c) => !NEUTRES.includes(c))).size >= 3 },
  { nom: "couche superflue par temps chaud", seuil: 0.35,
    test: (t, s) => s.temp === "chaud" && t.pieces.some((p) => p.categorie === "pull" || p.categorie === "manteau") },
  { nom: "note négative proposée", seuil: 0.02, test: (t) => t.note < 0 },
];

/* ═══════════ Exécution ═══════════ */
const M = chargerMoteur();

/* Le banc coupe le réseau, si bien que le moteur retombait sur le corpus de
   secours — zéro règle — et que noteTendances sortait immédiatement. Les
   premiers balayages ont donc tous tourné **terme de tendance mort**, calage
   des poids de silhouette compris. On injecte le corpus depuis le disque. */
const corpus = JSON.parse(readFileSync(new URL("../tendances.json", import.meta.url), "utf8"));
M.poserTendances(corpus);
const POIDS = Number(option("--tendance", 1));
const pieces = fichier ? JSON.parse(readFileSync(fichier, "utf8")).pieces : gardeRobeSynthetique();
M.etat.pieces = pieces; M.etat.tenues = []; M.etat.avis = []; M.etat.poidsTendance = POIDS;

const SITUATIONS = [];
for (const saison of ["printemps","ete","automne","hiver"])
  for (const meteo of ["soleil","nuages","pluie","neige"])
    for (const temp of ["chaud","doux","frais","froid"])
      for (const activite of ["travail","loisir","vacances"])
        SITUATIONS.push({ saison, meteo, temp, activite });

const compte = new Map(), exemples = new Map(), usage = new Map(), echantillon = [];
const tendances = [], trios = [], declenchees = new Set();
let total = 0, vides = 0, tirages = 0;
const noter = (cle, quoi) => {
  compte.set(cle, (compte.get(cle) || 0) + 1);
  if (quoi && !exemples.has(cle)) exemples.set(cle, quoi);
};

/* Avancement sur la sortie d'erreur : le rapport reste propre si on le
   redirige, et un balayage de plusieurs milliers de tirages ne laisse pas
   devant un terminal muet. */
let jalon = 0;
for (let n = 0; n < TIRAGES; n++) {
  const avance = Math.floor(100 * n / TIRAGES);
  if (avance >= jalon) {
    process.stderr.write(`  essais… ${String(jalon).padStart(3)} %  (${n}/${TIRAGES} tirages, ${total} tenues)   `);
    jalon += 10;
  }
  const s = SITUATIONS[n % SITUATIONS.length];
  Object.assign(M.etat, s, { ecartees: new Set() });
  tirages++;
  let r;
  try { r = M.proposerTenues(3); } catch (e) { noter("EXCEPTION : " + e.message); continue; }
  if (r.erreur) { vides++; continue; }
  const liste = r.tenues || r;
  const ctx = { chaussuresDehors: pieces.some((p) => p.categorie === "chaussures" && p.dehors && M.portable(p)) };

  for (let i = 1; i < liste.length; i++)
    if (liste[i].note > liste[i-1].note + 1e-6)
      noter("classement d'affichage non décroissant",
        `${liste[i-1].note.toFixed(2)} puis ${liste[i].note.toFixed(2)}`);

  /* Rien ne peut dépasser la tenue la mieux notée : lui conseiller quoi que ce
     soit reviendrait à nommer un gain hors de portée. */
  if (liste[0]) {
    const a = M.argumenter(liste[0].pieces, liste[0]);
    if (a.some((x) => x.titre === "Ce qui l'aurait améliorée" && !/Rien ne cloche/.test(x.texte)))
      noter("conseil donné à la tenue la mieux notée", liste[0].pieces.map((p) => p.nom).join(" + "));
  }

  /* Le bloc « la pièce qui la sublimerait » prépare un achat : conseiller une
     pièce déjà possédée enverrait acheter un doublon. */
  for (const t of liste) {
    const a = M.argumenter(t.pieces, t).find((x) => x.titre === "La pièce qui la sublimerait");
    if (!a) continue;
    const m = M.conseilsUtiles(t.pieces, t).retenus.find((x) => M.pieceQuiManque(x, pieces));
    if (!m) noter("pièce suggérée sans manque correspondant", a.texte);
  }

  /* Le terme de tendance, relevé pour le trio entier : la question n'est pas
     seulement « le corpus est-il chargé » mais « départage-t-il les trois
     propositions ». Un terme identique sur les trois est aussi inutile qu'un
     terme absent. */
  trios.push(liste.map((t) => {
    const r = M.noteTendances(t.pieces);
    for (const x of (r.touchees || [])) declenchees.add(x.note);
    return r.bonus;
  }));

  for (const t of liste) {
    total++;
    tendances.push(M.noteTendances(t.pieces).bonus);
    for (const p of t.pieces) usage.set(p.nom, (usage.get(p.nom) || 0) + 1);
    if (echantillon.length < 8 && Math.random() < 0.06) echantillon.push({ s, t });
    for (const d of DETECTEURS) if (d.test(t, s, ctx))
      noter(d.nom, `${s.saison}/${s.meteo}/${s.temp}/${s.activite} — ` + t.pieces.map((p) => p.nom).join(" + "));
  }
}

process.stderr.write(`  essais… 100 %  (${tirages}/${TIRAGES} tirages, ${total} tenues)   

`);

const pc = (n) => (100 * n / (total || 1)).toFixed(1) + " %";
console.log(`Garde-robe : ${fichier || "synthétique"} — ${pieces.length} pièces`);
console.log(`${tirages} tirages, ${vides} sans résultat (${(100*vides/tirages).toFixed(0)} %), ${total} tenues examinées\n`);

let echecs = 0;
console.log("═══ DÉTECTEURS ═══");
for (const d of DETECTEURS) {
  const n = compte.get(d.nom) || 0;
  const depasse = d.dur ? n > 0 : (n / (total || 1)) > d.seuil;
  if (depasse) echecs++;
  console.log(`${n === 0 ? "  ok   " : depasse ? " ÉCHEC " : " toléré"} ${String(n).padStart(4)} ${pc(n).padStart(7)}  ${d.nom}` +
    (d.dur ? "  [structurel]" : `  [seuil ${(100*d.seuil).toFixed(0)} %]`));
  if (n && exemples.has(d.nom)) console.log(`            ↳ ${exemples.get(d.nom)}`);
}
for (const [k, v] of compte) if (!DETECTEURS.some((d) => d.nom === k)) {
  echecs++;
  console.log(` ÉCHEC  ${String(v).padStart(4)}           ${k}`);
  if (exemples.has(k)) console.log(`            ↳ ${exemples.get(k)}`);
}

console.log("\n═══ TENDANCE ═══");
console.log(`  corpus ${corpus.revision} — ${corpus.regles.length} règles, curseur à ${POIDS}`);
const nonNuls = tendances.filter((x) => Math.abs(x) > 1e-9);
console.log(`  tenues touchées par au moins une règle : ${nonNuls.length}/${tendances.length}` +
  ` (${(100 * nonNuls.length / (tendances.length || 1)).toFixed(0)} %)`);
if (nonNuls.length) {
  const tri = [...nonNuls].sort((a, b) => a - b);
  console.log(`  bonus : min ${tri[0].toFixed(2)} | médiane ${tri[Math.floor(tri.length/2)].toFixed(2)}` +
    ` | max ${tri[tri.length-1].toFixed(2)}`);
}
const ecarts = trios.filter((t) => t.length > 1).map((t) => Math.max(...t) - Math.min(...t));
const plats = ecarts.filter((e) => e < 1e-9).length;
console.log(`  trios où les trois propositions ont la même note de tendance :` +
  ` ${plats}/${ecarts.length} (${(100 * plats / (ecarts.length || 1)).toFixed(0)} %)`);
if (ecarts.length) console.log(`  écart de tendance dans un trio : moyen ${(ecarts.reduce((a,b)=>a+b,0)/ecarts.length).toFixed(2)},` +
  ` max ${Math.max(...ecarts).toFixed(2)}`);
/* Les regles `descriptive` ne sont pas applicables par le moteur : elles
   attendent d etre rapprochees des descriptions des pieces. Les compter
   comme muettes serait un faux positif. */
const muettes = corpus.regles.filter((r) => r.type !== "descriptive" && !declenchees.has(r.note));
console.log(`  règles jamais déclenchées : ${muettes.length}/${corpus.regles.length}`);
for (const r of muettes) console.log(`    · [${r.type}] ${r.note}`);

console.log("\n═══ CONCENTRATION ═══");
console.log(`  ${usage.size} pièces distinctes proposées sur ${pieces.length}`);
for (const [nom, n] of [...usage.entries()].sort((a,b) => b[1]-a[1]).slice(0, 5))
  console.log(`    ${pc(n).padStart(7)}  ${nom}`);
const jamais = pieces.filter((p) => !usage.has(p.nom));
if (jamais.length) console.log(`  jamais proposées : ${jamais.map((p) => p.nom).join(", ")}`);

if (drapeau("--montrer")) {
  console.log("\n═══ ÉCHANTILLON ═══");
  for (const { s, t } of echantillon)
    console.log(`  ${s.saison}/${s.meteo}/${s.temp}/${s.activite}  note ${t.note.toFixed(2)}\n     ${t.pieces.map((p) => p.nom).join("  +  ")}`);
}

console.log(echecs ? `\n${echecs} détecteur(s) en échec.` : "\nAucun détecteur en échec.");
process.exit(echecs ? 1 : 0);
