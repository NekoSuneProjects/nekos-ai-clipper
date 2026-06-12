<div align="center">

<img src="assets/icon.ico" width="110" alt="Nekos AI Clipper" />

# 🎬 Nekos AI Clipper

### Your own AI highlight machine — auto-clip kills, deaths, wins & hype moments, then turn them into montages with music.

A spiritual **fork & revival of [Powder](https://www.powder.gg/)** (RIP) — rebuilt from scratch, open, and yours to run on your **PC** or in the **cloud**.

<p>
  <img alt="Platform" src="https://img.shields.io/badge/desktop-Windows-0078D6?logo=windows&logoColor=white" />
  <img alt="Web" src="https://img.shields.io/badge/web-Linux%20%C2%B7%20Docker%20%C2%B7%20amd64%2Farm64-2496ED?logo=docker&logoColor=white" />
  <img alt="Electron" src="https://img.shields.io/badge/Electron-32-47848F?logo=electron&logoColor=white" />
  <img alt="Node" src="https://img.shields.io/badge/Node-%E2%89%A520-339933?logo=node.js&logoColor=white" />
  <img alt="ffmpeg" src="https://img.shields.io/badge/ffmpeg-8.x-007808?logo=ffmpeg&logoColor=white" />
  <img alt="License" src="https://img.shields.io/badge/license-see%20LICENSE-blue" />
</p>

</div>

---

## ✨ What it does

You give it a **stream VOD, a clip, an upload, or a live capture** — it watches the footage, finds the good bits, and spits out clips or a music montage. No timeline scrubbing.

- 🎙️ **Reaction detection** — finds your loud/hype moments from the audio.
- 🎮 **Gameplay detection** — reads the game HUD (OCR) to catch **kills, headshots, multi-kills, deaths, vehicle destroys, and wins** — per-game tuned.
- 🧠 **Smart content types** — pick **Reactions**, **Gaming** (auto-uses the game profile), or **IRL**; it figures out the rest.
- 🔗 **Kill-streak clustering** — back-to-back kills merge into **one continuous clip** (no 3 repeats of the same callout).
- 🔴 **Live capture** — record desktop, a game window, or a **console via Remote Play** (PS Remote Play / chiaki-ng / Xbox / Moonlight) with **GPU capture (ddagrab)** and **real-time auto-clipping**.
- 🎞️ **Output your way** — **Normal (16:9)**, **Short (9:16 / TikTok)**, or **both**.
- 🎵 **Auto music** — built-in royalty-free library with **previews**, multi-song montage beds, and **fade in/out**.
- ⚡ **GPU or CPU encoding** — auto-detects **NVENC (980 Ti+) / AMD AMF / Intel QuickSync**, falls back to CPU.
- 📊 **Live progress + ETA** on analysis and rendering (e.g. *"~3m left"*).

---

## 🖥️ Two editions

| | 🪟 **Desktop App** | ☁️ **Web / Cloud** |
|---|---|---|
| Platform | Windows (Electron) | Linux server (Docker, **amd64 + arm64** — runs on a Raspberry Pi) |
| Input | Local file · VOD URL · **Live capture** | Upload · VOD URL |
| Live capture | ✅ (desktop/window/console) | ❌ (headless — no display) |
| Queue | single user | **1-job-at-a-time queue** |
| Music picker | ✅ | ✅ |
| GPU encode | ✅ if you have one | auto (CPU on most cloud) |
| Best for | streamers on their gaming PC | a always-on box / shared link |

---

## 📥 Supported sources

**YouTube** · **Twitch** (VODs **+ clips**) · **Kick** (VODs **+ clips**) — downloaded with `yt-dlp` (browser impersonation built in, so Cloudflare-protected clips work too).

## 🎮 Supported games (40+)

> Fortnite · Battlefield 6 (+ Console) · Apex Legends · Call of Duty (BO6 · MW2 · MW3 · Warzone · Vanguard · Zombies) · Counter-Strike 2 · Valorant · Marvel Rivals · The Finals · Halo Infinite · Helldivers 2 · PUBG · Rocket League · Elden Ring · Black Myth: Wukong · Diablo IV · Destiny 2 · Remnant II · Naraka: Bladepoint · The First Descendant · XDefiant · Skull and Bones · League of Legends · TFT · Smite 2 · Street Fighter 6 · Cuphead · Stumble Guys · Fall Guys · Among Us · Hearthstone · MTG Arena · Madden · Monster Hunter · Omega Strikers · Arc Raiders … and more.

Each game has its own **OCR crop profile** in [`core/gameConfigs/`](core/gameConfigs/). **Fortnite** and **Battlefield 6** are hand-calibrated; others are starter profiles you can tune.

## 🎵 Music

| Source | Credit required? |
|---|---|
| **NCS** (NoCopyrightSounds) | ⚠️ Yes — credit the artist |
| **StreamBeats** (Harris Heller) | ✅ No |
| **Ninety9Lives** | ⚠️ Yes |
| **Monstercat** | ⚠️ License required (Monstercat Gold) |
| **TikTok** | 🚫 Copyrighted — claims/strikes likely |

The picker shows the **required attribution** for every track and warns on the risky sources. You can also use your own file.

---

## 🚀 Getting started

### 🪟 Desktop (Windows)
```bash
cd MyOwnCode
npm install
npm test            # launches the app (electron .)
```
First launch auto-downloads its own **ffmpeg + yt-dlp + python** into AppData — nothing else to install.

**Build an installer:**
```bash
npm run build:win   # -> dist/NekosAIClipper-Setup-x.x.x.exe / .msi
```

### ☁️ Web (Docker — recommended for cloud / Pi)
```bash
cd MyOwnCode
docker build -f web/Dockerfile -t nekos-clipper-web .
docker run -p 8080:8080 -v $(pwd)/data:/data nekos-clipper-web
# open http://localhost:8080
```
Multi-arch build (amd64 + arm64):
```bash
docker buildx build --platform linux/amd64,linux/arm64 -f web/Dockerfile -t youruser/nekos-clipper-web --push .
```
Or just run it with Node + system `ffmpeg`/`yt-dlp`/`python3`:
```bash
npm install express multer
node web/server.js
```
See [`web/README.md`](web/README.md) for the full API, env vars, and the planned **multi-node render farm**.

---

## 🧠 How it works

```
 Source (VOD / clip / upload / live)
        │  yt-dlp / ffmpeg capture
        ▼
 ┌──────────────────────────────────────────────┐
 │  Analyse                                       │
 │  • Audio RMS  → reaction highlights            │
 │  • ffmpeg → frames → Tesseract OCR of the game │
 │    HUD (per-game crops + threshold)            │
 │  • Kill-streak clustering                      │
 └──────────────────────────────────────────────┘
        ▼
 Highlights ──► Standard clips  (16:9 / 9:16 / both)
            └─► Montage (cinema FX + auto music + fades)
```

**Built with:** Electron · Node · `fluent-ffmpeg` · `tesseract.js` (offline OCR) · `yt-dlp` · Express (web) · Tailwind (UI).

---

## ⚙️ Configuration

Desktop settings (output folder, **GPU/CPU encoder**) live in the **Settings** tab and persist between launches; downloaded music caches under `Documents/NekosAIClipper/music`.

Web is configured via env vars (`PORT`, `RETENTION_HOURS`, `ENCODER`, `SUPPORT_*`, …) — see [`web/README.md`](web/README.md).

---

## 🗺️ Roadmap

See [`TODO.md`](TODO.md) for the full list. Highlights still cooking:

- 🎯 **Crop calibration tool** — drag crop boxes on a frame to tune any game/layout yourself.
- 🌐 **Web clip preview & select** — pick which clips to keep, like the desktop app.
- 🕸️ **Multi-node render farm** — add render nodes (Windows/Linux) that pull jobs and encode in parallel.
- 🎶 **BPM-synced montage cuts**.

---

## 🤝 Contributing & Support

PRs and game-profile tunes welcome — adding a game is mostly a JSON file in [`core/gameConfigs/`](core/gameConfigs/).

This project is **free**. If it saves you time, consider supporting the servers & development (the web build shows donate links you configure via `SUPPORT_*` env vars).

---

## ⚠️ Music licensing — read this

The app can download music, but **using it in your videos is on you**. NCS / Ninety9Lives require **crediting the artist** (the app shows you the exact line). **Monstercat needs a license** and **TikTok songs are copyrighted** — using those can get your video claimed or struck. StreamBeats is the safe default (no credit needed).

## 📜 License

See [LICENSE](LICENSE). © NekoSuneVR / NekoSuneProjects.

<div align="center">

**Made with 💜 by [NekoSuneVR](https://github.com/NekoSuneProjects)** — bringing Powder back to life.

</div>
