"""
After OCR (pipeline.py) is done, run detection + build sheets for every video
whose game config has detectors. Writes events/<key>.json, output/<key>_*_sheet.png
and a stats CSV at output/stats.csv.
  python run_all.py
"""
import os, json, csv, shutil
import paths, detect, sheet

def has_kill_detectors(cfg_id):
    try:
        cfg = json.load(open(paths.cfg_path(cfg_id), encoding="utf-8"))
    except Exception:
        return False
    d = cfg.get("detectors", {}) or {}
    return bool(d.get("kill")) or bool(d.get("endGame")) or bool(d.get("streak"))

rows = []
for v in paths.load_videos():
    key, cfg = v["key"], v["cfg"]
    if not os.path.exists(paths.ocr_path(key)):
        rows.append([key, v["title"], cfg, "no-ocr"]); continue
    if not has_kill_detectors(cfg):
        rows.append([key, v["title"], cfg, "config-not-calibrated"]); continue
    s = detect.detect(key, cfg)
    # one combined all-events sheet per game (user preference)
    made = sheet.build(key, ["all"])
    published = ""
    if made:
        dest = paths.pos_sheet_path(cfg)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copy2(made, dest)
        published = os.path.relpath(dest, paths.SHEETLEARNING).replace(os.sep, "/")
        print("published -> SheetLearning/%s" % published)
    rows.append([key, v["title"], cfg, "ok", s["kills"], s["deaths"],
                 s["victories"], s["defeats"], s["streaks"], published])

with open(os.path.join(paths.OUTPUT, "stats.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["key", "title", "cfg", "status", "kills", "deaths", "victories", "defeats", "streaks", "sheet"])
    w.writerows(rows)
print("wrote", os.path.join(paths.OUTPUT, "stats.csv"))
for r in rows: print(r)
