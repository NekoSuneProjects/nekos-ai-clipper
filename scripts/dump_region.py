import json, sys
import paths
from collections import Counter
sys.stdout.reconfigure(encoding="utf-8")
# usage: dump_region.py <key> x1 y1 x2 y2   (fractions)
key = sys.argv[1]
x1, y1, x2, y2 = map(float, sys.argv[2:6])
W, H = 1280, 720
l, t, r, b = x1*W, y1*H, x2*W, y2*H
c = Counter()
for line in open(paths.ocr_path(key), encoding="utf-8"):
    rec = json.loads(line)
    for it in rec["items"]:
        yy = it.get("y", it.get("t", 0)); xx = it.get("x", 0)
        if l <= xx <= r and t <= yy <= b and it.get("c", 1) >= 0.4:
            c[it["txt"].upper()] += 1
for txt, n in c.most_common(30):
    print("%3d  %s" % (n, txt))
