# NekosAIClipper — Roadmap / TODO

## ✅ Done (this pass)
- **FPS/gameplay event detection now works.** Fixed the PNG `image2pipe` demux bug that
  silently dropped every frame, plus the missing `ffprobe` path. Kills/deaths/streaks/wins
  are detected via OCR of per-game killfeed crops (`core/fpsDetector.js`).
- **Offline OCR** — Tesseract loads `core/tessdata/eng.traineddata` locally (no CDN needed,
  works in packaged build).
- **OCR speed** — skips Tesseract on unchanged killfeed crops (per-frame fingerprint).
- **Montage fix** — music fade-out now uses true montage length, not source timestamp.
- **Free NCS auto-music** — `core/musicLibrary.js` + "Auto NCS Music" button. Downloads
  audio via yt-dlp, caches in AppData, returns required attribution.
- **Live auto-clip** — capture now uses rolling segments so real-time clipping actually runs
  (was hard-disabled before).

## 🎮 Live capture — Console via Remote Play apps  (REQUESTED)
Goal: clip console gameplay in real time by capturing a Remote Play app window on PC.
Targets: **PS Remote Play, Xbox (Console Companion / new Xbox app), Chiaki / chiaki-ng,
Steam Link, Moonlight, Parsec**.

How it works today: capture mode **"window"** uses `gdigrab title=<window>` and the window
picker lists open windows — so selecting e.g. "PS Remote Play" already records that window.

### TODO to make console solid
- [x] **gdigrab black-screen FIXED.** Window/console mode now resolves the window's client
      rectangle (Win32 `GetClientRect`+`ClientToScreen` via PowerShell in `main.js`) and
      region-captures the composited desktop (`gdigrab -offset_x/-offset_y/-video_size -i
      desktop`) instead of `title=`, which is black for GPU windows. Verified against chiaki-ng.
- [x] **Low FPS FIXED — ddagrab backend.** Capture now defaults to `ddagrab` (DXGI Desktop
      Duplication, GPU-accelerated) instead of CPU-bound gdigrab. Window region capture uses
      `ddagrab,hwdownload,format=bgra,crop=…` on the primary monitor; gdigrab is only the
      fallback for off-primary (negative-coord) windows or when forced. Window rect is now
      DPI-aware. Verified filtergraph + capture with bundled ffmpeg 8.0.
- [ ] Optional perf: keep ddagrab frames on GPU for NVENC (avoid hwdownload→re-upload via
      hwmap=derive_device=cuda) — current path does a GPU→CPU→GPU roundtrip.
- [ ] **Auto-crop letterboxing.** chiaki-ng/Remote Play letterbox the 16:9 stream inside a
      wider window → thin black bars throw OCR crops off slightly. Detect & crop to content,
      or tell users to run the Remote Play app fullscreen (16:9) for exact crops.
- [ ] **Add a "Capture Device" mode** (`-f dshow -i video=<device>`) so users can capture:
      - an **OBS Virtual Camera** (run the Remote Play app → OBS window/game capture →
        Start Virtual Camera → we grab the virtual cam). Most reliable path.
      - a **physical capture card** (Elgato etc.) for direct console HDMI — no remote app at all.
- [ ] Enumerate dshow **video** devices (we already enumerate dshow audio in `main.js`;
      reuse `-list_devices true -f dshow -i dummy` and parse the video section).
- [ ] Per-remote-app **window-title hints** in the picker (auto-suggest "PS Remote Play",
      "Chiaki", "Xbox", "Moonlight"…).
- [ ] **Auto-crop the Remote Play window** to the actual game video region (strip app chrome/
      borders) before OCR — otherwise killfeed crop fractions are off.
- [ ] Per-app latency presets (Remote Play adds input/encode lag; tune segment length).
- [ ] Optional: detect when the selected window is minimized/occluded and warn (gdigrab needs
      it visible).

## 🎯 Robust cross-layout detection (streams + overlays)
Streamers use different resolutions, HUD scales, and edge overlays/cams, so fixed
tiny crops calibrated to one capture don't generalize. Strategy + TODO:
- [x] FRTN now scans broad CENTRAL bands (callouts are center; overlays are at edges)
      so it covers PS5/chiaki (right-side callouts) AND PC streams (center callouts).
- [ ] Apply the same central-band approach to other battle-royale configs.
- [ ] Generic engine "broadScan" flag: OCR a few standard central regions + match the
      game's keywords anywhere, so a config works without per-layout tuning.
- [ ] Calibration tool (the real fix): let users drag crop boxes on a frame per layout.
- [ ] Longer term: template-match the callout icon, or a tiny ML text detector to LOCATE
      the callout regardless of position (true "always find the text").

## 🔧 Detection accuracy (per-game configs)
- [ ] Only a few `core/gameConfigs/*.json` have real, tuned crop coordinates + keywords.
      Build a **calibration tool**: extract a frame at a timestamp, overlay the crop rects,
      let the user drag them, save back to the config.
- [ ] Verify killfeed keywords per game (e.g. CONSOLE variants differ from PC).
- [ ] Consider a generic "killfeed contains my username" detector (Powder-style) instead of
      fixed keywords, for games without a fixed kill word.

## 🎵 Music / montage
- [x] **Multiple music sources** — `core/ncsTracks.json` now has `collections` (YouTube
      playlists/channels expanded live by yt-dlp): NCS, StreamBeats (no credit needed),
      Ninety9Lives — plus curated NCS `tracks`. UI has a source dropdown next to "Auto Music".
      Verified expansion + seeded pick against the live sources.
