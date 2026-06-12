# ARC Raiders — detection notes

**Sheet contents:** extractions only (6 successful raids in the source video).

**Why no kills:** ARC *machine* kills print **no kill-feed text**, so they cannot be
OCR-detected. The top-right HUD region is the Quick-Use / objective UI (Harvester,
Raider Hatch, distances), not a kill feed. PvP `ELIMINATED` callouts *would* be
detectable, but the source is a solo PvE run with none.

**Victory signal:** `RETURNING TO SPERANZA` / `RETURNED HOME SAFELY` (extraction) —
set in `GAMECONFIGS/ARCR.json` (`GameResult` crop, score 80).

**Detected:** 6 victories (extractions) at 5:30, 5:44, 7:36, 8:24, 20:44, 24:14.
Kills/deaths: 0 detectable.
