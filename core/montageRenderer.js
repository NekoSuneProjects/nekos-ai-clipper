// core/montageRenderer.js
const ffmpeg = require("fluent-ffmpeg");
const path = require("path");
const fs = require("fs");
const { getCinemaFxFilters } = require("./cinemaFx");

const { prepareTools } = require("../tools/toolsManager");
const { resolveCodec, encoderArgs } = require("../core/encoderDetector");

// PATH FIX
function toPosix(p) { return p.replace(/\\/g, "/"); }
function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

// "HH:MM:SS.xx" -> seconds
function timemarkToSec(tm) {
  if (!tm || typeof tm !== "string") return 0;
  const p = tm.split(":");
  if (p.length !== 3) return 0;
  return (parseFloat(p[0]) || 0) * 3600 + (parseFloat(p[1]) || 0) * 60 + (parseFloat(p[2]) || 0);
}

// ---------- CONCAT FILE ----------
function buildConcatFile(highlights, concatPath, videoPath) {
  const safe = toPosix(videoPath);

  const content = highlights.map(h => {
    return `file '${safe}'\ninpoint ${h.startMs / 1000}\noutpoint ${h.endMs / 1000}\n`;
  }).join("\n");

  fs.writeFileSync(concatPath, content, "utf8");
}

// Does this file have an audio stream? (Video-only recordings don't — referencing
// [0:a] in the filtergraph then fails with "Error binding filtergraph inputs".)
function hasAudioStream(videoPath) {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(videoPath, (err, data) => {
      if (err || !data || !Array.isArray(data.streams)) return resolve(false);
      resolve(data.streams.some((s) => s.codec_type === "audio"));
    });
  });
}

// ---------- LANDSCAPE MONTAGE ----------
async function renderMontageNormal(videoPath, musicPath, highlights, outPath, onProgress = () => {}, encoderPref = "auto", hasGameAudio = true) {

  const tools = await prepareTools();
  ffmpeg.setFfmpegPath(tools.ffmpeg);
  const enc = await resolveCodec(tools.ffmpeg, encoderPref);

  return new Promise((resolve, reject) => {
    const vfx = getCinemaFxFilters("normal");

    // Montage length = SUM of clip lengths, not the last clip's source timestamp.
    const totalDuration = highlights.reduce(
      (acc, h) => acc + Math.max(0, (h.endMs - h.startMs) / 1000),
      0
    );
    const fadeOutStart = Math.max(0, totalDuration - 2);
    const hasMusic = musicPath && musicPath.trim() !== "";

    // Build the audio graph based on what's actually available.
    let filterGraph;
    let audioMap = "[aout]";

    if (hasMusic && hasGameAudio) {
      filterGraph = [
        `[0:v]${vfx}[vfx]`,
        `[1:a]volume=0.5[music_vol]`,
        `[music_vol]afade=t=in:st=0:d=1[music_in]`,
        `[music_in]afade=t=out:st=${fadeOutStart}:d=2[music_final]`,
        `[0:a][music_final]amix=inputs=2:weights=1 1:normalize=1[aout]`
      ].join(";");
    } else if (hasMusic) {
      // Source has no audio → music only.
      filterGraph = [
        `[0:v]${vfx}[vfx]`,
        `[1:a]volume=0.8[music_vol]`,
        `[music_vol]afade=t=in:st=0:d=1[music_in]`,
        `[music_in]afade=t=out:st=${fadeOutStart}:d=2[aout]`
      ].join(";");
    } else if (hasGameAudio) {
      filterGraph = [`[0:v]${vfx}[vfx]`, `[0:a]anull[aout]`].join(";");
    } else {
      // No audio at all → video only.
      filterGraph = `[0:v]${vfx}[vfx]`;
      audioMap = null;
    }

    const cmd = ffmpeg()
      .input(toPosix(videoPath))
      .inputOptions(["-f concat", "-safe 0", "-fflags +genpts"]);

    // Loop the music so it covers the FULL montage even if the track is shorter
    // than the clips; -t caps it and afade handles the in/out.
    if (hasMusic) cmd.input(toPosix(musicPath)).inputOptions(["-stream_loop", "-1"]);

    cmd.complexFilter(filterGraph).videoCodec(enc.codec);

    const outOpts = ["-map", "[vfx]"];
    if (audioMap) {
      cmd.audioCodec("aac");
      outOpts.push("-map", audioMap);
    }
    outOpts.push(
      "-t", String(totalDuration),
      "-pix_fmt", "yuv420p",
      "-video_track_timescale", "90000",
      "-movflags", "+faststart",
      ...encoderArgs(enc.codec, "high"),
      "-y"
    );

    cmd.outputOptions(outOpts)
      .save(toPosix(outPath))
      .on("progress", (p) => {
        if (totalDuration > 0) {
          const pct = Math.min(99, (timemarkToSec(p.timemark) / totalDuration) * 100);
          onProgress(pct);
        }
      })
      .on("end", () => { onProgress(100); resolve(outPath); })
      .on("error", reject);
  });
}

