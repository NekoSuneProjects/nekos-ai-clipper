// main.js
const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

// Core modules
const { prepareTools } = require("./tools/toolsManager");
const { startLiveCapture } = require("./core/liveCapture");
const settings = require("./core/settings");
const { resolveCodec, encoderArgs, probeEncoders } = require("./core/encoderDetector");

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
let liveCapture = null;
let liveQueue = Promise.resolve();

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
  settings.init(app.getPath("userData"), app.getPath("documents"));

  // Store downloaded music + 30s previews under Documents (set BEFORE musicLibrary loads).
  process.env.MUSIC_DIR = path.join(app.getPath("documents"), "NekosAIClipper", "music");

  global.TOOLS = await prepareTools();

  // Warm up hardware-encoder detection in the background (non-blocking).
  probeEncoders(global.TOOLS.ffmpeg).catch(() => {});

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

// ---------- Settings ----------
ipcMain.handle("settings:get", async () => settings.get());

ipcMain.handle("settings:set", async (_e, patch) => settings.set(patch || {}));

// Pick a new output folder, persist it, return updated settings
ipcMain.handle("settings:chooseOutputDir", async () => {
  const current = settings.get().outputDir;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose render output folder",
    defaultPath: current,
    properties: ["openDirectory", "createDirectory"]
  });
  if (result.canceled || !result.filePaths.length) return settings.get();
  return settings.set({ outputDir: result.filePaths[0] });
});

ipcMain.handle("settings:openOutputDir", async () => {
  const dir = settings.get().outputDir;
  if (dir && fs.existsSync(dir)) { shell.openPath(dir); return true; }
  return false;
});

