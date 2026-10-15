import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadCatalog } from "../src/catalog.js";
import { recommendMaxRooms } from "../src/capacity.js";
import { createPreviewRunner } from "../src/docker.js";
import { createServer } from "../src/http.js";
import { assertPadIsolation } from "../src/pads.js";
import { createAuthStore } from "../src/liga.js";
import { Lobby } from "../src/rooms.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function testConfig(overrides = {}) {
  return {
    gamesDir: "/tmp/ps1-games-missing",
    biosDir: "/tmp/ps1-bios-missing",
    gamesDirPs2: "/tmp/ps2-games-missing",
    biosDirPs2: "/tmp/ps2-bios-missing",
    maxRooms: 2,
    maxSpectators: 4,
    idleMs: 600000,
    requireMedia: false,
    preview: true,
    ligaRequireAuth: false,
    ligaWpUrl: "",
    ligaWpUser: "",
    ligaWpAppPassword: "",
    ligaTekken3Id: 0,
    ligaTekken3Slug: "tekken-3",
    publicDir: path.join(root, "lobby", "public"),
    ...overrides,
  };
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

test("catalog exposes Tekken 3 only", () => {
  const games = loadCatalog(path.join(root, "games", "catalog.yaml"));
  assert.ok(games.length >= 1);
  const tekken = games.find((game) => game.id === "tekken3");
  assert.ok(tekken, "tekken3 must be enabled");
  assert.equal(tekken.file, "Tekken 3 (USA).cue");
  assert.equal(tekken.players, 2);
  assert.equal(tekken.ligaSlug, "tekken-3");
  for (const game of games) {
    assert.match(game.id, /^[a-z0-9-]+$/);
    assert.ok(game.file);
  }
});

test("DuckStation settings isolate Pad 1 and Pad 2", () => {
  const ini = fs.readFileSync(path.join(root, "room-image", "root", "defaults", "settings.ini"), "utf8");
  assert.deepEqual(assertPadIsolation(ini), []);
});

