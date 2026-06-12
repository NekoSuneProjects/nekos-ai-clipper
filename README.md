# SHEETGEN — gameplay kill-sheet generator + config calibration

Headless pipeline that downloads gameplay videos, OCRs the HUD, detects
kill/death/win/loss events using the `GAMECONFIGS/*.json` profiles (same crops +
fuzzy-match logic as `APP/core/fpsDetector.js`), and renders **contact-sheet PNGs**
(grids of event-moment thumbnails) plus stats. Also used to **calibrate** the game
configs (find the right crops + match words from real footage).

## Folder layout
```
SHEETGEN/
  videos.json     master registry: [{key, vid (YouTube id), cfg (GAMECONFIGS id), title}]
  scripts/        all python (see below)
  downloads/      <key>.mp4 (temporary; deleted after frames are extracted)
  frames/<key>/   f_0001.jpg ... (1 frame / 2s)
  ocr/<key>.jsonl full-frame OCR per frame: {i, sec, items:[{x,y,txt,c}]}
  events/<key>.json  detected events + summary
  output/         <key>_<types>_sheet.png  + stats.csv   <-- deliverables
  logs/           pipeline + download logs
```

## Scripts
| script | what it does |
|--------|--------------|
| `paths.py`     | shared paths (imports GAMECONFIGS from repo root) |
| `download.py`  | download videos.json entries -> downloads/ (720p). `python download.py [keys...]` |
| `pipeline.py`  | extract frames + full-frame OCR -> ocr/. deletes video after. `python pipeline.py [keys...]` |
| `detect.py`    | OCR + config -> events/. `python detect.py <key> <cfgId>` |
| `sheet.py`     | events + frames -> output PNG. `python sheet.py <key> [types]` (default `kill`; `all` for everything) |
| `calibrate.py` | inspect OCR to find where/what kill/win text is. `python calibrate.py <key> [keywords...]` |
| `run_all.py`   | detect + build sheets for every calibrated game; writes output/stats.csv |

## Typical run
```
cd scripts
python download.py            # all videos
python pipeline.py            # frames + OCR (long; run in background)
python run_all.py             # detect + sheets for calibrated configs
```

## Notes
- OCR engine here is RapidOCR (CPU); the Electron app uses Tesseract.js. Crops &
  match-words are engine-independent, so calibration transfers to the app.
- 720p downloads need yt-dlp's JS challenge solver: `--remote-components ejs:github`
  (deno). First call per process can fail transiently — scripts retry.
- Uncalibrated configs (empty `detectors`) detect nothing until match words/crops
  are filled. Use `calibrate.py` to find them.
