// core/analyser.js
//
// Audio reactions + FPS kill/streak detector combined highlight generator

const fs = require("fs");
const os = require("os");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const WavDecoder = require("wav-decoder");

const { detectFPSKills } = require("./fpsDetector");
const { prepareTools } = require("../tools/toolsManager");

// ------------------------------------------------------------
// Convert type → UI TAG
// ------------------------------------------------------------
function getTag(type, killstreak) {
  if (type === "kill") return "KILL";
  if (type === "killstreak") return `STREAK x${killstreak}`;
  return "REACTION";
}

// ------------------------------------------------------------
// Extract WAV audio
// ------------------------------------------------------------
async function extractAudioToWav(videoPath, outPath, onProgress = () => { }) {

  // ✔ Load tools first (yt-dlp, ffmpeg, python)
  const tools = await prepareTools();

  ffmpeg.setFfmpegPath(tools.ffmpeg);

  return new Promise((resolve, reject) => {

    const cmd = ffmpeg(videoPath)
      .noVideo()
      .audioChannels(1)
      .audioFrequency(16000)
      .audioCodec("pcm_s16le")
      .format("wav")
      .output(outPath);

    let duration = 0;

    // get duration first
    ffmpeg.ffprobe(videoPath, (err, data) => {
      if (!err && data.format && data.format.duration) {
        duration = data.format.duration;
      }
    });

    cmd.on("progress", (p) => {
      if (!duration) return;
      if (!p.timemark) return;

      const parts = p.timemark.split(":");
      const sec =
        parseFloat(parts[0]) * 3600 +
        parseFloat(parts[1]) * 60 +
        parseFloat(parts[2]);

      const percent = Math.min(100, Math.floor((sec / duration) * 100));
      onProgress(percent);
    });

    cmd.on("end", () => resolve(outPath));
    cmd.on("error", reject);

    cmd.run();
  });
}


// Does this file have an audio stream? (Video-only recordings don't, and
// trying to extract a WAV from them makes ffmpeg fail with "Invalid argument".)
async function hasAudioStream(videoPath) {
  const tools = await prepareTools();
  if (tools.ffprobe) ffmpeg.setFfprobePath(tools.ffprobe);
  return new Promise((resolve) => {
    ffmpeg.ffprobe(videoPath, (err, data) => {
      if (err || !data || !Array.isArray(data.streams)) return resolve(false);
      resolve(data.streams.some((s) => s.codec_type === "audio"));
    });
  });
}

async function readWavSamples(wavPath) {
  const buffer = fs.readFileSync(wavPath);
  const decoded = await WavDecoder.decode(buffer);
  return {
    samples: decoded.channelData[0],
    sampleRate: decoded.sampleRate
  };
}

function getPercentile(values, p) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}

// ------------------------------------------------------------
// Audio reaction detector
// ------------------------------------------------------------
function analyseAudioReactions(samples, sampleRate, opts = {}, onProgress = () => { }) {
  const windowMs = opts.windowMs ?? 500;
  const hopMs = opts.hopMs ?? 250;
  const minSegmentMs = opts.minSegmentMs ?? 1500;
  const mergeGapMs = opts.mergeGapMs ?? 2000;
  const padBeforeMs = opts.padBeforeMs ?? 2000;
  const padAfterMs = opts.padAfterMs ?? 2000;

  const winSize = Math.floor(sampleRate * windowMs / 1000);
  const hopSize = Math.floor(sampleRate * hopMs / 1000);

  if (winSize <= 0 || hopSize <= 0) return [];

  // -----------------------------
  // PASS 1 — compute RMS windows
  // -----------------------------
  const windows = [];
  let pos = 0;
  let total = samples.length - winSize;

  while (pos + winSize <= samples.length) {
    let sum = 0;
    for (let i = 0; i < winSize; i++) sum += samples[pos + i] ** 2;

    const rms = Math.sqrt(sum / winSize);
    const centerMs = ((pos + winSize / 2) / sampleRate) * 1000;
    windows.push({ centerMs, rms });

    pos += hopSize;

    // Progress: RMS calculation (30% of total audio analysis)
    onProgress(Math.floor((windows.length / (total / hopSize)) * 30));
  }

  if (!windows.length) return [];

  // -----------------------------
  // PASS 2 — normalize RMS
  // -----------------------------
  const rmsValues = windows.map((w) => w.rms);
  const rmsScale = getPercentile(rmsValues, 0.95) || Math.max(...rmsValues);
  if (rmsScale <= 0) return [];

  windows.forEach((w, i) => {
    w.rmsNorm = w.rms / rmsScale;
    if (w.rmsNorm > 1.5) w.rmsNorm = 1.5;

    onProgress(30 + Math.floor((i / windows.length) * 20));
  });

  // -----------------------------
  // PASS 3 — detect change deltas
  // -----------------------------
  const deltas = [0];
  for (let i = 1; i < windows.length; i++) {
    deltas.push(Math.abs(windows[i].rmsNorm - windows[i - 1].rmsNorm));

    // 80% → 90%
    onProgress(50 + Math.floor((i / windows.length) * 40));
  }

  const maxDelta = Math.max(...deltas);
  const deltaNorm = maxDelta > 0 ? deltas.map(d => d / maxDelta) : deltas;

  // -----------------------------
  // PASS 4 — reaction logic
  // -----------------------------
  const flags = [];
  const rmsNormValues = windows.map((w) => w.rmsNorm);
  const noiseFloor = getPercentile(rmsNormValues, 0.2);

  const loudThreshold = Math.max(
    0.35,
    getPercentile(rmsNormValues, 0.9),
    noiseFloor + 0.2
  );

  const midThreshold = Math.max(
    0.2,
    getPercentile(rmsNormValues, 0.7),
    noiseFloor + 0.1
  );

  const deltaThreshold = Math.max(0.2, getPercentile(deltaNorm, 0.85));

  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];
    const d = deltaNorm[i];

    const loud = w.rmsNorm >= loudThreshold;
    const jump = w.rmsNorm >= midThreshold && d >= deltaThreshold;

    flags.push(loud || jump);

    // 90% → 100%
    onProgress(90 + Math.floor((i / windows.length) * 10));
  }

  // -----------------------------
  // PASS 5 — grouping & merging
  // -----------------------------
  const segments = [];
  let start = null;
  let last = null;

  for (let i = 0; i < windows.length; i++) {
    if (!flags[i]) continue;

    const w = windows[i];

    if (start === null) {
      start = w.centerMs - windowMs / 2;
      last = w.centerMs;
    } else {
      if (w.centerMs - last > hopMs * 2.5) {
        const end = last + windowMs / 2;
        if (end - start >= minSegmentMs) {
          segments.push({ startMs: start, endMs: end });
        }
        start = w.centerMs - windowMs / 2;
      }
      last = w.centerMs;
    }
  }

  if (start !== null && last !== null) {
    const end = last + windowMs / 2;
    if (end - start >= minSegmentMs) {
      segments.push({ startMs: start, endMs: end });
    }
  }

  // -----------------------------
  // Build final highlight objects
  // -----------------------------
  return segments.map((seg, i) => {
    const startMs = Math.max(0, seg.startMs - padBeforeMs);
    const endMs = seg.endMs + padAfterMs;

    return {
      id: "a_" + i,
      type: "reaction",
      tag: "REACTION",
      startMs,
      endMs,
      killstreak: 0,
      score: endMs - startMs
    };
  });
}

