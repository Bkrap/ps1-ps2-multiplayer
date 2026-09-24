# One match: headless Selkies desktop + DuckStation kiosk.
# The disc image and BIOS are mounted at runtime. They are not in this image.
FROM ghcr.io/linuxserver/baseimage-selkies:debiantrixie

ENV TITLE="Match" \
    PIXELFLUX_WAYLAND=false \
    HARDEN_DESKTOP=true \
    HARDEN_OPENBOX=true \
    RESTART_APP=true \
    NO_DECOR=true \
    DISABLE_ZINK=true \
    DISABLE_DRI3=true \
    AUTO_GPU=false \
    SELKIES_USE_CPU=true|locked \
    SELKIES_ENCODER=x264enc \
    SELKIES_FRAMERATE=30 \
    SELKIES_H264_CRF=32 \
    SELKIES_H264_STREAMING_MODE=true \
    SELKIES_H264_FULLCOLOR=false \
    SELKIES_USE_PAINT_OVER_QUALITY=false \
    SELKIES_AUDIO_BITRATE=128000 \
    SELKIES_MANUAL_WIDTH=960 \
    SELKIES_MANUAL_HEIGHT=540 \
    SELKIES_IS_MANUAL_RESOLUTION_MODE=true \
    SELKIES_UI_SHOW_SIDEBAR=false \
    SELKIES_FILE_TRANSFERS=none \
    SELKIES_COMMAND_ENABLED=false \
    SELKIES_CLIPBOARD_ENABLED=false \
    SELKIES_MICROPHONE_ENABLED=false \
    SELKIES_ENABLE_SHARING=true \
    SELKIES_ENABLE_SHARED=true \
    SELKIES_ENABLE_COLLAB=false \
    SELKIES_ENABLE_PLAYER2=true \
    SELKIES_ENABLE_PLAYER3=false \
    SELKIES_ENABLE_PLAYER4=false \
    SELKIES_SECOND_SCREEN=false \
    SELKIES_GAMEPAD_ENABLED=true \
    SELKIES_AUDIO_ENABLED=true

ARG DUCKSTATION_URL=https://github.com/stenzek/duckstation/releases/download/latest/DuckStation-x64.AppImage
# Bump to invalidate apt cache when window helpers change.
ARG ROOM_HELPERS=5

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates wmctrl xdotool ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL -o /tmp/duckstation.AppImage "$DUCKSTATION_URL" \
    && chmod +x /tmp/duckstation.AppImage \
    && cd /tmp && ./duckstation.AppImage --appimage-extract \
    && rm -rf /opt/duckstation \
    && mv /tmp/squashfs-root /opt/duckstation \
    && rm -f /tmp/duckstation.AppImage \
    && chmod +x /opt/duckstation/AppRun

COPY root/ /
RUN chmod 755 /defaults/require-media.sh /defaults/launch-game.sh /defaults/maximize-game.sh /defaults/record-start.sh /defaults/record-stop.sh /defaults/patch-selkies-pad2.py /custom-cont-init.d/10-require-media /custom-cont-init.d/20-patch-selkies-pad2 \
    && python3 /defaults/patch-selkies-pad2.py

