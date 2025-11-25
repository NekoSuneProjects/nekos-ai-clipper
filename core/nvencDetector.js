// core/nvencDetector.js
const { exec } = require("child_process");

/**
 * Detect NVENC support in FFmpeg.
 * Returns true if h264_nvenc encoder exists.
 */
function detectNVENC(ffmpegBin) {
  return new Promise((resolve) => {
    exec(`"${ffmpegBin}" -hide_banner -encoders`, (err, stdout) => {
      if (err) {
        console.warn("FFmpeg NVENC check failed:", err);
        return resolve(false);
      }

      const hasNvenc =
        stdout.includes("h264_nvenc") ||
        stdout.includes("hevc_nvenc") ||
        stdout.includes("av1_nvenc");

      resolve(hasNvenc);
    });
  });
}

module.exports = { detectNVENC };
