const app = document.querySelector("#app");
const title = document.querySelector("#title");
const lede = document.querySelector("#lede");
const live = document.createElement("div");
live.setAttribute("aria-live", "polite");
live.className = "sr";
document.body.append(live);

const sessionKey = "ps1-room-session";
const lobbyAuthKey = "ps1-lobby-auth";
const padReadyKey = "ps1-pad-ready";

let controllerBar = null;
let focusKeepAlive = null;
let rankedRequired = true;

function say(message) {
  live.textContent = message;
}

function session() {
  try {
    return JSON.parse(sessionStorage.getItem(sessionKey) || "null");
  } catch {
    return null;
  }
}

function saveSession(value) {
  sessionStorage.setItem(sessionKey, JSON.stringify(value));
}

function clearSession() {
  sessionStorage.removeItem(sessionKey);
  sessionStorage.removeItem(padReadyKey);
}

function lobbyAuth() {
  try {
    return JSON.parse(sessionStorage.getItem(lobbyAuthKey) || "null");
  } catch {
    return null;
  }
}

function saveLobbyAuth(value) {
  sessionStorage.setItem(lobbyAuthKey, JSON.stringify(value));
}

function clearLobbyAuth() {
  sessionStorage.removeItem(lobbyAuthKey);
}

async function api(path, options = {}) {
  const auth = lobbyAuth();
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(auth?.sessionToken ? { "x-lobby-session": auth.sessionToken } : {}),
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body;
}

function slotLabel(slot, role) {
  if (role === "spectator" || slot == null) return "Watching";
  return `Pad ${slot}`;
}

function statusText(room) {
  if (room.error) return room.error;
  if (room.status === "queued") return "Both machines are busy. This room starts when one frees up.";
  if (room.status === "starting") return "Starting the match.";
  if (room.status === "live" && room.recording?.active) {
    return "Match is live. Recording in progress. Confirm your pad, then Focus stream.";
  }
  if (room.status === "live" && room.canStream) {
    return "Match is live. Confirm your pad below, then Focus stream.";
  }
  if (room.status === "live") return "The room is up. The picture appears when this server is running a match container.";
  if (room.status === "ended" && room.recording?.ranked === false && room.recording?.required) {
    return "Match ended. It did not count for the league (recording missing or failed).";
  }
  if (room.status === "ended") return "This match has ended.";
  return "Share the code. Use the controller bar to test your pad before starting.";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));
}

function stopControllerBar() {
  if (controllerBar) {
    controllerBar.destroy();
    controllerBar = null;
  }
  if (focusKeepAlive) {
    clearInterval(focusKeepAlive);
    focusKeepAlive = null;
  }
}

function startControllerBar(room) {
  stopControllerBar();
  if (room.you.role === "spectator") return;
  if (!window.Ps1ControllerBar) return;
  controllerBar = window.Ps1ControllerBar.createControllerBar({
    onReadyChange(ready, seen) {
      if (ready) sessionStorage.setItem(padReadyKey, seen.id || "ready");
      else sessionStorage.removeItem(padReadyKey);
    },
  });
  controllerBar.bind();
}

function focusStreamFrame() {
  const frame = app.querySelector("#stage-frame iframe");
  if (!frame) return;
  frame.focus();
  try {
    frame.contentWindow?.focus();
  } catch {
    // ignore
  }
  try {
    frame.contentWindow?.postMessage({ type: "gamepadControl", enabled: true }, "*");
  } catch {
    // ignore
  }
}

function startFocusKeepAlive() {
  if (focusKeepAlive) clearInterval(focusKeepAlive);
  focusKeepAlive = setInterval(() => {
    const frame = app.querySelector("#stage-frame iframe");
    if (!frame || document.activeElement === frame) return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || tag === "BUTTON") return;
    try {
      frame.contentWindow?.postMessage({ type: "gamepadControl", enabled: true }, "*");
    } catch {
      // ignore
    }
  }, 2000);
}

