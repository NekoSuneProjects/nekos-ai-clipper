// core/standardRender.js

const ffmpeg = require("fluent-ffmpeg");
const path = require("path");
const fs = require("fs");
const { prepareTools } = require("../tools/toolsManager");
const { detectNVENC } = require("../core/nvencDetector");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function buildBaseCmd(video) {

  // ✔ Load tools first (yt-dlp, ffmpeg, python)
  const tools = await prepareTools();
  const USE_NVENC = await detectNVENC(tools.ffmpeg);

  ffmpeg.setFfmpegPath(tools.ffmpeg);

  const cmd = ffmpeg(video);

  // Clean encoding
  if (USE_NVENC) cmd.videoCodec("h264_nvenc");
  else cmd.videoCodec("libx264");

  cmd.audioCodec("aac");

  cmd.outputOptions([
    "-preset fast",
    "-movflags +faststart"
  ]);

  return cmd;
}

// ----------------------------------------------------------
// NORMAL CLEAN EXPORT (NO FX)
// ----------------------------------------------------------
async function renderNormal(video, startMs, endMs, outDir) {
  ensureDir(outDir);

  const name = path.basename(video, path.extname(video));
  const out = path.join(outDir, `${name}_${startMs}-${endMs}_normal_clean.mp4`);

  // ⬅️ FIX: await the command builder
  const cmd = await buildBaseCmd(video);

  return new Promise((resolve, reject) => {
    cmd.setStartTime(startMs / 1000)
      .setDuration((endMs - startMs) / 1000)
      .output(out)
      .on("end", () => resolve(out))
      .on("error", reject)
      .run();
  });
}

// ----------------------------------------------------------
// SHORTS CLEAN EXPORT (NO FX)
// Still converts to 1080x1920 but without color grading or FX
// ----------------------------------------------------------
async function renderShort(video, startMs, endMs, outDir) {
  ensureDir(outDir);

  const name = path.basename(video, path.extname(video));
  const out = path.join(outDir, `${name}_${startMs}-${endMs}_short_clean.mp4`);

  // ⬅️ FIX: await the command builder
  const cmd = await buildBaseCmd(video);

  return new Promise((resolve, reject) => {
    cmd.setStartTime(startMs / 1000)
      .setDuration((endMs - startMs) / 1000)
      .videoFilters([
        "scale=1080:1920:force_original_aspect_ratio=decrease",
        "pad=1080:1920:(ow-iw)/2:(oh-ih)/2"
      ])
      .output(out)
      .on("end", () => resolve(out))
      .on("error", reject)
      .run();
  });
}

// ----------------------------------------------------------
async function renderStandardClip(video, startMs, endMs, outputDir) {
  const normal = await renderNormal(video, startMs, endMs, outputDir);
  const short = await renderShort(video, startMs, endMs, outputDir);

  return { normal, short };
}

module.exports = {
  renderStandardClip
};
