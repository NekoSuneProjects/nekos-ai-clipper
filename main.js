// main.js
const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");

// Core modules
const { prepareTools } = require("./tools/toolsManager");
const { detectNVENC } = require("./core/nvencDetector");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 750,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

let analyseVideo = null;
let createClipPair = null;
let downloadVod = null;
let renderMontage = null;

async function initCore() {
  const coreAnalyser = require("./core/analyser");
  const coreClipper = require("./core/clipper");
  const coreVod = require("./core/vodDownloader");
  const coreMontage = require("./core/montageRenderer");

  analyseVideo = coreAnalyser.analyseVideo;
  createClipPair = coreClipper.createClipPair;
  downloadVod = coreVod.downloadVod;
  renderMontage = coreMontage.renderMontage;
}


app.whenReady().then(async () => {
  global.TOOLS = await prepareTools();

  global.USE_NVENC = await detectNVENC(global.TOOLS.ffmpeg);

  // Now load core modules
  await initCore();

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ============ IPC HANDLERS ============

// Pick local video
ipcMain.handle("dialog:openVideo", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select a video file",
    properties: ["openFile"],
    filters: [
      { name: "Videos", extensions: ["mp4", "mov", "mkv", "avi"] },
      { name: "All Files", extensions: ["*"] }
    ]
  });

  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});


// Choose output directory
ipcMain.handle("dialog:chooseOutputDir", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select output folder",
    properties: ["openDirectory"]
  });

  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// Analyse video for general reaction/funny highlights
ipcMain.handle("video:analyseWithMode", async (event, opt) => {
  try {
    const highlights = await analyseVideo(opt.path, opt.mode, (p) => {
      event.sender.send("analyse:progress", p);
    });

    return { ok: true, highlights };
  } catch (err) {
    console.error("Analyse error:", err);
    return { ok: false, error: String(err) };
  }
});

// Pick music file
ipcMain.handle("dialog:chooseMusic", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select Music File",
    properties: ["openFile"],
    filters: [
      { name: "Audio", extensions: ["mp3", "wav", "ogg", "flac"] },
      { name: "All Files", extensions: ["*"] }
    ]
  });

  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// Standard rendering per clip
ipcMain.handle("video:renderStandard", async (_, payload) => {
  const { videoPath, highlight, musicPath, outputDir } = payload;
  console.log(payload)
  try {
    const { normal, short } = await require("./core/standardRender")
      .renderStandardClip(videoPath, highlight.startMs, highlight.endMs, outputDir);
    return { ok: true, normal, short };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Montage rendering
ipcMain.handle("video:renderMontage", async (_, payload) => {
  const {
    videoPath,
    highlights,
    musicPath,
    outputDir
  } = payload;

  try {
    const result = await require("./core/montageRenderer")
      .renderMontage(videoPath, highlights, musicPath, outputDir);

    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Create normal + short clip for a highlight
ipcMain.handle("video:createClipPair", async (_event, payload) => {
  const { videoPath, startMs, endMs, outputDir } = payload;
  try {
    const result = await createClipPair(videoPath, startMs, endMs, outputDir);
    return { ok: true, ...result };
  } catch (err) {
    console.error("Create clip pair error:", err);
    return { ok: false, error: String(err) };
  }
});

// Download VOD via URL and then analyse
ipcMain.handle("vod:downloadAndAnalyseWithMode", async (_event, payload) => {
  try {
    // ----------------------------------------
    // Validate payload (prevent undefined errors)
    // ----------------------------------------
    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid IPC payload. Expected an object.");
    }

    const { url, mode } = payload;

    if (typeof url !== "string" || !url.trim()) {
      throw new Error("Invalid URL passed to download.");
    }

    if (typeof mode !== "string") {
      throw new Error("Invalid mode passed to analyser.");
    }

    // ----------------------------------------
    // Resolve user's Downloads folder
    // ----------------------------------------
    const userDownloads = app.getPath("downloads");

    // Our custom folder inside Downloads
    const DOWNLOAD_DIR = path.join(userDownloads, "NekosAIClipper");

    // Ensure folder exists
    if (!fs.existsSync(DOWNLOAD_DIR)) {
      fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    }

    console.log("Download directory:", DOWNLOAD_DIR);

    // ----------------------------------------
    // Download VOD using yt-dlp
    // ----------------------------------------
    const videoPath = await downloadVod(url, DOWNLOAD_DIR, (progress) => {
      _event.sender.send("analyse:progress", progress);
    });

    console.log("Downloaded VOD path:", videoPath);

    // ----------------------------------------
    // Analyse
    // ----------------------------------------
    const highlights = await analyseVideo(videoPath, mode);

    return { ok: true, videoPath, highlights };

  } catch (err) {
    console.error("IPC Error:", err);
    return { ok: false, error: String(err) };
  }
});

// Show file in OS file manager
ipcMain.handle("os:showInFolder", async (_, filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
    return true;
  }
  return false;
});
