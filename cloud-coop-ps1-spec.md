# Cloud Co-op PS1 Streaming — Build Spec

## Goal
Two players, on two different residential IPs, play a local 2-player PS1 game
(starting with **Tekken 3**) against/with each other. The game runs on a
single Contabo VPS. Both players connect from their own PC as if they were
sitting on the same couch — one shared split-screen video feed, two separate
controller inputs mapped to Pad 1 / Pad 2.

This spec favors **existing open-source components** over custom code
wherever possible. The one genuinely unsolved piece is flagged explicitly
below (Risk #1) — everything else is "wire together known tools."

---

## Architecture

```
Player A (own PC) ──Moonlight──┐
                                 ├──> Sunshine (VPS) ──> DuckStation ──> Tekken 3
Player B (own PC) ──Moonlight──┘         │                (split-screen,
                                          │                 Pad1 + Pad2)
                                   channels = 2
                                   (shared session,
                                   both clients see
                                   the same stream)
```

- **VPS**: Contabo Cloud VPS, Ubuntu 24.04, EU datacenter (Germany), 6 vCPU /
  16GB RAM tier. No GPU needed for PS1.
- **Headless display**: Xvfb or `xserver-xorg-video-dummy` — no physical
  monitor attached, DuckStation renders into this virtual display.
- **Emulator**: [DuckStation](https://github.com/stenzek/duckstation) —
  purpose-built PS1 emulator, lightweight, scriptable via CLI, runs cleanly
  headless on Linux.
- **Streaming host**: [Sunshine](https://github.com/LizardByte/Sunshine) —
  open-source, self-hosted Moonlight-compatible streaming server. Captures
  the Xvfb framebuffer, encodes (software x264 since no GPU), streams to
  clients.
- **Streaming clients**: [Moonlight](https://github.com/moonlight-stream) —
  open-source, free, available on Windows/Mac/Linux/Android/iOS. Each player
  installs this on their own machine.
- **Shared-session config**: Sunshine's `channels` setting allows multiple
  Moonlight clients to connect to **one** running session simultaneously —
  this is the documented mechanism for co-op/shared-viewing use cases, and is
  the key setting this whole plan hinges on. Set `channels = 2` in
  `sunshine.conf`.
- **Join flow**: Sunshine has a built-in PIN-pairing web UI
  (`https://<vps-ip>:47990`). Each player opens that page once, requests
  pairing, and the host approves the PIN. This is the closest open-source
  equivalent to "go to a link, enter a code" — it is not as seamless as
  Parsec's single-click invite link (that part of Parsec is proprietary and
  not replicable 1:1 with open tools), but it's a one-time, few-minutes setup
  per player, not a recurring hassle.

---

## Fallback path (keep in your back pocket)

If the shared-session/controller-isolation approach (Risk #1 below) turns
out to be unreliable, there is a zero-server fallback:
**RetroArch + Beetle PSX core + RetroArch Netplay.** Each player runs
RetroArch locally with the same ROM, one hosts a Netplay room, inputs sync
peer-to-peer, no VPS or video streaming involved at all. Worth keeping
DuckStation and Beetle PSX/RetroArch both in the toolbox — don't rip Netplay
out even after the Sunshine path works, it's a good low-latency backup for
your own testing.

---

## Open-source components to use (don't rebuild these)

| Purpose | Tool | Link |
|---|---|---|
| PS1 emulator | DuckStation | https://github.com/stenzek/duckstation |
| PS1 emulator (Netplay fallback) | RetroArch + Beetle PSX | https://github.com/libretro/RetroArch |
| Streaming host | Sunshine | https://github.com/LizardByte/Sunshine |
| Streaming client | Moonlight | https://github.com/moonlight-stream |
| Headless display | Xvfb / xserver-xorg-video-dummy | apt package |
| Virtual controllers | Linux `uinput` (kernel) + `python-uinput` or `evdev` (if custom relay needed) | stdlib/apt |
| Reference multi-seat impl (if Sunshine's `channels` proves insufficient) | Wolf (games-on-whales) | https://github.com/games-on-whales/wolf |

---

## Build milestones (in order — don't skip the risk validation step)

1. **Provision VPS**: Ubuntu 24.04, Contabo 6 vCPU/16GB, EU region. Basic
   hardening (SSH key auth, ufw firewall, fail2ban).
2. **Headless display**: install Xvfb, confirm a test app (e.g. `glxgears`
   or `xeyes`) renders into it and can be screen-grabbed with `ffmpeg
   -f x11grab`.
3. **DuckStation**: install, load Tekken 3 ISO, confirm 2-player split-screen
   mode boots and runs correctly inside the Xvfb display (verify via VNC or
   a saved screenshot before moving on).
4. **Sunshine**: install, configure Tekken 3/DuckStation as a Sunshine "app"
   (launch command target), confirm a single Moonlight client can connect
   and play solo first.
5. **⚠️ RISK VALIDATION — do this before building anything else on top:**
   Set `channels = 2`, connect two Moonlight clients simultaneously (can be
   two devices on your own LAN for this test, doesn't need to be two real
   remote IPs yet). Confirm:
   - Both clients see the same split-screen video feed
   - Client A's controller drives Pad 1 only, Client B's controller drives
     Pad 2 only (no cross-talk, no both-clients-control-both-pads)

   **If controller isolation does NOT work cleanly out of the box**, this is
   the one piece needing custom code: a small relay service (Python +
   `python-uinput`, or Node + `node-uinput`) that listens to each Moonlight
   client's raw gamepad state and writes to two separate `uinput` virtual
   devices, bypassing Sunshine's built-in input pass-through. Check the
   Wolf project's approach to per-client `uinput` isolation as a reference
   before writing this from scratch.
6. **Encoding tuning**: software x264, `ultrafast` preset, `zerolatency`
   tune, target 720p60 at ~8–10 Mbps per stream (two streams = ~16–20 Mbps
   sustained upload from the VPS — confirm this against the VPS's port
   speed).
7. **Real remote test**: have two players connect from two actual separate
   IPs/locations (not LAN), measure input lag and video quality, adjust
   bitrate/resolution as needed.
8. **Pairing UX pass**: write a short one-page doc/README for your actual
   players — "install Moonlight, go to this IP, here's the PIN flow" — so
   the join process is copy-paste simple even though it's not a single
   clickable link.

---

## Known risks / things to validate early, not assume

1. **Controller isolation on a shared Sunshine session** (see Milestone 5)
   — the single biggest unknown. Sunshine's `channels` option is documented
   as supporting shared co-op sessions, but per-client Pad1/Pad2 mapping
   behavior should be verified hands-on before committing further time to
   this path.
2. **CPU headroom** for two concurrent software x264 encodes plus DuckStation
   on a 6 vCPU box — benchmark under real two-stream load, not just one.
3. **No true single-link join** — be upfront with your players that this is
   "install Moonlight once, pair once," not a URL they click and are
   instantly in.

---

## Server target (recap)

Contabo Cloud VPS — 6 vCPU / 16GB RAM, Ubuntu 24.04, EU (Germany)
datacenter, ≈ €10–11/month. No GPU needed for PS1-era titles.
