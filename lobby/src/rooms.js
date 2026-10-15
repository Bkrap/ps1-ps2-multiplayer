import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { selkiesTokenBody } from "./pads.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode() {
  const bytes = crypto.randomBytes(6);
  let code = "";
  for (let i = 0; i < 6; i += 1) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return code;
}

function randomToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function sanitizeNickname(value) {
  const nickname = String(value || "").trim().replace(/\s+/g, " ");
  if (!/^[\p{L}\p{N} _-]{1,24}$/u.test(nickname)) return null;
  return nickname;
}

export class LobbyError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export class Lobby {
  constructor({ config, games, docker, liga, auth, now = () => Date.now() }) {
    this.config = config;
    this.games = new Map(games.map((game) => [game.id, game]));
    this.docker = docker;
    this.liga = liga;
    this.auth = auth;
    this.now = now;
    this.rooms = new Map();
    this._lock = Promise.resolve();
  }

  listGames() {
    return [...this.games.values()].map((game) => ({
      id: game.id,
      title: game.title,
      system: game.system,
      players: game.players,
      ligaSlug: game.ligaSlug || null,
      ligaId: game.ligaId || null,
    }));
  }

  /** Auth required for create/join when WP sync is configured and LIGA_REQUIRE_AUTH. */
  authRequired() {
    if (!this.config.ligaRequireAuth) return false;
    return Boolean(this.liga?.enabled);
  }

  rankedEnabled() {
    return this.authRequired();
  }

  /** Ranked start/recording only when the game is wired to a liga. */
  roomIsRanked(room) {
    if (!this.rankedEnabled() || room.freeNugget) return false;
    return Boolean(room.ligaSlug || room.ligaId);
  }

  requireAuthSession(sessionToken, { freeNugget = false } = {}) {
    if (freeNugget) return null;
    if (!this.authRequired()) {
      if (this.config.ligaRequireAuth && !this.liga?.enabled) {
        throw new LobbyError(503, "Ranked play needs liga-cms sync (LIGA_WP_*). Use Play Casual instead.");
      }
      return null;
    }
    try {
      return this.auth.require(sessionToken);
    } catch (error) {
      throw new LobbyError(error.status || 401, error.message);
    }
  }

  ligaRefForGame(game) {
    if (!game) return { slug: this.config.ligaTekken3Slug || "tekken-3", id: this.config.ligaTekken3Id || 0 };
    return {
      slug: game.ligaSlug || (game.id === "tekken3" ? (this.config.ligaTekken3Slug || "tekken-3") : null),
      id: game.ligaId || (game.id === "tekken3" ? (this.config.ligaTekken3Id || 0) : 0),
    };
  }

  async ensureJoinedLiga(session, game) {
    if (!session?.wpUserId || !this.liga?.enabled) return null;
    const ref = this.ligaRefForGame(game);
    if (!ref.slug && !ref.id) return null;
    const liga = await this.liga.resolveLiga(ref);
    await this.liga.joinLiga({ ligaId: liga.id, userId: session.wpUserId });
    return liga;
  }