test("missing disc or BIOS refuses to start a desktop", () => {
  const script = path.join(root, "room-image", "root", "defaults", "require-media.sh");
  const empty = spawnSync("bash", [script], {
    env: { ...process.env, BIOS_DIR: os.tmpdir(), GAMES_DIR: os.tmpdir(), GAME_FILE: "" },
    encoding: "utf8",
  });
  assert.notEqual(empty.status, 0);
  assert.match(empty.stderr, /GAME_FILE/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ps1-media-"));
  const bios = path.join(dir, "bios");
  const games = path.join(dir, "games");
  fs.mkdirSync(bios);
  fs.mkdirSync(games);
  const noBios = spawnSync("bash", [script], {
    env: { ...process.env, BIOS_DIR: bios, GAMES_DIR: games, GAME_FILE: "tekken3.cue" },
    encoding: "utf8",
  });
  assert.notEqual(noBios.status, 0);
  assert.match(noBios.stderr, /BIOS/);

  fs.writeFileSync(path.join(bios, "scph1001.bin"), "not-a-real-bios");
  fs.writeFileSync(path.join(games, "tekken3.cue"), 'FILE "track.bin" BINARY\n');
  const missingBin = spawnSync("bash", [script], {
    env: { ...process.env, BIOS_DIR: bios, GAMES_DIR: games, GAME_FILE: "tekken3.cue" },
    encoding: "utf8",
  });
  assert.notEqual(missingBin.status, 0);
  assert.match(missingBin.stderr, /missing file/);

  fs.writeFileSync(path.join(games, "track.bin"), "disc");
  const ok = spawnSync("bash", [script], {
    env: { ...process.env, BIOS_DIR: bios, GAMES_DIR: games, GAME_FILE: "tekken3.cue" },
    encoding: "utf8",
  });
  assert.equal(ok.status, 0, ok.stderr);
});

test("two busy rooms on a 6 core box lower the cap to 1", () => {
  const tight = recommendMaxRooms({
    hostCpus: 6,
    samples: [{ cpuPercent: 280 }, { cpuPercent: 280 }],
  });
  assert.equal(tight.measured, true);
  assert.equal(tight.maxRooms, 1);

  const comfortable = recommendMaxRooms({
    hostCpus: 6,
    samples: [{ cpuPercent: 180 }, { cpuPercent: 160 }],
  });
  assert.equal(comfortable.maxRooms, 2);

  const unmeasured = recommendMaxRooms({ hostCpus: 6, samples: [] });
  assert.equal(unmeasured.maxRooms, 2);
  assert.equal(unmeasured.measured, false);
});

test("players get separate pads and a spectator gets none", async () => {
  const docker = createPreviewRunner();
  const lobby = new Lobby({
    config: testConfig(),
    games: loadCatalog(path.join(root, "games", "catalog.yaml")),
    docker,
  });
  const host = await lobby.createRoom({ nickname: "Asha", gameId: "tekken3" });
  const guest = await lobby.joinRoom({ code: host.code, nickname: "Bo" });
  const watcher = await lobby.joinRoom({ code: host.code, nickname: "Cam" });
  assert.equal(host.you.slot, 1);
  assert.equal(guest.you.slot, 2);
  assert.equal(watcher.you.role, "spectator");
  assert.equal(watcher.you.slot, null);

  await lobby.requestPlay(host.code, host.token);
  await lobby.whenSettled(host.code);
  const room = lobby.rooms.get(host.code);
  const tokens = docker.containers.get(room.containerName).tokens;
  assert.deepEqual(tokens[host.token], { role: "controller", slot: 1, mk_control: true });
  assert.deepEqual(tokens[guest.token], { role: "controller", slot: 2, mk_control: false });
  assert.deepEqual(tokens[watcher.token], { role: "viewer", slot: null, mk_control: false });
  assert.equal(await lobby.endRoom(host.code, guest.token).catch((error) => error.status), 403);
});

test("a full machine queues the next room and starts it when the first ends", async () => {
  const docker = createPreviewRunner();
  const lobby = new Lobby({
    config: testConfig({ maxRooms: 1 }),
    games: loadCatalog(path.join(root, "games", "catalog.yaml")),
    docker,
  });
  const first = await lobby.createRoom({ nickname: "Asha", gameId: "tekken3" });
  const second = await lobby.createRoom({ nickname: "Bo", gameId: "tekken3" });
  await lobby.requestPlay(first.code, first.token);
  await lobby.whenSettled(first.code);
  const queued = await lobby.requestPlay(second.code, second.token);
  assert.equal(queued.status, "queued");
  assert.equal(docker.containers.size, 1);

  await lobby.endRoom(first.code, first.token);
  await lobby.whenSettled(second.code);
  assert.equal(lobby.rooms.get(second.code).status, "live");
  assert.equal(docker.containers.has(`ps1-room-${second.code.toLowerCase()}`), true);
  assert.equal(docker.containers.has(`ps1-room-${first.code.toLowerCase()}`), false);
});

test("an idle match frees its machine", async () => {
  let clock = 1_000_000;
  const docker = createPreviewRunner();
  const lobby = new Lobby({
    config: testConfig({ idleMs: 1000 }),
    games: loadCatalog(path.join(root, "games", "catalog.yaml")),
    docker,
    now: () => clock,
  });
  const host = await lobby.createRoom({ nickname: "Asha", gameId: "tekken3" });
  await lobby.requestPlay(host.code, host.token);
  await lobby.whenSettled(host.code);
  clock += 5000;
  await lobby.tick();
  assert.equal(lobby.rooms.get(host.code).status, "ended");
  assert.equal(docker.containers.size, 0);
});

test("http lobby refuses a stream without a token and serves the home page", async () => {
  const lobby = new Lobby({
    config: testConfig(),
    games: loadCatalog(path.join(root, "games", "catalog.yaml")),
    docker: createPreviewRunner(),
  });
  const server = createServer({ lobby, config: testConfig() });
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}`;
  try {
    const home = await fetch(`${base}/`);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /Play together/);
    const script = await fetch(`${base}/app.js`);
    const appJs = await script.text();
    assert.match(appJs, /Play casual/);
    assert.match(appJs, /Play ranked/);

    const created = await fetch(`${base}/api/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nickname: "Asha", gameId: "tekken3" }),
    });
    assert.equal(created.status, 201);
    const room = await created.json();

    const blocked = await fetch(`${base}/streams/${room.code}/`);
    assert.equal(blocked.status, 403);

    const auth = await fetch(`${base}/internal/stream-auth`, {
      headers: { "x-original-uri": `/streams/${room.code}/?token=${room.token}` },
    });
    assert.equal(auth.status, 403);

    await fetch(`${base}/api/rooms/${room.code}/play`, {
      method: "POST",
      headers: { authorization: `Bearer ${room.token}` },
    });
    await lobby.whenSettled(room.code);
    const allowed = await fetch(`${base}/internal/stream-auth`, {
      headers: { "x-original-uri": `/streams/${room.code}/?token=${room.token}` },
    });
    assert.equal(allowed.status, 204);

    const assetBlocked = await fetch(`${base}/internal/stream-auth`, {
      headers: { "x-original-uri": `/streams/${room.code}/assets/index.css` },
    });
    assert.equal(assetBlocked.status, 403);

    const assetCookie = await fetch(`${base}/internal/stream-auth`, {
      headers: {
        "x-original-uri": `/streams/${room.code}/assets/index.css`,
        cookie: `ps1_stream_${room.code}=${room.token}`,
      },
    });
    assert.equal(assetCookie.status, 204);

    const preview = await fetch(`${base}/streams/${room.code}/?token=${room.token}`);
    assert.equal(preview.status, 503);
    const fifth = [];
    for (let i = 0; i < 6; i += 1) {
      fifth.push(fetch(`${base}/api/rooms/${room.code}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nickname: `Fan ${i}` }),
      }));
    }
    const joins = await Promise.all(fifth);
    const statuses = joins.map((response) => response.status).sort();
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 409]);
  } finally {
    server.close();
  }
});

test("ranked match creates mec when recording is healthy and cancels without file", async () => {
  const docker = createPreviewRunner();
  const auth = createAuthStore();
  const uploads = [];
  const patches = [];
  const joins = [];
  const liga = {
    enabled: true,
    async resolveLiga({ slug, id }) {
      return { id: id || 89, slug: slug || "tekken-3", title: "Tekken 3", visibility: "public" };
    },
    async joinLiga({ ligaId, userId }) {
      joins.push({ ligaId, userId });
      return { ligaId, userId, joined: true, canPlay: true };
    },
    async createMatch({ homeUserId, awayUserId, roomCode }) {
      return { matchId: 501, homeUserId, awayUserId, roomCode };
    },
    async uploadRecording(matchId, filePath, fileName) {
      uploads.push({ matchId, filePath, fileName });
    },
    async patchMatch(matchId, patch) {
      patches.push({ matchId, ...patch });
    },
  };
  const lobby = new Lobby({
    config: testConfig({
      ligaRequireAuth: true,
      ligaWpUrl: "https://liga.example",
      ligaWpUser: "ps1-sync",
      ligaWpAppPassword: "x",
      ligaTekken3Id: 89,
    }),
    games: loadCatalog(path.join(root, "games", "catalog.yaml")),
    docker,
    liga,
    auth,
  });
  const pad1 = auth.create({ wpUserId: 11, displayName: "Asha", email: "a@example.com" });
  const pad2 = auth.create({ wpUserId: 22, displayName: "Bo", email: "b@example.com" });
  const host = await lobby.createRoom({
    nickname: "Asha",
    gameId: "tekken3",
    sessionToken: pad1.token,
  });
  const guest = await lobby.joinRoom({
    code: host.code,
    nickname: "Bo",
    sessionToken: pad2.token,
  });
  assert.equal(host.recording.required, true);
  assert.equal(host.you.wpUserId, 11);
  assert.equal(guest.you.wpUserId, 22);
  assert.ok(joins.length >= 2);

  await lobby.requestPlay(host.code, host.token);
  await lobby.whenSettled(host.code);
  // beginRankedMatch polls up to 8s; wait for matchId
  for (let i = 0; i < 20 && !lobby.rooms.get(host.code).matchId; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
  }
  const live = lobby.rooms.get(host.code);
  assert.equal(live.status, "live");
  assert.equal(live.recording.active, true);
  assert.equal(live.recording.ranked, true);
  assert.equal(live.matchId, 501);

  await lobby.endRoom(host.code, host.token);
  assert.equal(lobby.rooms.get(host.code).status, "ended");
  assert.equal(uploads.length, 0);
  assert.equal(patches.length, 1);
  assert.equal(patches[0].matchId, 501);
  assert.equal(patches[0].status, "cancelled");
});

test("auth required blocks create without session; free_nugget bypasses", async () => {
  const docker = createPreviewRunner();
  const auth = createAuthStore();
  const liga = {
    enabled: true,
    async resolveLiga() {
      return { id: 89, slug: "tekken-3", title: "Tekken 3", visibility: "public" };
    },
    async joinLiga() {
      return { joined: true, canPlay: true };
    },
    async getStandings() {
      return { ligaId: 89, slug: "tekken-3", title: "Tekken 3", rows: [] };
    },
  };
  const lobby = new Lobby({
    config: testConfig({
      ligaRequireAuth: true,
      ligaWpUrl: "https://liga.example",
      ligaWpUser: "ps1-sync",
      ligaWpAppPassword: "x",
      ligaTekken3Id: 89,
    }),
    games: loadCatalog(path.join(root, "games", "catalog.yaml")),
    docker,
    liga,
    auth,
  });
  const server = createServer({ lobby, config: lobby.config, tls: null, auth, liga });
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}`;
  try {
    const denied = await fetch(`${base}/api/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nickname: "Asha", gameId: "tekken3" }),
    });
    assert.equal(denied.status, 401);

    const home = await fetch(`${base}/?free_nugget=1`);
    assert.equal(home.status, 200);
    const setCookie = home.headers.getSetCookie?.() || [];
    const cookieHeader = setCookie.find((c) => c.startsWith("ps1_free_nugget="))
      || (home.headers.get("set-cookie") || "");
    assert.match(String(cookieHeader), /ps1_free_nugget=1/);

    const cookie = String(cookieHeader).split(";")[0];
    const games = await fetch(`${base}/api/games`, { headers: { cookie } });
    const gamesBody = await games.json();
    assert.equal(gamesBody.authRequired, false);
    assert.equal(gamesBody.freeNugget, true);
    assert.equal(gamesBody.rankedPlayable, false);

    const casual = await fetch(`${base}/api/mode/casual`, { method: "POST" });
    assert.equal(casual.status, 204);
    const casualCookie = (casual.headers.getSetCookie?.() || []).find((c) => c.startsWith("ps1_free_nugget="))
      || (casual.headers.get("set-cookie") || "");
    assert.match(String(casualCookie), /ps1_free_nugget=1/);

    const created = await fetch(`${base}/api/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ nickname: "Nugget", gameId: "tekken3" }),
    });
    assert.equal(created.status, 201);
    const room = await created.json();
    assert.equal(room.freeNugget, true);
    assert.equal(room.recording.required, false);

    const standings = await fetch(`${base}/api/standings?gameId=tekken3`);
    assert.equal(standings.status, 200);
    const table = await standings.json();
    assert.equal(table.slug, "tekken-3");
  } finally {
    server.close();
  }
});

