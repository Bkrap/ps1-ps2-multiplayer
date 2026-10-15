# PS1 / PS2 multiplayer (`ps1-ps2-multiplayer`)

Two people play a **PS1 or PS2** game from a browser. The match runs in Docker on the host. Each room is its own emulator session (DuckStation or PCSX2). Both players see the same picture. Pad 1 and Pad 2 are different people; extras can watch.

| Mode | Login | League recording |
|---|---|---|
| **Play casual** | No | No |
| **Play ranked** | liga-cms account | Yes — **button is disabled** in this repo; forks cannot play ranked without a private liga-cms + secrets |

---

## Where are DuckStation and PCSX2?

**Not in this git repo.** They are downloaded when you build the Docker room image and live **inside the container**:

| Emulator | Built into image at | Source |
|---|---|---|
| DuckStation (PS1) | `/opt/duckstation/` | AppImage pulled in `room-image/Dockerfile` |
| PCSX2 (PS2) | `/opt/pcsx2/` | AppImage pulled in `room-image/Dockerfile` |

Duckstation: https://www.duckstation.org/
PCSX2: https://pcsx2.net/

Flow:

1. Host runs the **lobby** (Node on port 8791).
2. Create room → lobby starts a `ps1-room-*` Docker container from image `ps1-room:local`.
3. Disc + BIOS are **bind-mounted** from your machine (`~/ps1-rooms/...`) into the container.
4. Container runs Selkies (browser stream) + launches DuckStation or PCSX2 via `/defaults/launch-game.sh`.

You do **not** install DuckStation/PCSX2 on the host for this project. You need Docker, legal BIOS dumps, and your own game images.

---

## Hardware requirements

### Local (dev / LAN party)

| | Minimum | Comfortable |
|---|---|---|
| CPU | 4 cores (PS1 one room) | 6+ cores if PS2 or 2 rooms |
| RAM | 8 GB | 16 GB |
| Disk | ~5 GB for Docker image + space for ISOs | SSD preferred |
| GPU | Not required (software x264) | Optional; not used by default |
| Network | Same LAN; use **HTTPS** | Wired for the host if possible |

Per-room Docker limits (defaults in `scripts/run-local.sh`):

- PS1: ~3.5 CPUs / 3 GB RAM  
- PS2: ~4 CPUs / 6 GB RAM  

### VPS / dedicated host

Documented baseline: **Ubuntu 24.04**, **6 vCPU**, **16 GB RAM**, no GPU. Start with `MAX_ROOMS=1`. See Operator section below.

---

## Software requirements

- **Docker Desktop** (macOS/Windows) or Docker Engine (Linux)
- **Node.js 20+** (lobby)
- **npm**
- Legal **PS1 BIOS** (e.g. `SCPH1001.BIN`) and/or **PS2 BIOS** you own
- Your own **disc images** (`.cue`+`.bin` / `.iso` / `.chd`) — never commit these
- Browser: **Firefox** is the known-good gamepad path (Chrome work tracked in `docs/V1.2.md`)

Optional ranked only (private operators, not forks):

- WordPress **liga-cms** (e.g. MAMP `http://localhost:8888/liga-cms`)
- `lobby/.env.liga` with sync secret matching WP `LIGA_SYNC_SECRET`
- Details: `docs/LIGA_SYNC.md`

---

## Sensitive files — do this before first run

These must **never** be committed. `.gitignore` already covers them:

| File / path | What to do |
|---|---|
| `lobby/.env.liga` | Copy from `lobby/env.liga.example`, fill secrets locally |
| Root `.env` | Optional host overrides (`GAMES_DIR`, etc.) |
| `lobby/certs/*.pem` | Auto-generated TLS for local HTTPS — keep private |
| `bios/`, ROM/ISO/CUE/BIN/CHD | Keep under `~/ps1-rooms/` (see below), not in git |
| Any Application Password / `LIGA_WP_SYNC_SECRET` | Rotate if they were ever committed |

If you already tracked a BIOS or certs in an old clone:

```bash
git rm -r --cached bios lobby/certs/*.pem 2>/dev/null || true
# keep working copies on disk; only untrack from git
```

**Ranked will not work** for a fork until you also run liga-cms and configure matching secrets. Casual does not need that.

---

## Where to put games and BIOS (macOS / Linux / Windows)

Create these directories on the **host** (not inside the repo). Defaults come from `scripts/run-local.sh`:

### macOS / Linux

```text
~/ps1-rooms/games/        # PS1 .cue + every .bin the cue names (exact names)
~/ps1-rooms/bios/         # PS1 BIOS, e.g. SCPH1001.BIN
~/ps1-rooms/games-ps2/    # PS2 .iso / .chd
~/ps1-rooms/bios-ps2/     # PS2 BIOS dump you own
```

Examples:

```bash
mkdir -p ~/ps1-rooms/{games,bios,games-ps2,bios-ps2}
# then copy files into those folders
```

