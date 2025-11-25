// core/fpsDetector.js
//
// SAFE + STABLE OCR Killfeed Detector
// - Auto crop based on resolution
// - Proper PNG decoding (pngjs)
// - Reject too-small frames before OCR
// - Progress reporting
// ------------------------------------------------------------

const ffmpeg = require("fluent-ffmpeg");
const { createWorker } = require("tesseract.js");
const { PassThrough } = require("stream");
const PNG = require("pngjs").PNG;
const fs = require("fs");
const path = require("path");

ffmpeg.setFfmpegPath(global.TOOLS.ffmpeg);

const FPS = 3;

const KILL_WORDS = [
  "ELIMINATED",
  "KILLED",
  "DOWNED",
  "HEADSHOT",
  "DEFEATED",
  "YOU KILLED",
  "TEAM WIPE"
];

// ------------------------------------------------------------
// Get duration using ffprobe
// ------------------------------------------------------------
async function getVideoDuration(videoPath) {
  return new Promise((resolve, reject) => {
    if (!videoPath || typeof videoPath !== "string")
      return reject(new Error("getVideoDuration: videoPath is empty"));

    ffmpeg.ffprobe(videoPath, (err, data) => {
      if (err) return reject(err);
      if (!data || !data.format || !data.format.duration)
        return reject(new Error("ffprobe returned no duration"));

      resolve(data.format.duration);
    });
  });
}

// ------------------------------------------------------------
// Extract frame dimensions by reading first PNG header
// ------------------------------------------------------------
function getPngDimensions(buffer) {
  try {
    const png = PNG.sync.read(buffer);
    return { width: png.width, height: png.height };
  } catch {
    return { width: 0, height: 0 };
  }
}

// ------------------------------------------------------------
// Detect kills in FPS games by OCR of killfeed
// ------------------------------------------------------------
async function detectFPSKills(videoPath, onProgress = () => {}) {

  const durationSec = await getVideoDuration(videoPath);
  const totalFrames = Math.floor(durationSec * FPS);

  // Setup OCR worker
  const worker = await createWorker("eng");
  const kills = [];

  let frameIndex = 0;
  let killstreak = 0;
  let lastKillTime = 0;

  const stream = new PassThrough();

  // ------------------------------------------------------------
  // Auto-size crop based on resolution — safer for multiple games
  // ------------------------------------------------------------
  let cropFilter = "crop=in_w*0.22:in_h*0.28:in_w*0.78:0";

  // Detect resolution (only once)
  await new Promise((resolve) => {
    ffmpeg(videoPath)
      .frames(1)
      .outputOptions("-vf scale=100:100") // quick small read
      .format("image2")
      .on("end", resolve)
      .save(path.join(__dirname, "tmp_header.png"));
  });

  if (fs.existsSync(path.join(__dirname, "tmp_header.png"))) {
    const buf = fs.readFileSync(path.join(__dirname, "tmp_header.png"));
    const dims = getPngDimensions(buf);
    fs.unlinkSync(path.join(__dirname, "tmp_header.png"));

    if (dims.width >= 1920) {
      cropFilter = "crop=in_w*0.20:in_h*0.25:in_w*0.80:0";  // HD killfeed area
    } else {
      cropFilter = "crop=in_w*0.30:in_h*0.30:in_w*0.70:0";  // low-res fallback
    }
  }

  // ------------------------------------------------------------
  // Start FFmpeg → PNG stream
  // ------------------------------------------------------------
  ffmpeg(videoPath)
    .outputOptions([
      `-vf fps=${FPS},${cropFilter}`,
      "-vcodec png"
    ])
    .format("image2pipe")
    .pipe(stream);

  // ------------------------------------------------------------
  // Process frames
  // ------------------------------------------------------------
  for await (const chunk of stream) {

    frameIndex++;
    const progress = Math.min(100, Math.floor((frameIndex / totalFrames) * 100));
    onProgress(progress);

    const timeMs = (frameIndex / FPS) * 1000;

    // 1. VALIDATE PNG SIZE BEFORE OCR
    const dims = getPngDimensions(chunk);

    // Skip too small
    if (dims.width < 40 || dims.height < 20) {
      continue;
    }

    // 2. OCR
    let result;
    try {
      result = await worker.recognize(chunk);
    } catch (err) {
      console.warn("OCR failed, skipping frame:", err.message);
      continue;
    }

    const text = result.data.text.toUpperCase();

    // 3. Match killfeed
    const isKill = KILL_WORDS.some((w) => text.includes(w));
    if (!isKill) continue;

    // 4. Killstreak logic
    if (timeMs - lastKillTime < 3000) killstreak++;
    else killstreak = 1;

    lastKillTime = timeMs;

    kills.push({
      timeMs,
      killstreak,
      type:
        killstreak === 1 ? "kill" :
        killstreak === 2 ? "double_kill" :
        killstreak === 3 ? "triple_kill" :
        killstreak <= 5 ? "multi_kill" : "rampage"
    });
  }

  await worker.terminate();
  return kills;
}

module.exports = { detectFPSKills };
