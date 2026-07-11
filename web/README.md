# Nekos AI Clipper — Web / Cloud version

A headless web app that reuses the **same `core/` pipeline** as the desktop app,
behind a **1-job-at-a-time queue**. Input: paste a VOD/stream URL **or** upload a
video. (Live screen capture is desktop-only — it needs a display/GPU.)

## What it does
1. You submit a job (URL or upload) with a mode + game + render type.
2. It joins a queue and runs **one at a time**.
3. yt-dlp downloads (if URL) → `analyseVideo()` finds highlights (audio reactions +
   OCR kill/death detection) → renders **standard clips** or a **music montage**.
4. Live progress streams over SSE; finished files are downloadable.

## Run locally (Windows or Linux)
Requires `ffmpeg`, `ffprobe`, `yt-dlp`, `python3` on PATH (or set `*_PATH` env vars).

```bash
cd MyOwnCode
npm install            # core deps
npm install express multer
node web/server.js
# open http://localhost:8080
```

On Windows you can point at the already-downloaded tools:
```
set FFMPEG_PATH=%APPDATA%\ai-clipper\tools\ffmpeg-...\bin\ffmpeg.exe
set YTDLP_PATH=%APPDATA%\ai-clipper\tools\yt-dlp\yt-dlp.exe
```

## Deploy to a Linux cloud (Docker — recommended)
Build context is the **MyOwnCode** folder (so the image can copy `core/` + `node_modules`):

```bash
cd MyOwnCode
docker build -f web/Dockerfile -t nekos-clipper-web .
docker run -p 8080:8080 -v $(pwd)/data:/data nekos-clipper-web
```

### Multi-arch (AMD64 + ARM64) — Raspberry Pi & plain VPS
The image is arch-agnostic (node base + apt ffmpeg + pip yt-dlp). Build both:
```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -f web/Dockerfile -t youruser/nekos-clipper-web --push .
```
Runs as-is on a **Raspberry Pi** (arm64) or any **CPU-only VPS** — `core/encoderDetector.js`
tests for a GPU encoder at startup, finds none, and uses CPU `libx264`.

The image installs ffmpeg + yt-dlp + python3 and runs the queue server on port 8080.
Persisted outputs live in the `/data` volume and are **auto-deleted after 24h** (configurable).

### Same image on a GPU VPS (NVIDIA)
No separate build — the **same** image, run with GPU access, gets `h264_nvenc` for free:
`core/encoderDetector.js` does a real 1-frame test-encode of each hardware encoder and
picks the first that actually works, falling back to CPU otherwise. To give it a GPU:

1. Install the **NVIDIA driver** + [**NVIDIA Container
   Toolkit**](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)
   on the VPS host (the toolkit is what lets `docker run --gpus all` mount the driver's
   encode libraries into the container — the container itself doesn't need CUDA installed).
2. Run with `--gpus all`:
   ```bash
   docker run --gpus all -p 8080:8080 -v $(pwd)/data:/data ghcr.io/<your-user>/<your-repo>:latest
   ```
3. That's it — `ENCODER=auto` (the default) picks NVENC automatically. `ENCODER=cpu` forces
   `libx264` if you ever need to rule the GPU path out. (`ENCODER=gpu` behaves the same as
   `auto` today — both silently fall back to CPU if no GPU encoder passes the test-encode.)

### Auto-build in CI (GitHub Container Registry)
`.github/workflows/docker-publish.yml` builds the multi-arch image on every push to
`main` (and on `v*` tags) and pushes it to **ghcr.io — not Docker Hub**. Pull & run:
```bash
docker run -p 8080:8080 -v $(pwd)/data:/data ghcr.io/<your-user>/<your-repo>:latest
```
No secrets to configure — it uses the built-in `GITHUB_TOKEN`. First push: make the
GHCR package public (or `docker login ghcr.io` to pull a private one).

## Config (env vars)
| Var | Default | Meaning |
|-----|---------|---------|
| `PORT` | 8080 | HTTP port |
| `DATA_DIR` | `web/data` | where jobs/uploads/outputs are stored |
| `MAX_UPLOAD_MB` | 4096 | max upload size |
| `MAX_CLIPS` | 12 | max clips rendered in "standard" mode (best-scoring, not just first-detected) |
| `MAX_MONTAGE_CLIPS` | 20 | max highlights chained into a "montage" render (same reasoning — the desktop app lets you deselect noisy detections before rendering; this queue has no review step, so a cap keeps a noisy detection pass from producing a bloated, near-full-length montage) |
| `ENCODER` | `auto` | `auto` / `gpu` / `cpu` — see the GPU VPS section above |
| `RETENTION_HOURS` | 24 | auto-delete job files older than this (cloud space saving) |
| `SUPPORT_KOFI` / `SUPPORT_PATREON` / `SUPPORT_PAYPAL` / `SUPPORT_GITHUB` | (off) | donate button URLs shown in the UI |
| `FFMPEG_PATH` / `FFPROBE_PATH` / `YTDLP_PATH` / `PYTHON_PATH` | system names | override tool locations |

## API
- `POST /api/jobs` — multipart (`video` file) or form fields: `url, mode, gameId, renderMode, musicSource`
- `GET /api/jobs` / `GET /api/jobs/:id` — status
- `GET /api/jobs/:id/events` — SSE progress
- `GET /api/jobs/:id/files/:name` — download an output
- `GET /api/games` · `GET /api/music/sources`

## Not yet (TODO)
- Persistent job store (currently in-memory — jobs reset on restart).
- Auth / rate limiting before exposing publicly.
- Music **picker** + previews (desktop has these; web only auto-picks a source for now).

## Multi-node render farm (planned design)
Goal: run **render nodes** on any Windows/Linux box (home PCs, spare servers) that
pull jobs from the web coordinator and encode, so the web app scales horizontally.

Proposed architecture (not built yet — separate focused effort):
1. **Coordinator** = this web server, but the queue becomes a shared store
   (Redis / BullMQ or a DB) instead of in-memory, so multiple workers can claim jobs.
2. **Node agent** (`web/node-agent.js`, to build) — a small standalone program you run
   on each render box. It:
   - registers with the coordinator (`POST /api/nodes/register` with a shared
     `NODE_TOKEN`), reports OS/arch + whether it has NVENC,
   - long-polls `POST /api/nodes/claim` for the next `queued` job,
   - downloads the source (or receives the uploaded file), runs the **same `core/`
     pipeline** locally, then uploads outputs back (`POST /api/jobs/:id/outputs`),
   - heartbeats so the coordinator can re-queue a job if a node dies.
3. The coordinator stops doing encoding itself when nodes are connected; it just
   dispatches and serves results. One job per node → "wait for one encoder to finish
   before the next" is preserved **per node**, with N nodes running in parallel.
4. Auth: a shared `NODE_TOKEN` (or per-node keys) so only your boxes can claim jobs.

Because `core/` already runs headless via `boot-tools.js`, the node agent reuses it
verbatim on both Windows and Linux. This is the next big build.
