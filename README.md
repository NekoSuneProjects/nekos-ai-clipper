<div align="center">

<img src="assets/icon.ico" width="100" alt="Nekos AI Clipper" />

# 🎬 Nekos AI Clipper — Desktop App

### Auto-clip kills, deaths, wins & hype moments — then montage them with music. On your gaming PC.

<p>
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows-0078D6?logo=windows&logoColor=white" />
  <img alt="Electron" src="https://img.shields.io/badge/Electron-32-47848F?logo=electron&logoColor=white" />
  <img alt="GPU" src="https://img.shields.io/badge/encode-NVENC%20%2F%20AMF%20%2F%20QSV%20%2F%20CPU-76B900" />
</p>

> 🌿 This is the **`app` branch** — the Windows desktop app. The cloud version lives on **`web`**; the full source on **`DEV`**.

</div>

---

## ✨ Features

- 🎙️ **Reaction detection** — finds your loud/hype moments from audio.
- 🎮 **Gameplay detection** — OCR of the game HUD for **kills, headshots, multi-kills, deaths, vehicle destroys, wins** (40+ game profiles).
- 🧠 **Content types** — Reactions · Gaming (auto game profile) · IRL.
- 🔗 **Kill-streak clustering** — back-to-back kills become one continuous clip.
- 🔴 **Live capture** — desktop, a game window, or a **console via Remote Play** (PS Remote Play / chiaki-ng / Xbox / Moonlight) with **GPU capture (ddagrab)** and **real-time auto-clipping**.
- 🎞️ **Output** — Normal (16:9), Short (9:16 TikTok), or both.
- 🎵 **Music Library** — NCS / StreamBeats / Ninety9Lives / Monstercat / TikTok with **previews** + **multi-song montage beds** & fades.
- ⚡ **GPU or CPU encoding** — auto-detects NVENC (980 Ti+) / AMD AMF / Intel QuickSync.
- 📊 **Live progress + ETA** on analysis & rendering.

## 🚀 Getting started

```bash
npm install
npm test            # launches the app (electron .)
```
First launch auto-downloads its own **ffmpeg + yt-dlp + python** into AppData — nothing else to install.

**Build an installer:**
```bash
npm run build:win   # -> dist/NekosAIClipper-Setup-x.x.x.exe / .msi
```
> Builds are produced by CI: push to **`TESTING`** → BETA, **`RELEASE`** → release.

## 🕹️ Game profiles (submodule)

`core/gameConfigs` is a **git submodule** tracking the **`gameconfig`** branch. Clone with submodules:
```bash
git clone --recurse-submodules -b app <repo>
git submodule update --init --recursive          # if already cloned
git submodule update --remote core/gameConfigs    # pull the latest profiles
```

## 🌐 About the `curl_cffi` / impersonation code

The app has **no proxy support and does no IP rotation.** The only network-adjacent bit worth calling out is in [`core/vodDownloader.js`](core/vodDownloader.js): on Linux/Docker hosts, `yt-dlp` can optionally use **TLS/browser fingerprint impersonation** (via `curl_cffi`, pretending to be a real Chrome client) to get past Cloudflare's anti-bot check when it blocks Kick/Twitch clip downloads with a 403. It's a workaround for a stale `yt-dlp` extractor signature, not a proxy — it changes what the request *looks like*, not where it's routed from. It's opt-in via an env var (`YTDLP_IMPERSONATE`) and unused on Windows builds.

## 🔁 Updating this branch from DEV

`app` is slim, so **don't `merge DEV`** (it re-adds web files). Pull only app paths:
```bash
git fetch origin DEV
git checkout origin/DEV -- main.js preload.js renderer core tools assets package.json package-lock.json python
git commit -am "sync app from DEV" && git push
```

---

<div align="center">

Part of **[Nekos AI Clipper](https://github.com/NekoSuneProjects/nekos-ai-clipper)** · Made with 💜 by NekoSuneVR

</div>
