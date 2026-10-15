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
      const system = String(game.system || "ps1").toLowerCase();
      if (system !== "ps1" && system !== "ps2") {
        throw new Error(`Invalid system for ${game.id}: use ps1 or ps2`);
      }
      return {
        id: String(game.id),
        title: String(game.title || game.id),
        system,
        players: game.players,
        file: String(game.file),
        ligaSlug: game.ligaSlug ? String(game.ligaSlug) : null,
        ligaId: Number.isInteger(game.ligaId) ? game.ligaId : null,
        ligaKey: game.ligaKey ? String(game.ligaKey) : null,
      };
    });
}
