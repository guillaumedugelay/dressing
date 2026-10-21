/* Un vrai appel à Opus, avec exactement le code de l'application, depuis le
 * PC. Pour vérifier la composition sans passer par le téléphone.
 *
 *   node outils/essai-opus.mjs export.json --saison hiver --meteo pluie --temp froid --activite habille
 *
 * Coûte un appel (~0,40 à 0,60 $ selon le nombre de pièces). Requiert
 * ANTHROPIC_API_KEY dans l'environnement.
 *
 * Sur le PC, pas de canevas : les photos sont réduites à 512 px par
 * reduire-photos.ps1 (l'outil d'image de Windows), comme l'application le
 * fait sur le téléphone. Écrit aussi une page avec les tenues et leurs photos.
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { pathToFileURL, fileURLToPath } from "url";
import { execFileSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";

const args = process.argv.slice(2);
const option = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
const fichier = args.find((a) => !a.startsWith("--") && a.endsWith(".json"));
if (!fichier) { console.error("Usage : node outils/essai-opus.mjs <export.json> [--saison] [--meteo] [--temp] [--activite]"); process.exit(1); }
if (!process.env.ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY n'est pas dans l'environnement."); process.exit(1); }

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
let sc = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
sc = sc.slice(sc.indexOf("(() => {") + 8, sc.lastIndexOf("})();"));
const stubs = `
  var document = { addEventListener(){}, querySelector: () => null, querySelectorAll: () => [],
    createElement: () => ({ style:{}, classList:{add(){},remove(){}}, appendChild(){}, setAttribute(){}, getContext: () => null }),
    documentElement: { style: { setProperty(){} } }, body: { classList: { add(){}, remove(){} } }, getElementById: () => null };
  var window = { addEventListener(){}, matchMedia: () => ({ matches:false, addEventListener(){} }), location:{href:""}, navigator:{} };
  var localStorage = { getItem: () => null, setItem(){}, removeItem(){} };
  var indexedDB = { open: () => ({ addEventListener(){}, result:null }) };
  var setTimeout = globalThis.setTimeout, setInterval = () => 0, requestAnimationFrame = () => 0;`;
const M = {};
new Function("__out", stubs + sc + `;__out.etat = etat; __out.DB = DB; __out.IA = IA; __out.poserGardeRobe = poserGardeRobe;
  __out.poserTendances = (c) => { TENDANCES = c; }; __out.piecesEligibles = piecesEligibles;
  __out.composerAvecOpus = composerAvecOpus; __out.photosReduites = photosReduites; __out.motifIndisponible = motifIndisponible;
  __out.contexteDuJour = contexteDuJour; __out.nomDe = nomDe; __out.METEOS = METEOS; __out.TEMPS = TEMPS;
  __out.ACTIVITES = ACTIVITES; __out.SAISONS = SAISONS;`)(M);

/* Une base en mémoire à la place d'IndexedDB. */
const tables = { pieces: new Map(), reglages: new Map(), tenues: new Map(), avis: new Map() };
Object.assign(M.DB, {
  prendre: async (t, k) => tables[t].get(k),
  poser: async (t, v) => { tables[t].set(v.cle ?? v.id ?? v.paire, v); },
  tout: async (t) => [...tables[t].values()],
  retirer: async (t, k) => { tables[t].delete(k); },
});
await M.DB.poser("reglages", { cle: "cleApi", valeur: process.env.ANTHROPIC_API_KEY });
M.IA.sdk = pathToFileURL(new URL("../node_modules/@anthropic-ai/sdk/index.mjs", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")).href;

const donnees = JSON.parse(readFileSync(fichier, "utf8"));
M.poserTendances(JSON.parse(readFileSync(new URL("../tendances.json", import.meta.url), "utf8")));
M.poserGardeRobe(donnees.pieces);
Object.assign(M.etat, { tenues: donnees.tenues || [], avis: donnees.avis || [], poidsTendance: 1,
  saison: option("--saison", "automne"), meteo: option("--meteo", "nuages"), temp: option("--temp", "froid"), activite: option("--activite", "travail") });

const { fiches } = M.piecesEligibles();
/* Les photos, réduites comme sur le téléphone, puis posées dans le cache des
   photos réduites que l'application remplit par son canevas. */
const dossier = join(tmpdir(), "dressing-essai-opus");
rmSync(dossier, { recursive: true, force: true });
mkdirSync(join(dossier, "src"), { recursive: true });
for (const p of fiches) if (p.photo) writeFileSync(join(dossier, "src", p.id + ".jpg"), Buffer.from(p.photo.split(",")[1], "base64"));
execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fileURLToPath(new URL("reduire-photos.ps1", import.meta.url)),
  "-Source", join(dossier, "src"), "-Cible", join(dossier, "512")]);
