// web/boot-tools.js
//
// MUST be required BEFORE any core/* module. The core modules call
// toolsManager.prepareTools(), which normally DOWNLOADS Windows .exe tools.
// On a Linux server we instead point them at system binaries (installed via the
// Dockerfile / apt / pip) by pre-setting global.TOOLS + global.TOOLS_READY so
// prepareTools() short-circuits and never downloads.

global.TOOLS = {
  ffmpeg: process.env.FFMPEG_PATH || "ffmpeg",
  ffprobe: process.env.FFPROBE_PATH || "ffprobe",
  ytdlp: process.env.YTDLP_PATH || "yt-dlp",
  python: process.env.PYTHON_PATH || "python3",
};
global.TOOLS_READY = true;

module.exports = global.TOOLS;
