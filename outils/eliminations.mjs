/* Les pièces qu'on retirerait d'office avant de tout confier à Opus — à
 * valider par la propriétaire avant d'en faire une règle. Gratuit.
 *
 *   node outils/eliminations.mjs export.json
 *
 * Écrit « …-eliminations.html » : les pièces écartées, regroupées par
 * condition (« les jours chauds », « s'il pleut », « au travail »…), chacune
 * avec une case « À garder ». La page compte aussi, pour chacune des 78
 * situations, combien de pièces resteraient — ce qui fixe le prix d'un appel.
 *
 * POURQUOI PAR CONDITION. Une élimination ne dépend que de la pièce et d'un
 * seul trait de la journée : la température, la météo, l'occasion. La valider
 * situation par situation ferait revoir 78 fois les mêmes doudounes ; par
 * condition, chaque pièce n'est jugée qu'une fois par règle.
 *
 * Les règles ne lisent que ce qui est coché dans l'application : saisons,
 * « résiste à la pluie », registre. On les montre pour vérifier les cases.
 */

import { readFileSync, writeFileSync } from "fs";

const fichier = process.argv.slice(2).find((a) => a.endsWith(".json"));
if (!fichier) { console.error("Usage : node outils/eliminations.mjs <export.json>"); process.exit(1); }
const donnees = JSON.parse(readFileSync(fichier, "utf8"));
const pieces = donnees.pieces;

/* Le moteur de index.html, tel quel : c'est lui qui élimine (piecesEligibles),
   la page ne fait que montrer son travail. */
function chargerMoteur() {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  let sc = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
  const i = sc.indexOf("(() => {"), j = sc.lastIndexOf("})();");
  sc = sc.slice(i + 8, j);
  const stubs = `
    var document = { addEventListener(){}, querySelector: () => null, querySelectorAll: () => [],
      createElement: () => ({ style:{}, classList:{add(){},remove(){}}, appendChild(){}, setAttribute(){}, getContext: () => null }),
      documentElement: { style: { setProperty(){} } }, body: { classList: { add(){}, remove(){} } }, getElementById: () => null };
    var window = { addEventListener(){}, matchMedia: () => ({ matches:false, addEventListener(){} }), location:{href:""}, navigator:{} };
    var navigator = { serviceWorker: { register: () => Promise.resolve() }, geolocation: null };
    var localStorage = { getItem: () => null, setItem(){}, removeItem(){} };
    var indexedDB = { open: () => ({ addEventListener(){}, result:null }) };
    var fetch = () => Promise.reject(new Error("pas de réseau"));
    var setTimeout = () => 0, setInterval = () => 0, requestAnimationFrame = () => 0;`;
  const out = {};
  new Function("__out", stubs + sc + ";__out.etat = etat; __out.piecesEligibles = piecesEligibles; __out.ACTIVITES = ACTIVITES;" +
    "__out.REGISTRES = REGISTRES; __out.TEMPS = TEMPS; __out.poserGardeRobe = poserGardeRobe;")(out);
  return out;
}
const M = chargerMoteur();
/* La garde-robe est convertie en version 5 comme au chargement de l'appli. */
M.poserGardeRobe(pieces);
const nomRegistre = (id) => M.REGISTRES.find((r) => r.id === id)?.nom.toLowerCase() || id;

/* ═══════════ Les règles, pour l'affichage ═══════════
   On se fie à ce qui est coché dans l'application, et à rien d'autre — les
   règles de la propriétaire, 21 octobre 2026. Le regroupement ci-dessous
   reprend celles de piecesEligibles pour les montrer condition par
   condition ; les comptes, eux, viennent du moteur. */
