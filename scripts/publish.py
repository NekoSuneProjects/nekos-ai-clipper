"""
Copy generated contact sheets into the SheetLearning output branch:
  output/<key>_all_sheet.png  ->  ../SheetLearning/Gaming/<Game>/pos_sheet.png
Game folder name is derived from the game config's display name (paths.game_folder).
  python publish.py [keys...]
"""
import os, shutil, sys
import paths

keys = sys.argv[1:]
done = []
for v in paths.load_videos():
    key, cfg = v["key"], v["cfg"]
    if keys and key not in keys:
        continue
    src = os.path.join(paths.OUTPUT, "%s_all_sheet.png" % key)
    if not os.path.exists(src):
        continue
    dest = paths.pos_sheet_path(cfg)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.copy2(src, dest)
    rel = os.path.relpath(dest, paths.SHEETLEARNING)
    done.append((key, rel))
    print("published %-16s -> SheetLearning/%s" % (key, rel.replace(os.sep, "/")))

if not done:
    print("nothing to publish (no output/*_all_sheet.png yet)")
