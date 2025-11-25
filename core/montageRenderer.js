// core/montageRenderer.js
const ffmpeg = require("fluent-ffmpeg");
const path = require("path");
const fs = require("fs");
const { getCinemaFxFilters } = require("./cinemaFx");

const { prepareTools } = require("../tools/toolsManager");
const { detectNVENC } = require("../core/nvencDetector");

// PATH FIX
function toPosix(p) { return p.replace(/\\/g, "/"); }
function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

// ---------- CONCAT FILE ----------
function buildConcatFile(highlights, concatPath, videoPath) {
  const safe = toPosix(videoPath);

  const content = highlights.map(h => {
    return `file '${safe}'\ninpoint ${h.startMs / 1000}\noutpoint ${h.endMs / 1000}\n`;
  }).join("\n");

  fs.writeFileSync(concatPath, content, "utf8");
}

// ---------- LANDSCAPE MONTAGE ----------
async function renderMontageNormal(videoPath, musicPath, highlights, outPath) {

  const tools = await prepareTools();
  ffmpeg.setFfmpegPath(tools.ffmpeg);
  const USE_NVENC = await detectNVENC(tools.ffmpeg);

  return new Promise((resolve, reject) => {
    const vfx = getCinemaFxFilters("normal");

    const totalDuration = highlights[highlights.length - 1].endMs / 1000;
    const fadeOutStart = Math.max(0, totalDuration - 2);

    const hasMusic = musicPath && musicPath.trim() !== "";

    let filterGraph;

    if (hasMusic) {
      // ------------------------------
      // MUSIC + GAME AUDIO
      // ------------------------------
      filterGraph = [
        `[0:v]${vfx}[vfx]`,
        `[1:a]volume=0.5[music_vol]`,
        `[music_vol]afade=t=in:st=0:d=1[music_in]`,
        `[music_in]afade=t=out:st=${fadeOutStart}:d=2[music_final]`,
        `[0:a][music_final]amix=inputs=2:weights=1 1:normalize=1[aout]`
      ].join(";");
    } else {
      // ------------------------------
      // **NO MUSIC** → ONLY GAME AUDIO
      // Keep video FX
      // ------------------------------
      filterGraph = [
        `[0:v]${vfx}[vfx]`,
        `[0:a]anull[aout]`
      ].join(";");
    }

    const cmd = ffmpeg()
      .input(toPosix(videoPath))
      .inputOptions([
        "-f concat",
        "-safe 0",
        "-fflags +genpts"
      ]);

    // Only add the music input if it exists
    if (hasMusic) {
      cmd.input(toPosix(musicPath));
    }

    cmd
      .complexFilter(filterGraph)
      .videoCodec(USE_NVENC ? "h264_nvenc" : "libx264")
      .audioCodec("aac")
      .outputOptions([
        "-map [vfx]",
        "-map [aout]",
        `-t ${totalDuration}`,
        "-shortest",
        "-pix_fmt yuv420p",
        "-profile:v high",
        "-level 4.2",
        "-video_track_timescale 90000",
        "-movflags +faststart",
        "-preset medium",
        "-y"
      ])
      .save(toPosix(outPath))
      .on("end", () => resolve(outPath))
      .on("error", reject);
  });
}

// ---------- VERTICAL MONTAGE ----------
async function renderMontageShort(inPath, outPath) {

  // ✔ Load tools first (yt-dlp, ffmpeg, python)
  const tools = await prepareTools();

  ffmpeg.setFfmpegPath(tools.ffmpeg);

  const USE_NVENC = await detectNVENC(tools.ffmpeg);

  return new Promise((resolve, reject) => {
    const vfx = getCinemaFxFilters("short");

    ffmpeg(toPosix(inPath))
      .videoFilters(vfx)
      .videoCodec(USE_NVENC ? "h264_nvenc" : "libx264")
      .audioCodec("aac")
      .outputOptions([
        "-y",
        "-pix_fmt yuv420p",
        "-profile:v high",
        "-level 4.2",
        "-video_track_timescale 90000",
        "-movflags +faststart",
        "-preset medium"
      ])
      .save(toPosix(outPath))
      .on("end", () => resolve(outPath))
      .on("error", reject);
  });
}

// ---------- MAIN ----------
async function renderMontage(videoPath, highlights, musicPath, outputDir) {
  ensureDir(outputDir);

  const concatFile = toPosix(path.join(outputDir, "concat.txt"));
  const outNormal = toPosix(path.join(outputDir, "montage_normal_fx.mp4"));
  const outShort = toPosix(path.join(outputDir, "montage_vertical_fx.mp4"));

  buildConcatFile(highlights, concatFile, videoPath);

  await renderMontageNormal(concatFile, musicPath, highlights, outNormal);
  await renderMontageShort(outNormal, outShort);

  return {
    normalOut: outNormal,
    shortOut: outShort
  };
}

module.exports = { renderMontage };