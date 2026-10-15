# Liga sync (ranked matches)

Server-side bridge between the PS1/PS2 lobby and WordPress `liga-cms` (local or [liga.gamer.free](https://liga.gamer.free)).

**Public forks:** the lobby first screen keeps **Play ranked** disabled. Without `lobby/.env.liga` + a real liga-cms, ranked create/join cannot succeed (`LIGA_REQUIRE_AUTH=true`). Use **Play casual** (no login).

**Operators with liga-cms:** both pads **Register / Log in**, the lobby auto-joins them to the game’s liga, each live ranked match is recorded inside the room container (X11 + ffmpeg), and a `mec` post is created for admin scoring.

Streaming / Pad 1–2 / Selkies stay on the room `Bearer` token only — liga auth does not touch `/streams/*`.

## Lobby environment

Set these on the host that runs `ps1-lobby` (shell when developing, or systemd `EnvironmentFile`). **Never commit the Application Password.**

| Variable | Example | Notes |
|---|---|---|
| `LIGA_WP_URL` | `http://localhost:8888/liga-cms` | WordPress site origin (no trailing slash) |
| `LIGA_WP_USER` | `you@email` | Optional with sync secret; required for Application Password Basic auth |
| `LIGA_WP_SYNC_SECRET` | *(random hex)* | **Preferred on HTTP localhost.** Must match `LIGA_SYNC_SECRET` in `wp-config.php` |
| `LIGA_WP_APP_PASSWORD` | *(Application Password)* | Optional; awkward on plain HTTP — use sync secret locally instead |
| `LIGA_TEKKEN3_SLUG` | `tekken-3` | Preferred: resolve liga by CPT slug |
| `LIGA_TEKKEN3_ID` | `0` | Optional numeric fallback when slug resolve is unavailable |
| `LIGA_REQUIRE_AUTH` | `true` | When `true` and WP sync is enabled, create/join require a lobby session |

### Localhost HTTP note

WordPress often disables Application Passwords without HTTPS. For MAMP/`localhost`:

1. `wp-config.php` defines `WP_ENVIRONMENT_TYPE=local` and `LIGA_SYNC_SECRET=...`
2. Theme enables Application Passwords on localhost anyway, **and** accepts header `X-Liga-Sync-Secret`
3. Lobby `.env.liga` sets the same value as `LIGA_WP_SYNC_SECRET` — no Application Password required

Copy `lobby/env.liga.example` → `lobby/.env.liga` and fill secrets locally (do not commit).

### Local MAMP / liga-cms

```bash
cd lobby
export LIGA_WP_URL=http://localhost:8888/liga-cms
export LIGA_WP_USER='your-wp-login@email'
export LIGA_WP_APP_PASSWORD='xxxx xxxx xxxx xxxx xxxx xxxx'
export LIGA_TEKKEN3_SLUG=tekken-3
export LIGA_REQUIRE_AUTH=true
# optional: source a private env file next to the example
# set -a; source .env.liga; set +a
npm start
```

Preview without league:

```bash
cd lobby
PREVIEW=true REQUIRE_MEDIA=false LIGA_REQUIRE_AUTH=false npm start
```

### Casual mode (no liga auth)

UI: **Play casual** → `POST /api/mode/casual` sets HttpOnly cookie `ps1_free_nugget=1` and unlocks create/join without WP auth. Those rooms skip ranked recording / `mec` creation.

Legacy: open once with `?free_nugget=1` (same cookie).

## WordPress setup

1. Theme `liga-cms` loads `inc/liga/rest-sync.php` (namespace `liga/v1`).
2. Create or use a WP user that can edit posts; generate an Application Password named e.g. `ps1-lobby`.
3. Publish a `liga` CPT with slug `tekken-3` (or set `LIGA_TEKKEN3_ID`).
4. ACF Meč group includes `recording` (file) and status choice `pending_review`. Sync ACF JSON if needed.
5. Raise upload limits for match videos as needed.

Local MAMP (required for ~45MB+ recordings): in the active PHP `php.ini` set
`upload_max_filesize=256M`, `post_max_size=256M`, `max_input_time=600`, then **Restart MAMP**.
A 45MB POST against `post_max_size=32M` makes PHP drop `$_FILES` → WP “Recording file is required” / notes look like a missing ACF file.

### REST routes

Public (no Application Password):

- `POST /wp-json/liga/v1/register` — create subscriber (no activation mail)
- `POST /wp-json/liga/v1/login` — validate credentials
- `GET /wp-json/liga/v1/ligas?slug=tekken-3` — resolve liga `{ id, title, slug, visibility }`
- `GET /wp-json/liga/v1/standings?slug=tekken-3` (or `?ligaId=`) — standings rows

Application Password (`edit_posts`):

- `POST /wp-json/liga/v1/ligas/{id}/join` — body `{ userId }`; append ACF `assigned_users` if missing
- `POST /wp-json/liga/v1/matches` — create `mec` (`scheduled`); **403** if home/away fail `liga_user_can_play`
- `POST /wp-json/liga/v1/matches/{id}/recording` — multipart `file`; sets `pending_review`
- `PATCH /wp-json/liga/v1/matches/{id}` — status / notes (lobby uses `cancelled` if recording missing)

## Lobby HTTP (browser-facing)

- `POST /api/auth/register` / `POST /api/auth/login` — proxy WP; then server-side `join` for the selected/default game liga
- `GET /api/standings?gameId=tekken3` — proxies WP standings (no secrets to the browser)
- `GET /api/games` — includes `authRequired` / `rankedRequired` / `freeNugget`
- Create/join require `X-Lobby-Session` when auth is on (unless free-nugget cookie)

Catalog games may set `ligaSlug` / `ligaId` (Tekken 3 → `tekken-3`). Games without a liga show “No league for this game”.

## Match lifecycle

1. Register/login → lobby session (`X-Lobby-Session`) → auto-join game liga.
2. Create / join room (gated when ranked is enabled).
3. Start match → room live → ffmpeg x11grab → if recording healthy, create `mec` with `home_user` / `away_user`.
4. If recording fails → match still playable but **not ranked**.
5. Pad 1 ends match → stop ffmpeg → upload MP4 → `pending_review`, or `cancelled` if file missing.

## Admin review flow

1. Open **Mečevi** in WP admin.
2. Open the match; status **Čeka pregled**.
3. Download / play **Snimka meča**.
4. Set scores, status **Odigran** (`played`).
5. Standings (`liga_get_standings`) only count `played` matches.

Do not rely on automatic scoring from video — the admin remains source of truth.

## Room image

Rebuild after pulling recording scripts:

```bash
docker build -t ps1-room:local room-image/
```

Scripts: `/defaults/record-start.sh`, `/defaults/record-stop.sh` → `/tmp/ps1-match.mp4`.
