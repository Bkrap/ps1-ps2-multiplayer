import path from "node:path";
import { fileURLToPath } from "node:url";

const lobbyRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(lobbyRoot, "..");

function intEnv(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

function boolEnv(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  throw new Error(`${name} must be true or false`);
}

export function loadConfig(env = process.env) {
  return {
    port: intEnv(env, "PORT", 8080),
    bindHost: env.BIND_HOST || "127.0.0.1",
    catalogPath: env.CATALOG_PATH || path.join(repoRoot, "games", "catalog.yaml"),
    gamesDir: env.GAMES_DIR || "/var/lib/ps1-rooms/games",
    biosDir: env.BIOS_DIR || "/var/lib/ps1-rooms/bios",
    gamesDirPs2: env.GAMES_DIR_PS2 || "/var/lib/ps1-rooms/games-ps2",
    biosDirPs2: env.BIOS_DIR_PS2 || "/var/lib/ps1-rooms/bios-ps2",
    roomImage: env.ROOM_IMAGE || "ps1-room:local",
    dockerNetwork: env.DOCKER_NETWORK || "ps1-rooms",
    maxRooms: Math.max(1, intEnv(env, "MAX_ROOMS", 2)),
    maxSpectators: intEnv(env, "MAX_SPECTATORS", 4),
    idleMs: intEnv(env, "IDLE_MS", 600000),
    roomCpus: env.ROOM_CPUS || "3.5",
    roomMemory: env.ROOM_MEMORY || "3g",
    roomCpusPs2: env.ROOM_CPUS_PS2 || "4",
    roomMemoryPs2: env.ROOM_MEMORY_PS2 || "6g",
    requireMedia: boolEnv(env, "REQUIRE_MEDIA", true),
    preview: boolEnv(env, "PREVIEW", false),
    // LAN clients need HTTPS: browsers only treat localhost HTTP as secure.
    tls: boolEnv(env, "TLS", true),
    ligaWpUrl: env.LIGA_WP_URL || "",
    ligaWpUser: env.LIGA_WP_USER || "",
    ligaWpAppPassword: env.LIGA_WP_APP_PASSWORD || "",
    ligaWpSyncSecret: env.LIGA_WP_SYNC_SECRET || "",
    ligaTekken3Id: intEnv(env, "LIGA_TEKKEN3_ID", 0),
    ligaTekken3Slug: env.LIGA_TEKKEN3_SLUG || "tekken-3",
    ligaRequireAuth: boolEnv(env, "LIGA_REQUIRE_AUTH", true),
    publicDir: path.join(lobbyRoot, "public"),
    settingsPath: path.join(repoRoot, "room-image", "root", "defaults", "settings.ini"),
  };
}
