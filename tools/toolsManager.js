// tools/toolsManager.js
const path = require("path");
const fs = require("fs");
const https = require("https");
const unzipper = require("unzipper");

const pkg = require("../package.json");

// --------------------------------------------
// 1) Resolve AppData Path
// --------------------------------------------
const APPDATA = process.env.APPDATA || path.join(process.env.HOME, ".config");

const APP_FOLDER = path.join(APPDATA, pkg.name);
const TOOLS_DIR = path.join(APP_FOLDER, "tools");

// Ensure folders exist
if (!fs.existsSync(APP_FOLDER)) fs.mkdirSync(APP_FOLDER, { recursive: true });
if (!fs.existsSync(TOOLS_DIR)) fs.mkdirSync(TOOLS_DIR, { recursive: true });

// --------------------------------------------
// 2) Tool download URLs
// --------------------------------------------
const FFMPEG_URL =
  "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";

const PYTHON_URL =
  "https://www.python.org/ftp/python/3.11.0/python-3.11.0-embed-amd64.zip";

const YTDLP_API =
  "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";

// --------------------------------------------
// 3) Helper: download file (supports redirect)
// --------------------------------------------
function downloadFile(url, dest, headers = {}) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);

    const options = {
      headers: {
        "User-Agent": "NekoSuneVR",
        ...headers
      }
    };

    https.get(url, options, (res) => {

      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        console.log("Redirecting to", res.headers.location);
        return resolve(downloadFile(res.headers.location, dest, headers));
      }

      if (res.statusCode !== 200) {
        return reject(`Download failed: HTTP ${res.statusCode}`);
      }

      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    }).on("error", reject);
  });
}

// -----------------------------------------------------------
// ✔ FFmpeg install in AppData
// -----------------------------------------------------------
async function downloadAndExtractFFmpeg() {
  const existingFolder = fs.readdirSync(TOOLS_DIR).find(f => f.startsWith("ffmpeg"));

  if (existingFolder) {
    const ffmpegPath = path.join(TOOLS_DIR, existingFolder, "bin", "ffmpeg.exe");
    if (fs.existsSync(ffmpegPath)) {
      console.log("FFmpeg already installed.");
      return ffmpegPath;
    }
  }

  console.log("Downloading FFmpeg...");
  const zipPath = path.join(TOOLS_DIR, "ffmpeg.zip");

  await downloadFile(FFMPEG_URL, zipPath);

  console.log("Extracting FFmpeg...");
  await fs.createReadStream(zipPath)
    .pipe(unzipper.Extract({ path: TOOLS_DIR }))
    .promise();

  fs.unlinkSync(zipPath);

  const folder = fs.readdirSync(TOOLS_DIR).find(f => f.startsWith("ffmpeg"));
  const ffmpegBin = path.join(TOOLS_DIR, folder, "bin", "ffmpeg.exe");

  if (!fs.existsSync(ffmpegBin)) {
    throw new Error("FFmpeg binary missing after extraction!");
  }

  return ffmpegBin;
}

// -----------------------------------------------------------
// ✔ Python install in AppData
// -----------------------------------------------------------
async function downloadPython() {
  const pyFolder = path.join(TOOLS_DIR, "python");
  if (!fs.existsSync(pyFolder)) fs.mkdirSync(pyFolder);

  const pyExe = path.join(pyFolder, "python.exe");

  if (fs.existsSync(pyExe)) {
    console.log("Python already installed.");
    return pyExe;
  }

  console.log("Downloading Portable Python...");
  const zipPath = path.join(pyFolder, "python_embed.zip");

  await downloadFile(PYTHON_URL, zipPath);

  console.log("Extracting Python...");
  await fs.createReadStream(zipPath)
    .pipe(unzipper.Extract({ path: pyFolder }))
    .promise();

  fs.unlinkSync(zipPath);

  const pthFile = path.join(pyFolder, "python311._pth");
  if (fs.existsSync(pthFile)) {
    let txt = fs.readFileSync(pthFile, "utf8");
    txt = txt.replace("#import site", "import site");
    fs.writeFileSync(pthFile, txt, "utf8");
  }

  if (!fs.existsSync(pyExe)) throw new Error("Portable Python missing!");

  return pyExe;
}

// -----------------------------------------------------------
// ✔ yt-dlp downloader (latest version from GitHub Releases)
// -----------------------------------------------------------
async function downloadYT_DLP() {
  const ytFolder = path.join(TOOLS_DIR, "yt-dlp");
  const ytExe = path.join(ytFolder, "yt-dlp.exe");

  if (!fs.existsSync(ytFolder)) fs.mkdirSync(ytFolder, { recursive: true });

  // Already installed?
  if (fs.existsSync(ytExe)) {
    console.log("yt-dlp already installed.");
    return ytExe;
  }

  console.log("Fetching latest yt-dlp release...");

  const apiData = await new Promise((resolve, reject) => {
    https.get(
      YTDLP_API,
      { headers: { "User-Agent": "NekoSuneVR" } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve(JSON.parse(data)));
      }
    ).on("error", reject);
  });

  const asset = apiData.assets.find((a) =>
    a.name.endsWith("yt-dlp.exe")
  );

  if (!asset) throw new Error("Unable to find yt-dlp.exe in release!");

  console.log("Downloading yt-dlp:", asset.browser_download_url);

  await downloadFile(asset.browser_download_url, ytExe);

  if (!fs.existsSync(ytExe)) {
    throw new Error("yt-dlp.exe missing after download!");
  }

  return ytExe;
}

// -----------------------------------------------------------
// ✔ Prepare Tools (run once)
// -----------------------------------------------------------
async function prepareTools() {
  if (global.TOOLS_READY) return global.TOOLS;

  console.log(`Preparing tools under: ${TOOLS_DIR}`);

  const ffmpeg = await downloadAndExtractFFmpeg();
  const python = await downloadPython();
  const ytdlp = await downloadYT_DLP();

  const tools = { ffmpeg, python, ytdlp };

  global.TOOLS_READY = true;
  global.TOOLS = tools;

  return tools;
}

module.exports = { prepareTools, TOOLS_DIR };