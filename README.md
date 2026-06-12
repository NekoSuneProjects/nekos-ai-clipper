<div align="center">

# 🎞️ SHEETGEN — kill-sheet generator + gameconfig calibration

### Downloads gameplay videos, OCRs the HUD, detects kill/death/win/loss events with the `GAMECONFIGS` profiles, and renders **contact-sheet PNGs** (grids of event-moment thumbnails) — while helping **calibrate** those profiles from real footage.

> 🌿 This is the **`sheetgen` branch** — an orphan branch of `NekoSuneProjects/nekos-ai-clipper`, alongside `app`, `web`, `gameconfig`, `musictracks`.

</div>

---

## What it does

For every game in `videos.json`:

1. **download** the YouTube gameplay at 720p → `downloads/<key>.mp4`
2. **frames** at 1 frame / 2 s → `frames/<key>/` (then the video is deleted to save space)
3. **OCR** every frame full-frame (RapidOCR), storing each token + bbox → `ocr/<key>.jsonl`
4. **detect** events by emulating each game profile's `crops` as a position-filter over the OCR tokens and fuzzy-matching its `detectors` words — a faithful Python port of `APP/core/fpsDetector.js` → `events/<key>.json`
5. **sheet** — tile the frame at each event into a **6-column grid PNG** → `output/<key>_all_sheet.png`

The result is one **combined all-events sheet** per game (kills, deaths, wins, losses; each tile labelled), used to eyeball-verify and tune the configs.

## 📁 Folder layout

```
SHEETGEN/
  videos.json      master registry: [{ key, vid (YouTube id), cfg (GAMECONFIGS id), title }]
  scripts/         the pipeline (see below)
  downloads/       <key>.mp4  — temporary, deleted after frames        (gitignored)
  frames/<key>/    f_0001.jpg … one frame / 2 s                        (gitignored)
  ocr/<key>.jsonl  per-frame OCR { i, sec, items:[{x,y,txt,c}] }       (gitignored)
  events/<key>.json detected events + summary                          (gitignored)
  output/          <key>_all_sheet.png  +  stats.csv   ← deliverables
  logs/            download + pipeline logs                            (gitignored)
```

## 🧰 Scripts

| script | what it does |
|--------|--------------|
| `paths.py`     | shared paths; locates `GAMECONFIGS/` in the repo root |
| `download.py`  | `python download.py [keys…]` — download registry entries (720p) |
| `pipeline.py`  | `python pipeline.py [keys…]` — frames + OCR, deletes video after. Idempotent |
| `detect.py`    | `python detect.py <key> <cfgId>` — OCR + profile → `events/<key>.json` |
| `sheet.py`     | `python sheet.py <key> [types]` — events + frames → PNG (`all` = every type) |
| `calibrate.py` | `python calibrate.py <key> [keywords…]` — dump OCR token-freq by 3×3 region + keyword positions, to find where/what the kill/win text is |
| `run_all.py`   | detect + build combined sheets for every calibrated game; writes `output/stats.csv` |

## ▶️ Typical run

```bash
cd scripts
python download.py            # all videos in videos.json
python pipeline.py            # frames + OCR (long — run in background)
python run_all.py             # detect + sheets + stats.csv
```

## 🎯 Calibrating a game profile

Profiles live in the repo's `GAMECONFIGS/` (the `gameconfig` branch). Many ship with
**empty `detectors`** and detect nothing until calibrated. To calibrate:

1. `python calibrate.py <key> ELIMINATED VICTORY DEFEAT KILL` — see which screen region
   the callouts land in and the exact words OCR reads.
2. Set the `crops` fraction `[x1,y1,x2,y2]` (= pixel `/1280`, `/720`) and put the words
   in `detectors[…].match` with a `score` (≈75–82).
3. Re-run `detect.py` / `sheet.py` and eyeball `output/<key>_all_sheet.png`.

**Not all kills are text-detectable.** E.g. ARC Raiders *machine* kills print no kill-feed
text (the top-right HUD there is the Quick-Use/objective UI), so those fall back to a
best-effort **proxy** sheet from whatever *is* readable (extractions, score popups, streaks).
ARC victory = `RETURNING TO SPERANZA` / `RETURNED HOME SAFELY`.

## 📝 Notes

- OCR here is **RapidOCR** (CPU); the Electron app uses **Tesseract.js**. Crops and
  match-words are engine-independent, so calibration transfers to the app.
- 720p needs yt-dlp's JS challenge solver: `--remote-components ejs:github` (deno). The
  first call per process can fail transiently — `download.py` retries.

---

<div align="center">

Part of **[Nekos AI Clipper](https://github.com/NekoSuneProjects/nekos-ai-clipper)** · 💜

</div>
