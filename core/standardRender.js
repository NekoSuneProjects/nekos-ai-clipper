// core/standardRender.js

const ffmpeg = require("fluent-ffmpeg");
const path = require("path");
const fs = require("fs");
const { prepareTools } = require("../tools/toolsManager");
const { resolveCodec, encoderArgs } = require("../core/encoderDetector");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function timemarkToSec(tm) {
  if (!tm || typeof tm !== "string") return 0;
  const p = tm.split(":");
  if (p.length !== 3) return 0;
  return (parseFloat(p[0]) || 0) * 3600 + (parseFloat(p[1]) || 0) * 60 + (parseFloat(p[2]) || 0);
}

async function buildBaseCmd(video, encoderPref = "auto") {

  // ✔ Load tools first (yt-dlp, ffmpeg, python)
  const tools = await prepareTools();
  ffmpeg.setFfmpegPath(tools.ffmpeg);

  // Pick GPU (NVENC/AMF/QSV) or CPU per the user's preference, verified working.
  const enc = await resolveCodec(tools.ffmpeg, encoderPref);

  const cmd = ffmpeg(video);
  cmd.videoCodec(enc.codec);
  cmd.audioCodec("aac");
  cmd.outputOptions([...encoderArgs(enc.codec, "high"), "-movflags", "+faststart"]);

  return cmd;
}

// ----------------------------------------------------------
// NORMAL CLEAN EXPORT (NO FX)
// ----------------------------------------------------------
async function renderNormal(video, startMs, endMs, outDir, onProgress = () => {}, encoderPref = "auto") {
  ensureDir(outDir);

  const name = path.basename(video, path.extname(video));
  const out = path.join(outDir, `${name}_${startMs}-${endMs}_normal_clean.mp4`);
  const dur = (endMs - startMs) / 1000;

  // ⬅️ FIX: await the command builder
  const cmd = await buildBaseCmd(video, encoderPref);

  return new Promise((resolve, reject) => {
    cmd.setStartTime(startMs / 1000)
      .setDuration(dur)
      .output(out)
      .on("progress", (p) => { if (dur > 0) onProgress(Math.min(99, (timemarkToSec(p.timemark) / dur) * 100)); })
      .on("end", () => { onProgress(100); resolve(out); })
      .on("error", reject)
      .run();
  });
}

// ----------------------------------------------------------
// SHORTS CLEAN EXPORT (NO FX)
// Still converts to 1080x1920 but without color grading or FX
// ----------------------------------------------------------
async function renderShort(video, startMs, endMs, outDir, onProgress = () => {}, encoderPref = "auto") {
  ensureDir(outDir);

  const name = path.basename(video, path.extname(video));
  const out = path.join(outDir, `${name}_${startMs}-${endMs}_short_clean.mp4`);
  const dur = (endMs - startMs) / 1000;

  // ⬅️ FIX: await the command builder
  const cmd = await buildBaseCmd(video, encoderPref);

  return new Promise((resolve, reject) => {
    cmd.setStartTime(startMs / 1000)
      .setDuration(dur)
      .videoFilters([
        "scale=1080:1920:force_original_aspect_ratio=decrease",
        "pad=1080:1920:(ow-iw)/2:(oh-ih)/2"
      ])
      .output(out)
      .on("progress", (p) => { if (dur > 0) onProgress(Math.min(99, (timemarkToSec(p.timemark) / dur) * 100)); })
      .on("end", () => { onProgress(100); resolve(out); })
      .on("error", reject)
      .run();
  });
}

// ----------------------------------------------------------
// format: "normal" (16:9), "short" (9:16 TikTok), or "both"
async function renderStandardClip(video, startMs, endMs, outputDir, onProgress = () => {}, format = "both", encoderPref = "auto") {
  const wantNormal = format === "normal" || format === "both";
  const wantShort = format === "short" || format === "both";
  const out = {};

  if (wantNormal && wantShort) {
    out.normal = await renderNormal(video, startMs, endMs, outputDir,
      (pct) => onProgress({ step: "Clip (landscape)", percent: pct * 0.6 }), encoderPref);
    out.short = await renderShort(video, startMs, endMs, outputDir,
      (pct) => onProgress({ step: "Clip (vertical)", percent: 60 + pct * 0.4 }), encoderPref);
  } else if (wantNormal) {
    out.normal = await renderNormal(video, startMs, endMs, outputDir,
      (pct) => onProgress({ step: "Clip (landscape)", percent: pct }), encoderPref);
  } else {
    out.short = await renderShort(video, startMs, endMs, outputDir,
      (pct) => onProgress({ step: "Clip (vertical)", percent: pct }), encoderPref);
  }

  onProgress({ step: "Done", percent: 100 });
  return out;
}

module.exports = {
  renderStandardClip
};
