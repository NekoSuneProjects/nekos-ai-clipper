// web/server.js
//
// Cloud web version of the AI clipper. Reuses the SAME core/ pipeline as the
// desktop app, behind a 1-at-a-time job queue. Input: VOD/stream URL OR upload.
// Live screen capture is desktop-only (needs a display/GPU) so it's not here.

require("./boot-tools"); // MUST be first — points core/* at system ffmpeg/yt-dlp

const path = require("path");
const fs = require("fs");
const express = require("express");
const multer = require("multer");

const { JobQueue } = require("./queue");

// Core pipeline (loaded AFTER boot-tools so global.TOOLS is set)
const { analyseVideo } = require("../core/analyser");
const { downloadVod } = require("../core/vodDownloader");
const { renderMontage } = require("../core/montageRenderer");
const { renderStandardClip } = require("../core/standardRender");
const musicLibrary = require("../core/musicLibrary");

const PORT = process.env.PORT || 8080;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const OUTPUT_DIR = path.join(DATA_DIR, "jobs");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_STANDARD_CLIPS = Number(process.env.MAX_CLIPS || 12);
const ENCODER_PREF = process.env.ENCODER || "auto"; // "auto" | "gpu" | "cpu"

// ---------------------------------------------------------------------------
// The worker: download/use input -> analyse -> render. Reuses core modules.
// ---------------------------------------------------------------------------
async function processJob(job, onProgress) {
  const jobDir = path.join(OUTPUT_DIR, job.id);
  fs.mkdirSync(jobDir, { recursive: true });

  // 1) Resolve the source video
  let videoPath = job.filePath || null;
  if (!videoPath && job.url) {
    onProgress({ step: "downloading", progress: 0 });
    videoPath = await downloadVod(job.url, jobDir, (p) =>
      onProgress({ step: "downloading", progress: Math.floor(p) })
    );
  }
  if (!videoPath || !fs.existsSync(videoPath)) {
    throw new Error("No input video (provide a url or upload a file).");
  }
  job.videoPath = videoPath;

  // 2) Analyse — map content type to analyser mode.
  //    gaming -> audio + auto game detection (gameConfig); reactions/irl -> audio.
  const analyserMode = job.mode === "gaming" ? "both" : "reaction";
  onProgress({ step: "analysing", progress: 0 });
  const highlights = await analyseVideo(
    videoPath,
    analyserMode,
    { gameId: job.gameId },
    (p) => onProgress(p)
  );
  job.highlights = highlights;
  job.highlightCount = highlights.length;

  if (!highlights.length) {
    onProgress({ step: "done", progress: 100 });
    return;
  }

  // 3) Render — format: "normal" | "short" | "both"
  const format = ["normal", "short", "both"].includes(job.format) ? job.format : "both";
  const outputs = [];
  if (job.renderMode === "montage") {
    onProgress({ step: "rendering_montage", progress: 0 });
    let musicPath = null;
    const onMusicProg = (p) => onProgress({ step: "downloading_music", progress: Math.floor(p) });
    try {
      if (job.musicId || job.musicUrl) {
        // A specific track was picked
        const m = await musicLibrary.getTrack(
          { id: job.musicId, url: job.musicUrl, collectionId: job.musicCollection, title: job.musicTitle, artist: job.musicArtist },
          onMusicProg
        );
        musicPath = m.path;
        job.musicCredit = m.creditRequired === false ? null : m.attribution;
      } else if (job.musicSource) {
        // Just a source → random auto-pick
        const m = await musicLibrary.getAutoTrack({ collectionId: job.musicSource, seed: Date.now() }, onMusicProg);
        musicPath = m.path;
        job.musicCredit = m.creditRequired === false ? null : m.attribution;
      }
    } catch (e) {
      job.musicError = String(e.message || e);
    }
    const res = await renderMontage(videoPath, highlights, musicPath, jobDir,
      (p) => onProgress(p), format, ENCODER_PREF);
    if (res.normalOut) outputs.push({ type: "montage", file: path.basename(res.normalOut) });
    if (res.shortOut) outputs.push({ type: "vertical", file: path.basename(res.shortOut) });
  } else {
    // standard: render the top highlights as individual clips
    const top = highlights.slice(0, MAX_STANDARD_CLIPS);
    let i = 0;
    for (const h of top) {
      i += 1;
      onProgress({ step: "rendering_clips", progress: Math.floor((i / top.length) * 100) });
      try {
        const r = await renderStandardClip(videoPath, h.startMs, h.endMs, jobDir, () => {}, format, ENCODER_PREF);
        if (r.normal) outputs.push({ type: "clip", tag: h.tag, file: path.basename(r.normal) });
        if (r.short) outputs.push({ type: "short", tag: h.tag, file: path.basename(r.short) });
      } catch (e) { /* skip a failed clip */ }
    }
  }
  job.outputs = outputs;
  onProgress({ step: "done", progress: 100 });
}

const queue = new JobQueue(processJob);

// ---------------------------------------------------------------------------
// HTTP API
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: Number(process.env.MAX_UPLOAD_MB || 4096) * 1024 * 1024 },
});

function publicJob(j) {
  return {
    id: j.id, status: j.status, progress: j.progress, step: j.step,
    mode: j.mode, gameId: j.gameId, renderMode: j.renderMode,
    url: j.url, fileName: j.fileName, error: j.error,
    highlightCount: j.highlightCount, outputs: j.outputs,
    musicCredit: j.musicCredit, position: queue.position(j.id),
    createdAt: j.createdAt,
  };
}

