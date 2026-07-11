const fs = require("fs");
const path = require("path");
const { create: createYoutubeDl } = require("yt-dlp-exec");
const { prepareTools, ffmpegDirOf } = require("../tools/toolsManager");

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

// A realistic modern Chrome UA (the old one had a stray quote + was incomplete,
// which Cloudflare flags). Only used when NOT impersonating.
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function getPlatformHeaders(platform) {
  switch (platform) {
    case "twitch":
      return [`User-Agent: ${BROWSER_UA}`, "Referer: https://www.twitch.tv/", "Origin: https://www.twitch.tv"];
    case "youtube":
      return [`User-Agent: ${BROWSER_UA}`, "Referer: https://www.youtube.com/", "Origin: https://www.youtube.com"];
    case "kick":
      return [`User-Agent: ${BROWSER_UA}`, "Referer: https://kick.com/", "Origin: https://kick.com"];
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

  const outputTemplate = path.join(folder, `${prefix}.%(ext)s`);

  const args = {
    output: outputTemplate,
    format: "mp4/bv*+ba/b",
    // yt-dlp needs ffmpeg to merge bv*+ba and to remux HLS clips (FixupM3u8).
    // The desktop app bundles ffmpeg in AppData (not on PATH), so point yt-dlp at
    // it there — without this, Kick/HLS clip downloads fail with "exited with
    // code 1". On Linux/Docker, tools.ffmpeg is just "ffmpeg" (resolved via
    // $PATH), so ffmpegDirOf() returns undefined and yt-dlp finds it itself —
    // path.dirname("ffmpeg") would wrongly resolve to ".".
    ffmpegLocation: ffmpegDirOf(tools.ffmpeg),
    // YouTube gates its higher-res (720p/1080p+) DASH formats behind a JS
    // challenge yt-dlp needs a JS runtime to solve — without one, it silently
    // falls back to a low-res (often 360p) progressive format, which is why
    // killfeed OCR crops can come out too small to read. yt-dlp only enables
    // "deno" by default; the Docker image doesn't have deno installed, but
    // it's a Node app so `node` itself is always present — enabling it here
    // lets yt-dlp use it to solve the challenge with no new dependency.
    // (No-op for Twitch/Kick, which don't need this.) Verified locally that
    // --js-runtimes node alone (no deno) still resolves to a full 1080p format.
    jsRuntimes: "node",
    restrictFilenames: false,
    noWarnings: true,
    noCheckCertificates: true,
    progress: true
  };

  // Browser impersonation defeats Cloudflare 403s (Kick especially) on hosts
  // whose yt-dlp lacks the latest extractor signatures — e.g. the Linux/Pi
  // Docker. Enabled via env (the Dockerfile installs curl_cffi + sets it). When
  // impersonating, DON'T also send a manual User-Agent (it breaks the TLS/UA
  // fingerprint match); otherwise fall back to spoofed platform headers.
  const impersonate = process.env.YTDLP_IMPERSONATE;
  if (impersonate) {
    args.impersonate = impersonate; // e.g. "chrome"
  } else {
    args.addHeader = getPlatformHeaders(platform);
  }

  function attempt() {
    return new Promise((resolve, reject) => {
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

  // yt-dlp occasionally fails a "cold" first request with a 403 (YouTube's bot
  // gating rejecting the request/challenge) and succeeds right after on retry —
  // same flakiness class documented elsewhere for this pipeline. Retry a few
  // times before surfacing the failure.
  let lastErr;
  for (let i = 1; i <= 3; i++) {
    try {
      return await attempt();
    } catch (err) {
      lastErr = err;
      if (i < 3) {
        console.log(`[yt-dlp] attempt ${i}/3 failed (${err.message}), retrying...`);
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }
  throw lastErr;
}

module.exports = { downloadVod };
