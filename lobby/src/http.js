import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import httpProxy from "http-proxy";
import { LobbyError } from "./rooms.js";

const STATIC = {
  "/": "index.html",
  "/index.html": "index.html",
  "/styles.css": "styles.css",
  "/app.js": "app.js",
  "/controller-bar.js": "controller-bar.js",
  "/vendor/gamepad.js": "vendor/gamepad.js",
};

const SAFE_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...SAFE_HEADERS,
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 8192) {
        reject(new LobbyError(413, "Request is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new LobbyError(400, "Send JSON."));
      }
    });
    req.on("error", reject);
  });
}

function bearer(req, url) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  return url.searchParams.get("token") || "";
}

function parseCookies(req) {
  const raw = req.headers.cookie || "";
  const out = {};
  for (const part of raw.split(";")) {
    const split = part.indexOf("=");
    if (split === -1) continue;
    const key = part.slice(0, split).trim();
    const value = part.slice(split + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function streamToken(req, url, code) {
  return url.searchParams.get("token")
    || parseCookies(req)[`ps1_stream_${code}`]
    || "";
}

function streamCookie(code, token, secure) {
  const flags = [
    `ps1_stream_${code}=${encodeURIComponent(token)}`,
    `Path=/streams/${code}/`,
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=86400",
  ];
  if (secure) flags.push("Secure");
  return flags.join("; ");
}

function freeNuggetBypass(req) {
  return parseCookies(req).ps1_free_nugget === "1";
}

function freeNuggetCookie(secure, { clear = false } = {}) {
  const flags = [
    clear ? "ps1_free_nugget=" : "ps1_free_nugget=1",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    clear ? "Max-Age=0" : "Max-Age=86400",
  ];
  if (secure) flags.push("Secure");
  return flags.join("; ");
}

function streamParts(pathname) {
  const match = pathname.match(/^\/streams\/([A-Za-z0-9]+)(\/.*)?$/);
  if (!match) return null;
  return { code: match[1].toUpperCase(), rest: match[2] || "/" };
}

export function createServer({ lobby, config, tls, auth, liga }) {
  const secure = Boolean(tls);
  const proxy = httpProxy.createProxyServer({
    ws: true,
    xfwd: false,
    changeOrigin: true,
  });
  proxy.on("error", (_error, _req, res) => {
    if (res && typeof res.writeHead === "function" && !res.headersSent) {
      sendJson(res, 502, { error: "The match stream is not reachable." });
    }
  });
  // Selkies loads CSS/JS without ?token=. Stamp a path-scoped cookie on the
  // first authenticated HTML fetch so those follow-up requests are allowed.
  proxy.on("proxyRes", (proxyRes, req) => {
    const url = new URL(req.url || "/", "http://lobby.local");
    const stream = streamParts(url.pathname);
    const token = url.searchParams.get("token");
    if (!stream || !token || !lobby.authorizeStream(stream.code, token)) return;
    const cookie = streamCookie(stream.code, token, secure);
    const existing = proxyRes.headers["set-cookie"];
    if (!existing) proxyRes.headers["set-cookie"] = [cookie];
    else if (Array.isArray(existing)) proxyRes.headers["set-cookie"] = [...existing, cookie];
    else proxyRes.headers["set-cookie"] = [existing, cookie];
  });

  function lobbySession(req, body = {}) {
    return req.headers["x-lobby-session"]
      || body.sessionToken
      || "";
  }

  async function autoJoinDefaultLiga(session, gameId) {
    if (!session?.wpUserId || !lobby.ensureJoinedLiga) return;
    const game = lobby.games.get(gameId) || lobby.games.get("tekken3") || [...lobby.games.values()][0];
    if (!game) return;
    await lobby.ensureJoinedLiga(session, game);
  }

  const onRequest = async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://lobby.local");
      const stream = streamParts(url.pathname);

      if (req.method === "GET" && url.pathname === "/internal/stream-auth") {
        const original = new URL(req.headers["x-original-uri"] || "/", "http://lobby.local");
        const parts = streamParts(original.pathname);
        const token = parts ? streamToken(req, original, parts.code) : "";
        const allowed = parts && lobby.authorizeStream(parts.code, token);
        res.writeHead(allowed ? 204 : 403);
        res.end();
        return;
      }

      if (stream) {
        const token = streamToken(req, url, stream.code);
        if (!lobby.authorizeStream(stream.code, token)) {
          sendJson(res, 403, { error: "You cannot watch this match." });
          return;
        }
        const target = lobby.streamTarget(stream.code);
        if (!target) {
          sendJson(res, 503, { error: config.preview
            ? "Preview mode has no emulator. On the VPS this is the live picture."
            : "The match is still starting." });
          return;
        }
        proxy.web(req, res, { target });
        return;
      }

      if (req.method === "GET" && STATIC[url.pathname]) {
        const filePath = path.join(config.publicDir, STATIC[url.pathname]);
        const body = fs.readFileSync(filePath);
        const type = filePath.endsWith(".css")
          ? "text/css; charset=utf-8"
          : filePath.endsWith(".js")
            ? "text/javascript; charset=utf-8"
            : "text/html; charset=utf-8";
        const headers = { ...SAFE_HEADERS, "content-type": type, "cache-control": "no-store" };
        if ((url.pathname === "/" || url.pathname === "/index.html")
          && url.searchParams.get("free_nugget") === "1") {
          headers["set-cookie"] = freeNuggetCookie(secure);
        }
        res.writeHead(200, headers);
        res.end(body);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/games") {
        const nugget = freeNuggetBypass(req);
        const rankedAvailable = lobby.rankedEnabled();
        sendJson(res, 200, {
          games: lobby.listGames(),
          rankedRequired: nugget ? false : rankedAvailable,
          authRequired: nugget ? false : lobby.authRequired(),
          rankedAvailable,
          // Forks without liga-cms secrets cannot satisfy ranked auth.
          rankedPlayable: false,
          freeNugget: nugget,
        });
        return;
      }

      // Casual lobby: no liga login. Sets the free-play cookie used by create/join.
      if (req.method === "POST" && url.pathname === "/api/mode/casual") {
        res.writeHead(204, {
          ...SAFE_HEADERS,
          "set-cookie": freeNuggetCookie(secure),
          "cache-control": "no-store",
        });
        res.end();
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/mode/ranked") {
        // Ranked UI stays disabled for forks; clearing casual cookie only.
        res.writeHead(204, {
          ...SAFE_HEADERS,
          "set-cookie": freeNuggetCookie(secure, { clear: true }),
          "cache-control": "no-store",
        });
        res.end();
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/standings") {
        const gameId = url.searchParams.get("gameId") || "tekken3";
        sendJson(res, 200, await lobby.getStandingsForGame(gameId));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/auth/register") {
        if (!liga?.enabled) throw new LobbyError(503, "League sync is not configured. Set LIGA_WP_* in lobby/.env.liga.");
        const body = await readBody(req);
        const result = await liga.register({
          email: body.email,
          password: body.password,
          displayName: body.displayName || body.nickname,
        });
        const session = auth.create({
          wpUserId: result.userId,
          displayName: result.displayName,
          email: result.login,
        });
        try {
          await autoJoinDefaultLiga(session, body.gameId);
        } catch (error) {
          console.error("liga auto-join after register:", error.message);
        }
        sendJson(res, 201, {
          sessionToken: session.token,
          wpUserId: session.wpUserId,
          displayName: session.displayName,
          email: session.email,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/auth/login") {
        if (!liga?.enabled) throw new LobbyError(503, "League sync is not configured. Set LIGA_WP_* in lobby/.env.liga.");
        const body = await readBody(req);
        const result = await liga.login({
          email: body.email,
          password: body.password,
        });
        const session = auth.create({
          wpUserId: result.userId,
          displayName: result.displayName,
          email: result.login,
        });
        try {
          await autoJoinDefaultLiga(session, body.gameId);
        } catch (error) {
          console.error("liga auto-join after login:", error.message);
        }
        sendJson(res, 200, {
          sessionToken: session.token,
          wpUserId: session.wpUserId,
          displayName: session.displayName,
          email: session.email,
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/auth/me") {
        const token = lobbySession(req);
        const session = auth?.get(token);
        if (!session) {
          sendJson(res, 401, { error: "Not logged in." });
          return;
        }
        sendJson(res, 200, {
          sessionToken: session.token,
          wpUserId: session.wpUserId,
          displayName: session.displayName,
          email: session.email,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/rooms") {
        const body = await readBody(req);
        sendJson(res, 201, await lobby.createRoom({
          nickname: body.nickname,
          gameId: body.gameId,
          sessionToken: lobbySession(req, body),
          freeNugget: freeNuggetBypass(req),
        }));
        return;
      }

      const roomMatch = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9]+)(?:\/(join|play|end|leave))?$/);
      if (roomMatch) {
        const code = roomMatch[1];
        const action = roomMatch[2] || "";
        if (req.method === "GET" && !action) {
          sendJson(res, 200, await lobby.getRoom(code, bearer(req, url)));
          return;
        }
        if (req.method === "POST" && action === "join") {
          const body = await readBody(req);
          sendJson(res, 200, await lobby.joinRoom({
            code,
            nickname: body.nickname,
            sessionToken: lobbySession(req, body),
            freeNugget: freeNuggetBypass(req),
          }));
          return;
        }
        if (req.method === "POST" && action === "play") {
          sendJson(res, 200, await lobby.requestPlay(code, bearer(req, url)));
          return;
        }
        if (req.method === "POST" && action === "end") {
          sendJson(res, 200, await lobby.endRoom(code, bearer(req, url)));
          return;
        }
        if (req.method === "POST" && action === "leave") {
          sendJson(res, 200, await lobby.leaveRoom(code, bearer(req, url)));
          return;
        }
      }

      sendJson(res, 404, { error: "Not found." });
    } catch (error) {
      const status = error instanceof LobbyError ? error.status : (error.status || 500);
      const message = error instanceof LobbyError || error.status
        ? error.message
        : "Something went wrong.";
      if (status === 500) console.error(error);
      if (!res.headersSent) sendJson(res, status, { error: message });
    }
  };

  const server = tls
    ? https.createServer({ key: tls.key, cert: tls.cert }, onRequest)
    : http.createServer(onRequest);

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", "http://lobby.local");
    const stream = streamParts(url.pathname);
    const token = stream ? streamToken(req, url, stream.code) : "";
    if (!stream || !lobby.authorizeStream(stream.code, token)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const target = lobby.streamTarget(stream.code);
    if (!target) {
      socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    proxy.ws(req, socket, head, { target });
  });

  return server;
}
