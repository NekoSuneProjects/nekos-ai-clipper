"""
Frames + OCR pipeline. For each video in videos.json:
  1. extract frames at 2s interval into frames/<key>/  (if not already)
  2. delete downloads/<key>.mp4 to save space
  3. full-frame OCR every frame -> ocr/<key>.jsonl   (idempotent)
Loads RapidOCR once. Safe to re-run. Optional args = subset of keys.
"""
import os, glob, json, subprocess, sys, time
import paths
from rapidocr_onnxruntime import RapidOCR

INTERVAL = 2.0

def log(m): print(time.strftime("%H:%M:%S"), m, flush=True)

def n_frames(key): return len(glob.glob(os.path.join(paths.frames_dir(key), "f_*.jpg")))

def extract(key):
    fd = paths.frames_dir(key); os.makedirs(fd, exist_ok=True)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-i", paths.video_path(key),
                    "-vf", "fps=1/%g" % INTERVAL, "-q:v", "3",
                    os.path.join(fd, "f_%04d.jpg"), "-y"], check=True)

def ocr_complete(key):
    op = paths.ocr_path(key)
    if not os.path.exists(op): return False
    nf = n_frames(key)
    nl = sum(1 for _ in open(op, encoding="utf-8"))
    return nf > 0 and nl >= nf

def run_ocr(ocr, key):
    fd = paths.frames_dir(key)
    frames = sorted(glob.glob(os.path.join(fd, "f_*.jpg")))
    tmp = paths.ocr_path(key) + ".tmp"
    out = open(tmp, "w", encoding="utf-8"); n = len(frames)
    for i, f in enumerate(frames):
        num = int(os.path.splitext(os.path.basename(f))[0].split("_")[1])
        sec = (num - 1) * INTERVAL
        res, _ = ocr(f); items = []
        if res:
            for box, txt, conf in res:
                ys = [p[1] for p in box]; xs = [p[0] for p in box]
                items.append({"y": round(min(ys)), "x": round(min(xs)),
                              "txt": txt, "c": round(float(conf), 2)})
        out.write(json.dumps({"i": num, "sec": sec, "items": items}, ensure_ascii=False) + "\n")
        if i % 50 == 0: out.flush(); log("  ocr %s %d/%d t=%ds" % (key, i, n, int(sec)))
    out.close(); os.replace(tmp, paths.ocr_path(key))

def main():
    keys = sys.argv[1:]
    ocr = RapidOCR()
    for v in paths.load_videos():
        key = v["key"]
        if keys and key not in keys: continue
        if n_frames(key) < 10:
            if not (os.path.exists(paths.video_path(key)) and os.path.getsize(paths.video_path(key)) > 5_000_000):
                log("WAIT (not downloaded): " + key); continue
            log("extract frames: " + key); extract(key); log("  %d frames" % n_frames(key))
        v_mp4 = paths.video_path(key)
        if os.path.exists(v_mp4) and os.path.getsize(v_mp4) > 5_000_000:
            try: os.remove(v_mp4); log("deleted video for space: " + key)
            except Exception as e: log("  keep video %s (%s)" % (key, e))
        if ocr_complete(key): log("OCR already complete: " + key); continue
        log("OCR sweep: %s (%d frames)" % (key, n_frames(key))); run_ocr(ocr, key); log("OCR done: " + key)
    log("PIPELINE DONE")

if __name__ == "__main__":
    main()