// ---------- VERTICAL MONTAGE ----------
async function renderMontageShort(inPath, outPath, onProgress = () => {}, totalDuration = 0, encoderPref = "auto") {

  // ✔ Load tools first (yt-dlp, ffmpeg, python)
  const tools = await prepareTools();

  ffmpeg.setFfmpegPath(tools.ffmpeg);

  const enc = await resolveCodec(tools.ffmpeg, encoderPref);

  return new Promise((resolve, reject) => {
    const vfx = getCinemaFxFilters("short");

    ffmpeg(toPosix(inPath))
      .videoFilters(vfx)
      .videoCodec(enc.codec)
      .audioCodec("aac")
      .outputOptions([
        "-y",
        "-pix_fmt", "yuv420p",
        "-video_track_timescale", "90000",
        "-movflags", "+faststart",
        ...encoderArgs(enc.codec, "high")
      ])
      .save(toPosix(outPath))
      .on("progress", (p) => {
        if (totalDuration > 0) {
          const pct = Math.min(99, (timemarkToSec(p.timemark) / totalDuration) * 100);
          onProgress(pct);
        }
      })
      .on("end", () => { onProgress(100); resolve(outPath); })
      .on("error", reject);
  });
}

// ---------- MAIN ----------
// format: "normal" (16:9), "short" (9:16 TikTok), or "both"
async function renderMontage(videoPath, highlights, musicPath, outputDir, onProgress = () => {}, format = "both", encoderPref = "auto") {
  ensureDir(outputDir);

  const wantNormal = format === "normal" || format === "both";
  const wantShort = format === "short" || format === "both";

  const concatFile = toPosix(path.join(outputDir, "concat.txt"));
  const outNormal = toPosix(path.join(outputDir, "montage_normal_fx.mp4"));
  const outShort = toPosix(path.join(outputDir, "montage_vertical_fx.mp4"));

  const totalDuration = highlights.reduce(
    (acc, h) => acc + Math.max(0, (h.endMs - h.startMs) / 1000), 0
  );

  buildConcatFile(highlights, concatFile, videoPath);

  // Probe the source for audio so the montage doesn't reference a missing [0:a].
  const gameAudio = await hasAudioStream(videoPath);

  const result = {};

  // The vertical montage is built FROM the landscape one, so we always render
  // the landscape first (even if only "short" was requested) then derive short.
  const needLandscapeFirst = wantNormal || wantShort;
  const split = wantNormal && wantShort;

  if (needLandscapeFirst) {
    await renderMontageNormal(concatFile, musicPath, highlights, outNormal,
      (pct) => onProgress({ step: "Montage (landscape)", percent: split ? pct * 0.7 : pct }), encoderPref, gameAudio);
    if (wantNormal) result.normalOut = outNormal;
  }
  if (wantShort) {
    await renderMontageShort(outNormal, outShort,
      (pct) => onProgress({ step: "Montage (vertical)", percent: split ? 70 + pct * 0.3 : pct }), totalDuration, encoderPref);
    result.shortOut = outShort;
    if (!wantNormal) { try { fs.unlinkSync(outNormal); } catch {} }
  }

  onProgress({ step: "Done", percent: 100 });
  return result;
}

module.exports = { renderMontage };
