# Liga sync (ranked matches)

Server-side bridge between the PS1 lobby and [liga.gamer.free](https://liga.gamer.free). Both pads **Register to play**, each live ranked match is recorded inside the room container (X11 + ffmpeg), and a `mec` post is created for admin scoring.

## Lobby environment

Set these on the host that runs `ps1-lobby` (systemd `EnvironmentFile`, or shell when developing). **Never commit the Application Password.**

| Variable | Example | Notes |
|---|---|---|
| `LIGA_WP_URL` | `https://liga.gamer.free` | WordPress site origin (no trailing slash) |
| `LIGA_WP_USER` | `ps1-sync` | Dedicated WP user with `edit_posts` (editor/admin) |
| `LIGA_WP_APP_PASSWORD` | *(Application Password)* | Generated in WP → Users → Profile → Application Passwords |
| `LIGA_TEKKEN3_ID` | `89` | Post ID of the Tekken 3 `liga` CPT (confirm in WP admin) |
| `LIGA_REQUIRE_AUTH` | `true` | When `true` and WP env is set, create/join require Register to play |

Copy `lobby/env.liga.example` and fill secrets locally. After any chat paste of a password: **rotate** the WP user password and create a fresh Application Password.

Local preview without league:

```bash
cd lobby
PREVIEW=true REQUIRE_MEDIA=false LIGA_REQUIRE_AUTH=false npm start
```

Ranked LAN (TLS on, liga configured):

```bash
cd lobby
export LIGA_WP_URL=https://liga.gamer.free
export LIGA_WP_USER=ps1-sync
export LIGA_WP_APP_PASSWORD='xxxx xxxx xxxx xxxx xxxx xxxx'
export LIGA_TEKKEN3_ID=89
npm start
```

## WordPress setup

1. Theme `liga-cms` loads `inc/liga/rest-sync.php` (namespace `liga/v1`).
2. Create user `ps1-sync` with capability to edit posts; generate an Application Password named `ps1-lobby`.
3. Confirm Tekken league post ID → `LIGA_TEKKEN3_ID`.
4. ACF Meč group includes `recording` (file) and status choice `pending_review`. Sync ACF JSON if needed (ACF → Sync).
5. Raise upload limits for match videos (`client_max_body_size`, `upload_max_filesize`, `post_max_size`) as needed.

### REST routes

- `POST /wp-json/liga/v1/register` — public; create subscriber
- `POST /wp-json/liga/v1/login` — public; validate credentials
- `POST /wp-json/liga/v1/matches` — Basic auth; create `mec` (`scheduled`)
- `POST /wp-json/liga/v1/matches/{id}/recording` — Basic auth; multipart `file`; sets `pending_review`
- `PATCH /wp-json/liga/v1/matches/{id}` — Basic auth; status / notes (lobby uses `cancelled` if recording missing)

## Match lifecycle

1. Pad 1 and Pad 2 register/login in the lobby → lobby session token (`X-Lobby-Session`).
2. Create / join room (gated when ranked is enabled).
3. Start match → room live → ffmpeg x11grab → if recording healthy, create `mec` with `home_user` / `away_user`.
4. If recording fails → match still playable but **not ranked** (UI badge + error).
5. Pad 1 ends match → stop ffmpeg → upload MP4 → status `pending_review`, or `cancelled` if file missing.

## Admin review flow

1. Open **Mečevi** in WP admin.
2. Open the match (title like `Alice vs Bob`); status **Čeka pregled**.
3. Download / play **Snimka meča**.
4. Set `score_home`, `score_away`, status **Odigran** (`played`).
5. Standings (`liga_get_standings`) only count `played` matches.

Do not rely on automatic scoring from video — the admin remains source of truth.

## Room image

Rebuild after pulling recording scripts:

```bash
docker build -t ps1-room:local room-image/
```

Scripts: `/defaults/record-start.sh`, `/defaults/record-stop.sh` → `/tmp/ps1-match.mp4`.
