import { loadCatalog } from "./catalog.js";
import { loadConfig } from "./config.js";
import { createDockerRunner, createPreviewRunner } from "./docker.js";
import { createServer } from "./http.js";
import { createAuthStore, createLigaClient } from "./liga.js";
import { Lobby } from "./rooms.js";
import { ensureTlsMaterial } from "./tls.js";

const config = loadConfig();
const games = loadCatalog(config.catalogPath);
const docker = config.preview ? createPreviewRunner() : createDockerRunner(config);
const liga = createLigaClient(config);
const auth = createAuthStore();
const lobby = new Lobby({ config, games, docker, liga, auth });
const tls = config.tls ? ensureTlsMaterial(config) : null;
const server = createServer({ lobby, config, tls, auth, liga });

const timer = setInterval(() => {
  lobby.tick().catch((error) => console.error("idle tick failed", error.message));
}, 30000);
timer.unref();

const scheme = tls ? "https" : "http";
server.listen(config.port, config.bindHost, () => {
  console.log(`lobby listening on ${scheme}://${config.bindHost}:${config.port}`);
  if (liga.enabled) console.log(`liga sync: ${config.ligaWpUrl} (slug ${config.ligaTekken3Slug || "tekken-3"})`);
  else if (config.ligaRequireAuth) console.log("liga sync: disabled (set LIGA_WP_* env to enable ranked play)");
  if (tls?.ips?.length) {
    for (const ip of tls.ips) {
      if (ip === "127.0.0.1") continue;
      console.log(`LAN: ${scheme}://${ip}:${config.port}  (accept the self-signed cert warning once)`);
    }
  }
});