// Detect available hardware encoders (for the Settings UI)
ipcMain.handle("encoder:detect", async () => {
  try {
    const probe = await probeEncoders(global.TOOLS.ffmpeg);
    return { ok: true, ...probe };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

// Analyse video for general reaction/funny highlights
ipcMain.handle("video:analyseWithMode", async (event, opt) => {
  try {
    const highlights = await analyseVideo(opt.path, opt.mode, { gameId: opt.gameId }, (p) => {
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

// List available free NCS music tracks
ipcMain.handle("music:listNcs", async () => {
  try {
    return require("./core/musicLibrary").listTracks();
  } catch (err) {
    console.error("Failed to list NCS tracks:", err);
    return [];
  }
});

// List music sources (playlist/channel collections like NCS, StreamBeats, Ninety9Lives)
ipcMain.handle("music:listSources", async () => {
  try {
    const lib = require("./core/musicLibrary");
    return { collections: lib.listCollections(), tracks: lib.listTracks() };
  } catch (err) {
    console.error("Failed to list music sources:", err);
    return { collections: [], tracks: [] };
  }
});

// Expand one source (collection id, or "curated") into a list of songs for the picker
ipcMain.handle("music:listItems", async (_event, payload) => {
  try {
    const lib = require("./core/musicLibrary");
    const max = (payload && payload.max) || 60;
    if (!payload || !payload.collectionId || payload.collectionId === "curated") {
      return { ok: true, items: lib.listTracks() };
    }
    const col = lib.listCollections().find((c) => c.id === payload.collectionId);
    if (!col) return { ok: false, error: "Unknown source" };
    const items = await lib.listCollectionItems(col, max);
    return { ok: true, items, warning: col.warning, creditRequired: col.creditRequired !== false };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

// Download a ~30s preview snippet → returns a local mp3 path to play
ipcMain.handle("music:preview", async (_event, payload) => {
  try {
    const lib = require("./core/musicLibrary");
    const file = await lib.previewTrack(payload.url || payload.id);
    return { ok: true, path: file };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

// Download a specific picked track (full) → returns path + attribution
ipcMain.handle("music:useTrack", async (event, payload) => {
  try {
    const lib = require("./core/musicLibrary");
    const res = await lib.getTrack(payload || {}, (p) => {
      event.sender.send("analyse:progress", { step: "downloading_music", progress: Math.floor(p) });
    });
    return { ok: true, ...res };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

// Auto-download a free NCS track (cached). Returns { path, attribution }.
ipcMain.handle("music:getAuto", async (event, opt) => {
  try {
    const result = await require("./core/musicLibrary").getAutoTrack(opt || {}, (p) => {
      event.sender.send("analyse:progress", { step: "downloading_music", progress: Math.floor(p) });
    });
    return { ok: true, ...result };
  } catch (err) {
    console.error("Auto music error:", err);
    return { ok: false, error: String(err) };
  }
});

// List game configs
ipcMain.handle("config:listGames", async () => {
  try {
    const indexPath = path.join(__dirname, "core", "gameConfigs", "index.json");
    if (!fs.existsSync(indexPath)) return [];
    return JSON.parse(fs.readFileSync(indexPath, "utf-8"));
  } catch (err) {
    console.error("Failed to load game configs:", err);
    return [];
  }
});

function parseDirectShowAudioDevices(output) {
  const lines = output.split(/\r?\n/);
  const devices = new Set();
  let inAudioSection = false;

  for (const line of lines) {
    if (line.includes("DirectShow audio devices")) {
      inAudioSection = true;
      continue;
    }
    if (line.includes("DirectShow video devices")) {
      inAudioSection = false;
      continue;
    }

    const isAudioLine = line.includes("(audio)");
    if (!inAudioSection && !isAudioLine) continue;
    if (line.includes("Alternative name")) continue;

    const match = line.match(/"([^"]+)"/);
    if (match && match[1]) devices.add(match[1]);
  }

  return Array.from(devices);
}

ipcMain.handle("audio:listDevices", async () => {
  try {
    const ffmpegPath = global.TOOLS?.ffmpeg;
    if (!ffmpegPath) return [];

    const args = ["-list_devices", "true", "-f", "dshow", "-i", "dummy"];
    const proc = spawn(ffmpegPath, args, { windowsHide: true });

    let output = "";
    proc.stderr.on("data", (data) => { output += data.toString(); });
    proc.stdout.on("data", (data) => { output += data.toString(); });

    const exitCode = await new Promise((resolve) => {
      proc.on("close", resolve);
      proc.on("error", () => resolve(1));
    });

    if (exitCode !== 0 && !output) return [];

    const devices = parseDirectShowAudioDevices(output);
    return devices;
  } catch (err) {
    console.error("Failed to list audio devices:", err);
    return [];
  }
});

ipcMain.handle("window:list", async () => {
  try {
    const ps = `
$code = @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public class Win32 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
'@

Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue | Out-Null
$windows = New-Object System.Collections.Generic.List[object]
[Win32]::EnumWindows({
  param($h, $l)
  if (-not [Win32]::IsWindowVisible($h)) { return $true }
  if ([Win32]::IsIconic($h)) { return $true }
  $len = [Win32]::GetWindowTextLength($h)
  if ($len -eq 0) { return $true }
  $sb = New-Object System.Text.StringBuilder ($len + 1)
  [Win32]::GetWindowText($h, $sb, $sb.Capacity) | Out-Null
  $title = $sb.ToString()
  if ([string]::IsNullOrWhiteSpace($title)) { return $true }
  $pid = 0
  [Win32]::GetWindowThreadProcessId($h, [ref]$pid) | Out-Null
  $proc = ""
  try { $proc = (Get-Process -Id $pid -ErrorAction SilentlyContinue).ProcessName } catch {}
  $windows.Add([pscustomobject]@{ title = $title; process = $proc })
  return $true
}, [IntPtr]::Zero) | Out-Null
$windows | Sort-Object title | ConvertTo-Json -Compress
`;

    const proc = spawn("powershell", ["-NoProfile", "-Command", ps], { windowsHide: true });

    let output = "";
    proc.stdout.on("data", (data) => { output += data.toString(); });
    proc.stderr.on("data", () => {});

    const exitCode = await new Promise((resolve) => {
      proc.on("close", resolve);
      proc.on("error", () => resolve(1));
    });

    if (exitCode !== 0 && !output) return [];

    const parsed = JSON.parse(output);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && parsed.title) return [parsed];
    return [];
  } catch (err) {
    console.error("Failed to list windows:", err);
    return [];
  }
});

// Get the on-screen client rectangle of a visible window by title, so we can
// region-capture it (gdigrab title= is black for GPU/Remote-Play windows).
function getWindowClientRect(title) {
  return new Promise((resolve) => {
    if (!title) return resolve(null);

    const ps = `
$target = @'
${String(title).replace(/'/g, "''")}
'@
$code = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinRect {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT lpPoint);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue | Out-Null
# Report PHYSICAL pixels so the capture region matches ddagrab/gdigrab at any
# display scaling (otherwise coords are off at non-100% DPI).
try { [WinRect]::SetProcessDPIAware() | Out-Null } catch {}
$found = $null
$exact = $null
[WinRect]::EnumWindows({
  param($h, $l)
  if (-not [WinRect]::IsWindowVisible($h)) { return $true }
  if ([WinRect]::IsIconic($h)) { return $true }
  $len = [WinRect]::GetWindowTextLength($h)
  if ($len -eq 0) { return $true }
  $sb = New-Object System.Text.StringBuilder ($len + 1)
  [WinRect]::GetWindowText($h, $sb, $sb.Capacity) | Out-Null
  $t = $sb.ToString()
  if ($t -eq $target) { if (-not $exact) { $script:exact = $h } }
  elseif ($t -like "*$target*") { if (-not $found) { $script:found = $h } }
  return $true
}, [IntPtr]::Zero) | Out-Null
$hwnd = if ($exact) { $exact } else { $found }
if (-not $hwnd) { '' ; exit }
$r = New-Object WinRect+RECT
[WinRect]::GetClientRect($hwnd, [ref]$r) | Out-Null
$p = New-Object WinRect+POINT
$p.X = 0; $p.Y = 0
[WinRect]::ClientToScreen($hwnd, [ref]$p) | Out-Null
[pscustomobject]@{ x = $p.X; y = $p.Y; w = $r.Right; h = $r.Bottom } | ConvertTo-Json -Compress
`;

    const proc = spawn("powershell", ["-NoProfile", "-Command", ps], { windowsHide: true });
    let output = "";
    proc.stdout.on("data", (d) => { output += d.toString(); });
    proc.stderr.on("data", () => {});
    proc.on("close", () => {
      try {
        const j = JSON.parse(output.trim());
        if (j && j.w > 0 && j.h > 0) return resolve({ x: j.x, y: j.y, w: j.w, h: j.h });
      } catch {}
      resolve(null);
    });
    proc.on("error", () => resolve(null));
  });
}

// Build a progress forwarder that adds an ETA estimate and sends render:progress
function makeRenderProgress(sender) {
  const start = Date.now();
  return (info) => {
    const pct = Math.max(0, Math.min(100, (info && info.percent) || 0));
    const elapsed = (Date.now() - start) / 1000;
    const etaSec = pct > 1 && pct < 100 ? Math.round(elapsed * (100 - pct) / pct) : (pct >= 100 ? 0 : null);
    sender.send("render:progress", {
      percent: Math.floor(pct),
      etaSec,
      step: (info && info.step) || "Rendering"
    });
  };
}

// Standard rendering per clip
ipcMain.handle("video:renderStandard", async (event, payload) => {
  const { videoPath, highlight, musicPath, outputDir, format } = payload;
  const dir = outputDir || settings.get().outputDir;
  try {
    const out = await require("./core/standardRender")
      .renderStandardClip(videoPath, highlight.startMs, highlight.endMs, dir, makeRenderProgress(event.sender), format || "both", settings.get().encoder || "auto");
    return { ok: true, ...out, outputDir: dir };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Montage rendering
ipcMain.handle("video:renderMontage", async (event, payload) => {
  const { videoPath, highlights, musicPath, outputDir, format, musicCollection, musicTrack } = payload;
  const dir = outputDir || settings.get().outputDir;
  try {
    // If a music SOURCE/track was chosen, build a bed that chains enough songs
    // to cover the full montage (instead of looping one). A plain file (own
    // upload) is used as-is.
    let finalMusic = musicPath || null;
    let musicCredit = null;
    if (musicCollection || musicTrack) {
      const totalSec = highlights.reduce((a, h) => a + Math.max(0, (h.endMs - h.startMs) / 1000), 0);
      const m = await require("./core/musicLibrary").prepareMontageMusic(
        { collectionId: musicCollection, track: musicTrack },
        totalSec,
        (p) => event.sender.send("render:progress", { step: "Fetching music", percent: Math.floor(p), etaSec: null })
      );
      finalMusic = m.path;
      musicCredit = m.creditRequired === false ? null : m.attribution;
    }

    const result = await require("./core/montageRenderer")
      .renderMontage(videoPath, highlights, finalMusic, dir, makeRenderProgress(event.sender), format || "both", settings.get().encoder || "auto");

    return { ok: true, ...result, outputDir: dir, musicCredit };
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

    const { url, mode, gameId } = payload;

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
      _event.sender.send("analyse:progress", { step: "downloading", progress: Math.floor(progress) });
    });

    console.log("Downloaded VOD path:", videoPath);

    // ----------------------------------------
    // Analyse (with progress)
    // ----------------------------------------
    const highlights = await analyseVideo(videoPath, mode, { gameId }, (p) => {
      _event.sender.send("analyse:progress", p);
    });

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

// Live capture start
ipcMain.handle("capture:start", async (event, opt) => {
  if (liveCapture) return { ok: false, error: "Capture already running." };

  try {
    if (!opt || !opt.outputDir) throw new Error("outputDir is required");

    const outputDir = opt.outputDir;
    const clipsDir = path.join(outputDir, "clips");
    if (!fs.existsSync(clipsDir)) fs.mkdirSync(clipsDir, { recursive: true });

    const sender = event.sender;
    const mode = opt.mode || "reaction";
    const gameId = opt.gameId || null;
    const autoClip = !!opt.autoClip;

    const gameLabel = (opt.gameId || "GAME").toString().toUpperCase();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outputFile = path.join(clipsDir, `${gameLabel}_${timestamp}.mp4`);

    // Real-time clipping needs rolling segments to feed the analyser as we
    // record. Without auto-clip we just record one clean file.
    const singleFile = !autoClip;

    if (autoClip) {
      sender.send("capture:status", { state: "warn", message: "Live auto-clip on: analysing segments as they record." });
    }

    const captureMode = opt.captureMode || "desktop";
    const windowTitle = opt.windowTitle || "";

    // For window/console capture, resolve the window's screen rectangle so we
    // can region-capture the composited desktop (gdigrab title= is black for
    // GPU-accelerated Remote Play windows like chiaki-ng / PS Remote Play).
    let captureRect = null;
    if ((captureMode === "window" || captureMode === "console_obs") && windowTitle) {
      captureRect = await getWindowClientRect(windowTitle);
      if (captureRect) {
        sender.send("capture:status", { state: "log", message: `Capturing region ${captureRect.w}x${captureRect.h} at ${captureRect.x},${captureRect.y}` });
      } else {
        sender.send("capture:status", { state: "warn", message: "Couldn't read window position; falling back to title capture (may be black for Remote Play)." });
      }
    }

    // Resolution setting: "1920x1080" (default) or "1280x720".
    const resMatch = String(opt.resolution || "1920x1080").match(/(\d+)\s*x\s*(\d+)/);
    const outputWidth = resMatch ? parseInt(resMatch[1], 10) : 1920;
    const outputHeight = resMatch ? parseInt(resMatch[2], 10) : 1080;

    // Resolve GPU/CPU encoder per the user's setting (verified working).
    const capQuality = opt.quality || "high";
    const enc = await resolveCodec(global.TOOLS.ffmpeg, settings.get().encoder || "auto");
    if (enc.fallback) {
      sender.send("capture:status", { state: "warn", message: "No working GPU encoder found — using CPU." });
    }

    liveCapture = startLiveCapture({
      ffmpegPath: global.TOOLS.ffmpeg,
      outputDir,
      fps: opt.fps || 60,
      segmentSec: opt.segmentSec || 10,
      audioDevice: opt.audioDevice || "",
      captureMode,
      windowTitle,
      captureRect,
      outputWidth,
      outputHeight,
      quality: capQuality,
      videoCodec: enc.codec,
      encoderExtraArgs: encoderArgs(enc.codec, capQuality),
      singleFile,
      outputFile
    }, (segmentPath) => {
      sender.send("capture:status", { state: "segment", segmentPath });

      if (!autoClip) return;

      liveQueue = liveQueue.then(async () => {
        sender.send("capture:status", { state: "analysing", segmentPath });
        const highlights = await analyseVideo(segmentPath, mode, { gameId });

        for (const h of highlights) {
          try {
            const res = await createClipPair(segmentPath, h.startMs, h.endMs, clipsDir);
            sender.send("capture:status", { state: "clip", clip: res.normal || res.short });
          } catch (err) {
            sender.send("capture:status", { state: "clip_error", error: String(err) });
          }
        }

        sender.send("capture:status", { state: "segment_done", segmentPath });
      }).catch((err) => {
        sender.send("capture:status", { state: "error", error: String(err) });
      });
    }, (msg) => {
      sender.send("capture:status", { state: "log", message: msg });
    });

    sender.send("capture:status", { state: "started", outputDir });
    return { ok: true, outputFile };
  } catch (err) {
    console.error("Capture start failed:", err);
    return { ok: false, error: String(err) };
  }
});

// Live capture stop
ipcMain.handle("capture:stop", async (event) => {
  if (!liveCapture) return { ok: false, error: "No capture running." };
  try {
    event.sender.send("capture:status", { state: "stopping" });
    const finalFile = await liveCapture.stop();
    liveCapture = null;
    event.sender.send("capture:status", { state: "stopped", file: finalFile });
    return { ok: true, file: finalFile };
  } catch (err) {
    liveCapture = null;
    return { ok: false, error: String(err) };
  }
});
