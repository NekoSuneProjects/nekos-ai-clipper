// core/fpsDetector.js
//
// OCR Killfeed Detector (config-driven)
// - Reads per-game crops + keyword configs
// - Fuzzy matching for noisy OCR
// - Multi-crop OCR with event merging
// ------------------------------------------------------------

const ffmpeg = require("fluent-ffmpeg");
const { createWorker } = require("tesseract.js");
const { PassThrough } = require("stream");
const PNG = require("pngjs").PNG;
const fs = require("fs");
const path = require("path");

// Resolve ffmpeg + ffprobe lazily so requiring this module never crashes if
// global.TOOLS isn't ready yet. ffprobe lives in the same bin/ folder as ffmpeg
// but is NOT on PATH, so fluent-ffmpeg can't find it unless we point at it.
function configureFfmpegPaths() {
  const tools = global.TOOLS || {};
  if (tools.ffmpeg) ffmpeg.setFfmpegPath(tools.ffmpeg);

  const ffprobePath =
    tools.ffprobe ||
    (tools.ffmpeg ? path.join(path.dirname(tools.ffmpeg), "ffprobe.exe") : null);

  if (ffprobePath && fs.existsSync(ffprobePath)) {
    ffmpeg.setFfprobePath(ffprobePath);
  }
}
configureFfmpegPaths();

// PNG file signature — every PNG starts with these 8 bytes.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Local Tesseract language data so OCR works fully offline and in the packaged
// build (Tesseract's wasm core + worker already resolve from node_modules in
// Node/Electron — only the .traineddata is otherwise fetched from a CDN).
const TESSDATA_DIR = path.join(__dirname, "tessdata");

async function createOcrWorker() {
  const hasLocal = fs.existsSync(path.join(TESSDATA_DIR, "eng.traineddata"));

  let worker;
  if (hasLocal) {
    // gzip:false because our bundled file is the raw (uncompressed) traineddata.
    worker = await createWorker("eng", 1, {
      langPath: TESSDATA_DIR,
      cachePath: TESSDATA_DIR,
      cacheMethod: "none",
      gzip: false,
      logger: () => {}
    });
  } else {
    // Fallback: let tesseract.js fetch from its CDN (requires internet once).
    console.warn("Local eng.traineddata not found, falling back to CDN download.");
    worker = await createWorker("eng");
  }

  // Treat each crop as ONE uniform block of text (PSM 6) instead of running
  // full document layout analysis (PSM 3, the default). This stops Tesseract's
  // "image too small to scale / line cannot be recognized" spam on UI slivers
  // and improves accuracy on short killfeed strings.
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: "6",
      preserve_interword_spaces: "1"
    });
  } catch {}

  return worker;
}

const PRE_PAD_MS = 2000;
const POST_PAD_MS = 2000;
const MIN_EVENT_GAP_MS = 2000;
const GAME_CONFIG_DIR = path.join(__dirname, "gameConfigs");

const DEATH_WORDS = [
  "YOU DIED",
  "YOU ARE DEAD",
  "KILLED BY",
  "ELIMINATED BY",
  "DEFEATED BY",
  "YOU WERE KILLED",
  "YOU WERE ELIMINATED",
  "YOU WERE DOWNED",
  "DEATH"
];

// ------------------------------------------------------------
// Get duration using ffprobe
// ------------------------------------------------------------
async function getVideoDuration(videoPath) {
  return new Promise((resolve) => {
    if (!videoPath || typeof videoPath !== "string") return resolve(0);

    ffmpeg.ffprobe(videoPath, (err, data) => {
      if (err || !data || !data.format || !data.format.duration) {
        // Don't hard-fail: 0 just means we can't show an accurate %.
        console.warn("ffprobe failed for duration, progress will be approximate:", err && err.message);
        return resolve(0);
      }
      resolve(Number(data.format.duration) || 0);
    });
  });
}

// ------------------------------------------------------------
// Demux a concatenated PNG stream (ffmpeg image2pipe) into whole frames.
//
// image2pipe glues PNG files end-to-end and the readable stream hands us
// arbitrary byte slices, so we must reassemble complete PNGs ourselves by
// walking the chunk structure (IHDR ... IEND) rather than guessing.
// Consumed with `for await`, so OCR backpressure naturally throttles ffmpeg.
// ------------------------------------------------------------
function extractOnePng(buf) {
  // Need at least signature + first chunk header.
  if (buf.length < PNG_SIGNATURE.length + 8) return null;
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    // Resync: find the next signature, drop the garbage before it.
    const next = buf.indexOf(PNG_SIGNATURE, 1);
    if (next === -1) return { skip: buf.length };
    return { skip: next };
  }

  let offset = 8; // past signature
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const chunkEnd = offset + 12 + length; // len(4)+type(4)+data+crc(4)
    if (chunkEnd > buf.length) return null; // incomplete, wait for more bytes
    if (type === "IEND") return { end: chunkEnd };
    offset = chunkEnd;
  }
  return null; // header split across chunk boundary, wait for more
}

