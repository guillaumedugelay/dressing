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
 * aperçoive. La garde-robe ci-dessous couvre les sept catégories, les cinq
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
  ["Chemise blanche Oxford",      "haut", ["blanc"],          2, [2,4], TOUTES, "droit",  "uni"],
  ["Débardeur noir",              "haut", ["noir"],           1, [1,2], ETE,    "ajuste", "uni"],
  ["Marinière écrue",             "haut", ["blanc","marine"], 2, [1,3], TOUTES, "droit",  "raye"],
  ["Blouse en soie ivoire",       "haut", ["blanc"],          1, [3,4], TOUTES, "ample",  "uni"],
  ["Chemise flanelle à carreaux", "haut", ["rouge","noir"],   3, [1,2], HIVER,  "droit",  "carreaux"],
  ["Top ajusté noir",             "haut", ["noir"],           1, [2,3], TOUTES, "ajuste", "uni"],

  ["Jean brut droit",             "bas",  ["denim"],          2, [1,3], TOUTES, "droit",  "uni", "long"],
  ["Pantalon de costume marine",  "bas",  ["marine"],         2, [3,4], TOUTES, "droit",  "uni", "long"],
  ["Short en coton kaki",         "bas",  ["vert"],           1, [1,2], ETE,    "droit",  "uni", "court"],
  ["Jupe plissée midi",           "bas",  ["beige"],          2, [2,3], TOUTES, "ample",  "uni", "genoux"],
  ["Pantalon large en lin",       "bas",  ["beige"],          1, [2,3], ETE,    "ample",  "uni", "long"],
  ["Jupe crayon noire",           "bas",  ["noir"],           2, [3,4], TOUTES, "ajuste", "uni", "genoux"],

  ["Robe fleurie d'été",          "robe", ["bleu","blanc"],   1, [2,3], ETE,    "ample",  "imprime", "court"],
  ["Robe fourreau noire",         "robe", ["noir"],           2, [3,4], TOUTES, "ajuste", "uni", "genoux"],
  ["Robe longue fluide bordeaux", "robe", ["rouge"],          1, [2,4], TOUTES, "ample",  "uni", "long"],

  ["Pull en laine marine",        "pull", ["marine"],         4, [2,3], HIVER,  "droit",  "uni"],
  ["Gilet fin gris",              "pull", ["gris"],           2, [2,3], TOUTES, "droit",  "uni"],
  ["Sweat à capuche noir",        "pull", ["noir"],           3, 1,     TOUTES, "ample",  "uni"],
  ["Cardigan long beige",         "pull", ["beige"],          3, [2,3], TOUTES, "ample",  "uni"],

  ["Trench beige",                "manteau", ["beige"],       3, [2,4], TOUTES, "droit",  "uni", "long",  true],
  ["Doudoune noire",              "manteau", ["noir"],        5, [1,2], HIVER,  "ample",  "uni", "court", true],
  ["Veste de costume marine",     "manteau", ["marine"],      2, [3,4], TOUTES, "ajuste", "uni", "court"],
  ["Manteau long en laine gris",  "manteau", ["gris"],        4, [2,4], HIVER,  "droit",  "uni", "long"],

  ["Sandales en cuir camel",      "chaussures", ["marron"],   1, [2,3], ETE,    "droit",  "uni"],
  ["Baskets blanches",            "chaussures", ["blanc"],    2, [1,2], TOUTES, "droit",  "uni"],
  ["Derbies en cuir noir",        "chaussures", ["noir"],     2, [3,4], TOUTES, "droit",  "uni"],
  ["Bottines en cuir marron",     "chaussures", ["marron"],   3, [2,3], TOUTES, "droit",  "uni", "", true],
  ["Bottes de pluie",             "chaussures", ["marine"],   3, [1,2], TOUTES, "droit",  "uni", "", true],
  ["Escarpins noirs",             "chaussures", ["noir"],     2, [3,4], TOUTES, "ajuste", "uni"],

  ["Écharpe en laine grise",      "accessoire", ["gris"],     4, [1,3], HIVER,  "droit",  "uni"],
  ["Casquette bleue",             "accessoire", ["bleu"],     1, [1,2], TOUTES, "droit",  "uni"],
  ["Sac structuré en cuir",       "accessoire", ["marron"],   1, [2,4], TOUTES, "droit",  "uni"],
];

function gardeRobeSynthetique() {
  return BRUT.map(([nom, categorie, couleurs, chaleur, f, saisons, coupe, motif, longueur, dehors], i) => ({
    id: "s" + i, nom, categorie, couleurs, chaleur,
    formaliteMin: Array.isArray(f) ? f[0] : f,
    formaliteMax: Array.isArray(f) ? f[1] : f,
    saisons: saisons || [],
    coupe, motif, longueur: longueur || "", matiere: "coton",
    dehors: !!dehors, porteLe: [], description: "",
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
    "\n;__out.proposerTenues = proposerTenues; __out.etat = etat; __out.portable = portable;")(out);
  if (typeof out.proposerTenues !== "function") throw new Error("moteur : proposerTenues introuvable");
  return out;
}

/* ═══════════ Détecteurs ═══════════
   Deux familles. Les **structurels** ne tolèrent rien : une tenue sans
   chaussures ou une pièce hors saison est un bug, pas une affaire de goût.
   Les **qualitatifs** ont un seuil, parce qu'une troisième proposition
   moyenne vaut mieux que deux propositions seulement. */
const NEUTRES = ["noir","blanc","gris","beige","marine","denim","marron"];
const CIBLES = { chaud: 4, doux: 7, frais: 11, froid: 14 };
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
const pieces = fichier ? JSON.parse(readFileSync(fichier, "utf8")).pieces : gardeRobeSynthetique();
M.etat.pieces = pieces; M.etat.tenues = []; M.etat.avis = [];

const SITUATIONS = [];
for (const saison of ["printemps","ete","automne","hiver"])
  for (const meteo of ["soleil","nuages","pluie","neige"])
    for (const temp of ["chaud","doux","frais","froid"])
      for (const activite of ["travail","loisir","vacances"])
        SITUATIONS.push({ saison, meteo, temp, activite });

const compte = new Map(), exemples = new Map(), usage = new Map(), echantillon = [];
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

  for (const t of liste) {
    total++;
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