- [x] **Music Library pop-out UI** (DONE) — "🎵 Music Library" button opens a modal with TABS
      per source: NCS, StreamBeats, Ninety9Lives, **Monstercat**, **TikTok** (+ "NCS Picks"
      curated). Each tab lazy-loads songs with Preview + Use buttons. Monstercat & TikTok show a
      yellow copyright-warning banner. Credit line shown on pick. Backend verified (search
      listing + downloads).
- [x] **30-second preview snippets** (DONE) — `musicLibrary.previewTrack()` downloads a 30s clip
      (`yt-dlp --download-sections "*0:30-1:00"`) cached in AppData; plays in an `<audio>` el.
      Verified a real 30s mp3 downloads.
- [~] **Browsable song lists** (PARTIAL) — modal lazy-loads up to 60 newest per source live.
      Still TODO: full catalog (NCS is 1500+) cached to AppData with search/scroll, raise the
      60 cap, and "🎲 Random from this source" + a search box inside the modal.
- [ ] Verify `file:///` preview playback works under Electron contextIsolation (webSecurity);
      if blocked, serve previews via a registered custom protocol instead.
- [ ] **BPM is detected (`musicBpm.js`) but never used.** Sync montage cut points to beats.
- [ ] `bpm_detector.py` needs numpy/librosa — the bundled embedded Python is bare. Either
      bundle wheels or use a JS BPM detector.
- [ ] Let users add their own playlist/channel sources to `core/ncsTracks.json` from the UI.

## ⚡ Encoding
- [x] **GPU/CPU encoder choice** (DONE) — `core/encoderDetector.js` verifies encoders with a
      real test-encode (not just listing). Supports NVIDIA NVENC (980 Ti+), AMD AMF, Intel QSV,
      CPU libx264. Settings dropdown: Auto / GPU only / CPU only, with detected-hardware status.
      Threaded through standard + montage renderers AND live capture, desktop + web
      (`ENCODER` env). Falls back to CPU when GPU unavailable. Verified GPU + CPU renders work.
      (`core/nvencDetector.js` is now superseded by encoderDetector.)

## 🎯 Modes & formats
- [x] **Simplified content types** (DONE) — Reactions / Gaming / IRL instead of raw
      kills/deaths modes. Gaming auto-uses the selected gameConfig (kills/deaths/wins) + audio;
      Reactions/IRL use the audio engine. Desktop + web. Game profile only enabled for Gaming.
- [x] **Output format Normal / Short / Both** (DONE) — 16:9, 9:16 TikTok, or both. Threaded
      through standard + montage renderers, desktop + web.
- [ ] IRL tuning — currently same as Reactions; give IRL a more sensitive audio threshold.

## 🖥️ UI / Web
- [x] **Web auto-delete** (DONE) — job files + uploads older than `RETENTION_HOURS` (default 24h)
      are purged hourly to save cloud disk.
- [x] **Supporter / donate** (DONE) — `/api/support` + UI buttons, configured via `SUPPORT_*`
      env vars (Ko-fi/Patreon/PayPal/GitHub Sponsors).
- [x] **Multi-arch Docker** (DONE) — image builds for linux/amd64 + linux/arm64 (pip yt-dlp,
      apt ffmpeg). Windows stays the desktop app.
- [ ] **Multi-node render farm** (DESIGNED, not built) — node agents on any Win/Linux box pull
      jobs from the coordinator and encode in parallel. Needs shared queue (Redis/BullMQ) +
      `web/node-agent.js` + `/api/nodes/*` endpoints + `NODE_TOKEN` auth. Full design in
      `web/README.md`. This is the next big build.
- [ ] Fully split Web vs Desktop into shared-UI packages (currently `renderer/` + `web/public/`
      share the theme but duplicate markup).
- [x] **Desktop UI redesign** (DONE) — Powder-style: sticky gradient header + logo, icon
      sidebar with active state, glass cards, 4 highlight modes as pill-cards, game/render
      two-up grid, restyled inputs/buttons, custom scrollbar. All element IDs preserved.
- [x] **Web / cloud version** (DONE, v1) — `web/` Express app reuses `core/` behind a
      1-at-a-time `JobQueue`. URL + file upload, mode/game/render/music, SSE live progress,
      downloadable outputs. `boot-tools.js` points core at system ffmpeg/yt-dlp; `Dockerfile`
      for Linux deploy. Verified serial queue + tool short-circuit.
- [x] **Settings page + persisted output folder** (DONE) — `core/settings.js` stores settings
      in userData; default render folder = `Documents\NekosAIClipper`, changeable from the
      Settings tab, remembered across launches. Renders default to it (no folder prompt).
- [x] **Render progress + ETA** (DONE) — montage & standard renderers emit ffmpeg progress;
      Output tab shows a % bar + estimated time left (e.g. "~1h 5m left"). Verified math.
- [x] **Real-time live clips** (DONE) — clips detected during live capture appear instantly in
      the Live Capture tab as cards with Open buttons + a running count.
- [ ] Web hardening: persistent job store (in-memory now), auth/rate-limit before public
      exposure, auto-cleanup of old job files, Redis/BullMQ for multi-worker scale.
- [ ] Port the Music Library picker + 30s previews to the web UI (web auto-picks a source now).

## 🧪 General
- [ ] End-to-end test on a real BF6 (and one console) gameplay clip.
- [ ] Bundle/verify `tesseract.js-core` + `core/tessdata` are included by electron-builder.
- [ ] Progress UI: surface the new `downloading_music` step.
