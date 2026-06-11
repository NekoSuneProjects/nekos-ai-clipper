# Cloud image for the Nekos AI Clipper web version (Linux).
# Bundles ffmpeg + yt-dlp + python3 so core/* finds them on PATH.
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

# yt-dlp via pip = pure-Python, works on amd64 AND arm64
RUN pip3 install --no-cache-dir --break-system-packages yt-dlp

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
    PYTHON_PATH=python3
VOLUME ["/data"]
EXPOSE 8080

CMD ["node", "web/server.js"]
