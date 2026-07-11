# Cloud image for the Nekos AI Clipper web version (Linux).
# Bundles ffmpeg + yt-dlp + python3 so core/* finds them on PATH.
#
# ONE image for every target — Raspberry Pi (arm64, CPU), a plain VPS (amd64, CPU),
# or a GPU VPS (amd64 + NVIDIA): core/encoderDetector.js does a real test-encode at
# runtime and picks NVENC/AMF/QSV if one actually works, else falls back to CPU
# libx264. No separate build needed for the GPU case — see web/README.md for the
# `--gpus all` / nvidia-container-toolkit setup on a GPU VPS.
#
# MULTI-ARCH (linux/amd64 + linux/arm64): the node base image, apt ffmpeg, and
# the pip yt-dlp install are all arch-agnostic. Build both with:
#   docker buildx build --platform linux/amd64,linux/arm64 -f web/Dockerfile -t you/nekos-clipper-web --push .
FROM node:20-bookworm-slim

# System tools used by the pipeline (apt pulls the correct arch automatically).
# python-is-python3 provides a `python` command (Debian only ships `python3`) —
# the yt-dlp-exec npm postinstall checks for `python` and fails without it.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg python3 python3-pip python-is-python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp via pip + curl_cffi for browser impersonation. curl_cffi lets yt-dlp
# mimic a real Chrome TLS/HTTP fingerprint, which defeats Cloudflare 403s on
# Kick (and others) that block plain Python requests on Linux/ARM hosts.
RUN pip3 install --no-cache-dir --break-system-packages --upgrade "yt-dlp[default,curl-cffi]"

WORKDIR /app

# The web app lives in MyOwnCode/web and reuses MyOwnCode/{core,tools,node_modules}.
# Copy the whole MyOwnCode project (build context = MyOwnCode), minus dist/tools bins.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm install express multer --omit=dev

COPY core ./core
COPY tools/toolsManager.js ./tools/toolsManager.js
COPY web ./web

ENV PORT=8080 \
    DATA_DIR=/data \
    FFMPEG_PATH=ffmpeg \
    FFPROBE_PATH=ffprobe \
    YTDLP_PATH=yt-dlp \
    PYTHON_PATH=python3 \
    YTDLP_IMPERSONATE=chrome \
    ENCODER=auto

# Harmless on Pi/CPU-only hosts. On a GPU VPS running with `docker run --gpus all`
# (nvidia-container-toolkit installed on the host), these tell the toolkit which
# driver capabilities to mount into the container so ffmpeg's h264_nvenc can find
# libnvidia-encode/libcuda at runtime. See web/README.md.
ENV NVIDIA_VISIBLE_DEVICES=all \
    NVIDIA_DRIVER_CAPABILITIES=compute,video,utility

VOLUME ["/data"]
EXPOSE 8080

CMD ["node", "web/server.js"]
