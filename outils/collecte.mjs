/* Collecte hebdomadaire des sources de tendance.
 *
 * Uniquement des flux publiés pour être lus par des programmes : flux RSS de
 * la presse mode et API publique de Reddit. Aucun site n'est aspiré, et le
 * texte collecté ne sert qu'à produire des règles chiffrées — il n'est jamais
 * republié tel quel.
 *
 *   node outils/collecte.mjs > corpus.json
 */

const FLUX = [
  { nom: "Vogue",          url: "https://www.vogue.com/feed/rss" },
  { nom: "Hypebeast",      url: "https://hypebeast.com/feed" },
  { nom: "Who What Wear",  url: "https://www.whowhatwear.com/rss" },
  { nom: "WWD",            url: "https://wwd.com/feed/" },
];

const REDDIT = [
  "https://www.reddit.com/r/malefashionadvice/top.json?t=week&limit=25",
  "https://www.reddit.com/r/femalefashionadvice/top.json?t=week&limit=25",
  "https://www.reddit.com/r/streetwear/top.json?t=week&limit=25",
];

const UA = "dressing-tendances/1.0 (collecte hebdomadaire, usage personnel)";
const PLAFOND = 30;   // articles retenus par source
const EXTRAIT = 400;  // caractères conservés par article

const propre = (s) => (s || "")
  .replace(/<!\[CDATA\[|\]\]>/g, "")
  .replace(/<[^>]+>/g, " ")
  .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, EXTRAIT);

async function lire(url, quoi) {
  try {
    const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return quoi === "json" ? await r.json() : await r.text();
  } catch (e) {
    process.stderr.write(`  ! ${url} — ${e.message}\n`);
    return null;
  }
}

async function depuisRss({ nom, url }) {
  const xml = await lire(url, "texte");
  if (!xml) return [];
  const items = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/g) || [];
  return items.slice(0, PLAFOND).map((bloc) => {
    const champ = (t) => (bloc.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1];
    return {
      source: nom,
      titre: propre(champ("title")),
      extrait: propre(champ("description") || champ("summary") || champ("content")),
    };
  }).filter((a) => a.titre);
}

async function depuisReddit(url) {
  const json = await lire(url, "json");
  if (!json?.data?.children) return [];
  const sub = url.match(/\/r\/([^/]+)\//)[1];
  return json.data.children.map(({ data }) => ({
    source: `reddit/${sub}`,
    titre: propre(data.title),
    extrait: propre(data.selftext),
  })).filter((a) => a.titre);
}

const listes = await Promise.all([...FLUX.map(depuisRss), ...REDDIT.map(depuisReddit)]);
const articles = listes.flat();

if (!articles.length) {
  process.stderr.write("Aucune source n'a répondu — collecte abandonnée.\n");
  process.exit(1);
}

const parSource = {};
for (const a of articles) parSource[a.source] = (parSource[a.source] || 0) + 1;
process.stderr.write(`Collecté : ${articles.length} articles\n`);
for (const [s, n] of Object.entries(parSource)) process.stderr.write(`  ${s}: ${n}\n`);

process.stdout.write(JSON.stringify({
  collecteLe: new Date().toISOString(),
  sources: Object.keys(parSource),
  articles,
}, null, 2));
