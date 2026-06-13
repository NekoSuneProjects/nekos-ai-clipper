"""Create a new game config by copying a base config and changing id/name.
  python make_cfg.py <baseId> <newId> "<New Name>"
Also appends {id,name} to GAMECONFIGS/index.json if missing.
"""
import json, os, sys, collections
import paths

base, newid, newname = sys.argv[1], sys.argv[2], sys.argv[3]
cfg = json.load(open(paths.cfg_path(base), encoding="utf-8"),
                object_pairs_hook=collections.OrderedDict)
cfg["id"] = newid
cfg["name"] = newname
json.dump(cfg, open(paths.cfg_path(newid), "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print("wrote", paths.cfg_path(newid))

idx_path = os.path.join(paths.GAMECONFIGS, "index.json")
idx = json.load(open(idx_path, encoding="utf-8"))
ids = {e.get("id") for e in idx} if isinstance(idx, list) else set()
if isinstance(idx, list) and newid not in ids:
    idx.append({"id": newid, "name": newname})
    json.dump(idx, open(idx_path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    print("added to index.json")
else:
    print("index.json: already present or unexpected format (%s)" % type(idx).__name__)
