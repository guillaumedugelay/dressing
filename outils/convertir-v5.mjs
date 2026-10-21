/* Conversion des fiches vers la version 5 (refonte du 21 octobre 2026), et
 * page de validation des nouvelles catégories. Gratuit.
 *
 *   node outils/convertir-v5.mjs export.json
 *   node outils/convertir-v5.mjs export.json --corrections choix-categories.json
 *
 * Écrit « …-v5.json » (à réimporter plus tard, une fois l'application passée
 * en version 5) et « …-v5-validation.html ».
 *
 * Ce qui est converti d'office, parce que la correspondance est sûre :
 *   registre    l'intervalle sport–habillé devient trois cases ; « sport »
 *               rejoint « décontracté »
 *   intempéries résiste à la pluie → « Résiste » ; sinon « Non » pour ce qui
 *               se mouille (chaussures, vestes, manteaux, sacs), « Non
 *               concernée » pour le reste
 *   couleurs    vers la nuance de la palette, affinée par le nom quand il la
 *               précise (« écru », « camel », « kaki », « bordeaux »…)
 *   coupe       ajusté → près du corps ; « cintré », « oversize » lus dans le
 *               nom ou la description
 * Ce qui est proposé, et validé par elle : la catégorie, devinée sur le nom.
 *
 * Rien n'est perdu : les anciennes valeurs restent dans `v4`.
 */

import { readFileSync, writeFileSync } from "fs";


const args = process.argv.slice(2);
const option = (n) => { const i = args.indexOf(n); return i < 0 ? null : args[i + 1]; };
const fichier = args.find((a) => !a.startsWith("--") && a.endsWith(".json") && a !== option("--corrections"));
if (!fichier) { console.error("Usage : node outils/convertir-v5.mjs <export.json> [--corrections choix.json]"); process.exit(1); }
const donnees = JSON.parse(readFileSync(fichier, "utf8"));
const corrections = option("--corrections")
  ? new Map(JSON.parse(readFileSync(option("--corrections"), "utf8")).corrections.map((c) => [c.id, c.categorie]))
  : new Map();

/* ═══════════ Conversion ═══════════
   La même fonction que l'application (migrerV5 dans index.html) : il n'y a
   qu'une conversion, et cet outil ne fait que la montrer et la faire valider. */
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
  new Function("__out", stubs + sc + ";__out.CATEGORIES = CATEGORIES; __out.COULEURS = COULEURS;" +
    "__out.migrer = (p) => { migrerFormalite(p); migrerChaleur(p); return migrerV5(p); };")(out);
  return out;
}
const M = chargerMoteur();
const { CATEGORIES, COULEURS } = M;
const rapport = [];
const pieces = donnees.pieces.map((p) => {
  if (p.ficheV === 5) return p;
  const v5 = structuredClone(p);
  M.migrer(v5);
  const sure = !v5.categorieADeviner;
  if (corrections.has(p.id)) { v5.categorie = corrections.get(p.id); delete v5.categorieADeviner; }
  rapport.push({ p, v5, sure: sure || corrections.has(p.id), corrigee: corrections.has(p.id) });
  return v5;
});
const sortie = fichier.replace(/\.json$/i, "") + "-v5.json";
writeFileSync(sortie, JSON.stringify({ ...donnees, version: 5, couleurs: undefined, pieces }, null, 1));

/* ═══════════ Page de validation ═══════════ */
const echapper = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const nomCat = (id) => CATEGORIES.find((c) => c.id === id)?.nom || id;
const hex = (id) => COULEURS.find((c) => c.id === id)?.hex || "#999";
const photos = new Map();
const options = CATEGORIES.map((c) => `<option value="${c.id}">${c.nom}</option>`).join("");
const groupes = CATEGORIES.map((c) => {
  const ici = rapport.filter((r) => r.v5.categorie === c.id)
    .sort((a, b) => Number(a.sure) - Number(b.sure));
  if (!ici.length) return "";
  const cartes = ici.map(({ p, v5, sure }) => {
    if (p.photo) photos.set(p.id, p.photo);
    return `<div class="c${sure ? "" : " doute"}" data-id="${p.id}" data-propose="${v5.categorie}">
      ${p.photo ? `<img data-p="${p.id}" alt="">` : `<div class="sans"></div>`}
      <span class="n">${echapper(p.nom)}</span>
      <span class="a">avant : ${echapper(p.categorie)}${sure ? "" : " — <b>à vérifier</b>"}</span>
      <span class="pal">${v5.couleurs.map((x) => `<i style="background:${hex(x)}" title="${x}"></i>`).join("")}</span>
      <select>${options}</select></div>`;
  }).join("");
  const douteux = ici.filter((r) => !r.sure).length;
  return `<details open><summary><b>${c.pict} ${echapper(c.nom)}</b> — ${ici.length} pièce(s)${douteux ? `, dont ${douteux} à vérifier` : ""}</summary>
    <div class="grille">${cartes}</div></details>`;
}).join("");

