/* Simulateur gratuit : ce que l'application proposerait, situation par
 * situation, sur la vraie garde-robe — sans aucun appel payant.
 *
 *   node outils/simulateur.mjs export.json
 *   node outils/simulateur.mjs export.json --saison hiver
 *   node outils/simulateur.mjs export.json --tirages 2
 *
 * Écrit « …-simulation.html » à côté de l'export : les tenues du moteur de
 * règles, avec les photos, et sous chacune un bouton « Ça ne va pas » et une
 * case pour dire pourquoi. Les remarques sont gardées dans le navigateur et
 * se téléchargent en un fichier, à rapporter pour corriger les règles.
 *
 * POURQUOI. Le duel des modèles coûte quelques dollars, et le premier a été
 * jugé sur un moteur qui superposait deux tee-shirts : les modèles ne
 * choisissent que parmi ce que le moteur leur tend. Les incohérences se
 * traquent donc ici, gratuitement, et le duel ne se paie qu'une fois le
 * moteur propre.
 *
 * Le moteur est celui de index.html, tel quel — comme pour banc-tenues.
 */

import { readFileSync, writeFileSync } from "fs";

const args = process.argv.slice(2);
const option = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
const fichier = args.find((a) => !a.startsWith("--") && a.endsWith(".json"));
if (!fichier) { console.error("Usage : node outils/simulateur.mjs <export.json> [--saison hiver] [--tirages 1]"); process.exit(1); }
const SAISON = option("--saison", null);
const TIRAGES = Number(option("--tirages", 1));

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
    var fetch = () => Promise.reject(new Error("simulateur : pas de réseau"));
    var setTimeout = () => 0, setInterval = () => 0, requestAnimationFrame = () => 0;
  `;
  const out = {};
  new Function("__out", stubs + sc +
    "\n;__out.proposerTenues = proposerTenues; __out.etat = etat;" +
    "\n;__out.poserTendances = (c) => { TENDANCES = c; }; __out.poserGardeRobe = poserGardeRobe;")(out);
  return out;
}

const donnees = JSON.parse(readFileSync(fichier, "utf8"));
const M = chargerMoteur();
M.poserTendances(JSON.parse(readFileSync(new URL("../tendances.json", import.meta.url), "utf8")));
M.poserGardeRobe(donnees.pieces);
Object.assign(M.etat, { tenues: donnees.tenues || [], avis: donnees.avis || [], poidsTendance: 1 });

/* Les mêmes situations que le duel : chaque saison avec ses températures
   vraisemblables, la neige en hiver seulement. */
const TEMPERATURES = { printemps: ["froid", "doux"], ete: ["doux", "chaud"], automne: ["froid", "doux"], hiver: ["froid"] };
const NOMS = { printemps: "Printemps", ete: "Été", automne: "Automne", hiver: "Hiver", soleil: "soleil", nuages: "nuages",
  bruine: "pluie faible", pluie: "pluvieux", neige: "neige", chaud: "chaud", doux: "doux", froid: "froid",
  travail: "travail", chill: "loisir chill", habille: "loisir habillé" };
const situations = [];
for (const saison of Object.keys(TEMPERATURES)) {
  if (SAISON && saison !== SAISON) continue;
  for (const meteo of ["soleil", "nuages", "bruine", "pluie", ...(saison === "hiver" ? ["neige"] : [])])
    for (const temp of TEMPERATURES[saison])
      for (const activite of ["travail", "chill", "habille"])
        for (let k = 0; k < TIRAGES; k++) {
          Object.assign(M.etat, { saison, meteo, temp, activite, ecartees: new Set() });
          const r = M.proposerTenues();
          situations.push({ saison, meteo, temp, activite, tirage: k + 1, erreur: r.erreur,
            tenues: (r.tenues || []).map((t) => ({ ids: t.pieces.map((p) => p.id), detail: t.detail || [], note: t.note })) });
        }
}

const parId = new Map(donnees.pieces.map((p) => [p.id, p]));
const echapper = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const photos = new Map();
const vignette = (id) => {
  const p = parId.get(id);
  if (p.photo) photos.set(id, p.photo);
  return `<div class="p">${p.photo ? `<img data-p="${id}" alt="">` : ""}<span title="${echapper(p.nom)}">${echapper(p.nom)}</span></div>`;
};

const blocs = situations.map((s, i) => {
  const titre = `${NOMS[s.saison]} · ${NOMS[s.meteo]} · ${NOMS[s.temp]} · ${NOMS[s.activite]}${TIRAGES > 1 ? ` · tirage ${s.tirage}` : ""}`;
  if (s.erreur) return `<section><h2>${i + 1}. ${titre}</h2><p class="vide">Aucune tenue : ${echapper(s.erreur)}</p></section>`;
  return `<section><h2>${i + 1}. ${titre}</h2><div class="lot">${s.tenues.map((t, k) => `
    <div class="t" data-cle="${i}-${k}" data-situation="${echapper(titre)}" data-pieces="${echapper(t.ids.map((x) => parId.get(x).nom).join(" + "))}" data-ids="${t.ids.join(",")}">
      <div class="pieces">${t.ids.map(vignette).join("")}</div>
      <p class="detail">${echapper(t.detail.join(" · "))}</p>
      <button class="ko">Ça ne va pas</button>
      <textarea placeholder="Pourquoi ? (facultatif)" hidden></textarea>
    </div>`).join("")}</div></section>`;
}).join("");

const fait = new Date().toISOString();
const page = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Simulation des tenues</title>
<style>
 body{font:15px/1.5 system-ui,sans-serif;max-width:1100px;margin:0 auto;padding:16px;background:#faf8f4;color:#1f2534}
 h1{font-size:22px} h2{font-size:15px;margin:26px 0 10px;color:#5a6274;font-weight:600}
 .lot{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
 .t{background:#fff;border:1px solid #e6e1d8;border-radius:10px;padding:10px}
 .t.signalee{border-color:#b3412f;box-shadow:0 0 0 2px #f3dcd6}
 .pieces{display:flex;gap:5px;flex-wrap:wrap}
 .p{width:62px;font-size:10px;text-align:center;color:#5a6274}
 .p img{width:62px;height:62px;object-fit:cover;border-radius:6px;display:block}
 .p span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 .detail{font-size:12px;color:#7a7365;margin:6px 0 0}
 .vide{color:#7a7365;font-style:italic}
 button{margin-top:8px;width:100%;padding:6px;border:1px solid #cfc9bd;border-radius:7px;background:#f4f1ea;cursor:pointer;font:inherit;font-size:13px}
 .t.signalee .ko{background:#b3412f;color:#fff;border-color:#b3412f}
 textarea{width:100%;box-sizing:border-box;margin-top:6px;font:inherit;font-size:13px;border:1px solid #cfc9bd;border-radius:7px;padding:6px;min-height:52px}
 .barre{position:sticky;bottom:0;background:#1f2534;color:#fff;padding:10px 12px;border-radius:10px;margin-top:24px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
 .barre button{width:auto;margin:0;padding:6px 14px}
</style>
<h1>Simulation des tenues — moteur de règles</h1>
<p>Ce que l'application proposerait pour ${situations.length} situations, sur ta garde-robe telle qu'exportée. Rien n'est payant ici.
Sous une tenue qui ne va pas, appuie sur <b>« Ça ne va pas »</b> et dis pourquoi en quelques mots. Tes remarques sont gardées si tu fermes la page.
Quand tu as fini, <b>« Télécharger mes remarques »</b> crée un fichier à envoyer.</p>
${blocs}
<div class="barre"><span id="compte">Aucune remarque.</span><button id="telecharger">Télécharger mes remarques</button></div>
<script>
 const PHOTOS = __PHOTOS__;
 document.querySelectorAll("img[data-p]").forEach((i) => { i.src = PHOTOS[i.dataset.p] || ""; });
 const CLE = "simulation-${fait}";
 let rem = {};
 try { rem = JSON.parse(localStorage.getItem(CLE)) || {}; } catch {}
 const garder = () => { try { localStorage.setItem(CLE, JSON.stringify(rem)); } catch {} };
 const compter = () => { const n = Object.keys(rem).length; document.getElementById("compte").textContent = n ? n + " tenue(s) signalée(s)" : "Aucune remarque."; };
 document.querySelectorAll(".t").forEach((t) => {
   const cle = t.dataset.cle, zone = t.querySelector("textarea");
   const peindre = () => { const on = cle in rem; t.classList.toggle("signalee", on); zone.hidden = !on; zone.value = on ? rem[cle] : ""; };
   t.querySelector(".ko").onclick = () => { if (cle in rem) delete rem[cle]; else rem[cle] = ""; garder(); peindre(); compter(); if (cle in rem) zone.focus(); };
   zone.oninput = () => { rem[cle] = zone.value; garder(); };
   peindre();
 });
 compter();
 document.getElementById("telecharger").onclick = () => {
   const liste = Object.entries(rem).map(([cle, pourquoi]) => {
     const t = document.querySelector('.t[data-cle="' + cle + '"]');
     return { situation: t.dataset.situation, tenue: t.dataset.pieces, ids: t.dataset.ids.split(","), pourquoi };
   });
   const url = URL.createObjectURL(new Blob([JSON.stringify({ simulation: "${fait}", remarques: liste }, null, 1)], { type: "application/json" }));
   const a = document.createElement("a"); a.href = url; a.download = "remarques-simulation.json"; a.click();
   setTimeout(() => URL.revokeObjectURL(url), 4000);
 };
</script>`;

const sortie = fichier.replace(/\.json$/i, "") + "-simulation.html";
writeFileSync(sortie, page.replace("__PHOTOS__", JSON.stringify(Object.fromEntries(photos))));
const nbTenues = situations.reduce((n, s) => n + s.tenues.length, 0);
console.error(`${situations.length} situations, ${nbTenues} tenues, ${photos.size} photos distinctes.`);
console.error(`Écrit : ${sortie}`);
