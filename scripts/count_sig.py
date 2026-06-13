import json, sys
import paths
for k in sys.argv[1:]:
    counts = {"ELIMINATED": 0, "NTHKILL": 0, "PLUS100": 0, "KILLED": 0}
    for line in open(paths.ocr_path(k), encoding="utf-8"):
        for it in json.loads(line)["items"]:
            t = it["txt"].upper().replace(" ", "")
            if "ELIMINATED" in t: counts["ELIMINATED"] += 1
            if any(o in t for o in ("STKILL", "NDKILL", "RDKILL", "THKILL")): counts["NTHKILL"] += 1
            if "+100" in t or "100ELIMINATION" in t: counts["PLUS100"] += 1
            if "KILLED" in t: counts["KILLED"] += 1
    print(k, counts)
