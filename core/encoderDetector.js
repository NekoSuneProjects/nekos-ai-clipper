// core/encoderDetector.js
//
// Real hardware-encoder detection. Listing an encoder in `ffmpeg -encoders` does
// NOT mean it works (the gyan builds list h264_nvenc even with no NVIDIA GPU), so
// we VERIFY each one with a tiny 1-frame test encode. Covers:
//   - NVIDIA NVENC  (GTX 900-series / 980 Ti and newer)
//   - AMD AMF
//   - Intel QuickSync (QSV)
// Falls back to CPU (libx264) when no GPU encoder actually works.

const { exec, execFile } = require("child_process");

let cachedProbe = null;

function listEncoders(ffmpegBin) {
  return new Promise((resolve) => {
    exec(`"${ffmpegBin}" -hide_banner -encoders`, (err, stdout) => resolve(stdout || ""));
  });
}

// Try a real (tiny) encode to confirm the encoder initialises on this machine.
function testEncoder(ffmpegBin, codec) {
  return new Promise((resolve) => {
    const args = [
      "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "testsrc=size=256x144:rate=1",
      "-frames:v", "1", "-c:v", codec, "-f", "null", "-"
    ];
    execFile(ffmpegBin, args, { timeout: 20000 }, (err) => resolve(!err));
  });
}

const CANDIDATES = [
  { key: "nvenc", codec: "h264_nvenc", name: "NVIDIA NVENC" },
  { key: "amf", codec: "h264_amf", name: "AMD AMF" },
  { key: "qsv", codec: "h264_qsv", name: "Intel QuickSync" },
];

// Probe once per process (each probe runs up to 3 quick test encodes).
async function probeEncoders(ffmpegBin) {
  if (cachedProbe) return cachedProbe;
  const list = await listEncoders(ffmpegBin);
  const probe = { nvenc: false, amf: false, qsv: false, best: null, bestName: null };

  for (const c of CANDIDATES) {
    if (!list.includes(c.codec)) continue;
    const ok = await testEncoder(ffmpegBin, c.codec);
    probe[c.key] = ok;
    if (ok && !probe.best) { probe.best = c.codec; probe.bestName = c.name; }
  }
  cachedProbe = probe;
  return probe;
}

// preference: "auto" | "gpu" | "cpu"
// Returns { codec, hw, name, fallback } — fallback=true when GPU was requested
// but none works (so we silently used CPU).
async function resolveCodec(ffmpegBin, preference = "auto") {
  if (preference === "cpu") {
    return { codec: "libx264", hw: false, name: "CPU (libx264)", fallback: false };
  }
  const probe = await probeEncoders(ffmpegBin);
  if (probe.best) {
    return { codec: probe.best, hw: true, name: probe.bestName, fallback: false };
  }
  return { codec: "libx264", hw: false, name: "CPU (libx264)", fallback: preference === "gpu" };
}

// Quality-targeted output options per encoder. quality: "high" | "medium" | "low".
// Does NOT set -pix_fmt (callers already do).
function encoderArgs(codec, quality = "high") {
  const cq = quality === "low" ? 26 : quality === "medium" ? 23 : 20;
  switch (codec) {
    case "h264_nvenc":
      return ["-preset", "p5", "-tune", "hq", "-rc", "vbr", "-cq", String(cq), "-b:v", "0"];
    case "h264_amf":
      return ["-quality", "quality", "-rc", "cqp", "-qp_i", String(cq), "-qp_p", String(cq), "-qp_b", String(cq)];
    case "h264_qsv":
      return ["-global_quality", String(cq)];
    default: // libx264
      return ["-preset", "veryfast", "-crf", String(cq)];
  }
}

module.exports = { probeEncoders, resolveCodec, encoderArgs };