  async createRoom({ nickname, gameId, sessionToken, freeNugget = false }) {
    const session = this.requireAuthSession(sessionToken, { freeNugget });
    const game = this.games.get(gameId);
    if (!game) throw new LobbyError(404, "That game is not available.");
    let ligaMeta = null;
    if (session && !freeNugget) {
      try {
        ligaMeta = await this.ensureJoinedLiga(session, game);
      } catch (error) {
        throw new LobbyError(error.status || 502, error.message || "Could not join the league.");
      }
    }
    return this.withLock(async () => {
      const name = sanitizeNickname(nickname || session?.displayName);
      if (!name) throw new LobbyError(400, "Enter a nickname using letters, numbers, spaces, or hyphens.");
      let code = randomCode();
      for (let attempt = 0; this.rooms.has(code) && attempt < 5; attempt += 1) code = randomCode();
      if (this.rooms.has(code)) throw new LobbyError(503, "Could not open a room. Try again.");
      const token = randomToken();
      const ligaSlug = ligaMeta?.slug || this.ligaRefForGame(game).slug;
      const ligaId = ligaMeta?.id || null;
      const ranked = this.rankedEnabled() && !freeNugget && Boolean(ligaSlug || ligaId);
      const room = {
        code,
        game,
        status: "waiting",
        error: null,
        createdAt: this.now(),
        lastActivity: this.now(),
        containerName: `ps1-room-${code.toLowerCase()}`,
        masterToken: randomToken(),
        hostPort: null,
        members: [{
          token,
          nickname: name,
          role: "player",
          slot: 1,
          wpUserId: session?.wpUserId || null,
        }],
        recording: { active: false, required: ranked, ranked: false },
        matchId: null,
        freeNugget: Boolean(freeNugget),
        ligaId,
        ligaSlug,
        _boot: null,
      };
      this.rooms.set(code, room);
      return this.memberView(room, token);
    });
  }

  async joinRoom({ code, nickname, sessionToken, freeNugget = false }) {
    const roomPeek = this.requireRoom(code);
    const bypass = freeNugget || Boolean(roomPeek.freeNugget);
    const session = this.requireAuthSession(sessionToken, { freeNugget: bypass });
    if (session && !bypass) {
      try {
        await this.ensureJoinedLiga(session, roomPeek.game);
      } catch (error) {
        throw new LobbyError(error.status || 502, error.message || "Could not join the league.");
      }
    }
    return this.withLock(async () => {
      const room = this.requireRoom(code);
      this.touch(room);
      if (room.status === "ended") throw new LobbyError(410, "This match has ended.");
      const name = sanitizeNickname(nickname || session?.displayName);
      if (!name) throw new LobbyError(400, "Enter a nickname using letters, numbers, spaces, or hyphens.");
      if (session?.wpUserId && room.members.some((m) => m.wpUserId === session.wpUserId)) {
        throw new LobbyError(409, "You are already in this room.");
      }
      const players = room.members.filter((member) => member.role === "player");
      const spectators = room.members.filter((member) => member.role === "spectator");
      const token = randomToken();
      if (players.length < room.game.players) {
        room.members.push({
          token,
          nickname: name,
          role: "player",
          slot: players.length + 1,
          wpUserId: session?.wpUserId || null,
        });
      } else if (spectators.length < this.config.maxSpectators) {
        room.members.push({
          token,
          nickname: name,
          role: "spectator",
          slot: null,
          wpUserId: session?.wpUserId || null,
        });
      } else {
        throw new LobbyError(409, "This room is full.");
      }
      if (room.status === "live") await this.syncTokens(room);
      return this.memberView(room, token);
    });
  }

  async getRoom(code, token) {
    return this.withLock(async () => {
      const room = this.requireRoom(code);
      this.requireMember(room, token);
      this.touch(room);
      if (room.status === "live" && room.recording?.required) {
        room.recording.active = await this.docker.recordingActive(room).catch(() => false);
      }
      return this.memberView(room, token);
    });
  }

  async requestPlay(code, token) {
    let boot = null;
    const view = await this.withLock(async () => {
      await this.reclaimOrphanRooms();
      await this.promote();
      const room = this.requireRoom(code);
      this.requireMember(room, token);
      this.touch(room);
      if (room.status === "ended") throw new LobbyError(410, "This match has ended.");
      if (room.status === "live" || room.status === "starting" || room.status === "queued") {
        return this.memberView(room, token);
      }
      if (this.roomIsRanked(room)) {
        const players = room.members.filter((m) => m.role === "player");
        if (players.length < 2) {
          throw new LobbyError(400, "Both Pad 1 and Pad 2 must join before a ranked match.");
        }
        if (players.some((p) => !p.wpUserId)) {
          throw new LobbyError(400, "Both players must Register to play before starting.");
        }
      }
      if (!this.mediaReady(room)) {
        room.error = "This game is not on the server yet.";
        return this.memberView(room, token);
      }
      const busy = [...this.rooms.values()].filter((item) => item.status === "live" || item.status === "starting").length;
      if (busy >= this.config.maxRooms) {
        room.status = "queued";
        room.error = null;
        return this.memberView(room, token);
      }
      room.status = "starting";
      room.error = null;
      boot = this.boot(room);
      room._boot = boot;
      return this.memberView(room, token);
    });
    if (boot) boot.catch((error) => console.error("room boot failed", error.message));
    return view;
  }

