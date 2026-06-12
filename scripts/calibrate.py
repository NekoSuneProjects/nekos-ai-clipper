"""
Calibration helper: inspect ocr/<key>.jsonl to find WHERE kill/win/death text
appears (to set config crops) and WHAT words occur (to set detector match lists).
  python calibrate.py <key> [keyword1 keyword2 ...]
Prints: (a) token frequency by 3x3 screen region, (b) hits for given keywords
with their pixel positions -> convert to crop fractions (x/1280, y/720).
"""
import json, sys
import paths
sys.stdout.reconfigure(encoding="utf-8")

W, H = 1280, 720
key = sys.argv[1]
keywords = [k.upper() for k in sys.argv[2:]]

def region(x, y):
    col = "L" if x < W/3 else ("C" if x < 2*W/3 else "R")
    row = "T" if y < H/3 else ("M" if y < 2*H/3 else "B")
    return row + col  # e.g. TR = top-right

from collections import Counter, defaultdict
byreg = defaultdict(Counter)
hits = []
for line in open(paths.ocr_path(key), encoding="utf-8"):
    r = json.loads(line)
    for it in r["items"]:
        y = it.get("y", it.get("t", 0)); x = it.get("x", 0)
        if it.get("c", 1) < 0.5: continue
        T = it["txt"].upper()
        byreg[region(x, y)][T] += 1
        if any(k in T.replace(" ", "") for k in keywords):
            hits.append((int(r["sec"]), x, y, it["txt"]))

print("=== token freq by region (TL TC TR / ML MC MR / BL BC BR) ===")
for reg in ["TL","TC","TR","ML","MC","MR","BL","BC","BR"]:
    common = byreg[reg].most_common(6)
    if common:
        print(reg, "->", ", ".join("%s(%d)" % (t, n) for t, n in common))
if keywords:
    print("\n=== keyword hits (sec, x, y, text) -> crop fraction x/%d y/%d ===" % (W, H))
    for sec, x, y, txt in hits[:60]:
        print("%4ds x=%4d y=%3d  (%.3f,%.3f)  %s" % (sec, x, y, x/W, y/H, txt))
