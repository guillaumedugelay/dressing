/* Petit serveur statique, uniquement pour essayer l'application en local dans
 * les mêmes conditions que GitHub Pages : une vraie origine HTTP, sans quoi ni
 * le stockage ni le chargement de tendances.json ne fonctionnent.
 *
 *   node outils/serveur-local.mjs
 */

import { createServer } from "http";
import { readFile } from "fs/promises";
import { extname, join, normalize } from "path";

const RACINE = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const PORT = 8137;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".md": "text/markdown; charset=utf-8",
};

createServer(async (req, res) => {
  const demande = decodeURIComponent(req.url.split("?")[0]);
  const relatif = normalize(demande === "/" ? "index.html" : demande.slice(1));
  if (relatif.startsWith("..")) { res.writeHead(403).end("interdit"); return; }

  try {
    const contenu = await readFile(join(RACINE, relatif));
    res.writeHead(200, {
      "content-type": TYPES[extname(relatif)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(contenu);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("introuvable");
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}/`));