async function* pngFrameIterator(readable) {
  let buf = Buffer.alloc(0);
  for await (const chunk of readable) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    while (buf.length) {
      const r = extractOnePng(buf);
      if (!r) break;
      if (r.skip) { buf = buf.subarray(r.skip); continue; }
      yield buf.subarray(0, r.end);
      buf = buf.subarray(r.end);
    }
  }
}

// Cheap fingerprint of a cropped region so we can skip OCR on frames whose
// crop is visually identical to the previous one (killfeeds are static most
// of the time). Samples bytes rather than hashing everything.
function quickSig(buffer) {
  let sig = buffer.length >>> 0;
  const step = Math.max(1, Math.floor(buffer.length / 256));
  for (let i = 0; i < buffer.length; i += step) {
    sig = (sig * 31 + buffer[i]) >>> 0;
  }
  return sig;
}

// ------------------------------------------------------------
// OCR fuzzy matching helpers (Powder-like)
// ------------------------------------------------------------
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[m][n];
}

function normalize(text) {
  return String(text || "").toUpperCase().replace(/\s+/g, "");
}

function similarityScore(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  const maxLen = Math.max(na.length, nb.length);
  if (!maxLen) return 0;
  const dist = levenshtein(na, nb);
  return (1 - dist / maxLen) * 100;
}

function bestWindowScore(detected, wanted) {
  const d = normalize(detected);
  const w = normalize(wanted);
  if (!d || !w) return 0;
  if (d.length <= w.length) return similarityScore(d, w);

  let best = 0;
  const win = w.length;
  for (let i = 0; i <= d.length - win; i++) {
    const segment = d.slice(i, i + win);
    const score = similarityScore(segment, w);
    if (score > best) best = score;
  }
  return best;
}

function checkValues(detected, matchList, score) {
  if (!detected || !matchList || !matchList.length) return false;
  for (const value of matchList) {
    if (bestWindowScore(detected, value) >= score) return true;
  }
  return false;
}

// ------------------------------------------------------------
// Crop helpers
// ------------------------------------------------------------
function getCropRect(coords, width, height) {
  if (!coords || coords.length !== 4) return null;
  const [x1, y1, x2, y2] = coords;
  const left = Math.max(0, Math.floor(x1 * width));
  const top = Math.max(0, Math.floor(y1 * height));
  const right = Math.min(width, Math.ceil(x2 * width));
  const bottom = Math.min(height, Math.ceil(y2 * height));
  const w = right - left;
  const h = bottom - top;
  // Reject crops too small to OCR meaningfully (avoids Leptonica "image too
  // small to scale" spam from a malformed/near-empty crop rect).
  if (w < 8 || h < 8) return null;
  return { left, top, width: w, height: h };
}

// Crop the region, upscale small crops (nearest-neighbour), and optionally
// binarize on brightness. Thresholding is ESSENTIAL for stylized game fonts
// (e.g. Fortnite's italic callouts) on busy backgrounds — it isolates the white
// text so Tesseract can read it. Returns a PNG buffer.
function cropPngToBuffer(png, rect, opts = {}) {
  const crop = new PNG({ width: rect.width, height: rect.height });
  for (let y = 0; y < rect.height; y++) {
    const srcStart = ((rect.top + y) * png.width + rect.left) * 4;
    const dstStart = y * rect.width * 4;
    png.data.copy(crop.data, dstStart, srcStart, srcStart + rect.width * 4);
  }

  const minSide = Math.min(rect.width, rect.height);
  let scale = 1;
  if (minSide < 60) scale = Math.min(4, Math.ceil(96 / minSide));
  else if (minSide < 240) scale = 2;
  if (opts.threshold && scale < 2) scale = 2; // thresholded text reads better upscaled

  let img = crop;
  if (scale > 1) {
    const sw = rect.width * scale;
    const sh = rect.height * scale;
    const big = new PNG({ width: sw, height: sh });
    for (let y = 0; y < sh; y++) {
      const sy = (y / scale) | 0;
      for (let x = 0; x < sw; x++) {
        const sx = (x / scale) | 0;
        const s = (sy * rect.width + sx) * 4;
        const d = (y * sw + x) * 4;
        big.data[d] = crop.data[s];
        big.data[d + 1] = crop.data[s + 1];
        big.data[d + 2] = crop.data[s + 2];
        big.data[d + 3] = crop.data[s + 3];
      }
    }
    img = big;
  }

  if (opts.threshold) {
    const thr = opts.threshold;
    const data = img.data;
    for (let p = 0; p < data.length; p += 4) {
      const g = data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114;
      const v = g >= thr ? 255 : 0;
      data[p] = data[p + 1] = data[p + 2] = v;
    }
  }

  return PNG.sync.write(img);
}

