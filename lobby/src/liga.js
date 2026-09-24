import { readFileSync } from "node:fs";
import { File } from "node:buffer";
import crypto from "node:crypto";

/**
 * WordPress liga.gamer.free sync client.
 * Uses Application Password Basic auth for match mutations;
 * register/login hit public liga/v1 routes.
 */
export function createLigaClient(config) {
  const base = String(config.ligaWpUrl || "").replace(/\/$/, "");
  const user = config.ligaWpUser || "";
  const pass = config.ligaWpAppPassword || "";
  const enabled = Boolean(base && user && pass && config.ligaTekken3Id);

  function authHeader() {
    const token = Buffer.from(`${user}:${pass}`, "utf8").toString("base64");
    return `Basic ${token}`;
  }

  async function request(path, { method = "GET", body, auth = false, formData } = {}) {
    if (!base) throw new Error("Liga WordPress URL is not configured.");
    const headers = {};
    if (auth) headers.authorization = authHeader();
    let payload;
    if (formData) {
      payload = formData;
    } else if (body !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const response = await fetch(`${base}/wp-json${path}`, { method, headers, body: payload });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { message: text.slice(0, 200) };
    }
    if (!response.ok) {
      const message = data.message || data.error || `Liga API ${response.status}`;
      const err = new Error(typeof message === "string" ? message : "Liga request failed.");
      err.status = response.status;
      throw err;
    }
    return data;
  }

  return {
    enabled,
    ligaId: Number(config.ligaTekken3Id) || 0,

    async register({ email, password, displayName }) {
      return request("/liga/v1/register", {
        method: "POST",
        body: { email, password, displayName },
      });
    },

    async login({ email, password }) {
      return request("/liga/v1/login", {
        method: "POST",
        body: { email, password },
      });
    },

    async createMatch({ homeUserId, awayUserId, roomCode, status = "scheduled", notes = "" }) {
      return request("/liga/v1/matches", {
        method: "POST",
        auth: true,
        body: {
          ligaId: this.ligaId,
          homeUserId,
          awayUserId,
          roomCode,
          status,
          notes,
        },
      });
    },

    async patchMatch(matchId, patch) {
      return request(`/liga/v1/matches/${matchId}`, {
        method: "PATCH",
        auth: true,
        body: patch,
      });
    },

    async uploadRecording(matchId, filePath, fileName = "match.mp4") {
      const form = new FormData();
      const file = new File([readFileSync(filePath)], fileName, { type: "video/mp4" });
      form.append("file", file);
      return request(`/liga/v1/matches/${matchId}/recording`, {
        method: "POST",
        auth: true,
        formData: form,
      });
    },
  };
}

export function createAuthStore() {
  const sessions = new Map();

  return {
    create({ wpUserId, displayName, email }) {
      const token = crypto.randomBytes(32).toString("base64url");
      sessions.set(token, {
        token,
        wpUserId: Number(wpUserId),
        displayName: String(displayName || ""),
        email: String(email || ""),
        createdAt: Date.now(),
      });
      return sessions.get(token);
    },
    get(token) {
      if (!token) return null;
      return sessions.get(token) || null;
    },
    require(token) {
      const session = this.get(token);
      if (!session) {
        const err = new Error("Log in to play ranked matches.");
        err.status = 401;
        throw err;
      }
      return session;
    },
  };
}
