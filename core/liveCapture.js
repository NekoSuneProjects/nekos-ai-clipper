// core/liveCapture.js
//
// Live capture pipeline:
// - Single-file mode: records straight to ONE mp4.
// - Segment mode (for live auto-clip): writes rolling segments that get fed to
//   the analyser as they complete, then on stop() stitches them into ONE mp4
//   (stream copy) and deletes the segments. Either way you end up with one file.

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

function startLiveCapture(options, onSegment, onLog = () => {}) {
  const {
    ffmpegPath,
    outputDir,
    fps = 60,
    segmentSec = 10,
    audioDevice = "",
    captureMode = "desktop",
    windowTitle = "",
    captureRect = null,
    captureBackend = "dda",
    outputWidth = 1920,
    outputHeight = 1080,
    quality = "high",
    singleFile = false,
    outputFile = "",
    videoCodec = "libx264",        // resolved by main (GPU/CPU)
    encoderExtraArgs = ["-preset", "veryfast", "-crf", "20"]
  } = options || {};

  if (!ffmpegPath) throw new Error("ffmpegPath is required");
  if (!outputDir) throw new Error("outputDir is required");

  const recordingsDir = path.join(outputDir, "recordings");
  fs.mkdirSync(recordingsDir, { recursive: true });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-live-"));
  const segmentList = path.join(tmpDir, "segments.m3u8");
  const outputPattern = path.join(recordingsDir, "segment_%05d.mp4");

  // The final single file we hand back to the user (both modes produce this).
  const finalPath = outputFile || path.join(recordingsDir, "recording.mp4");

  const mode = captureMode === "console_obs" ? "window" : captureMode;
  const even = (n) => Math.max(2, Math.floor(n / 2) * 2);

  // Fixed output resolution (default 1080p). A uniform scale keeps OCR crop
  // fractions valid regardless of the raw capture-region size.
  const outW = even(outputWidth || 1920);
  const outH = even(outputHeight || 1080);

  // Backend: "dda" = ddagrab (Desktop Duplication API, GPU-accelerated, FAST) is
  // the default. gdigrab is CPU-bound GDI BitBlt and tanks FPS at high res — we
  // only fall back to it for off-primary-monitor windows (negative coords) or
  // when ddagrab is unavailable / forced off.
  const backend = String(captureBackend || "dda").toLowerCase();

  const args = ["-hide_banner", "-loglevel", "error"];
  const gdiInputFlags = ["-fflags", "nobuffer", "-flags", "low_delay", "-probesize", "32M", "-analyzeduration", "0"];

  let usingFilter = false; // video comes from a ddagrab filter source (no -i)
  let filterStr = "";

  function ddaChain(rect, drawMouse) {
    let chain = `ddagrab=output_idx=0:framerate=${fps}:draw_mouse=${drawMouse ? 1 : 0}`;
    chain += ",hwdownload,format=bgra";
    if (rect) {
      const x = Math.max(0, Math.floor(rect.x));
      const y = Math.max(0, Math.floor(rect.y));
      const w = even(rect.w);
      const h = even(rect.h);
      // Clamp to the captured monitor so we never crop outside the frame.
      chain += `,crop=w='min(${w}\\,iw-${x})':h='min(${h}\\,ih-${y})':x=${x}:y=${y}`;
    }
    chain += `,scale=${outW}:${outH}:flags=lanczos,format=yuv420p[vout]`;
    return chain;
  }

  const haveRegion = captureRect && captureRect.w > 0 && captureRect.h > 0;
  const regionOnPrimary = haveRegion && captureRect.x >= 0 && captureRect.y >= 0;

  if (mode === "window" && regionOnPrimary && backend === "dda") {
    // FAST path: GPU region capture of a primary-monitor window.
    usingFilter = true;
    filterStr = ddaChain(captureRect, false);
    onLog(`ddagrab region ${even(captureRect.w)}x${even(captureRect.h)} @ ${captureRect.x},${captureRect.y}`);
  } else if (mode === "window" && haveRegion) {
    // gdigrab region (off-primary monitor or forced gdi).
    args.push(...gdiInputFlags,
      "-f", "gdigrab", "-framerate", String(fps), "-draw_mouse", "0",
      "-offset_x", String(Math.floor(captureRect.x)),
      "-offset_y", String(Math.floor(captureRect.y)),
      "-video_size", `${even(captureRect.w)}x${even(captureRect.h)}`,
      "-i", "desktop");
    onLog(`gdigrab region ${even(captureRect.w)}x${even(captureRect.h)} @ ${captureRect.x},${captureRect.y}`);
  } else if (mode === "window" && windowTitle) {
    args.push(...gdiInputFlags,
      "-f", "gdigrab", "-framerate", String(fps), "-draw_mouse", "1",
      "-i", `title=${windowTitle}`);
    onLog(`gdigrab title (may be black for GPU apps): ${windowTitle}`);
  } else if (backend === "dda") {
    usingFilter = true;
    filterStr = ddaChain(null, true);
    onLog("ddagrab full desktop");
  } else {
    args.push(...gdiInputFlags,
      "-f", "gdigrab", "-framerate", String(fps), "-draw_mouse", "1", "-i", "desktop");
    onLog("gdigrab full desktop");
  }

  // Audio input index depends on whether a video -i exists (ddagrab uses none).
  const audioIndex = usingFilter ? 0 : 1;
  if (audioDevice) {
    args.push("-thread_queue_size", "512", "-f", "dshow", "-i", `audio=${audioDevice}`);
  }

  if (usingFilter) {
    args.push("-filter_complex", filterStr, "-map", "[vout]");
  } else {
    // gdigrab paths have no filter graph yet — scale to the target resolution.
    args.push("-vf", `scale=${outW}:${outH}:flags=lanczos`, "-map", "0:v:0");
  }
  if (audioDevice) args.push("-map", `${audioIndex}:a:0`);

  // Quality-first encoding (this is a recorder, not a low-latency stream).
  // videoCodec + encoderExtraArgs are resolved by main (GPU NVENC/AMF/QSV or CPU).
  args.push(
    "-rtbufsize", "512M",
    "-fps_mode", "cfr",
    "-r", String(fps),
    "-g", String(Math.max(2, fps * 2)),
    "-pix_fmt", "yuv420p",
    "-c:v", videoCodec,
    ...encoderExtraArgs
  );

  if (audioDevice) {
    args.push("-c:a", "aac", "-b:a", "192k");
  }

  if (singleFile) {
    args.push("-movflags", "+faststart", finalPath);
  } else {
    args.push(
      "-f", "segment",
      "-segment_time", String(segmentSec),
      "-segment_list", segmentList,
      "-segment_list_flags", "+live",
      "-reset_timestamps", "1",
      outputPattern
    );
  }

  onLog("Starting ffmpeg: " + args.join(" "));

  const proc = spawn(ffmpegPath, args, { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] });

  proc.stderr.on("data", (d) => onLog("[ffmpeg] " + d.toString().trim()));
  proc.on("exit", (code) => onLog("ffmpeg exit: " + code));
  proc.on("error", (err) => onLog("ffmpeg error: " + err.message));

  let stopped = false;
  const seen = new Set();

  async function waitForStableFile(filePath) {
    let lastSize = -1;
    let stableCount = 0;

    for (let i = 0; i < 10; i++) {
      let size = 0;
      try {
        size = fs.statSync(filePath).size;
      } catch {
        size = 0;
      }
      if (size > 0 && size === lastSize) {
        stableCount += 1;
      } else {
        stableCount = 0;
      }
      lastSize = size;
      if (stableCount >= 2) return true;
      await new Promise((r) => setTimeout(r, 300));
    }
    return false;
  }

  const interval = singleFile ? null : setInterval(() => {
    if (!fs.existsSync(segmentList)) return;
    const content = fs.readFileSync(segmentList, "utf-8");
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      if (!line || line.startsWith("#")) continue;
      if (seen.has(line)) continue;
      seen.add(line);
      const segPath = path.join(recordingsDir, line.trim());
      if (fs.existsSync(segPath)) {
        waitForStableFile(segPath).then((ok) => {
          if (ok && !stopped) onSegment(segPath);
        });
      }
    }
  }, 1000);

  // Stitch all recorded segments into a single mp4 (fast stream copy), then
  // remove the segment files so the user is left with just the one recording.
  function mergeSegments() {
    return new Promise((resolve) => {
      let segs = [];
      try {
        segs = fs.readdirSync(recordingsDir)
          .filter((f) => /^segment_\d+\.mp4$/i.test(f))
          .sort();
      } catch {
        return resolve(null);
      }

      // Drop a trailing 0-byte/incomplete segment if present.
      segs = segs.filter((f) => {
        try { return fs.statSync(path.join(recordingsDir, f)).size > 1024; }
        catch { return false; }
      });

      if (!segs.length) return resolve(null);

      const listFile = path.join(tmpDir, "concat.txt");
      const listBody = segs
        .map((f) => `file '${path.join(recordingsDir, f).replace(/\\/g, "/")}'`)
        .join("\n");
      try { fs.writeFileSync(listFile, listBody, "utf8"); } catch { return resolve(null); }

      const mergeArgs = [
        "-hide_banner", "-loglevel", "error",
        "-f", "concat", "-safe", "0",
        "-i", listFile,
        "-c", "copy",
        "-movflags", "+faststart",
        "-y", finalPath
      ];

      onLog("Merging " + segs.length + " segments -> " + finalPath);
      const merge = spawn(ffmpegPath, mergeArgs, { windowsHide: true });
      merge.on("close", (code) => {
        if (code === 0) {
          // Clean up segment files now that they're merged.
          for (const f of segs) {
            try { fs.rmSync(path.join(recordingsDir, f), { force: true }); } catch {}
          }
          resolve(finalPath);
        } else {
          onLog("Segment merge failed with code " + code + " (segments kept).");
          resolve(null);
        }
      });
      merge.on("error", () => resolve(null));
    });
  }

  return {
    finalPath,
    stop() {
      if (stopped) return Promise.resolve(finalPath);
      stopped = true;
      if (interval) clearInterval(interval);

      // Ask ffmpeg to quit gracefully so the mp4 / last segment is finalized.
      try { proc.stdin.write("q"); } catch {}

      const done = new Promise((resolve) => {
        proc.on("close", () => resolve());
        proc.on("error", () => resolve());
      });

      // Give it time to flush the moov atom; only hard-kill if it hangs.
      const timeout = new Promise((resolve) => {
        setTimeout(() => {
          try { proc.kill("SIGKILL"); } catch {}
          resolve();
        }, 8000);
      });

      return Promise.race([done, timeout]).then(async () => {
        let result = finalPath;
        if (!singleFile) {
          const merged = await mergeSegments();
          result = merged || finalPath;
        }
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
        return result;
      });
    }
  };
}

module.exports = { startLiveCapture };