test("auth required fails closed when WP env missing", async () => {
  const lobby = new Lobby({
    config: testConfig({ ligaRequireAuth: true }),
    games: loadCatalog(path.join(root, "games", "catalog.yaml")),
    docker: createPreviewRunner(),
    liga: null,
    auth: createAuthStore(),
  });
  await assert.rejects(
    () => lobby.createRoom({ nickname: "Asha", gameId: "tekken3" }),
    (error) => error.status === 503,
  );
});

test("leave frees the machine so the next room is not stuck queued", async () => {
  const docker = createPreviewRunner();
  const lobby = new Lobby({
    config: testConfig({ maxRooms: 1, idleMs: 600000 }),
    games: loadCatalog(path.join(root, "games", "catalog.yaml")),
    docker,
  });
  const first = await lobby.createRoom({ nickname: "Asha", gameId: "tekken3" });
  await lobby.requestPlay(first.code, first.token);
  await lobby.whenSettled(first.code);
  assert.equal(lobby.rooms.get(first.code).status, "live");

  // Browser "Leave" without End used to keep the slot forever.
  await lobby.leaveRoom(first.code, first.token);
  assert.equal(lobby.rooms.get(first.code).status, "ended");
  assert.equal(docker.containers.size, 0);

  const second = await lobby.createRoom({ nickname: "Bo", gameId: "tekken3" });
  const playing = await lobby.requestPlay(second.code, second.token);
  assert.notEqual(playing.status, "queued");
  await lobby.whenSettled(second.code);
  assert.equal(lobby.rooms.get(second.code).status, "live");
});

test("deploy files keep the stream behind nginx and the firewall", () => {
  const nginx = fs.readFileSync(path.join(root, "deploy", "nginx.conf"), "utf8");
  assert.match(nginx, /auth_request/);
  assert.match(nginx, /proxy_read_timeout 3600s/);
  const setup = fs.readFileSync(path.join(root, "deploy", "setup-vps.sh"), "utf8");
  assert.match(setup, /ufw allow 22/);
  assert.match(setup, /ufw allow 80/);
  assert.match(setup, /ufw allow 443/);
  assert.match(setup, /fail2ban/);
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  assert.match(readme, /DuckStation/);
  assert.match(readme, /Play casual/);
  assert.doesNotMatch(readme, /https?:\/\/[^\s]*rom/i);
});