let octets = 0;
for (const p of fiches) if (p.photo) {
  const data = readFileSync(join(dossier, "512", p.id + ".jpg")).toString("base64");
  M.photosReduites.set(p.id, { source: p.photo, data });
  octets += data.length;
}
const journee = `${M.nomDe(M.SAISONS, M.etat.saison)} · ${M.nomDe(M.METEOS, M.etat.meteo)} · ${M.nomDe(M.TEMPS, M.etat.temp)} · ${M.nomDe(M.ACTIVITES, M.etat.activite)}`;
console.error(`${journee} : ${fiches.length} pièces, ${(octets / 1048576).toFixed(1)} Mo de photos réduites.`);
console.error("\nCe qu'Opus lit de la journée :\n" + M.contexteDuJour(fiches, []).split("\n").map((l) => "  │ " + l).join("\n") + "\n");

const t0 = Date.now();
let usage = null;
M.IA.surReponse = (r) => { usage = r.usage; };
try {
  const tenues = await M.composerAvecOpus({ fiches, progres: (t) => console.error("  " + t) });
  console.error(`\n${tenues.length} tenue(s) en ${Math.round((Date.now() - t0) / 1000)} s.\n`);
  for (const [i, t] of tenues.entries()) {
    console.log(`Tenue ${i + 1} · ${t.titre}`);
    console.log(`  ${t.pieces.map((p) => p.nom).join(" + ")}`);
    console.log(`  ${t.raison}\n`);
  }
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const page = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Essai Opus</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:900px;margin:0 auto;padding:16px;background:#faf8f4;color:#1f2534}
.t{background:#fff;border:1px solid #e6e1d8;border-radius:12px;padding:12px;margin:14px 0}
.p{display:inline-block;width:96px;margin:4px;vertical-align:top;font-size:11px;color:#5a6274;text-align:center}
.p img{width:96px;height:96px;object-fit:cover;border-radius:8px;display:block}h2{font-size:16px;margin:0 0 8px}</style>
<h1 style="font-size:20px">${esc(journee)}</h1><p style="color:#7a7365">${fiches.length} pièces envoyées à Opus 5.5 · ${Math.round((Date.now() - t0) / 1000)} s</p>
${tenues.map((t, i) => `<div class="t"><h2>Tenue ${i + 1} · ${esc(t.titre)}</h2>${t.pieces.map((p) =>
    `<div class="p">${p.photo ? `<img src="${p.photo}">` : ""}${esc(p.nom)}</div>`).join("")}<p>${esc(t.raison)}</p></div>`).join("")}`;
  const sortie = fichier.replace(/\.json$/i, "") + `-essai-${M.etat.saison}-${M.etat.meteo}-${M.etat.temp}-${M.etat.activite}.html`;
  writeFileSync(sortie, page);
  console.error("Écrit : " + sortie);
} catch (e) {
  console.error("Opus n'est pas disponible : " + M.motifIndisponible(e));
  console.error(e);
}
if (usage) {
  const cout = (usage.input_tokens * 4 + (usage.cache_creation_input_tokens || 0) * 5 + (usage.cache_read_input_tokens || 0) * 0.4 + usage.output_tokens * 20) / 1e6;
  console.error(`Jetons : ${usage.input_tokens} entrée, ${usage.cache_creation_input_tokens || 0} écrits en cache, ${usage.output_tokens} sortie — environ ${cout.toFixed(2)} $.`);
}
