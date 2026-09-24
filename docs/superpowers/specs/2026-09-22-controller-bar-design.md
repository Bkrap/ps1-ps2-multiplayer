# Controller settings bar (physical pads)

Date: 2026-09-22

## Goal
Both Pad 1 and Pad 2 get a DualShock-style live-test bar before/during a match. Physical pads only, fixed standard mapping (no press-to-bind). In-match input stays Selkies → virtual joystick → DuckStation.

## Approach
1. Lobby UI uses [gamepad.js](https://github.com/neogeek/gamepad.js) (MIT) to poll the browser Gamepad API and light a DualShock diagram.
2. **Ready** when at least one face button and one stick have responded.
3. Match input delivery: keep Selkies gamepad path; force joystick interposer `LD_PRELOAD` on DuckStation; keep the stream iframe focused after Ready / Focus stream.

## Non-goals
Touch/virtual pads, per-button remapping, DuckStation settings.ini edits from the browser.