function authBarHtml() {
  const auth = lobbyAuth();
  if (auth) {
    return `<section class="panel auth-bar">
      <p>Signed in as <strong>${escapeHtml(auth.displayName)}</strong> (${escapeHtml(auth.email)})</p>
      <div class="actions">
        <button type="button" class="secondary" id="logout">Log out</button>
      </div>
    </section>`;
  }
  return `<section class="panel auth-bar">
    <h2 class="panel-title">Register to play</h2>
    <p class="hint">Both Pad 1 and Pad 2 need a liga.gamer.free account before a ranked match.</p>
    <div class="auth-grid">
      <form id="register">
        <label>Display name <input name="displayName" required maxlength="24" autocomplete="nickname"></label>
        <label>Email <input name="email" type="email" required autocomplete="email"></label>
        <label>Password <input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
        <button type="submit">Create account</button>
      </form>
      <form id="login">
        <label>Email <input name="email" type="email" required autocomplete="email"></label>
        <label>Password <input name="password" type="password" required autocomplete="current-password"></label>
        <button type="submit">Log in</button>
      </form>
    </div>
  </section>`;
}

function wireAuthBar() {
  const logout = app.querySelector("#logout");
  if (logout) {
    logout.addEventListener("click", () => {
      clearLobbyAuth();
      clearSession();
      location.hash = "#/";
      show();
    });
  }
  const register = app.querySelector("#register");
  if (register) {
    register.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(event.target);
      try {
        const auth = await api("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({
            displayName: data.get("displayName"),
            email: data.get("email"),
            password: data.get("password"),
          }),
        });
        saveLobbyAuth(auth);
        say(`Welcome, ${auth.displayName}.`);
        show();
      } catch (err) {
        say(err.message);
      }
    });
  }
  const login = app.querySelector("#login");
  if (login) {
    login.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(event.target);
      try {
        const auth = await api("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({
            email: data.get("email"),
            password: data.get("password"),
          }),
        });
        saveLobbyAuth(auth);
        say(`Welcome back, ${auth.displayName}.`);
        show();
      } catch (err) {
        say(err.message);
      }
    });
  }
}

function renderHome(games, error) {
  stopControllerBar();
  const auth = lobbyAuth();
  title.textContent = "Play Tekken 3 together";
  lede.textContent = rankedRequired
    ? "Register to play, create a room, and both pads drive the ranked league match. The match is recorded on the server for admin review."
    : "Create a room, share the code, and both players use their own gamepad.";
  const options = games.map((game) => `<option value="${escapeHtml(game.id)}">${escapeHtml(game.title)}</option>`).join("");
  const locked = rankedRequired && !auth;
  app.innerHTML = `
    ${authBarHtml()}
    <section class="panel" ${locked ? "hidden" : ""}>
      <form id="create">
        <label>Nickname <input name="nickname" required maxlength="24" autocomplete="nickname" value="${escapeHtml(auth?.displayName || "")}"></label>
        <label>Game <select name="gameId">${options}</select></label>
        <button type="submit">Create room</button>
      </form>
    </section>
    <section class="panel" ${locked ? "hidden" : ""}>
      <form id="join">
        <label>Nickname <input name="nickname" required maxlength="24" autocomplete="nickname" value="${escapeHtml(auth?.displayName || "")}"></label>
        <label>Room code <input name="code" required maxlength="6" autocapitalize="characters" spellcheck="false"></label>
        <button type="submit">Join room</button>
      </form>
    </section>
    ${locked ? `<p class="hint">Register or log in above to create or join a ranked room.</p>` : ""}
    ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ""}
  `;
  wireAuthBar();
  const create = app.querySelector("#create");
  if (create) {
    create.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(event.target);
      try {
        const room = await api("/api/rooms", {
          method: "POST",
          body: JSON.stringify({ nickname: data.get("nickname"), gameId: data.get("gameId") }),
        });
        saveSession({ code: room.code, token: room.token });
        location.hash = `#/room/${room.code}`;
      } catch (err) {
        renderHome(games, err.message);
        say(err.message);
      }
    });
  }
  const join = app.querySelector("#join");
  if (join) {
    join.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(event.target);
      const code = String(data.get("code") || "").trim().toUpperCase();
      try {
        const room = await api(`/api/rooms/${encodeURIComponent(code)}/join`, {
          method: "POST",
          body: JSON.stringify({ nickname: data.get("nickname") }),
        });
        saveSession({ code: room.code, token: room.token });
        location.hash = `#/room/${room.code}`;
      } catch (err) {
        renderHome(games, err.message);
        say(err.message);
      }
    });
  }
}

