/* Cumule les corpus hebdomadaires sur deux mois glissants.
 *
 *   node outils/cumuler.mjs                    lit tendances/, écrit tendances.json
 *   node outils/cumuler.mjs --semaines 12
 *   node outils/cumuler.mjs --montrer          détaille la fusion
 *
 * POURQUOI. Une synthèse hebdomadaire est bâtie sur une seule semaine de flux
 * RSS, et une semaine, c'est du bruit. Le corpus du 17 août 2026 portait
 * « lilas en touche, vu sur tapis rouge » : un événement isolé pesant autant
 * qu'une tendance de fond. Une tendance vestimentaire tient une saison, pas
 * sept jours. Cumuler enrichit le corpus — plus de règles, plus de vocabulaire
 * relevé — et surtout le stabilise : les suggestions ne basculent plus d'une
 * semaine à l'autre au gré d'un défilé.
 *
 * COMMENT. Chaque semaine garde son fichier dans `tendances/`. Le cumul les
 * repondère par ancienneté — demi-vie de quatre semaines — puis divise par le
 * total des pondérations de la fenêtre, et non par le nombre de semaines où la
 * règle apparaît. Une règle vue six semaines de suite pèse donc lourd ; une
 * règle vue une fois pèse peu, même récente. C'est exactement la distinction
 * qu'on cherche entre une tendance et un fait divers.
 *
 * L'application ne change pas : elle télécharge toujours un seul
 * `tendances.json`, et la note de tendance étant rapportée au total des poids
 * atteignables, un corpus plus fourni ne pèse pas mécaniquement plus lourd.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const args = process.argv.slice(2);
const option = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
const SEMAINES = Number(option("--semaines", 8));   // deux mois
const DEMI_VIE = Number(option("--demi-vie", 4));   // en semaines
const PLANCHER = 0.15;   // en deçà, c'est du bruit
const PLAFOND = 40;      // le moteur parcourt les règles pour chaque candidate

const racine = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const dossier = join(racine, "tendances");

if (!existsSync(dossier)) { mkdirSync(dossier, { recursive: true }); }
const fichiers = readdirSync(dossier)
  .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
  .sort()
  .slice(-SEMAINES);

if (!fichiers.length) {
  process.stderr.write(`Aucun corpus hebdomadaire dans ${dossier} — rien à cumuler.\n`);
  process.exit(1);
}

const semaines = fichiers.map((f) => ({
  date: f.slice(0, 10),
  corpus: JSON.parse(readFileSync(join(dossier, f), "utf8")),
}));

/* La plus récente est l'ancienneté 0. */
const poidsDe = (i) => Math.pow(0.5, (semaines.length - 1 - i) / DEMI_VIE);
const totalPoids = semaines.reduce((s, _, i) => s + poidsDe(i), 0);

/* ═══════════ Fusion des règles ═══════════
   Deux règles sont la même si elles disent la même chose. Les `descriptive`
   n'ont pas de champ structuré : leur texte fait office d'identité, sans quoi
   elles s'écraseraient toutes les unes sur les autres. */
const identite = (r) => r.type === "descriptive"
  ? "descriptive|" + (r.texte || r.note || "").toLowerCase().trim()
  : [r.type, r.valeur || "", (r.couleurs || []).slice().sort().join("+"),
     r.haut || "", r.bas || "", r.coupe || ""].join("|");

const fusion = new Map();
semaines.forEach((s, i) => {
  const f = poidsDe(i);
  for (const r of s.corpus.regles || []) {
    const cle = identite(r);
    const e = fusion.get(cle) || { modele: r, cumul: 0, semaines: [], derniere: null };
    e.cumul += r.poids * f;
    e.semaines.push(s.date);
    /* La formulation la plus récente est la plus juste : on garde celle-là,
       et le modèle de règle qui va avec. */
    e.modele = r; e.derniere = s.date;
    fusion.set(cle, e);
  }
});

const regles = [...fusion.values()]
  .map((e) => {
    const poids = Math.round(100 * e.cumul / totalPoids) / 100;
    return { ...e.modele, poids, vuSur: e.semaines.length, depuis: e.semaines[0] };
  })
  .filter((r) => Math.abs(r.poids) >= PLANCHER)
  .sort((a, b) => Math.abs(b.poids) - Math.abs(a.poids))
  .slice(0, PLAFOND);

/* ═══════════ Cumul du vocabulaire ═══════════
   C'est ici que deux mois changent tout. Un relevé hebdomadaire donne des
   occurrences de 1 à 3, dont on ne peut rien conclure ; cumulé, il dit
   vraiment quels champs manquent au modèle de données. */
const mots = new Map();
for (const s of semaines)
  for (const v of s.corpus.vocabulaire || []) {
    const cle = (v.terme || "").toLowerCase().trim();
    if (!cle) continue;
    const e = mots.get(cle) || { terme: v.terme, axe: v.axe, occurrences: 0, semaines: 0 };
    e.occurrences += Number(v.occurrences) || 0;
    e.semaines += 1;
    e.axe = v.axe || e.axe;
    mots.set(cle, e);
  }
const vocabulaire = [...mots.values()]
  .sort((a, b) => b.semaines - a.semaines || b.occurrences - a.occurrences);

const recente = semaines[semaines.length - 1];
const sortie = {
  revision: recente.date,
  origine: "cumul-hebdomadaire",
  fenetre: { semaines: semaines.length, de: semaines[0].date, a: recente.date, demiVie: DEMI_VIE },
  sources: [...new Set(semaines.flatMap((s) => s.corpus.sources || []))],
  resume: recente.corpus.resume,
  regles,
  vocabulaire,
};

writeFileSync(join(racine, "tendances.json"), JSON.stringify(sortie, null, 2) + "\n");

process.stderr.write(`${semaines.length} semaine(s) cumulée(s), du ${semaines[0].date} au ${recente.date}.\n`);
process.stderr.write(`  ${fusion.size} règles distinctes → ${regles.length} retenues (plancher ${PLANCHER}, plafond ${PLAFOND}).\n`);
process.stderr.write(`  ${vocabulaire.length} termes de vocabulaire cumulés.\n`);

if (args.includes("--montrer")) {
  process.stderr.write("\n  Règles retenues :\n");
  for (const r of regles)
    process.stderr.write(`    ${String(r.poids).padStart(5)}  vue ${r.vuSur}× depuis ${r.depuis}  [${r.type}] ${r.note}\n`);
  process.stderr.write("\n  Vocabulaire le plus persistant :\n");
  for (const v of vocabulaire.slice(0, 12))
    process.stderr.write(`    ${String(v.semaines).padStart(2)} sem., ${String(v.occurrences).padStart(3)} occ.  [${v.axe}] ${v.terme}\n`);
}