// ------------------------------------------------------------
// Main analyser: mix audio reactions + FPS kills
// ------------------------------------------------------------
async function analyseVideo(videoPath, mode = "reaction", options = {}, onProgress = () => { }) {
  if (typeof options === "function") {
    onProgress = options;
    options = {};
  }

  const modeKey = typeof mode === "string" ? mode : "reaction";
  const wantsAudio = modeKey === "reaction" || modeKey === "both";
  const wantsFps = modeKey === "fps" || modeKey === "both" || modeKey.startsWith("fps_");

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ai-clip-"));
  const wavOut = path.join(tmp, "audio.wav");

  let audioHighlights = [];
  let fpsHighlights = [];

  // ---------- STEP 1: AUDIO MODE ----------
  if (wantsAudio) {
    const audioPresent = await hasAudioStream(videoPath);

    if (!audioPresent) {
      // Video-only recording (no audio device was captured). Skip audio
      // reactions gracefully instead of crashing the whole analysis.
      console.warn("No audio stream found in", videoPath, "- skipping audio reactions.");
      onProgress({ step: "no_audio", progress: 100 });
      audioHighlights = [];
    } else {
      try {
        onProgress({ step: "extract_audio", progress: 0 });

        await extractAudioToWav(videoPath, wavOut, (p) => {
          onProgress({ step: "extract_audio", progress: p });
        });

        onProgress({ step: "extract_audio", progress: 100 });

        onProgress({ step: "reading_audio", progress: 0 });
        const { samples, sampleRate } = await readWavSamples(wavOut);
        onProgress({ step: "reading_audio", progress: 100 });

        onProgress({ step: "audio_analysis", progress: 0 });

        audioHighlights = analyseAudioReactions(
          samples,
          sampleRate,
          {},
          (p) => onProgress({ step: "audio_analysis", progress: p })
        );
        onProgress({ step: "audio_analysis", progress: 100 });
      } catch (err) {
        // Don't let an audio failure kill FPS detection in "both" mode.
        console.warn("Audio analysis failed, continuing without it:", err && err.message);
        onProgress({ step: "no_audio", progress: 100 });
        audioHighlights = [];
      }
    }
  }

  // ---------- STEP 2: FPS MODE ----------
  if (wantsFps) {
    onProgress({ step: "fps_scanning", progress: 0 });

    fpsHighlights = await detectFPSKills(videoPath, { gameId: options.gameId }, (p) => {
      // receives % from FPS detector
      onProgress({ step: "fps_scanning", progress: p });
    });

    onProgress({ step: "fps_scanning", progress: 100 });
  }

  // ---------- STEP 3: COMBINE ----------
  onProgress({ step: "finalising", progress: 0 });

  const results = [...audioHighlights, ...fpsHighlights];
  results.sort((a, b) => a.startMs - b.startMs);

  onProgress({ step: "finalising", progress: 100 });

  // Cleanup
  try {
    fs.unlinkSync(wavOut);
    fs.rmdirSync(tmp);
  } catch { }

  return results;
}

module.exports = {
  analyseVideo
};