// List games (from the shared gameConfigs index)
app.get("/api/games", (_req, res) => {
  try {
    const idx = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "core", "gameConfigs", "index.json"), "utf8"));
    res.json(idx.sort((a, b) => a.name.localeCompare(b.name)));
  } catch (e) { res.json([]); }
});

// Music sources
app.get("/api/music/sources", (_req, res) => {
  try { res.json(musicLibrary.listCollections()); } catch { res.json([]); }
});

// Expand one source into a song list for the picker
app.get("/api/music/items", async (req, res) => {
  try {
    const id = req.query.collection;
    const max = Math.min(120, Number(req.query.max) || 60);
    if (!id || id === "curated") {
      return res.json({ ok: true, items: musicLibrary.listTracks() });
    }
    const col = musicLibrary.listCollections().find((c) => c.id === id);
    if (!col) return res.json({ ok: false, error: "Unknown source" });
    const items = await musicLibrary.listCollectionItems(col, max);
    res.json({ ok: true, items, warning: col.warning, creditRequired: col.creditRequired !== false });
  } catch (err) {
    res.json({ ok: false, error: String(err) });
  }
});

// Stream a ~30s preview of a track (downloaded + cached server-side)
app.get("/api/music/preview", async (req, res) => {
  try {
    const file = await musicLibrary.previewTrack(req.query.url || req.query.id);
    res.sendFile(file);
  } catch (err) {
    res.status(500).end(String(err));
  }
});

// Supporter / donate links (configured via env so you can set your own)
app.get("/api/support", (_req, res) => {
  const links = [];
  if (process.env.SUPPORT_KOFI) links.push({ label: "☕ Ko-fi", url: process.env.SUPPORT_KOFI });
  if (process.env.SUPPORT_PATREON) links.push({ label: "🅿️ Patreon", url: process.env.SUPPORT_PATREON });
  if (process.env.SUPPORT_PAYPAL) links.push({ label: "💵 PayPal", url: process.env.SUPPORT_PAYPAL });
  if (process.env.SUPPORT_GITHUB) links.push({ label: "💖 GitHub Sponsors", url: process.env.SUPPORT_GITHUB });
  res.json({ links, message: process.env.SUPPORT_MESSAGE || "" });
});

// Submit a job (URL via JSON, or file via multipart field "video")
app.post("/api/jobs", upload.single("video"), (req, res) => {
  const body = req.body || {};
  const url = (body.url || "").trim();
  if (!url && !req.file) {
    return res.status(400).json({ error: "Provide a 'url' or upload a 'video' file." });
  }
  const job = queue.add({
    url: url || null,
    filePath: req.file ? req.file.path : null,
    fileName: req.file ? req.file.originalname : null,
    mode: body.mode || "reaction",
    gameId: body.gameId || null,
    renderMode: body.renderMode === "montage" ? "montage" : "standard",
    musicSource: body.musicSource || null,
    musicId: body.musicId || null,
    musicUrl: body.musicUrl || null,
    musicCollection: body.musicCollection || null,
    musicTitle: body.musicTitle || null,
    musicArtist: body.musicArtist || null,
    format: ["normal", "short", "both"].includes(body.format) ? body.format : "both",
  });
  res.json(publicJob(job));
});

app.get("/api/jobs", (_req, res) => res.json(queue.list().map(publicJob)));

app.get("/api/jobs/:id", (req, res) => {
  const j = queue.get(req.params.id);
  if (!j) return res.status(404).json({ error: "not found" });
  res.json(publicJob(j));
});

// SSE live progress for one job
app.get("/api/jobs/:id/events", (req, res) => {
  const j = queue.get(req.params.id);
  if (!j) return res.status(404).end();
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const send = (job) => {
    if (job.id !== req.params.id) return;
    res.write(`data: ${JSON.stringify(publicJob(job))}\n\n`);
    if (job.status === "done" || job.status === "error") res.end();
  };
  send(j);
  const onUpdate = (job) => send(job);
  queue.on("update", onUpdate);
  req.on("close", () => queue.off("update", onUpdate));
});

// Download an output file
app.get("/api/jobs/:id/files/:name", (req, res) => {
  const j = queue.get(req.params.id);
  if (!j) return res.status(404).end();
  const safe = path.basename(req.params.name);
  const file = path.join(OUTPUT_DIR, j.id, safe);
  if (!fs.existsSync(file)) return res.status(404).end();
  res.sendFile(file);
});

// ---------------------------------------------------------------------------
// Auto-cleanup: delete job output folders + uploads older than RETENTION_HOURS
// (default 24h) to save cloud disk. Runs hourly.
// ---------------------------------------------------------------------------
const RETENTION_MS = Number(process.env.RETENTION_HOURS || 24) * 3600 * 1000;
function cleanupOldFiles() {
  const now = Date.now();
  for (const dir of [OUTPUT_DIR, UPLOAD_DIR]) {
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      const full = path.join(dir, name);
      try {
        const st = fs.statSync(full);
        if (now - st.mtimeMs > RETENTION_MS) {
          fs.rmSync(full, { recursive: true, force: true });
          // Drop the job from memory too
          if (dir === OUTPUT_DIR && queue.get(name)) queue.jobs.delete(name);
          console.log("Cleaned up old:", full);
        }
      } catch {}
    }
  }
}
setInterval(cleanupOldFiles, 3600 * 1000);
cleanupOldFiles();

app.listen(PORT, () => {
  console.log(`Nekos AI Clipper (web) listening on http://0.0.0.0:${PORT}`);
  console.log(`Tools: ffmpeg=${global.TOOLS.ffmpeg} ytdlp=${global.TOOLS.ytdlp}`);
  console.log(`Auto-delete files older than ${RETENTION_MS / 3600000}h`);
});
