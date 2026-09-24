import fs from "node:fs";
import yaml from "js-yaml";

export function loadCatalog(catalogPath) {
  const document = yaml.load(fs.readFileSync(catalogPath, "utf8"));
  const games = Array.isArray(document?.games) ? document.games : [];
  return games
    .filter((game) => game && game.enabled === true)
    .map((game) => {
      if (!/^[a-z0-9-]+$/.test(String(game.id || ""))) {
        throw new Error(`Invalid game id: ${game.id}`);
      }
      if (!Number.isInteger(game.players) || game.players < 1) {
        throw new Error(`Invalid player count for ${game.id}`);
      }
      if (!game.file || /[\\/]/.test(String(game.file)) || String(game.file).includes("..")) {
        throw new Error(`Invalid game file for ${game.id}`);
      }
      return {
        id: String(game.id),
        title: String(game.title || game.id),
        system: String(game.system || "ps1"),
        players: game.players,
        file: String(game.file),
      };
    });
}
