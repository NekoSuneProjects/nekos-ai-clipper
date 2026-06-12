<div align="center">

# ☁️ Nekos AI Clipper — Web / Cloud Edition

### The headless, cloud-hostable version — paste a VOD or upload, get auto clips & montages.

<p>
  <img alt="Web" src="https://img.shields.io/badge/runtime-Linux%20%C2%B7%20Docker-2496ED?logo=docker&logoColor=white" />
  <img alt="Arch" src="https://img.shields.io/badge/arch-amd64%20%2B%20arm64%20(Pi)-555" />
  <img alt="Node" src="https://img.shields.io/badge/Node-%E2%89%A520-339933?logo=node.js&logoColor=white" />
</p>

> 🌿 This is the **`web` branch** — slim, server-only. The desktop app lives on the **`app`** branch; the full source on **`DEV`**.

</div>

---

## What it is

The web edition reuses the same `core/` AI pipeline behind a **1-job-at-a-time queue**. You paste a **VOD/stream URL** or **upload a video**, and it downloads, finds the highlights (audio reactions + per-game OCR), and renders **clips or a music montage** — all in the browser. (Live screen capture is desktop-only — a server has no display.)

- 🎮 **Game detection** · 🎙️ **reaction detection** · 🎞️ **Normal / Short / both** · 🎵 **music picker with previews**
- 🧵 **Serial queue** — one encode at a time
- 🗑️ **Auto-delete** old job files (saves cloud disk)
- 💜 **Supporter links** (configure via env)
- 🐳 **Multi-arch** image — runs on a Raspberry Pi

## 🚀 Run it

**Docker (recommended):**
```bash
docker build -f web/Dockerfile -t nekos-clipper-web .
docker run -p 8080:8080 -v $(pwd)/data:/data nekos-clipper-web
# http://localhost:8080
```
Multi-arch (amd64 + arm64):
```bash
docker buildx build --platform linux/amd64,linux/arm64 -f web/Dockerfile -t youruser/nekos-clipper-web --push .
```
**Or plain Node** (needs system `ffmpeg`/`yt-dlp`/`python3`):
```bash
npm install express multer
node web/server.js
```

📖 Full API, env vars, and the planned **multi-node render farm** → [`web/README.md`](web/README.md).

## 🕹️ Game profiles (submodule)

`core/gameConfigs` is a **git submodule** tracking the **`gameconfig`** branch, so all game profiles are maintained in one place. Clone with submodules so the image has them:
```bash
git clone --recurse-submodules -b web <repo>
# already cloned?
git submodule update --init --recursive
# pull the latest profiles:
git submodule update --remote core/gameConfigs && git commit -am "update game profiles"
```
(CI checks out submodules automatically.)

## 🔁 Updating this branch from DEV

`web` is slim, so **don't `merge DEV`** (it re-adds desktop files). Pull only what web needs:
```bash
git fetch origin DEV
git checkout origin/DEV -- core tools/toolsManager.js web package.json package-lock.json
git commit -am "sync web from DEV" && git push   # triggers the Docker build
```

---

<div align="center">

Part of **[Nekos AI Clipper](https://github.com/NekoSuneProjects/nekos-ai-clipper)** · Made with 💜 by NekoSuneVR

</div>