let painted = "";

function roomSignature(room) {
  return JSON.stringify({
    code: room.code,
    status: room.status,
    error: room.error,
    canStream: room.canStream,
    players: room.players,
    spectators: room.spectators,
    you: room.you,
    recording: room.recording,
    matchId: room.matchId,
  });
}

function padPanel(room) {
  if (!window.Ps1ControllerBar) {
    return `<section class="panel pad-panel"><p class="error">Controller bar failed to load.</p></section>`;
  }
  return window.Ps1ControllerBar.panelHtml({
    slotLabel: escapeHtml(slotLabel(room.you.slot, room.you.role)),
    spectator: room.you.role === "spectator",
  });
}

function recordingBadge(room) {
  if (!room.recording?.required) return "";
  if (room.recording.active) {
    return `<p class="record-badge active" role="status">Recording in progress</p>`;
  }
  if (room.status === "live" && !room.recording.ranked) {
    return `<p class="record-badge warn" role="status">Not ranked — recording failed</p>`;
  }
  if (room.status === "ended" && room.recording.ranked) {
    return `<p class="record-badge" role="status">Recording sent for league review</p>`;
  }
  return "";
}

function renderRoom(room) {
  const signature = roomSignature(room);
  if (signature === painted && app.querySelector("#stage")) {
    const badge = app.querySelector(".record-badge");
    if (badge && room.recording?.active) badge.classList.add("active");
    if (room.canStream) showStream(room);
    return;
  }
  painted = signature;
  title.textContent = room.game.title;
  lede.textContent = statusText(room);
  const you = slotLabel(room.you.slot, room.you.role);
  const pad1 = room.players.find((player) => player.slot === 1);
  const pad2 = room.players.find((player) => player.slot === 2);
  const watchers = room.spectators.map((person) => escapeHtml(person.nickname)).join(", ") || "None yet";
  app.innerHTML = `
    <section class="panel">
      <p>Room code <code class="code">${escapeHtml(room.code)}</code></p>
      <p class="hint">You are ${escapeHtml(you)}${room.you.wpUserId ? ` · liga #${room.you.wpUserId}` : ""}.</p>
      ${recordingBadge(room)}
      <div class="slots">
        <div class="slot"><strong>Pad 1</strong> ${pad1 ? escapeHtml(pad1.nickname) : "Waiting"}</div>
        <div class="slot"><strong>Pad 2</strong> ${pad2 ? escapeHtml(pad2.nickname) : "Waiting"}</div>
      </div>
      <p class="watch"><strong>Watching</strong> ${watchers}</p>
      <div class="actions">
        <button type="button" id="copy">Copy code</button>
        ${room.status === "ended" || room.status === "live" ? "" : `<button type="button" id="play">${room.status === "queued" ? "Waiting for a machine" : room.status === "starting" ? "Starting" : "Start match"}</button>`}
        ${room.you.slot === 1 && room.status !== "ended" ? `<button type="button" class="secondary" id="end">End match</button>` : ""}
        <button type="button" class="secondary" id="leave">Leave</button>
      </div>
      ${room.error ? `<p class="error" role="alert">${escapeHtml(room.error)}</p>` : ""}
    </section>
    ${padPanel(room)}
    <section class="panel stage-panel" id="stage" ${room.canStream ? "" : "hidden"}>
      <div class="actions">
        <button type="button" id="focus-stream">Focus stream</button>
        <button type="button" class="secondary" id="fullscreen">Fullscreen</button>
      </div>
      <p class="hint">Focus the stream so Selkies can read your pad. You are ${escapeHtml(you)}.</p>
      <div class="stage" id="stage-frame">
        <iframe title="${escapeHtml(room.game.title)} match picture" allow="gamepad *; fullscreen *; autoplay *" tabindex="0"></iframe>
      </div>
    </section>
  `;
  say(`${room.game.title}. ${you}. ${statusText(room)}`);
  startControllerBar(room);
  app.querySelector("#copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(room.code);
      say("Room code copied.");
    } catch {
      say(`Room code ${room.code}`);
    }
  });
  const play = app.querySelector("#play");
  if (play) {
    play.addEventListener("click", () => {
      if (room.you.role === "player" && !(controllerBar?.isReady() || sessionStorage.getItem(padReadyKey))) {
        const confirmed = window.confirm("Pad not Ready yet (need a face button and a stick). Start anyway?");
        if (!confirmed) return;
      }
      startMatch(room.code);
    });
  }
  const end = app.querySelector("#end");
  if (end) {
    end.addEventListener("click", async () => {
      const current = session();
      try {
        const next = await api(`/api/rooms/${room.code}/end`, {
          method: "POST",
          headers: { authorization: `Bearer ${current.token}` },
          body: "{}",
        });
        renderRoom(next);
      } catch (err) {
        say(err.message);
      }
    });
  }
  app.querySelector("#leave").addEventListener("click", async () => {
    const current = session();
    painted = "";
    stopControllerBar();
    if (current?.code && current?.token) {
      try {
        await api(`/api/rooms/${current.code}/leave`, {
          method: "POST",
          headers: { authorization: `Bearer ${current.token}` },
          body: "{}",
        });
      } catch {
        // Room may already be gone; still leave the UI.
      }
    }
    clearSession();
    location.hash = "#/";
  });
  const focus = app.querySelector("#focus-stream");
  if (focus) {
    focus.addEventListener("click", () => {
      focusStreamFrame();
      say("Stream focused. Press buttons on your pad to move.");
    });
  }
  const fullscreen = app.querySelector("#fullscreen");
  if (fullscreen) {
    fullscreen.addEventListener("click", async () => {
      const box = document.querySelector("#stage-frame");
      if (!box) return;
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else {
          await box.requestFullscreen();
          focusStreamFrame();
        }
      } catch (err) {
        say(err.message || "Fullscreen was blocked.");
      }
    });
  }
  const stage = app.querySelector("#stage-frame");
  if (stage) {
    stage.addEventListener("pointerdown", () => focusStreamFrame());
  }
  if (room.canStream) showStream(room);
}

function showStream(room) {
  const stage = app.querySelector("#stage");
  const frame = stage?.querySelector("iframe");
  if (!stage || !frame) return;
  const current = session();
  stage.hidden = false;
  const src = `/streams/${room.code}/?token=${encodeURIComponent(current.token)}`;
  if (frame.getAttribute("src") !== src) frame.src = src;
  frame.addEventListener("load", () => {
    focusStreamFrame();
  // Pad 2 is also a Selkies controller (slot 2). Forcing pipelineControl video
  // on both clients used to race START_VIDEO before Pad 1 owned primary and
  // left Pad 2 on "Waiting for stream...". Only Pad 1 nudges video; audio both.
  if (room.you?.slot === 1) {
    frame.contentWindow?.postMessage({ type: "pipelineControl", pipeline: "video", enabled: true }, "*");
  }
  frame.contentWindow?.postMessage({ type: "pipelineControl", pipeline: "audio", enabled: true }, "*");
    startFocusKeepAlive();
  }, { once: true });
  startFocusKeepAlive();
}

async function startMatch(code) {
  const current = session();
  try {
    const room = await api(`/api/rooms/${code}/play`, {
      method: "POST",
      headers: { authorization: `Bearer ${current.token}` },
      body: "{}",
    });
    renderRoom(room);
  } catch (err) {
    say(err.message);
  }
}

async function show() {
  const hash = location.hash || "#/";
  const roomHash = hash.match(/^#\/room\/([A-Za-z0-9]+)$/);
  if (!roomHash) {
    painted = "";
    stopControllerBar();
    try {
      const payload = await api("/api/games");
      rankedRequired = Boolean(payload.rankedRequired);
      renderHome(payload.games, "");
    } catch (err) {
      app.innerHTML = `<p class="error" role="alert">${escapeHtml(err.message)}</p>`;
    }
    return;
  }
  const current = session();
  if (!current || current.code !== roomHash[1].toUpperCase()) {
    location.hash = "#/";
    return;
  }
  try {
    const room = await api(`/api/rooms/${current.code}`, {
      headers: { authorization: `Bearer ${current.token}` },
    });
    renderRoom(room);
  } catch (err) {
    clearSession();
    location.hash = "#/";
    say(err.message);
  }
}

window.addEventListener("hashchange", () => {
  show();
});

setInterval(() => {
  if (location.hash.startsWith("#/room/")) show();
}, 3000);

show();
