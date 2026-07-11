// tools/toolsManager.js
const path = require("path");
const fs = require("fs");
const https = require("https");
const { execFile, execFileSync } = require("child_process");
const unzipper = require("unzipper");

const pkg = require("../package.json");

const IS_WIN = process.platform === "win32";
const IS_LINUX = process.platform === "linux";

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
// 2) Tool download sources
//
// This only runs when nothing has already set global.TOOLS_READY (the Docker
// image's web/boot-tools.js does that, pointing at apt/pip-installed system
// tools instead). It's the fallback for running core/ directly on a box that
// doesn't have ffmpeg/yt-dlp on PATH yet — e.g. a bare Linux/Pi node-agent box
// (see web/README.md's "multi-node render farm" plan) — so it needs to fetch
// real Linux binaries, not just the Windows ones.
// --------------------------------------------
function linuxArchTag() {
  if (process.arch === "x64") return "amd64";
  if (process.arch === "arm64") return "arm64";
  throw new Error(`Unsupported Linux architecture for tool auto-download: ${process.arch} (only x64/arm64)`);
}

function ffmpegDownloadUrl() {
  if (IS_WIN) return "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
  if (IS_LINUX) return `https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-${linuxArchTag()}-static.tar.xz`;
  throw new Error(`Unsupported platform for ffmpeg auto-download: ${process.platform}`);
}

function ytdlpAssetName() {
  if (IS_WIN) return "yt-dlp.exe";
  if (IS_LINUX) return process.arch === "arm64" ? "yt-dlp_linux_aarch64" : "yt-dlp_linux";
  throw new Error(`Unsupported platform for yt-dlp auto-download: ${process.platform}`);
}

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

// Extract a .tar.xz by shelling out to the system `tar` (GNU tar auto-detects
// xz with -J; present on virtually every Linux box). No pure-JS tar+xz decoder
// is a current dependency, and adding one just for this fallback path isn't
// worth it — `tar` is about as safe an assumption on Linux as `ffmpeg` itself.
function extractTarXz(archivePath, destDir) {
  return new Promise((resolve, reject) => {
    execFile("tar", ["-xJf", archivePath, "-C", destDir], (err) => {
      if (err) return reject(new Error(`Failed to extract ${archivePath} (is 'tar' installed?): ${err.message}`));
      resolve();
    });
  });
}

function findSystemPython() {
  for (const cmd of ["python3", "python"]) {
    try {
      execFileSync(cmd, ["--version"], { stdio: "ignore" });
      return cmd;
    } catch { /* not found / not runnable */ }
  }
  return null;
}

// -----------------------------------------------------------
// ✔ FFmpeg install in AppData
// -----------------------------------------------------------
async function downloadAndExtractFFmpeg() {
  const binName = IS_WIN ? "ffmpeg.exe" : "ffmpeg";
  // Windows builds nest binaries under bin/; the Linux static builds don't.
  const binSubdir = IS_WIN ? "bin" : "";

  const existingFolder = fs.readdirSync(TOOLS_DIR).find(f => f.startsWith("ffmpeg"));
  if (existingFolder) {
    const ffmpegPath = path.join(TOOLS_DIR, existingFolder, binSubdir, binName);
    if (fs.existsSync(ffmpegPath)) {
      console.log("FFmpeg already installed.");
      return ffmpegPath;
    }
  }

  console.log("Downloading FFmpeg...");
  const archivePath = path.join(TOOLS_DIR, IS_WIN ? "ffmpeg.zip" : "ffmpeg.tar.xz");

  await downloadFile(ffmpegDownloadUrl(), archivePath);

  console.log("Extracting FFmpeg...");
  if (IS_WIN) {
    await fs.createReadStream(archivePath)
      .pipe(unzipper.Extract({ path: TOOLS_DIR }))
      .promise();
  } else {
    await extractTarXz(archivePath, TOOLS_DIR);
  }

  fs.unlinkSync(archivePath);

  const folder = fs.readdirSync(TOOLS_DIR).find(f => f.startsWith("ffmpeg"));
  const ffmpegBin = path.join(TOOLS_DIR, folder, binSubdir, binName);

  if (!fs.existsSync(ffmpegBin)) {
    throw new Error("FFmpeg binary missing after extraction!");
  }
  if (!IS_WIN) fs.chmodSync(ffmpegBin, 0o755);

  return ffmpegBin;
}

// -----------------------------------------------------------
// ✔ Python install in AppData (Windows only — see findSystemPython below)
// -----------------------------------------------------------
async function downloadPython() {
  if (!IS_WIN) {
    // The only python consumer today is core/musicBpm.js's BPM detector, which
    // per TODO.md isn't wired into the render pipeline yet — nothing on Linux
    // actually needs a bundled interpreter right now. Rather than ship a
    // from-scratch static-Python fetcher for unused functionality, resolve
    // whatever system python3/python is already on PATH (present on virtually
    // every Linux box) and fail loudly if neither exists.
    const found = findSystemPython();
    if (!found) {
      throw new Error(
        "No system python3/python found on PATH. Install one (e.g. `apt install python3`) " +
        "or set PYTHON_PATH."
      );
    }
    console.log(`Using system ${found} (no bundled Python on Linux).`);
    return found;
  }

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
  const binName = IS_WIN ? "yt-dlp.exe" : "yt-dlp";
  const ytFolder = path.join(TOOLS_DIR, "yt-dlp");
  const ytExe = path.join(ytFolder, binName);

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

  const assetName = ytdlpAssetName();
  const asset = apiData.assets.find((a) => a.name === assetName);

  if (!asset) throw new Error(`Unable to find ${assetName} in latest yt-dlp release!`);

  console.log("Downloading yt-dlp:", asset.browser_download_url);

  await downloadFile(asset.browser_download_url, ytExe);

  if (!fs.existsSync(ytExe)) {
    throw new Error(`${binName} missing after download!`);
  }
  if (!IS_WIN) fs.chmodSync(ytExe, 0o755);

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

  // ffprobe ships alongside ffmpeg (bin/ on Windows, same folder on the Linux
  // static builds) in both cases.
  const ffprobe = path.join(path.dirname(ffmpeg), IS_WIN ? "ffprobe.exe" : "ffprobe");

  const tools = { ffmpeg, ffprobe, python, ytdlp };

  global.TOOLS_READY = true;
  global.TOOLS = tools;

  return tools;
}

// Directory to hand yt-dlp as --ffmpeg-location. Only meaningful when ffmpegBin
// is an actual filesystem path (both the Windows app and the fallback Linux
// downloader above return one). On Docker, boot-tools.js sets tools.ffmpeg to
// the bare command "ffmpeg" so it resolves via $PATH — path.dirname("ffmpeg")
// would wrongly return ".", which makes yt-dlp look for ./ffmpeg in the CWD and
// fail with "ffmpeg is not installed". Returning undefined here lets yt-dlp
// fall back to its own $PATH search instead.
function ffmpegDirOf(ffmpegBin) {
  if (!ffmpegBin || !/[\\/]/.test(ffmpegBin)) return undefined;
  return path.dirname(ffmpegBin);
}

module.exports = { prepareTools, TOOLS_DIR, ffmpegDirOf };
