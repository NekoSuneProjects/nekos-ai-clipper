"""
Headless port of APP/core/fpsDetector.js detection.
We OCR full frames once (pipeline.py, storing bbox per token), then emulate each
config crop as a POSITION FILTER over tokens and fuzzy-match detector words.
  python detect.py <key> <cfg_id>   ->  events/<key>.json
"""
import json, sys
import paths

def levenshtein(a, b):
    if a == b: return 0
    la, lb = len(a), len(b)
    if not la: return lb
    if not lb: return la
    prev = list(range(lb + 1))
    for i in range(1, la + 1):
        cur = [i] + [0] * lb; ca = a[i - 1]
        for j in range(1, lb + 1):
            cost = 0 if ca == b[j - 1] else 1
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
        prev = cur
    return prev[lb]

def norm(s): return "".join(ch for ch in s.upper() if ch.isalnum())

def best_window_score(detected, wanted):
    d = norm(detected); w = norm(wanted)
    if not w or not d: return 0
    if len(w) >= len(d):
        return max(0.0, (1 - levenshtein(d, w) / max(len(d), len(w))) * 100)
    best = 0.0
    for i in range(0, len(d) - len(w) + 1):
        sc = (1 - levenshtein(d[i:i + len(w)], w) / len(w)) * 100
        if sc > best: best = sc
    return best

def check_values(detected, match_list, score):
    return any(best_window_score(detected, v) >= score for v in match_list)

DEATH_WORDS = ["YOU DIED", "YOU ARE DEAD", "KILLED BY", "ELIMINATED BY",
               "DEFEATED BY", "YOU WERE KILLED", "YOU WERE ELIMINATED",
               "YOU WERE DOWNED", "YOU WERE DESTROYED", "WASTED"]
COLLAPSE_GAP_MS = {"kill": 4000, "death": 8000, "streak": 6000,
                   "squadWipe": 8000, "endGame": 12000}

def load_ocr(key):
    frames = []
    for line in open(paths.ocr_path(key), encoding="utf-8"):
        line = line.strip()
        if not line: continue
        r = json.loads(line); items = []
        for it in r["items"]:
            y = it.get("y", it.get("t", 0))
            items.append({"x": it.get("x", 0), "y": y, "txt": it["txt"], "c": it.get("c", 1.0)})
        frames.append({"sec": r["sec"], "items": items})
    frames.sort(key=lambda f: f["sec"]); return frames

def text_in_crop(frame, crop, W=1280, H=720):
    if not crop:
        return " ".join(it["txt"] for it in frame["items"])
    x1, y1, x2, y2 = crop
    l, t, rr, b = x1 * W, y1 * H, x2 * W, y2 * H
    return " ".join(it["txt"] for it in frame["items"] if l <= it["x"] <= rr and t <= it["y"] <= b)

def detect(key, cfg_id):
    cfg = json.load(open(paths.cfg_path(cfg_id), encoding="utf-8"))
    crops = cfg.get("crops", {}) or {}; det = cfg.get("detectors", {}) or {}
    frames = load_ocr(key)
    events = []; last = {}

    def emit(etype, event, sec, text):
        ms = sec * 1000; k = (etype, event)
        gap = COLLAPSE_GAP_MS.get(etype, 4000)
        if k in last and ms - last[k] < gap:
            last[k] = ms; return
        last[k] = ms
        events.append({"type": etype, "event": event, "sec": round(sec, 1), "text": text[:70]})

    def crop_for(d, default): return crops.get(d.get("crop", default))

    for fr in frames:
        sec = fr["sec"]
        alltext = " ".join(it["txt"] for it in fr["items"])
        if check_values(alltext, DEATH_WORDS, 82): emit("death", "death", sec, alltext)
        for d in det.get("kill", []):
            txt = text_in_crop(fr, crop_for(d, "KillMessage"))
            if check_values(txt, d["match"], d.get("score", 75)): emit("kill", d.get("event", "kill"), sec, txt)
        for d in det.get("streak", []):
            txt = text_in_crop(fr, crop_for(d, "StreakMessage"))
            if check_values(txt, d["match"], d.get("score", 75)): emit("streak", d.get("event", "streak"), sec, txt)
        for d in det.get("squadWipe", []):
            txt = text_in_crop(fr, crop_for(d, "KillMessage"))
            if check_values(txt, d["match"], d.get("score", 75)): emit("squadWipe", d.get("event", "squadWipe"), sec, txt)
        for d in det.get("endGame", []):
            txt = text_in_crop(fr, crop_for(d, "GameResult"))
            if check_values(txt, d["match"], d.get("score", 70)): emit("endGame", d.get("event", "result"), sec, txt)

    summary = {"key": key, "cfg": cfg_id,
               "kills": sum(1 for e in events if e["type"] == "kill"),
               "deaths": sum(1 for e in events if e["type"] == "death"),
               "victories": sum(1 for e in events if e["event"] == "victory"),
               "defeats": sum(1 for e in events if e["event"] == "defeat"),
               "streaks": sum(1 for e in events if e["type"] == "streak"),
               "squadWipes": sum(1 for e in events if e["type"] == "squadWipe")}
    json.dump({"summary": summary, "events": events},
              open(paths.events_path(key), "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    print(json.dumps(summary)); return summary

if __name__ == "__main__":
    detect(sys.argv[1], sys.argv[2])
