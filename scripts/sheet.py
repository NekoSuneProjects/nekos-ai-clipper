"""
Build a contact-sheet PNG (grid of event-moment thumbnails) like the reference.
  python sheet.py <key> [types]
    types: comma list of event types (default "kill"); "all" = every event
Output: output/<key>_<types>_sheet.png
"""
import json, os, sys, glob
from PIL import Image, ImageDraw, ImageFont
import paths

COLS = 6
TILE_W, TILE_H = 288, 185
INTERVAL = 2.0

def nearest_frame(key, sec):
    fd = paths.frames_dir(key)
    num = round(sec / INTERVAL) + 1
    for cand in (num, num - 1, num + 1, num - 2, num + 2):
        p = os.path.join(fd, "f_%04d.jpg" % cand)
        if os.path.exists(p): return p
    files = sorted(glob.glob(os.path.join(fd, "f_*.jpg")))
    return files[min(len(files) - 1, max(0, num - 1))] if files else None

def cover(img, w, h):
    sw, sh = img.size; scale = max(w / sw, h / sh)
    img = img.resize((int(sw * scale + 0.5), int(sh * scale + 0.5)), Image.LANCZOS)
    sw, sh = img.size; left = (sw - w) // 2; top = (sh - h) // 2
    return img.crop((left, top, left + w, top + h))

def hms(sec): s = int(sec); return "%d:%02d" % (s // 60, s % 60)

def build(key, types):
    data = json.load(open(paths.events_path(key), encoding="utf-8"))
    events = data["events"]
    if types != ["all"]:
        events = [e for e in events if e["type"] in types]
    events.sort(key=lambda e: e["sec"])
    if not events:
        print("NO EVENTS for %s types=%s" % (key, types)); return None
    n = len(events); rows = (n + COLS - 1) // COLS
    sheet = Image.new("RGB", (COLS * TILE_W, rows * TILE_H), (8, 8, 8))
    draw = ImageDraw.Draw(sheet)
    try: font = ImageFont.truetype("arialbd.ttf", 15)
    except Exception: font = ImageFont.load_default()
    for idx, e in enumerate(events):
        fp = nearest_frame(key, e["sec"])
        if not fp: continue
        tile = cover(Image.open(fp).convert("RGB"), TILE_W, TILE_H)
        x = (idx % COLS) * TILE_W; y = (idx // COLS) * TILE_H
        sheet.paste(tile, (x, y))
        label = "%s %s" % (hms(e["sec"]), e["event"])
        draw.rectangle([x, y + TILE_H - 18, x + TILE_W, y + TILE_H], fill=(0, 0, 0))
        draw.text((x + 4, y + TILE_H - 17), label, fill=(255, 230, 120), font=font)
    name = os.path.join(paths.OUTPUT, "%s_%s_sheet.png" % (key, "+".join(types)))
    sheet.save(name)
    print("wrote %s  (%d events, %dx%d)" % (name, n, sheet.width, sheet.height)); return name

if __name__ == "__main__":
    key = sys.argv[1]
    types = (sys.argv[2].split(",") if len(sys.argv) > 2 else ["kill"])
    build(key, types)
