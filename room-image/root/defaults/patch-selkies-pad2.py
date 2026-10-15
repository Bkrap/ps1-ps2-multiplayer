#!/usr/bin/env python3
"""Hardening Selkies for PS1 Pad 1 + Pad 2 (post-selkies.py refactor).

Upstream moved the data plane into websockets_mode.py and dropped selkies.py.
Pad 2 is a controller with slot 2 (lobby tokens) so it can drive a gamepad and
avoid the shared-viewer keyframe gate. Without this patch, Pad 2's SETTINGS
takes over `primary` and kills Pad 1.

Strategy (same as before):
- Secondary pads (slot >= 2) must NOT take over the primary display.
- Their SETTINGS path mirrors a soft viewer join (resolution + IDR only).
- START_VIDEO with no primary capture must not empty-reconfigure.
"""
from __future__ import annotations

from pathlib import Path

CANDIDATES = [
    Path("/lsiopy/lib/python3.13/site-packages/selkies/websockets_mode.py"),
    Path("/lsiopy/lib/python3.12/site-packages/selkies/websockets_mode.py"),
    Path("/lsiopy/lib/python3.11/site-packages/selkies/websockets_mode.py"),
]


def find_target() -> Path:
    for path in CANDIDATES:
        if path.is_file():
            return path
    # Last-resort scan under /lsiopy
    root = Path("/lsiopy")
    if root.is_dir():
        matches = list(root.glob("lib/python*/site-packages/selkies/websockets_mode.py"))
        if matches:
            return matches[0]
    raise SystemExit("websockets_mode.py not found under /lsiopy (Selkies layout changed?)")


HELPER = '''
def _ps1_peer_slot(perms):
    try:
        slot = perms.get("slot") if perms else None
        return int(slot) if slot is not None else None
    except (TypeError, ValueError):
        return None

def _ps1_is_secondary_pad(perms):
    slot = _ps1_peer_slot(perms)
    return slot is not None and slot >= 2
'''