  async leaveRoom(code, token) {
    return this.withLock(async () => {
      const room = this.requireRoom(code);
      const member = this.requireMember(room, token);
      room.members = room.members.filter((item) => item.token !== token);
      this.touch(room);

      const players = room.members.filter((item) => item.role === "player");
      const active = room.status === "live" || room.status === "starting" || room.status === "queued";
      // Leaving Pad 1 (or emptying the room) must free the machine slot.
      if (players.length === 0 || (active && member.slot === 1)) {
        await this.finish(room);
        await this.promote();
        return { ok: true, ended: true };
      }
      if (room.status === "live") await this.syncTokens(room).catch(() => {});
      return { ok: true, ended: false };
    });
  }

  async endRoom(code, token) {
    return this.withLock(async () => {
      const room = this.requireRoom(code);
      const member = this.requireMember(room, token);
      if (member.slot !== 1) throw new LobbyError(403, "Only Pad 1 can end the match.");
      await this.finish(room);
      await this.promote();
      return this.memberView(room, token);
    });
  }

  /** Free slots held by abandoned rooms (browser closed / Leave without End). */
  async reclaimOrphanRooms() {
    const staleMs = Math.min(45000, Math.max(15000, Math.floor(this.config.idleMs / 4)));
    const now = this.now();
    for (const room of [...this.rooms.values()]) {
      if (room.status === "ended" || room.status === "waiting") continue;
      if (now - room.lastActivity < staleMs) continue;
      console.warn(`reclaiming stale room ${room.code} (${room.status}, idle ${now - room.lastActivity}ms)`);
      await this.finish(room);
    }
  }

  authorizeStream(code, token) {
    const room = this.rooms.get(String(code || "").toUpperCase());
    if (!room || room.status === "ended") return false;
    const member = room.members.find((item) => item.token === token);
    if (!member) return false;
    this.touch(room);
    return room.status === "live";
  }

  streamTarget(code) {
    const room = this.rooms.get(String(code || "").toUpperCase());
    if (!room || room.status !== "live") return null;
    return this.docker.streamTarget(room);
  }

  async tick() {
    await this.withLock(async () => {
      await this.reclaimOrphanRooms();
      const cutoff = this.now() - this.config.idleMs;
      for (const room of this.rooms.values()) {
        if (room.status === "ended") continue;
        if (room.lastActivity >= cutoff) continue;
        await this.finish(room);
      }
      await this.promote();
    });
  }

  async whenSettled(code) {
    const room = this.rooms.get(String(code || "").toUpperCase());
    if (room?._boot) await room._boot.catch(() => {});
  }

  async boot(room) {
    try {
      await this.docker.start(room);
      await this.docker.waitReady(room);
      await this.withLock(async () => {
        if (room.status === "ended") {
          await this.docker.stop(room);
          return;
        }
        room.status = "live";
        room.lastActivity = this.now();
        await this.syncTokens(room);
      });

      if (room.status !== "live") return;

      if (this.roomIsRanked(room)) {
        await this.beginRankedMatch(room);
      }
    } catch (error) {
      console.error(`room ${room.code} failed to start: ${error.message}`);
      await this.withLock(async () => {
        if (room.status !== "ended") {
          room.status = "waiting";
          room.error = "The match could not start.";
          room.recording = { ...(room.recording || {}), active: false, ranked: false };
        }
        await this.docker.stop(room);
        await this.promote();
      });
    }
  }