// ------------------------------------------------------------
// Config loader
// ------------------------------------------------------------
function loadGameIndex() {
  const indexPath = path.join(GAME_CONFIG_DIR, "index.json");
  if (!fs.existsSync(indexPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(indexPath, "utf-8"));
  } catch {
    return [];
  }
}

function loadGameConfig(gameId) {
  const index = loadGameIndex();
  const fallback = index[0] ? index[0].id : "BF6";
  const id = String(gameId || process.env.GAME_ID || fallback || "BF6").toUpperCase();
  const filePath = path.join(GAME_CONFIG_DIR, id + ".json");

  if (!fs.existsSync(filePath)) {
    const fallbackPath = path.join(GAME_CONFIG_DIR, fallback + ".json");
    if (fs.existsSync(fallbackPath)) {
      return JSON.parse(fs.readFileSync(fallbackPath, "utf-8"));
    }
    return { id: id, name: id, fps: 4, crops: {} };
  }

  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function eventDisplayName(eventName, eventMap) {
  if (eventMap[eventName]) return eventMap[eventName];
  return String(eventName || "EVENT").replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase();
}

function eventCategory(eventName) {
  const name = String(eventName || "").toLowerCase();
  if (name.includes("death")) return "death";
  if (name.includes("double") || name.includes("triple") || name.includes("quad") || name.includes("reaper") || name.includes("spree") || name.includes("multi") || name.includes("rampage")) {
    return "killstreak";
  }
  if (name.includes("kill") || name.includes("knock") || name.includes("headshot") || name.includes("longshot") || name.includes("gadget") || name.includes("vehicule") || name.includes("vehicle")) {
    return "kill";
  }
  if (name.includes("victory") || name.includes("defeat")) return "event";
  if (name.includes("squadwipe") || name.includes("squad wipe")) return "killstreak";
  return "event";
}

function eventStreakCount(eventName) {
  const name = String(eventName || "").toLowerCase();
  if (name.includes("double")) return 2;
  if (name.includes("triple")) return 3;
  if (name.includes("quad")) return 4;
  if (name.includes("reaper") || name.includes("multi") || name.includes("spree") || name.includes("rampage")) return 5;
  return 0;
}

function buildHighlight(type, timeMs, tag, killstreak, index) {
  const startMs = Math.max(0, timeMs - PRE_PAD_MS);
  const endMs = timeMs + POST_PAD_MS;
  return {
    id: "f_" + type + "_" + index,
    type: type,
    tag: tag,
    tMs: timeMs,            // exact event time (used for kill clustering)
    startMs: startMs,
    endMs: endMs,
    killstreak: killstreak || 0,
    score: endMs - startMs
  };
}

// Merge consecutive KILLS into one continuous clip: if the player keeps killing
// within `gapMs` of the last kill, the clip extends; once they stop killing for
// `gapMs`, the clip ends (a few seconds after the final kill). This avoids 3
// overlapping clips for a 3-kill streak that all repeat the same footage.
const KILL_TYPES = ["kill", "killstreak", "headshot", "longshot"];

function mergeKillClusters(highlights, gapMs = 15000, tailMs = 3000) {
  const sorted = highlights.slice().sort((a, b) => a.startMs - b.startMs);
  const out = [];
  let cluster = null;

  const flush = () => {
    if (!cluster) return;
    if (cluster.members.length === 1) {
      out.push(cluster.members[0]); // lone kill — leave it untouched
    } else {
      const n = cluster.members.length;
      const tag = n === 2 ? "DOUBLE KILL" : n === 3 ? "TRIPLE KILL" : n === 4 ? "QUAD KILL" : `MULTI KILL x${n}`;
      out.push({
        id: "cluster_" + Math.round(cluster.firstMs),
        type: "killstreak",
        tag,
        tMs: cluster.lastKillMs,
        startMs: Math.max(0, cluster.firstMs - PRE_PAD_MS),
        endMs: cluster.lastKillMs + tailMs,         // end shortly after the LAST kill
        killstreak: n,
        score: (cluster.lastKillMs - cluster.firstMs) + n * 2000
      });
    }
    cluster = null;
  };

  for (const h of sorted) {
    const killTime = typeof h.tMs === "number" ? h.tMs : h.startMs + PRE_PAD_MS;
    if (!KILL_TYPES.includes(h.type)) { flush(); out.push(h); continue; }

    if (cluster && killTime - cluster.lastKillMs <= gapMs) {
      cluster.lastKillMs = killTime;
      cluster.members.push(h);
    } else {
      flush();
      cluster = { firstMs: killTime, lastKillMs: killTime, members: [h] };
    }
  }
  flush();

  out.sort((a, b) => a.startMs - b.startMs);
  return out;
}

// ------------------------------------------------------------
// Detect kills/deaths in FPS games by OCR of killfeed
// ------------------------------------------------------------
async function detectFPSKills(videoPath, options = {}, onProgress = () => {}) {
  if (typeof options === "function") {
    onProgress = options;
    options = {};
  }

  const game = loadGameConfig(options.gameId);
  const fps = game.fps || 4;
  const crops = game.crops || {};
  const cropNames = Object.keys(crops);

  if (game.autoKillfeedRight || !cropNames.length) {
    if (!crops.KillMessage) {
      crops.KillMessage = [0.70, 0.05, 0.98, 0.35];
    }
    if (!crops.StreakMessage) {
      crops.StreakMessage = [0.70, 0.05, 0.98, 0.25];
    }
  }

  const resolvedCropNames = Object.keys(crops);

  if (!resolvedCropNames.length) {
    throw new Error("No OCR crops configured for " + game.id);
  }

  // Make sure paths are wired even if this module was required before tools
  // finished downloading.
  configureFfmpegPaths();

  const durationSec = await getVideoDuration(videoPath);
  const totalFrames = durationSec > 0 ? Math.max(1, Math.floor(durationSec * fps)) : 0;

  const worker = await createOcrWorker();
  const stream = new PassThrough();

  const ocrResults = {};
  resolvedCropNames.forEach((name) => { ocrResults[name] = []; });

  // Per-crop OCR memo: skip Tesseract when the crop hasn't changed since the
  // previous frame (the common case — killfeed empty/unchanged).
  const lastSig = {};
  const lastText = {};
  resolvedCropNames.forEach((name) => { lastText[name] = ""; });

  let frameIndex = 0;

  const command = ffmpeg(videoPath)
    .outputOptions([
      "-vf", "fps=" + fps,
      "-c:v", "png"
    ])
    .format("image2pipe")
    .on("error", (err) => {
      // EPIPE/SIGKILL on stream teardown is expected; surface real errors.
      if (!/SIGKILL|EPIPE|premature/i.test(String(err && err.message))) {
        stream.destroy(err);
      }
    });

  command.pipe(stream);

  try {
    for await (const pngBuf of pngFrameIterator(stream)) {
      frameIndex++;

      const progress = totalFrames
        ? Math.min(99, Math.floor((frameIndex / totalFrames) * 100))
        : Math.min(99, frameIndex % 100);
      onProgress(progress);

      let png;
      try {
        png = PNG.sync.read(pngBuf);
      } catch {
        continue;
      }

      if (png.width < 40 || png.height < 20) continue;

      for (const cropName of resolvedCropNames) {
        const rect = getCropRect(crops[cropName], png.width, png.height);
        if (!rect) continue;

        const cropped = cropPngToBuffer(png, rect, { threshold: game.ocrThreshold || 0 });

        // Skip OCR if this crop is identical to the previous frame's.
        const sig = quickSig(cropped);
        if (sig === lastSig[cropName]) {
          ocrResults[cropName][frameIndex] = lastText[cropName];
          continue;
        }
        lastSig[cropName] = sig;

        try {
          const result = await worker.recognize(cropped);
          const text = String(result.data.text || "").toUpperCase();
          ocrResults[cropName][frameIndex] = text;
          lastText[cropName] = text;
        } catch {
          ocrResults[cropName][frameIndex] = "";
          lastText[cropName] = "";
        }
      }
    }
  } finally {
    try { await worker.terminate(); } catch {}
    try { command.kill("SIGKILL"); } catch {}
  }

  onProgress(100);

  const eventMap = {};
  (game.events || []).forEach((ev) => {
    if (ev && ev.name) eventMap[ev.name] = ev.displayName || ev.name;
  });

  const windows = game.windows || {};
  const detectors = game.detectors || {};

  const highlights = [];
  const lastEventTime = {};
  const totalDetectedFrames = frameIndex || 0;

  const getText = (cropName, idx) => (ocrResults[cropName] || [])[idx] || "";
  const allText = (idx) => resolvedCropNames.map((n) => getText(n, idx)).join(" ");

  // Per-game death words override the defaults (e.g. Fortnite uses different
  // wording than BF6). Death detection can be disabled per game.
  const deathWords = Array.isArray(game.deathWords) && game.deathWords.length
    ? game.deathWords
    : DEATH_WORDS;
  const detectDeath = game.detectDeath !== false;

  // Detectors may name their own crop; otherwise fall back to the standard ones.
  const cropFor = (config, fallback) =>
    (config && config.crop) || fallback;

  const checkFuture = (idx, windowLen, cropName, matchList, score) => {
    if (idx + windowLen >= totalDetectedFrames) return false;
    for (let i = 1; i <= Math.max(1, windowLen); i++) {
      const text = getText(cropName, idx + i);
      if (!checkValues(text, matchList, score)) return false;
    }
    return true;
  };

  for (let i = 1; i <= totalDetectedFrames; i++) {
    const timeMs = (i / fps) * 1000;

    // Death detection (global) — death banners can land in any crop, so scan
    // every configured region.
    if (detectDeath && checkValues(allText(i), deathWords, 82)) {
      const last = lastEventTime.death || 0;
      if (timeMs - last >= MIN_EVENT_GAP_MS) {
        lastEventTime.death = timeMs;
        highlights.push(buildHighlight("death", timeMs, "DEATH", 0, highlights.length));
      }
    }

    // Kill detection
    let killEvent = null;
    for (const config of detectors.kill || []) {
      const ok = checkFuture(i, windows.killFuture || 2, cropFor(config, "KillMessage"), config.match, config.score || 80);
      if (ok) killEvent = config.event;
    }

    if (killEvent) {
      const streakStart = windows.streakLookbehind || 0;
      const streakEnd = windows.streakLookahead || 8;
      for (let j = streakStart; j <= streakEnd; j++) {
        for (const config of detectors.streak || []) {
          const text = getText(cropFor(config, "StreakMessage"), i + j) || "";
          if (checkValues(text, config.match, config.score || 80)) {
            killEvent = config.event;
          }
        }
      }

      const category = eventCategory(killEvent);
      const tag = eventDisplayName(killEvent, eventMap);
      const streakCount = eventStreakCount(killEvent);
      const key = "kill_" + category + "_" + killEvent;

      if (!lastEventTime[key] || timeMs - lastEventTime[key] >= MIN_EVENT_GAP_MS) {
        lastEventTime[key] = timeMs;
        highlights.push(buildHighlight(category, timeMs, tag, streakCount, highlights.length));
      }
    }

    // Squad wipe
    for (const config of detectors.squadWipe || []) {
      const ok = checkFuture(i, windows.squadFuture || 2, cropFor(config, "KillMessage"), config.match, config.score || 80);
      if (!ok) continue;
      const tag = eventDisplayName(config.event, eventMap);
      const key = "squad_" + config.event;
      if (!lastEventTime[key] || timeMs - lastEventTime[key] >= MIN_EVENT_GAP_MS) {
        lastEventTime[key] = timeMs;
        highlights.push(buildHighlight("killstreak", timeMs, tag, 0, highlights.length));
      }
    }

    // End game / win-or-lose banners (victory, top placements, etc.)
    for (const config of detectors.endGame || []) {
      const ok = checkFuture(i, windows.endGameFuture || 2, cropFor(config, "GameResult"), config.match, config.score || 70);
      if (!ok) continue;
      const tag = eventDisplayName(config.event, eventMap);
      const key = "end_" + config.event;
      if (!lastEventTime[key] || timeMs - lastEventTime[key] >= MIN_EVENT_GAP_MS) {
        lastEventTime[key] = timeMs;
        highlights.push(buildHighlight("event", timeMs, tag, 0, highlights.length));
      }
    }
  }

  // Merge kill streaks into single continuous clips (configurable per game).
  const gapMs = Number(game.killClusterGapMs) > 0 ? Number(game.killClusterGapMs) : 15000;
  return mergeKillClusters(highlights, gapMs);
}

module.exports = { detectFPSKills, loadGameConfig };