### Windows (Docker Desktop)

Use your user profile (Docker mounts this into Linux VMs):

```text
%USERPROFILE%\ps1-rooms\games\
%USERPROFILE%\ps1-rooms\bios\
%USERPROFILE%\ps1-rooms\games-ps2\
%USERPROFILE%\ps1-rooms\bios-ps2\
```

In Git Bash / PowerShell that is typically `C:\Users\<you>\ps1-rooms\...`.  
`run-local.sh` uses `$HOME/ps1-rooms/...` — under Git Bash, `$HOME` is your user directory.

Override any path:

```bash
export GAMES_DIR=/path/to/ps1-games
export BIOS_DIR=/path/to/ps1-bios
export GAMES_DIR_PS2=/path/to/ps2-games
export BIOS_DIR_PS2=/path/to/ps2-bios
```

### Catalog

Filenames alone go in `games/catalog.yaml` (`file: Exact Name.cue`). Restart the lobby after edits. Enable `system: ps2` rows only when PS2 media + BIOS are in place. Rebuild the room image once after pulling PCSX2 Dockerfile changes: `npm run build`.

---

## Local: start / restart / stop

```bash
cd /path/to/ps1-ps2-multiplayer
npm start
```

What `npm start` does (`scripts/run-local.sh`):

1. Ensures Docker is up  
2. Builds `ps1-room:local` if missing / stale  
3. Frees port **8791** and removes leftover `ps1-room-*` containers  
4. Loads `lobby/.env.liga` if present  
5. Starts the lobby on `0.0.0.0:8791` with **TLS**

```text
Local: https://127.0.0.1:8791
LAN:   https://192.168.x.x:8791
```

Accept the self-signed certificate once. On other devices use the **current** LAN IP from the log. **`http://` hangs — use https.**

### First screen

1. **Play casual** — no register/login; create/join rooms.  
2. **Play ranked** — **disabled**. Needs liga-cms auth + `LIGA_WP_*` secrets; public forks will not qualify.

### Useful scripts

| Command | What |
|---|---|
| `npm start` | Docker + real rooms + HTTPS lobby |
| `npm run build` | Rebuild `ps1-room:local` after `room-image/` changes |
| `npm run preview` | UI only (no emulator) |
| `npm test` | Lobby unit tests |

Stop: `Ctrl+C`, or:

```bash
lsof -t -nP -iTCP:8791 -sTCP:LISTEN | xargs kill
docker rm -f $(docker ps -aq --filter name=ps1-room) 2>/dev/null || true
```

---

## Ranked / liga (operators only)

Forks: skip this. Use **Play casual**.

1. Run liga-cms (WordPress).  
2. Copy `lobby/env.liga.example` → `lobby/.env.liga` and set at least:

```bash
LIGA_WP_URL=http://localhost:8888/liga-cms
LIGA_WP_SYNC_SECRET=...   # same as LIGA_SYNC_SECRET in wp-config.php
LIGA_REQUIRE_AUTH=true
```

3. Restart lobby. Log should show `liga sync: http://...`.  
4. Large uploads: PHP `post_max_size` / `upload_max_filesize` ≥ 256M.  

Server-side: create/join for ranked still require a lobby session when liga sync is enabled. The UI ranked button stays off so forks do not hit a half-configured path. Full bridge: `docs/LIGA_SYNC.md`.

---

## Operator (VPS)

```bash
deploy/setup-vps.sh play.example.com you@example.com
```

Then place media:

- `/var/lib/ps1-rooms/games/` + `bios/`  
- optional `/var/lib/ps1-rooms/games-ps2/` + `bios-ps2/`  

Checkout path example: `/opt/ps1-ps2-multiplayer`. Service name remains `ps1-lobby` / image `ps1-room:local` (internal Docker names; safe to leave).

```bash
cd /opt/ps1-ps2-multiplayer
npm run build
npm start
# or: systemctl enable --now ps1-lobby
```

`scripts/capacity.sh` after real load before raising `MAX_ROOMS`.  
`scripts/pad-gate.sh` checks Pad 1 / Pad 2 / spectator wiring.

---

## Common issues

| Symptom | Fix |
|---|---|
| Endless load on `http://…` | Use **https://** |
| Ranked button dead | Expected — use **Play casual**; ranked needs private liga-cms |
| Room stuck on **starting** | `docker logs ps1-room-…`; rebuild image |
| Blank stream / no game | Cue `.bin` name mismatch; media under `~/ps1-rooms/games/` |
| `liga sync: disabled` | Fill `lobby/.env.liga` (operators only) |
| Game missing from dropdown | `games/catalog.yaml` + restart lobby |

---

## License / media

You must own the rights to any BIOS and disc images you mount. This repo ships **no** ROMs and **no** emulator binaries in git — only the Dockerfile that fetches AppImages at **image build** time.