  async beginRankedMatch(room) {
    try {
      await this.docker.startRecording(room);
      let ok = false;
      for (let i = 0; i < 8; i += 1) {
        await new Promise((r) => setTimeout(r, 1000));
        ok = await this.docker.recordingActive(room);
        if (ok) break;
      }
      await this.withLock(async () => {
        if (room.status !== "live") return;
        room.recording.active = ok;
        room.recording.ranked = ok;
        if (!ok) {
          room.error = "Recording did not start. This match does not count for the league.";
          room.recording.ranked = false;
          return;
        }
        const pad1 = room.members.find((m) => m.slot === 1);
        const pad2 = room.members.find((m) => m.slot === 2);
        if (!pad1?.wpUserId || !pad2?.wpUserId) {
          room.error = "Both players need Register to play. This match does not count.";
          room.recording.ranked = false;
          return;
        }
        try {
          const created = await this.liga.createMatch({
            ligaId: room.ligaId || undefined,
            homeUserId: pad1.wpUserId,
            awayUserId: pad2.wpUserId,
            roomCode: room.code,
            status: "scheduled",
          });
          room.matchId = created.matchId;
        } catch (error) {
          console.error(`liga create match failed for ${room.code}:`, error.message);
          room.error = "League sync failed. This match does not count.";
          room.recording.ranked = false;
        }
      });
    } catch (error) {
      console.error(`recording start failed for ${room.code}:`, error.message);
      await this.withLock(async () => {
        if (room.status === "live") {
          room.recording = { ...(room.recording || {}), active: false, ranked: false };
          room.error = "Recording did not start. This match does not count for the league.";
        }
      });
    }
  }

