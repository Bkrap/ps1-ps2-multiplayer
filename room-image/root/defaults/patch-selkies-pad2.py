#!/usr/bin/env python3
"""Hardening Selkies for PS1 Pad 1 + Pad 2.

Problems this fixes permanently:
1. Pad 2 as shared "viewer" uses a keyframe gate → often stuck on
   "Waiting for stream..."
2. Pad 2 START_VIDEO before Pad 1 is ready used to call reconfigure_displays()
   with zero display clients → "Video pipelines remain stopped" and Pad 2 never
   recovers.
3. A second client registering as primary kills Pad 1.

Strategy:
- Allow Pad 2 to authenticate as controller/slot 2 (set by lobby tokens).
- Secondary pads (slot >= 2) must NOT take over the primary display.
- START_VIDEO with no primary capture must be a no-op (wait), never an empty
  reconfigure.
- When primary capture is already running, request an IDR for late joiners.
"""
from pathlib import Path

path = Path("/lsiopy/lib/python3.13/site-packages/selkies/selkies.py")
text = path.read_text()
original = text

# --- helpers we inject once ---
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

if "_ps1_is_secondary_pad" not in text:
    # Insert after imports-ish: right before class or after user_tokens =
    anchor = "user_tokens = {}"
    if anchor not in text:
        raise SystemExit("user_tokens anchor missing")
    text = text.replace(anchor, HELPER + "\n" + anchor, 1)

# Viewers may STOP/START like the official shared client does.
text = text.replace(
    """                        allowed_viewer_prefixes = [
                            "SETTINGS,",
                            "START_VIDEO",
                            "js,",
                        ]""",
    """                        allowed_viewer_prefixes = [
                            "SETTINGS,",
                            "START_VIDEO",
                            "STOP_VIDEO",
                            "START_AUDIO",
                            "STOP_AUDIO",
                            "js,",
                        ]""",
)
# Idempotent if already patched once
text = text.replace(
    """                        allowed_viewer_prefixes = [
                            "SETTINGS,",
                            "START_VIDEO",
                            "STOP_VIDEO",
                            "js,",
                        ]""",
    """                        allowed_viewer_prefixes = [
                            "SETTINGS,",
                            "START_VIDEO",
                            "STOP_VIDEO",
                            "START_AUDIO",
                            "STOP_AUDIO",
                            "js,",
                        ]""",
)

# Soften viewer START throttle (old 30s left Pad 2 stuck).
text = text.replace(
    "if now - last_req_time < 30.0:",
    "if now - last_req_time < 1.0:",
)

# Viewer SETTINGS: never PIPELINE_RESETTING (drops Pad 1).
old_viewer = """                            if client_role == 'viewer':
                                data_logger.info(f"Viewer client {websocket.remote_address} sent initial SETTINGS. Syncing with current stream state.")
                                if not initial_settings_processed:
                                    initial_settings_processed = True
                                
                                await self.broadcast_stream_resolution()

                                data_logger.info(f"Broadcasting PIPELINE_RESETTING to sync new viewer.")
                                websockets.broadcast(self.clients, "PIPELINE_RESETTING primary")

                                continue"""

new_viewer = """                            if client_role == 'viewer' or _ps1_is_secondary_pad(client_permissions.get(websocket)):
                                data_logger.info(f"Peer client {websocket.remote_address} sent SETTINGS (secondary/viewer). Sync only — do not steal primary.")
                                if not initial_settings_processed:
                                    initial_settings_processed = True

                                await self.broadcast_stream_resolution()
                                primary_capture = self.capture_instances.get('primary') if hasattr(self, 'capture_instances') else None
                                module = primary_capture.get('module') if primary_capture else None
                                if module is not None:
                                    try:
                                        module.request_idr_frame()
                                        data_logger.info("Requested IDR for secondary pad without resetting Pad 1.")
                                    except Exception as idr_err:
                                        data_logger.warning(f"IDR request for secondary pad failed: {idr_err}")

                                continue"""

# Already-patched viewer block (from v1 patch)
old_viewer_v1 = """                            if client_role == 'viewer':
                                data_logger.info(f"Viewer client {websocket.remote_address} sent initial SETTINGS. Syncing with current stream state.")
                                if not initial_settings_processed:
                                    initial_settings_processed = True

                                # Do not PIPELINE_RESETTING — that drops Pad 1 and leaves Pad 2
                                # waiting on a throttled START_VIDEO with no keyframe.
                                await self.broadcast_stream_resolution()
                                primary_capture = self.capture_instances.get('primary') if hasattr(self, 'capture_instances') else None
                                module = primary_capture.get('module') if primary_capture else None
                                if module is not None:
                                    try:
                                        module.request_idr_frame()
                                        data_logger.info("Requested IDR for new viewer without resetting Pad 1 pipeline.")
                                    except Exception as idr_err:
                                        data_logger.warning(f"IDR request for viewer failed: {idr_err}")

                                continue"""

if old_viewer in text:
    text = text.replace(old_viewer, new_viewer)
elif old_viewer_v1 in text:
    text = text.replace(old_viewer_v1, new_viewer)
elif "Peer client" not in text:
    raise SystemExit("viewer SETTINGS block not found")

