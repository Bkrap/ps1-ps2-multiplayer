# PS1 rooms

Two people play Tekken 3 from a browser. The match runs on one VPS. Each room is its own DuckStation session. Both players see the same split-screen picture. Pad 1 and Pad 2 are different people. Extra people in the room can watch, and their pads do nothing.

There is a ranked path for Tekken 3: both players **Register to play** against liga.gamer.free, the room records the match on the server, and an admin scores the `mec` in WordPress. See `docs/LIGA_SYNC.md`. Moonlight plus Sunshine remains the fallback described in `cloud-coop-ps1-spec.md` if browser streaming is too late for a real match.

## Players

1. Open the site (use **https** on LAN).
2. **Register to play** or log in (required for ranked).
3. Enter a nickname. Create a room, or join with a code.
4. Plug in a gamepad. Firefox is the known-good browser until Chrome gamepad work in `docs/V1.2.md` lands.
5. Pad 1 presses **Start match**. Pad 2 joins the same code.
6. When ranked recording is healthy, the lobby shows **Recording in progress**.
7. Click the picture, then press a button on the pad. You only drive your own pad.
8. Pad 1 ends the match; the recording is uploaded for league review.
9. A third person who joins watches. They cannot move either fighter.

Share the room code. That is the invite.

## Operator

Ubuntu 24.04 VPS, 6 vCPU, 16 GB, no GPU. From a checkout of this repo, as root:

```bash
deploy/setup-vps.sh play.example.com you@example.com
```

The script installs Docker, nginx, fail2ban, and a firewall that opens 22, 80, and 443. It builds the room image, starts the lobby, and requests a certificate when you pass a domain and an email.

Then copy your own files:

- `/var/lib/ps1-rooms/games/tekken3.cue` and the `.bin` files that cue names
- `/var/lib/ps1-rooms/bios/` — your own dumped PS1 BIOS

```bash
chmod 644 /var/lib/ps1-rooms/games/* /var/lib/ps1-rooms/bios/*
systemctl restart ps1-lobby
```

`MAX_ROOMS` starts at **2**. After two matches are actually running:

```bash
scripts/capacity.sh
systemctl restart ps1-lobby
```

If those two rooms use more CPU than the box can spare, the script sets `MAX_ROOMS=1` in `.env`. Do not raise it past what that measurement holds. Further rooms wait in a queue.

`scripts/pad-gate.sh` checks that Pad 1, Pad 2, and spectators are wired to different inputs. Run the browser steps it prints before inviting anyone.

Each match container is limited to about 2.5 CPUs and 4 GB. Video is software x264 at 1280×720. A Germany VPS will feel later than Tekken on a local console. Get the shared match stable before chasing bitrate. The starting encoder CRF is 28, set in `room-image/Dockerfile`.

An empty room shuts its container down after 10 minutes so a closed browser does not hold a machine.

## Add a game later

Add an enabled entry to `games/catalog.yaml` with a file name inside the games directory. Leave the disc image on the server. Do not commit it.

## Run locally (LAN + real rooms)

One command (starts Docker if needed, then the lobby):

```bash
cd /Applications/MAMP/htdocs/ps1-multiplayer
npm start
```

Play at **https://192.168.x.x:8791** (IP is printed in the terminal). Accept the self-signed cert once. Disc + BIOS: `~/ps1-rooms/{games,bios}`.

```bash
npm run build    # rebuild room image after Dockerfile / scripts change
npm run preview  # UI only, no Docker / emulator
npm test
```

## Local lobby preview

```bash
cd lobby
npm ci
npm run preview
```

Preview mode has no emulator. It is only for the room list, the codes, and the queue. Ranked sync setup: `docs/LIGA_SYNC.md` and `lobby/env.liga.example`.
