import { readFileSync } from "node:fs";
import { File } from "node:buffer";
import crypto from "node:crypto";

/**
 * WordPress liga-cms sync client (headless liga/v1).
 * Mutations use either Application Password (Basic) or local sync secret header.
 * register/login/standings/ligas are public.
 */
export function createLigaClient(config) {
  const base = String(config.ligaWpUrl || "").replace(/\/$/, "");
  const user = config.ligaWpUser || "";
  const pass = config.ligaWpAppPassword || "";
  const syncSecret = String(config.ligaWpSyncSecret || "").trim();
  const hasBasic = Boolean(base && user && pass);
  const hasSecret = Boolean(base && syncSecret);
  const defaultSlug = String(config.ligaTekken3Slug || "tekken-3");
  const defaultId = Number(config.ligaTekken3Id) || 0;
  // Enabled when WP URL + (Application Password OR local sync secret).
  const enabled = hasBasic || hasSecret;

  const ligaCache = new Map();

  function applyAuth(headers) {
    if (syncSecret) {
      headers["x-liga-sync-secret"] = syncSecret;
      return;
    }
    if (user && pass) {
      headers.authorization = `Basic ${Buffer.from(`${user}:${pass}`, "utf8").toString("base64")}`;
    }
  }

  async function request(path, { method = "GET", body, auth = false, formData } = {}) {
    if (!base) throw new Error("Liga WordPress URL is not configured.");
    const headers = {};
    if (auth) applyAuth(headers);
    let payload;
    if (formData) {
      payload = formData;
    } else if (body !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const response = await fetch(`${base}/wp-json${path}`, { method, headers, body: payload }).catch((error) => {
      const err = new Error(
        `Cannot reach WordPress at ${base} (${error.message}). Is MAMP running on :8888?`,
      );
      err.status = 502;
      throw err;
    });
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
    defaultSlug,
    defaultId,

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

    async resolveLiga({ slug, id } = {}) {
      const ligaId = Number(id) || 0;
      const ligaSlug = String(slug || "").trim();
      const cacheKey = ligaId ? `id:${ligaId}` : `slug:${ligaSlug || defaultSlug}`;
      if (ligaCache.has(cacheKey)) return ligaCache.get(cacheKey);

      let data;
      if (ligaId) {
        data = await request(`/liga/v1/ligas?id=${ligaId}`);
      } else {
        data = await request(`/liga/v1/ligas?slug=${encodeURIComponent(ligaSlug || defaultSlug)}`);
      }
      ligaCache.set(cacheKey, data);
      if (data?.id) ligaCache.set(`id:${data.id}`, data);
      if (data?.slug) ligaCache.set(`slug:${data.slug}`, data);
      return data;
    },

    async joinLiga({ ligaId, userId }) {
      return request(`/liga/v1/ligas/${ligaId}/join`, {
        method: "POST",
        auth: true,
        body: { userId },
      });
    },

    async getStandings({ slug, ligaId } = {}) {
      const params = new URLSearchParams();
      if (ligaId) params.set("ligaId", String(ligaId));
      else if (slug) params.set("slug", slug);
      else if (defaultId) params.set("ligaId", String(defaultId));
      else params.set("slug", defaultSlug);
      return request(`/liga/v1/standings?${params.toString()}`);
    },

    async createMatch({
      ligaId,
      homeUserId,
      awayUserId,
      roomCode,
      status = "scheduled",
      notes = "",
    }) {
      const resolvedId = Number(ligaId) || this.defaultId;
      if (!resolvedId) {
        const liga = await this.resolveLiga({ slug: this.defaultSlug });
        ligaId = liga.id;
      } else {
        ligaId = resolvedId;
      }
      return request("/liga/v1/matches", {
        method: "POST",
        auth: true,
        body: {
          ligaId,
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