  async promote() {
    const busy = () => [...this.rooms.values()].filter((item) => item.status === "live" || item.status === "starting").length;
    const queued = [...this.rooms.values()]
      .filter((item) => item.status === "queued")
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const room of queued) {
      if (busy() >= this.config.maxRooms) break;
      if (!this.mediaReady(room)) {
        room.status = "waiting";
        room.error = "This game is not on the server yet.";
        continue;
      }
      room.status = "starting";
      room.error = null;
      const boot = this.boot(room);
      room._boot = boot;
      boot.catch((error) => console.error("queued room failed", error.message));
    }
  }

  async finish(room) {
    const wasLive = room.status === "live" || room.status === "starting";
    const ranked = Boolean(room.recording?.ranked && room.matchId);
    const matchId = room.matchId;
    const containerName = room.containerName;

    if (wasLive) {
      await this.docker.stopRecording(room).catch(() => {});
    }

    let recordingPath = null;
    if (ranked && wasLive) {
      recordingPath = path.join(os.tmpdir(), `ps1-${room.code}-match.mp4`);
      try {
        await this.docker.pullRecording({ ...room, containerName }, recordingPath);
      } catch (error) {
        console.error(`pull recording failed for ${room.code}:`, error.message);
        recordingPath = null;
      }
    }

    room.status = "ended";
    room.recording = { ...(room.recording || {}), active: false };
    await this.docker.stop(room);

    if (ranked && matchId && this.liga?.enabled) {
      try {
        if (recordingPath && fs.existsSync(recordingPath)) {
          await this.liga.uploadRecording(matchId, recordingPath, `${room.code}.mp4`);
          room.recording = { ...(room.recording || {}), uploaded: true, ranked: true };
        } else {
          room.recording = { ...(room.recording || {}), uploaded: false, ranked: false };
          await this.liga.patchMatch(matchId, {
            status: "cancelled",
            notes: "Recording missing — match does not count.",
          });
        }
      } catch (error) {
        console.error(`liga finish sync failed for ${room.code}:`, error.message);
        room.recording = { ...(room.recording || {}), uploaded: false, ranked: false };
        try {
          await this.liga.patchMatch(matchId, {
            status: "cancelled",
            notes: `Recording upload failed — match does not count. (${String(error.message).slice(0, 180)})`,
          });
        } catch (patchError) {
          console.error(`liga cancel after upload fail:`, patchError.message);
        }
      } finally {
        if (recordingPath) fs.unlink(recordingPath, () => {});
      }
    }
  }

  async syncTokens(room) {
    if (room.status !== "live") return;
    await this.docker.pushTokens(room, selkiesTokenBody(room.members));
  }

  mediaReady(room) {
    if (!this.config.requireMedia) return true;
    const system = String(room.game.system || "ps1").toLowerCase();
    const gamesDir = system === "ps2" ? this.config.gamesDirPs2 : this.config.gamesDir;
    const filePath = path.join(gamesDir, room.game.file);
    return fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
  }

  touch(room) {
    room.lastActivity = this.now();
  }

  requireRoom(code) {
    const room = this.rooms.get(String(code || "").toUpperCase());
    if (!room) throw new LobbyError(404, "No room with that code.");
    return room;
  }

  requireMember(room, token) {
    const member = room.members.find((item) => item.token === token);
    if (!member) throw new LobbyError(403, "That invite is not valid for this room.");
    return member;
  }

  async getStandingsForGame(gameId) {
    const game = this.games.get(gameId);
    if (!game) throw new LobbyError(404, "That game is not available.");
    const ref = this.ligaRefForGame(game);
    if (!ref.slug && !ref.id) {
      return { ligaId: null, slug: null, title: null, rows: [], message: "No league for this game" };
    }
    if (!this.liga?.enabled) {
      return { ligaId: null, slug: ref.slug, title: null, rows: [], message: "League sync is not configured." };
    }
    try {
      return await this.liga.getStandings(ref);
    } catch (error) {
      const message = error.message || "Could not load standings.";
      // Soft-fail for UI: home still renders; table shows why.
      if (!error.status || error.status >= 500 || /fetch failed|Cannot reach WordPress/i.test(message)) {
        return {
          ligaId: null,
          slug: ref.slug,
          title: null,
          rows: [],
          message: message.includes("Cannot reach")
            ? message
            : `Standings unavailable (${message}). Check MAMP / liga-cms.`,
        };
      }
      throw new LobbyError(error.status || 502, message);
    }
  }

  memberView(room, token) {
    const member = room.members.find((item) => item.token === token);
    return {
      code: room.code,
      game: { id: room.game.id, title: room.game.title },
      status: room.status,
      error: room.error,
      players: room.members
        .filter((item) => item.role === "player")
        .map((item) => ({
          slot: item.slot,
          nickname: item.nickname,
          wpUserId: item.wpUserId || null,
        })),
      spectators: room.members
        .filter((item) => item.role === "spectator")
        .map((item) => ({ nickname: item.nickname })),
      you: member
        ? {
          slot: member.slot,
          role: member.role,
          nickname: member.nickname,
          wpUserId: member.wpUserId || null,
        }
        : null,
      canStream: room.status === "live" && Boolean(room.hostPort),
      recording: {
        active: Boolean(room.recording?.active),
        required: Boolean(room.recording?.required ?? this.roomIsRanked(room)),
        ranked: Boolean(room.recording?.ranked),
        uploaded: Boolean(room.recording?.uploaded),
      },
      matchId: room.matchId || null,
      rankedRequired: this.roomIsRanked(room),
      freeNugget: Boolean(room.freeNugget),
      ligaId: room.ligaId || null,
      ligaSlug: room.ligaSlug || null,
      token,
    };
  }

  withLock(fn) {
    const run = this._lock.then(fn, fn);
    this._lock = run.then(() => {}, () => {});
    return run;
  }
}
