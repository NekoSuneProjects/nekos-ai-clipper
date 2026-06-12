<div align="center">

# 🕹️ Nekos AI Clipper — Game Profiles

### The OCR detection profiles that tell the clipper where to look on each game's HUD.

> 🌿 This is the **`gameconfig` branch**. It's consumed by the **`app`** and **`web`** branches as a **git submodule** mounted at `core/gameConfigs/`.

</div>

---

## What's in here

One JSON per game (`BF6.json`, `FRTN.json`, …) plus **`index.json`** (the dropdown list of `{id, name}`). Each profile defines **where on the screen** to OCR and **what words** mean a kill/death/win.

## 📐 Profile format

```jsonc
{
  "id": "FRTN",
  "name": "Fortnite",
  "fps": 2,                     // frames/sec sampled for OCR (lower = faster)
  "ocrThreshold": 185,          // 0–255: binarize bright HUD text so it reads
  "killClusterGapMs": 15000,    // merge kills within this gap into one clip
  "crops": {                    // regions to OCR — fractions [x1,y1,x2,y2] of the frame
    "KillMessage":   [0.25, 0.46, 0.75, 0.66],
    "StreakMessage": [0.25, 0.44, 0.75, 0.64],
    "GameResult":    [0.30, 0.10, 0.70, 0.42]
  },
  "windows": { "killFuture": 1, "squadFuture": 1, "endGameFuture": 1, "streakLookahead": 8 },
  "deathWords": ["YOU PLACED", "PLACED #"],
  "detectors": {
    "kill":   [ { "event": "kill", "crop": "KillMessage", "match": ["KILL"], "score": 76 } ],
    "streak": [ { "event": "doubleKill", "crop": "StreakMessage", "match": ["DOUBLE KILL"], "score": 72 } ],
    "squadWipe": [ /* … */ ],
    "endGame":   [ { "event": "victory", "crop": "GameResult", "match": ["VICTORY"], "score": 74 } ]
  },
  "events": [ /* display names, icons, montage effects per event */ ]
}
```

**Key ideas**
- **`crops`** are fractions of the frame, so they scale to any resolution.
- **`match`** is fuzzy (Levenshtein), so noisy OCR still hits; **`score`** is the % threshold.
- **`ocrThreshold`** is essential for stylized fonts — it isolates the white callout text.
- Detectors can name their own **`crop`**; otherwise they default to `KillMessage` / `StreakMessage` / `GameResult`.

## 🎯 The "central band" rule (important)

Most games show your **personal** kill callouts **center-screen**, while the lobby kill-feed and streamer overlays sit at the **edges**. So crops scan the **central band** and **exclude the feed** — that way only **your** kills count, and edge overlays don't matter. Fortnite & Battlefield 6 are calibrated this way.

## ➕ Add or tune a game

1. Copy an existing profile (e.g. `BF6.json`) to `NEWID.json`, set `id`/`name`.
2. Grab a frame of real gameplay, find where the kill/headshot/win text appears, and set the `crops` fractions.
3. Put the on-screen words in `detectors[...].match`; set `ocrThreshold` if the text is stylized.
4. Add `{ "id": "NEWID", "name": "Game Name" }` to **`index.json`**.

## 🔗 How app/web use this

```bash
# from inside the app or web clone
git submodule update --init --recursive       # first time
git submodule update --remote core/gameConfigs # pull the latest profiles
git commit -am "update game profiles"          # pin the new version
```

---

<div align="center">

Part of **[Nekos AI Clipper](https://github.com/NekoSuneProjects/nekos-ai-clipper)** · 💜
</div>
