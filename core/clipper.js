// core/clipper.js
const path = require("path");
const fs = require("fs");
const ffmpeg = require("fluent-ffmpeg");

ffmpeg.setFfmpegPath(global.TOOLS.ffmpeg);

// Toggle this depending on your GPU / drivers.
// GTX 900+ usually supports nvenc on Windows with correct drivers.
const USE_NVENC = true;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function buildCommand(inputPath) {
  const cmd = ffmpeg(inputPath);

  if (USE_NVENC) {
    cmd.videoCodec("h264_nvenc");
  } else {
    cmd.videoCodec("libx264");
  }

  cmd.audioCodec("aac");
  cmd.outputOptions(["-preset fast", "-movflags +faststart"]);

  return cmd;
}

// Normal landscape clip (16:9-ish)
function createNormalClip(videoPath, startMs, endMs, outputDir) {
  return new Promise((resolve, reject) => {
    ensureDir(outputDir);

    const baseName = path.basename(videoPath, path.extname(videoPath));
    const clipName = `${baseName}_${Math.round(startMs)}-${Math.round(
      endMs
    )}_normal.mp4`;
    const outPath = path.join(outputDir, clipName);

    const startSec = startMs / 1000;
    const durationSec = (endMs - startMs) / 1000;

    const cmd = buildCommand(videoPath)
      .setStartTime(startSec)
      .setDuration(durationSec)
      // scale to width = 1920 (keep aspect)
      .videoFilters("scale=1920:-2,setsar=1:1")
      .output(outPath)
      .on("end", () => resolve(outPath))
      .on("error", (err) => reject(err));

    cmd.run();
  });
}

// Vertical short (9:16) for TikTok/Shorts/Reels
function createShortClip(videoPath, startMs, endMs, outputDir) {
  return new Promise((resolve, reject) => {
    ensureDir(outputDir);

    const baseName = path.basename(videoPath, path.extname(videoPath));
    const clipName = `${baseName}_${Math.round(startMs)}-${Math.round(
      endMs
    )}_short.mp4`;
    const outPath = path.join(outputDir, clipName);

    const startSec = startMs / 1000;
    const durationSec = (endMs - startMs) / 1000;

    // scale to height 1920, crop center to 1080x1920 (9:16)
    const vf = "scale=-2:1920,crop=1080:1920,setsar=1:1";

    const cmd = buildCommand(videoPath)
      .setStartTime(startSec)
      .setDuration(durationSec)
      .videoFilters(vf)
      .output(outPath)
      .on("end", () => resolve(outPath))
      .on("error", (err) => reject(err));

    cmd.run();
  });
}

// Create BOTH normal + short clips
async function createClipPair(videoPath, startMs, endMs, outputDir) {
  const normal = await createNormalClip(videoPath, startMs, endMs, outputDir);
  const short = await createShortClip(videoPath, startMs, endMs, outputDir);
  return { normal, short };
}

module.exports = {
  createClipPair
};
