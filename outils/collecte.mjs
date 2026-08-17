/* Collecte hebdomadaire des sources de tendance.
 *
 * Uniquement des flux publiés pour être lus par des programmes : flux RSS de
 * la presse mode et API publique de Reddit. Aucun site n'est aspiré, et le
 * texte collecté ne sert qu'à produire des règles chiffrées — il n'est jamais
 * republié tel quel.
 *
 *   node outils/collecte.mjs > corpus.json
 */

/* Des titres qui parlent de vêtements portables, pas de défilés ni du
   commerce de la mode. Business of Fashion a été essayé et écarté : il publie
   cent articles par semaine, presque tous sur des levées de fonds et des
   nominations, et il aurait noyé le reste. Dazed et i-D, écartés aussi —
   trop éditoriaux pour une garde-robe de tous les jours. Highsnobiety fait
   double emploi avec Hypebeast. The Cut ne répond plus (404).

   Un flux qui meurt ne casse rien : `lire` avale l'erreur et la collecte
   continue avec les autres. Elle n'échoue que si toutes tombent. */
const FLUX = [
  { nom: "Vogue",           url: "https://www.vogue.com/feed/rss" },
  { nom: "Hypebeast",       url: "https://hypebeast.com/feed" },
  { nom: "Who What Wear",   url: "https://www.whowhatwear.com/rss" },
  { nom: "WWD",             url: "https://wwd.com/feed/" },
  { nom: "Fashionista",     url: "https://fashionista.com/.rss/full" },
  { nom: "Harper's Bazaar", url: "https://www.harpersbazaar.com/rss/all.xml" },
  { nom: "Elle",            url: "https://www.elle.com/rss/all.xml" },
  { nom: "Refinery29",      url: "https://www.refinery29.com/en-us/fashion/rss.xml" },
  { nom: "Glamour",         url: "https://www.glamour.com/feed/rss" },
];

/* Reddit a fermé ses points d'accès JSON publics : ils répondent 403 sans
   jeton OAuth, et depuis une machine d'intégration continue à coup sûr.
   Rebrancher cette source suppose de créer une application Reddit et de
   déposer ses identifiants en secrets — pas fait tant que ça n'apporte pas
   assez au regard des flux de presse. */
const REDDIT = [];

const UA = "dressing-tendances/1.0 (collecte hebdomadaire, usage personnel)";

/* Ces deux plafonds décident de ce que la synthèse aura sous les yeux, et donc
   de ce qu'elle pourra mettre de côté en `descriptive` — le journal des mots
   que le vocabulaire ne sait pas encore dire. Ce qui est coupé ici est perdu
   pour toujours : un flux RSS est une fenêtre glissante, la semaine passée ne
   se rattrape pas. Mieux vaut donc collecter large et laisser la synthèse
   trier, d'autant que la garde-robe grandira et rendra exploitables des
   nuances qu'elle ignore aujourd'hui.

   400 caractères tronquaient le chapô en plein milieu, là où se trouvent
   justement les précisions concrètes — « bout carré », « manches ballon ».
   Le surcoût est en jetons d'entrée sur la synthèse, quelques dizaines de
   centimes par an. */
const PLAFOND = 40;    // articles retenus par source
const EXTRAIT = 1500;  // caractères conservés par article

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
