"""Shared paths for the SHEETGEN pipeline. All scripts import this."""
import os, json

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)              # SHEETGEN/
REPO = os.path.dirname(ROOT)              # repo root (has GAMECONFIGS/)

DOWNLOADS = os.path.join(ROOT, "downloads")
FRAMES    = os.path.join(ROOT, "frames")
OCR       = os.path.join(ROOT, "ocr")
EVENTS    = os.path.join(ROOT, "events")
OUTPUT    = os.path.join(ROOT, "output")
LOGS      = os.path.join(ROOT, "logs")
GAMECONFIGS = os.path.join(REPO, "GAMECONFIGS")
VIDEOS_JSON = os.path.join(ROOT, "videos.json")

for _d in (DOWNLOADS, FRAMES, OCR, EVENTS, OUTPUT, LOGS):
    os.makedirs(_d, exist_ok=True)

def video_path(key):  return os.path.join(DOWNLOADS, key + ".mp4")
def frames_dir(key):  return os.path.join(FRAMES, key)
def ocr_path(key):    return os.path.join(OCR, key + ".jsonl")
def events_path(key): return os.path.join(EVENTS, key + ".json")
def cfg_path(cid):    return os.path.join(GAMECONFIGS, cid + ".json")
def load_videos():    return json.load(open(VIDEOS_JSON, encoding="utf-8"))