# Never kill Pad 1 when a secondary pad connects as "primary" in SETTINGS.
old_kill = """                            if display_id in ['primary', 'display2']:
                                existing_client_info = self.display_clients.get(display_id)
                                if existing_client_info:
                                    old_ws = existing_client_info.get('ws')
                                    if old_ws and old_ws is not websocket and old_ws.state == websockets.protocol.State.OPEN:
                                        kill_reason = f"a new {display_id} client connected connection killed"
                                        data_logger.warning(
                                            f"Killing old client for '{display_id}' at {old_ws.remote_address}. Reason: {kill_reason}"
                                        )
                                        try:
                                            await old_ws.send(f"KILL {kill_reason}")
                                            await old_ws.close(code=1000, reason="Superseded by new client")
                                        except websockets.ConnectionClosed:
                                            data_logger.info(f"Old client for '{display_id}' was already disconnected.")
                                        except Exception as e:
                                            data_logger.error(f"Error while killing old client for '{display_id}': {e}")"""

new_kill = """                            if display_id in ['primary', 'display2']:
                                existing_client_info = self.display_clients.get(display_id)
                                if existing_client_info:
                                    old_ws = existing_client_info.get('ws')
                                    incoming = client_permissions.get(websocket) or {}
                                    if _ps1_is_secondary_pad(incoming):
                                        data_logger.info(
                                            f"Ignoring primary takeover from secondary pad {websocket.remote_address} (slot={incoming.get('slot')})."
                                        )
                                    elif old_ws and old_ws is not websocket and old_ws.state == websockets.protocol.State.OPEN:
                                        kill_reason = f"a new {display_id} client connected connection killed"
                                        data_logger.warning(
                                            f"Killing old client for '{display_id}' at {old_ws.remote_address}. Reason: {kill_reason}"
                                        )
                                        try:
                                            await old_ws.send(f"KILL {kill_reason}")
                                            await old_ws.close(code=1000, reason="Superseded by new client")
                                        except websockets.ConnectionClosed:
                                            data_logger.info(f"Old client for '{display_id}' was already disconnected.")
                                        except Exception as e:
                                            data_logger.error(f"Error while killing old client for '{display_id}': {e}")"""

if old_kill in text:
    text = text.replace(old_kill, new_kill)
elif "Ignoring primary takeover from secondary pad" not in text:
    raise SystemExit("primary kill block not found")

# START_VIDEO with no display: never empty-reconfigure.
old_start = """                        else:
                            data_logger.info(f"Received START_VIDEO from a shared client ({websocket.remote_address}). Triggering reconfiguration.")
                            await self.reconfigure_displays()"""

old_start_v1 = """                        else:
                            data_logger.info(f"Received START_VIDEO from a shared client ({websocket.remote_address}).")
                            primary_capture = self.capture_instances.get('primary') if hasattr(self, 'capture_instances') else None
                            if primary_capture and primary_capture.get('module') is not None:
                                try:
                                    primary_capture['module'].request_idr_frame()
                                    data_logger.info("Shared client START_VIDEO: requested IDR (Pad 1 capture kept).")
                                except Exception as idr_err:
                                    data_logger.warning(f"Shared client IDR request failed: {idr_err}")
                                await self.broadcast_stream_resolution()
                            else:
                                data_logger.info("Shared client START_VIDEO: no primary capture yet, full reconfigure.")
                                await self.reconfigure_displays()"""

new_start = """                        else:
                            data_logger.info(f"Received START_VIDEO from a peer client ({websocket.remote_address}).")
                            primary_capture = self.capture_instances.get('primary') if hasattr(self, 'capture_instances') else None
                            if primary_capture and primary_capture.get('module') is not None:
                                try:
                                    primary_capture['module'].request_idr_frame()
                                    data_logger.info("Peer START_VIDEO: requested IDR (Pad 1 capture kept).")
                                except Exception as idr_err:
                                    data_logger.warning(f"Peer IDR request failed: {idr_err}")
                                await self.broadcast_stream_resolution()
                                try:
                                    await websocket.send("VIDEO_STARTED")
                                except Exception:
                                    pass
                            else:
                                # Critical: do NOT reconfigure with zero display clients — that
                                # permanently stops pipelines and leaves Pad 2 on Waiting for stream.
                                data_logger.info("Peer START_VIDEO before primary ready — deferring (no empty reconfigure).")
                                try:
                                    await websocket.send("VIDEO_STARTED")
                                except Exception:
                                    pass"""

if old_start in text:
    text = text.replace(old_start, new_start)
elif old_start_v1 in text:
    text = text.replace(old_start_v1, new_start)
elif "Peer START_VIDEO before primary ready" not in text:
    raise SystemExit("shared START_VIDEO block not found")

# After primary capture starts, nudge late peers with IDR + resolution.
old_success = 'data_logger.info(f"SUCCESS: Capture started for \'{display_id}\'.")'
if old_success in text and "ps1_nudge_peers_after_capture" not in text:
    text = text.replace(
        old_success,
        old_success
        + """
        if display_id == 'primary':
            try:
                module = self.capture_instances.get('primary', {}).get('module')
                if module is not None:
                    module.request_idr_frame()
                await self.broadcast_stream_resolution()
                data_logger.info("ps1_nudge_peers_after_capture: IDR + resolution for late Pad 2")
            except Exception as nudge_err:
                data_logger.warning(f"ps1_nudge_peers_after_capture failed: {nudge_err}")""",
    )

if text == original:
    print(f"already patched {path}")
    raise SystemExit(0)
path.write_text(text)
print(f"patched {path}")
