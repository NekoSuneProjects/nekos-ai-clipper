const fs = require("fs");
const path = require("path");
const { create: createYoutubeDl } = require("yt-dlp-exec");
const { prepareTools } = require("../tools/toolsManager");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Twitch VOD: https://www.twitch.tv/videos/2626451997
function extractTwitchId(url) {
  const match = url.match(/twitch\.tv\/videos\/(\d+)/i);
  return match ? `twitch-${match[1]}` : null;
}

// Twitch CLIP:
// https://clips.twitch.tv/WiseOptimisticPeppermintBuddhaBar-3u9argC8wcP6vb1A
// https://www.twitch.tv/<channel>/clip/<slug>
function extractTwitchClip(url) {
  let m = url.match(/clips\.twitch\.tv\/([A-Za-z0-9_-]+)/i);
  if (m) return `twitch-clip-${m[1]}`;
  m = url.match(/twitch\.tv\/[^/]+\/clip\/([A-Za-z0-9_-]+)/i);
  if (m) return `twitch-clip-${m[1]}`;
  return null;
}

// YouTube example:
// https://www.youtube.com/watch?v=dQw4w9WgXcQ
// https://youtu.be/dQw4w9WgXcQ
function extractYouTubeId(url) {
  const match1 = url.match(/[?&]v=([a-zA-Z0-9_-]{6,})/);
  const match2 = url.match(/youtu\.be\/([a-zA-Z0-9_-]{6,})/);
  const id = match1?.[1] || match2?.[1];
  return id ? `youtube-${id}` : null;
}

// Kick VOD: https://kick.com/<channel>/videos/<uuid>
function extractKickId(url) {
  const match = url.match(/kick\.com\/[^/]+\/videos\/([a-zA-Z0-9-]{10,})/i);
  return match ? `kick-${match[1]}` : null;
}

// Kick CLIP: https://kick.com/<channel>/clips/clip_<id>
function extractKickClip(url) {
  const m = url.match(/kick\.com\/[^/]+\/clips\/clip_([A-Za-z0-9]+)/i);
  return m ? `kick-clip-${m[1]}` : null;
}

// WHITELIST resolver
function resolveFilenamePrefix(url) {
  return (
    extractTwitchId(url) ||
    extractTwitchClip(url) ||
    extractYouTubeId(url) ||
    extractKickClip(url) ||
    extractKickId(url) ||
    null
  );
}

function detectPlatform(url) {
  const u = url.toLowerCase();

  if (u.includes("twitch.tv")) return "twitch";   // covers clips.twitch.tv too
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "youtube";
  if (u.includes("kick.com")) return "kick";

  return null; // not allowed
}

function getPlatformHeaders(platform) {
  switch (platform) {
    case "twitch":
      return [
        "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)'",
        "Referer: https://www.twitch.tv/",
        "Origin: https://www.twitch.tv"
      ];

    case "youtube":
      return [
        "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)'",
        "Referer: https://www.youtube.com/",
        "Origin: https://www.youtube.com"
      ];

    case "kick":
      return [
        "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)'",
        "Referer: https://kick.com/",
        "Origin: https://kick.com"
      ];
  }

  return [];
}


async function downloadVod(url, folder, onProgress = null) {
  ensureDir(folder);

  // ✔ Load tools first (yt-dlp, ffmpeg, python)
  const tools = await prepareTools();

  // ✔ Create yt-dlp instance with correct executable path
  const ytdlp = createYoutubeDl(tools.ytdlp);

  // ---------------------------------------
  // Determine output name from whitelist
  // ---------------------------------------
  const platform = detectPlatform(url);

  // Gate on the platform (Twitch incl. clips / YouTube / Kick). Throw here — we
  // are in an async function, NOT a Promise executor, so `reject` doesn't exist.
  if (!platform) {
    throw new Error(
      "Unsupported platform. Only Twitch (videos + clips), YouTube, and Kick are supported."
    );
  }

  // Nice filename if we can derive one, otherwise a safe platform-stamped name.
  const prefix = resolveFilenamePrefix(url) || `${platform}-${Date.now()}`;

  const addHeader = getPlatformHeaders(platform);

  const outputTemplate = path.join(folder, `${prefix}.%(ext)s`);

  const args = {
    output: outputTemplate,
    format: "mp4/bv*+ba/b",
    restrictFilenames: false,
    noWarnings: true,
    noCheckCertificates: true,
    addHeader,
    progress: true
  };

  const subprocess = ytdlp.exec(url, args);

  let destinationFile = null;

  subprocess.stdout.on("data", (chunk) => {
    const line = chunk.toString();

    const destMatch = line.match(/Destination:\s(.+)/i);
    if (destMatch) destinationFile = destMatch[1].trim();

    const progMatch = line.match(/\[download\]\s+(\d+\.\d+)%/i);
    if (progMatch && onProgress) onProgress(parseFloat(progMatch[1]));
  });

  subprocess.stderr.on("data", (data) => {
    console.log("[yt-dlp]", data.toString());
  });

  return new Promise((resolve, reject) => {
    subprocess.on("close", (code) => {
      if (code !== 0) return reject(new Error(`yt-dlp exited with code ${code}`));

      if (!destinationFile) {
        const files = fs
          .readdirSync(folder)
          .map(f => ({ name: f, time: fs.statSync(path.join(folder, f)).mtimeMs }))
          .sort((a, b) => b.time - a.time);

        if (!files.length) return reject(new Error("Download completed but no file found."));
        destinationFile = path.join(folder, files[0].name);
      }

      if (!path.isAbsolute(destinationFile)) {
        destinationFile = path.join(process.cwd(), destinationFile);
      }

      resolve(destinationFile);
    });
  });
}

module.exports = { downloadVod };