def main() -> None:
    path = find_target()
    text = path.read_text()
    original = text

    if "_ps1_is_secondary_pad" not in text:
        anchor = "client_permissions: dict[Any, dict] = {}"
        if anchor not in text:
            raise SystemExit("client_permissions anchor missing")
        text = text.replace(anchor, HELPER + "\n" + anchor, 1)

    # Secondary pad SETTINGS: sync like a viewer, never steal primary.
    old_viewer = """                            if client_role == 'viewer':
                                data_logger.info(f"Viewer {remote_address} joins the 'primary' stream.")
                                if not initial_settings_processed:
                                    initial_settings_processed = True

                                if 'primary' not in self.capture_instances:
                                    await self._ensure_viewer_capture()

                                await self.broadcast_stream_resolution()

                                # Only the joining viewer is reset; the IDR opens its keyframe
                                # gate now, since an infinite GOP schedules none.
                                data_logger.debug("Sending PIPELINE_RESETTING to the new viewer and requesting an IDR.")
                                try:
                                    await websocket.send_str("PIPELINE_RESETTING primary")
                                except (ConnectionResetError, OSError, RuntimeError):
                                    pass
                                self._schedule_idr_for_display('primary')

                                continue"""

    new_viewer = """                            if client_role == 'viewer' or _ps1_is_secondary_pad(client_permissions.get(websocket)):
                                data_logger.info(f"Peer {remote_address} joins primary stream (viewer/secondary pad). Sync only — do not steal primary.")
                                if not initial_settings_processed:
                                    initial_settings_processed = True

                                if 'primary' not in self.capture_instances:
                                    await self._ensure_viewer_capture()

                                await self.broadcast_stream_resolution()

                                # Only this peer is reset; never broadcast a primary takeover.
                                data_logger.debug("Sending PIPELINE_RESETTING to secondary/viewer and requesting an IDR.")
                                try:
                                    await websocket.send_str("PIPELINE_RESETTING primary")
                                except (ConnectionResetError, OSError, RuntimeError):
                                    pass
                                self._schedule_idr_for_display('primary')

                                continue"""

    if old_viewer in text:
        text = text.replace(old_viewer, new_viewer)
    elif "Peer {remote_address} joins primary stream (viewer/secondary pad)" not in text:
        raise SystemExit("viewer SETTINGS block not found")

    # Belt-and-suspenders: if a secondary somehow reaches the kill path, ignore takeover.
    old_kill = """                            if display_id in ['primary', 'display2']:
                                existing_client_info = self.display_clients.get(display_id)
                                if existing_client_info:
                                    old_ws = existing_client_info.get('ws')
                                    if old_ws and old_ws is not websocket and not old_ws.closed:
                                        kill_reason = f"a new {display_id} client connected connection killed"
                                        old_ws_raddr = client_permissions.get(old_ws, {}).get("remote_address", "unknown")
                                        data_logger.warning(
                                            f"Killing old client for '{display_id}' at {old_ws_raddr}. Reason: {kill_reason}"
                                        )
                                        # Handed over before the close yields: the superseded
                                        # handler only tears down an entry its socket still owns,
                                        # and must not stop the capture being taken over.
                                        existing_client_info['ws'] = websocket
                                        try:
                                            # The superseded socket is the one most likely frozen;
                                            # unbounded, the takeover would hang here.
                                            await asyncio.wait_for(old_ws.send_str(f"KILL {kill_reason}"), timeout=2.0)
                                            await asyncio.wait_for(
                                                old_ws.close(code=1000, message=b"Superseded by new client"),
                                                timeout=2.0,
                                            )
                                        except asyncio.TimeoutError:
                                            _close_abandoned_ws(old_ws)
                                        except (ConnectionResetError, OSError, RuntimeError):
                                            data_logger.debug(f"Old client for '{display_id}' was already disconnected.")
                                        except Exception as e:
                                            data_logger.error(f"Error while killing old client for '{display_id}': {e}")"""

    new_kill = """                            if display_id in ['primary', 'display2']:
                                existing_client_info = self.display_clients.get(display_id)
                                if existing_client_info:
                                    old_ws = existing_client_info.get('ws')
                                    incoming = client_permissions.get(websocket) or {}
                                    if _ps1_is_secondary_pad(incoming):
                                        data_logger.info(
                                            f"Ignoring primary takeover from secondary pad {remote_address} (slot={incoming.get('slot')})."
                                        )
                                    elif old_ws and old_ws is not websocket and not old_ws.closed:
                                        kill_reason = f"a new {display_id} client connected connection killed"
                                        old_ws_raddr = client_permissions.get(old_ws, {}).get("remote_address", "unknown")
                                        data_logger.warning(
                                            f"Killing old client for '{display_id}' at {old_ws_raddr}. Reason: {kill_reason}"
                                        )
                                        # Handed over before the close yields: the superseded
                                        # handler only tears down an entry its socket still owns,
                                        # and must not stop the capture being taken over.
                                        existing_client_info['ws'] = websocket
                                        try:
                                            # The superseded socket is the one most likely frozen;
                                            # unbounded, the takeover would hang here.
                                            await asyncio.wait_for(old_ws.send_str(f"KILL {kill_reason}"), timeout=2.0)
                                            await asyncio.wait_for(
                                                old_ws.close(code=1000, message=b"Superseded by new client"),
                                                timeout=2.0,
                                            )
                                        except asyncio.TimeoutError:
                                            _close_abandoned_ws(old_ws)
                                        except (ConnectionResetError, OSError, RuntimeError):
                                            data_logger.debug(f"Old client for '{display_id}' was already disconnected.")
                                        except Exception as e:
                                            data_logger.error(f"Error while killing old client for '{display_id}': {e}")"""

    if old_kill in text:
        text = text.replace(old_kill, new_kill)
    elif "Ignoring primary takeover from secondary pad" not in text:
        raise SystemExit("primary kill block not found")

    # Shared START_VIDEO with zero capture: defer instead of empty reconfigure.
    old_start_fallback = """                                else:
                                    # A no-op with zero display clients.
                                    await self.reconfigure_displays()"""

    new_start_fallback = """                                else:
                                    # Critical: do NOT reconfigure with zero display clients —
                                    # that can stop pipelines and leave Pad 2 on Waiting for stream.
                                    data_logger.info(
                                        f"START_VIDEO from shared/secondary ({remote_address}) before primary ready — deferring (no empty reconfigure)."
                                    )
                                    try:
                                        await websocket.send_str("VIDEO_STARTED")
                                    except (ConnectionResetError, OSError, RuntimeError):
                                        pass"""

    if old_start_fallback in text:
        text = text.replace(old_start_fallback, new_start_fallback, 1)
    elif "before primary ready — deferring" not in text:
        raise SystemExit("shared START_VIDEO empty-reconfigure fallback not found")

    if text == original:
        print(f"already patched {path}")
        raise SystemExit(0)
    path.write_text(text)
    print(f"patched {path}")


if __name__ == "__main__":
    main()