const REGLES = [
  ...["printemps", "ete", "automne", "hiver"].map((saison) => ({
    id: "saison-" + saison, titre: `${saison === "ete" ? "En été" : saison === "printemps" ? "Au printemps" : `En ${saison}`} : pièces sans la case « ${saison === "ete" ? "Été" : saison[0].toUpperCase() + saison.slice(1)} »`,
    condition: (st) => st.saison === saison,
    raison: (p) => (p.saisons || []).length && !p.saisons.includes(saison) ? "saison non cochée" : null })),
  ...M.ACTIVITES.map((j) => ({
    id: "journee-" + j.id, titre: `${j.nom} : pièces sans « ${j.registres.map(nomRegistre).join(" » ni « ")} »`, condition: (st) => st.activite === j.id,
    raison: (p) => (p.registres || []).some((r) => j.registres.includes(r)) ? null : "registre qui ne convient pas" })),
  { id: "pluie", titre: "Pluvieux ou neige : pièces « Non » aux intempéries", condition: (st) => st.meteo === "pluie" || st.meteo === "neige",
    raison: (p) => p.intemperies === "non" ? "ne résiste pas à la pluie" : null },
];

/* ═══════════ Combien il en resterait ═══════════ */
const TEMPERATURES = { printemps: ["froid", "doux"], ete: ["doux", "chaud"], automne: ["froid", "doux"], hiver: ["froid"] };
const situations = [];
for (const saison of Object.keys(TEMPERATURES))
  for (const meteo of ["soleil", "nuages", "bruine", "pluie", ...(saison === "hiver" ? ["neige"] : [])])
    for (const temp of TEMPERATURES[saison])
      for (const activite of M.ACTIVITES.map((j) => j.id)) {
        const st = { saison, meteo, temp, activite };
        Object.assign(M.etat, st);
        situations.push({ ...st, restent: M.piecesEligibles().fiches.length });
      }
const stats = (l) => { const t = [...l].sort((a, b) => a - b); return { min: t[0], med: t[Math.floor(t.length / 2)], max: t.at(-1) }; };
const sR = stats(situations.map((s) => s.restent));
/* Prix d'un appel Opus 5.5 seul : photo (418 jetons) + fiche (232), mesurés le
   21 octobre 2026, à 4 $ le million en entrée, plus ~4 000 jetons de sortie à 20 $. */
const prix = (n) => (n * 650 * 4 + 4000 * 20) / 1e6;

/* ═══════════ La page ═══════════ */
const echapper = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const photos = new Map();
let total = 0;
const sections = REGLES.map((r) => {
  /* Une nouvelle règle ne montre que les pièces qu'elle retire vraiment :
     celles que la saison laisse passer dans au moins une situation où elle
     joue. Les jours chauds n'existent qu'en été, et y montrer un manteau
     d'hiver que la saison écarte déjà ne ferait que noyer le reste. */
  const saisonsOu = [...new Set(situations.filter((s) => r.condition(s)).map((s) => s.saison))];
  const passeLaSaison = (p) => !(p.saisons || []).length || saisonsOu.some((s) => p.saisons.includes(s));
  const visees = pieces.map((p) => ({ p, raison: r.raison(p) }))
    .filter((x) => x.raison);
  total += visees.length;
  const cartes = visees.map(({ p, raison }) => {
    if (p.photo) photos.set(p.id, p.photo);
    return `<label class="c" data-regle="${r.id}" data-id="${p.id}" data-nom="${echapper(p.nom)}">
      ${p.photo ? `<img data-p="${p.id}" alt="">` : `<div class="sans"></div>`}
      <span class="n">${echapper(p.nom)}</span><span class="r">${echapper(raison)}</span>
      <span class="g"><input type="checkbox"> À garder</span></label>`;
  }).join("");
  return `<details class="regle"><summary><b>${echapper(r.titre)}</b> — ${visees.length} pièce(s) retirée(s)
</summary>
    <div class="grille">${cartes || "<p class=\"vide\">Aucune pièce.</p>"}</div></details>`;
}).join("");