const fait = new Date().toISOString();
const nbDoute = rapport.filter((r) => !r.sure).length;
const page = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nouvelles catégories</title>
<style>
 body{font:15px/1.5 system-ui,sans-serif;max-width:1100px;margin:0 auto;padding:16px;background:#faf8f4;color:#1f2534}
 h1{font-size:22px} summary{cursor:pointer;padding:10px 0;font-size:15px} details{border-top:1px solid #e6e1d8}
 .grille{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;padding-bottom:16px}
 .c{background:#fff;border:1px solid #e6e1d8;border-radius:10px;padding:6px;display:flex;flex-direction:column;gap:3px}
 .c.doute{border-color:#c98a2b;box-shadow:0 0 0 2px #f5e3c4}
 .c.change{border-color:#3e5288;box-shadow:0 0 0 2px #e2e6f2}
 .c img,.c .sans{width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px;background:#eee}
 .n{font-size:12px;font-weight:600} .a{font-size:11px;color:#7a7365}
 .pal i{display:inline-block;width:14px;height:14px;border-radius:7px;margin-right:3px;border:1px solid #0002}
 select{font:inherit;font-size:12px;padding:3px;border-radius:6px;border:1px solid #cfc9bd}
 .barre{position:sticky;bottom:0;background:#1f2534;color:#fff;padding:10px 12px;border-radius:10px;margin-top:24px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
 .barre button{padding:6px 14px;border-radius:7px;border:0;cursor:pointer;font:inherit}
</style>
<h1>Les nouvelles catégories de ta garde-robe</h1>
<p>Chaque pièce a reçu une nouvelle catégorie, devinée d'après son nom. <b>Change la catégorie dans le menu</b> sous toute pièce mal rangée.
Les pièces <span style="color:#c98a2b;font-weight:600">encadrées en orange</span> (${nbDoute}) n'avaient aucun indice dans leur nom : ce sont celles à regarder en premier.
Tes changements sont gardés si tu fermes la page ; « Télécharger mes changements » crée un fichier à envoyer.</p>
<p style="font-size:13px;color:#7a7365">Les pastilles montrent les couleurs converties vers la nouvelle palette. Le registre, les intempéries et la coupe ont été convertis d'office.</p>
${groupes}
<div class="barre"><span id="compte">Aucun changement.</span><button id="telecharger">Télécharger mes changements</button></div>
<script>
 const PHOTOS = __PHOTOS__;
 document.querySelectorAll("img[data-p]").forEach((i) => { i.src = PHOTOS[i.dataset.p] || ""; });
 const CLE = "categories-v5-${fait}";
 let chg = {};
 try { chg = JSON.parse(localStorage.getItem(CLE)) || {}; } catch {}
 const sauver = () => { try { localStorage.setItem(CLE, JSON.stringify(chg)); } catch {} };
 const compter = () => { const n = Object.keys(chg).length; document.getElementById("compte").textContent = n ? n + " changement(s)" : "Aucun changement."; };
 document.querySelectorAll(".c").forEach((c) => {
   const s = c.querySelector("select"), id = c.dataset.id, propose = c.dataset.propose;
   s.value = chg[id] || propose; c.classList.toggle("change", s.value !== propose);
   s.onchange = () => { if (s.value === propose) delete chg[id]; else chg[id] = s.value; c.classList.toggle("change", s.value !== propose); sauver(); compter(); };
 });
 compter();
 document.getElementById("telecharger").onclick = () => {
   const liste = Object.entries(chg).map(([id, categorie]) => ({ id, categorie, nom: document.querySelector('.c[data-id="' + id + '"] .n').textContent }));
   const url = URL.createObjectURL(new Blob([JSON.stringify({ validation: "${fait}", corrections: liste }, null, 1)], { type: "application/json" }));
   const a = document.createElement("a"); a.href = url; a.download = "choix-categories.json"; a.click();
   setTimeout(() => URL.revokeObjectURL(url), 4000);
 };
</script>`;
const pageSortie = fichier.replace(/\.json$/i, "") + "-v5-validation.html";
writeFileSync(pageSortie, page.replace("__PHOTOS__", JSON.stringify(Object.fromEntries(photos))));

const parCat = {};
for (const r of rapport) parCat[r.v5.categorie] = (parCat[r.v5.categorie] || 0) + 1;
console.error(`${rapport.length} pièces converties, ${nbDoute} catégorie(s) à vérifier.`);
console.error(Object.entries(parCat).map(([c, n]) => `${nomCat(c)} ${n}`).join(" · "));
console.error(`Écrit : ${sortie}\nÉcrit : ${pageSortie}`);
