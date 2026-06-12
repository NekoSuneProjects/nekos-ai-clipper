"""Download every video in videos.json to downloads/<key>.mp4 (720p, idempotent)."""
import subprocess, os, sys, time
import paths

def log(m): print(time.strftime("%H:%M:%S"), m, flush=True)

def download(key, vid):
    out = paths.video_path(key)
    if os.path.exists(out) and os.path.getsize(out) > 5_000_000:
        log("SKIP (exists): " + key); return True
    url = "https://www.youtube.com/watch?v=" + vid
    for attempt in range(1, 8):
        log("download %s attempt %d" % (key, attempt))
        cmd = [sys.executable, "-m", "yt_dlp", "-v", "--remote-components", "ejs:github",
               "-f", "bestvideo[height=720]+bestaudio/best[height<=720]",
               "--merge-output-format", "mp4", "-o", out, url]
        subprocess.run(cmd, capture_output=True, text=True, errors="replace")
        if os.path.exists(out) and os.path.getsize(out) > 5_000_000:
            log("OK: %s (%.0f MB)" % (key, os.path.getsize(out)/1e6)); return True
        time.sleep(4)
    log("GAVE UP: " + key); return False

if __name__ == "__main__":
    keys = sys.argv[1:]
    for v in paths.load_videos():
        if keys and v["key"] not in keys: continue
        download(v["key"], v["vid"])
    log("DOWNLOADS DONE")