const fait = new Date().toISOString();
const page = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pièces à écarter</title>
<style>
 body{font:15px/1.5 system-ui,sans-serif;max-width:1100px;margin:0 auto;padding:16px;background:#faf8f4;color:#1f2534}
 h1{font-size:22px} summary{cursor:pointer;padding:10px 0;font-size:15px}
 .regle{border-top:1px solid #e6e1d8} .badge{font-size:11px;background:#e6e1d8;border-radius:9px;padding:2px 8px;margin-left:6px}
 .badge.neuf{background:#3e5288;color:#fff}
 .grille{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;padding-bottom:16px}
 .c{background:#fff;border:1px solid #e6e1d8;border-radius:10px;padding:6px;display:flex;flex-direction:column;gap:3px;cursor:pointer}
 .c img,.c .sans{width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px;background:#eee}
 .c .n{font-size:12px;font-weight:600} .c .r{font-size:11px;color:#7a7365}
 .c .g{font-size:12px;margin-top:auto} .c.garde{border-color:#2f7a4a;box-shadow:0 0 0 2px #d6eedd}
 .vide{color:#7a7365;font-style:italic}
 table{border-collapse:collapse;font-size:13px;margin:8px 0 18px} td,th{padding:3px 10px;border-bottom:1px solid #e6e1d8;text-align:left}
 .barre{position:sticky;bottom:0;background:#1f2534;color:#fff;padding:10px 12px;border-radius:10px;margin-top:24px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
 .barre button{padding:6px 14px;border-radius:7px;border:0;cursor:pointer;font:inherit}
</style>
<h1>Pièces à écarter avant de choisir les tenues</h1>
<p>Avant de confier la garde-robe à l'IA, on retire les pièces impossibles pour la journée, <b>uniquement d'après ce qui est coché dans l'application</b> : les saisons, « résiste à la pluie » et le registre.
Une pièce retirée à tort se corrige dans sa fiche : coche la saison qui manque, ou « résiste à la pluie ». Tu peux aussi la marquer ici « À garder » et m'envoyer le fichier.</p>
<table>
 <tr><th></th><th>Pièces envoyées à l'IA (sur ${pieces.length})</th><th>Prix d'un appel Opus seul</th></tr>
 <tr><td>Selon la journée</td><td>${sR.min} à ${sR.max} (médiane ${sR.med})</td><td>${prix(sR.min).toFixed(2)} à ${prix(sR.max).toFixed(2)} $</td></tr>
</table>
${sections}
<div class="barre"><span id="compte">Aucune pièce à garder.</span><button id="telecharger">Télécharger mes choix</button></div>
<script>
 const PHOTOS = __PHOTOS__;
 document.querySelectorAll("img[data-p]").forEach((i) => { i.src = PHOTOS[i.dataset.p] || ""; });
 const CLE = "eliminations-${fait}";
 let garder = {};
 try { garder = JSON.parse(localStorage.getItem(CLE)) || {}; } catch {}
 const sauver = () => { try { localStorage.setItem(CLE, JSON.stringify(garder)); } catch {} };
 const compter = () => { const n = Object.keys(garder).length; document.getElementById("compte").textContent = n ? n + " pièce(s) à garder" : "Aucune pièce à garder."; };
 document.querySelectorAll(".c").forEach((c) => {
   const cle = c.dataset.regle + "|" + c.dataset.id, box = c.querySelector("input");
   box.checked = cle in garder; c.classList.toggle("garde", box.checked);
   box.onchange = () => { if (box.checked) garder[cle] = c.dataset.nom; else delete garder[cle]; c.classList.toggle("garde", box.checked); sauver(); compter(); };
 });
 compter();
 document.getElementById("telecharger").onclick = () => {
   const liste = Object.entries(garder).map(([cle, nom]) => { const [regle, id] = cle.split("|"); return { regle, id, nom }; });
   const url = URL.createObjectURL(new Blob([JSON.stringify({ eliminations: "${fait}", aGarder: liste }, null, 1)], { type: "application/json" }));
   const a = document.createElement("a"); a.href = url; a.download = "choix-eliminations.json"; a.click();
   setTimeout(() => URL.revokeObjectURL(url), 4000);
 };
</script>`;

const sortie = fichier.replace(/\.json$/i, "") + "-eliminations.html";
writeFileSync(sortie, page.replace("__PHOTOS__", JSON.stringify(Object.fromEntries(photos))));
for (const r of REGLES) {
  const n = (sections.match(new RegExp(`data-regle="${r.id}"`, "g")) || []).length;
  console.error(`  ${r.titre} : ${n}`);
}
console.error(`Pièces envoyées à l'IA : ${sR.min}–${sR.max} (méd. ${sR.med}).`);
console.error(`Prix d'un appel Opus seul : ${prix(sR.min).toFixed(2)}–${prix(sR.max).toFixed(2)} $ (méd. ${prix(sR.med).toFixed(2)} $).`);
console.error(`Écrit : ${sortie}`);
