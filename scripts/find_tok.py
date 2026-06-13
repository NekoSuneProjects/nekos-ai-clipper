import json, sys
import paths
sys.stdout.reconfigure(encoding="utf-8")
key = sys.argv[1]
needles = [s.upper() for s in sys.argv[2:]]
hits = {}
for line in open(paths.ocr_path(key), encoding="utf-8"):
    r = json.loads(line)
    for it in r["items"]:
        T = it["txt"].upper().replace(" ", "")
        for n in needles:
            if n.replace(" ", "") in T:
                y = it.get("y", it.get("t", 0)); x = it.get("x", 0)
                k = n
                hits.setdefault(k, [])
                if len(hits[k]) < 4:
                    hits[k].append("%ds (%.3f,%.3f) %s" % (int(r["sec"]), x/1280, y/720, it["txt"][:40]))
for n in needles:
    print(n, "->", len(hits.get(n, [])) and hits[n] or "NONE")
