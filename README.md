<div align="center">

# 🧩 Nekos AI Clipper — Sheet Learning

### Per-game **position sheets** — contact-sheet grids of real HUD moments used to *learn* and calibrate where each game shows its kills, deaths, wins and losses.

> 🌿 This is the **`SheetLearning` branch** of [`NekoSuneProjects/nekos-ai-clipper`](https://github.com/NekoSuneProjects/nekos-ai-clipper), alongside `app`, `web`, `gameconfig`, `musictracks`, and `sheetgen`.

</div>

---

## What's in here

One folder per game under **`Gaming/`**, each containing a **`pos_sheet.png`**:

```
Gaming/
  Battlefield6/        pos_sheet.png
  ArcRaiders/          pos_sheet.png
  HaloInfinite/        pos_sheet.png
  CallofDutyBlackOps6/ pos_sheet.png
  …
```

A **`pos_sheet.png`** is a **6-column contact sheet**: every tile is a frame grabbed
at a detected gameplay event (kill / death / victory / defeat), captioned with its
timestamp and event type. Reading down the grid you can see, at a glance, **where on
the HUD** each game prints its callouts and **what the text says** — which is exactly
what you need to write or fix that game's detection profile.

## 🎯 Why "learning"

These sheets are the ground-truth used to **calibrate** the OCR profiles in the
[`gameconfig`](https://github.com/NekoSuneProjects/nekos-ai-clipper/tree/gameconfig)
branch (`GAMECONFIGS/<ID>.json`). The loop is:

1. Generate a `pos_sheet.png` for a game from real footage.
2. Eyeball the grid → note the **region** (crop) and the **words** of the kill/win text.
3. Set the profile's `crops` (fractions of the frame) and `detectors[…].match` words.
4. Re-generate the sheet and confirm the right moments line up.

## 🛠️ How sheets are generated

By the tooling on the **`sheetgen`** branch
([tree](https://github.com/NekoSuneProjects/nekos-ai-clipper/tree/sheetgen)):
download gameplay → sample frames → OCR the HUD → detect events with the game
profile → tile the event frames into the grid. It publishes each result here as
`Gaming/<Game>/pos_sheet.png` (folder name = the profile's display name, alnum-only,
e.g. *Battlefield 6 → `Battlefield6`*).

## 📏 Sheet format

| property | value |
|----------|-------|
| columns  | 6 |
| tile      | ~288 × 185 px, cover-cropped from a 1280×720 frame |
| caption   | `m:ss <eventType>` per tile |
| contents  | combined **all events** — kills, deaths, victories, defeats |

> Some games print no kill-feed **text** (e.g. ARC Raiders machine kills), so those
> sheets fall back to a **best-effort proxy** from whatever *is* readable (extractions,
> score popups, streaks) and are marked approximate.

---

<div align="center">

Part of **[Nekos AI Clipper](https://github.com/NekoSuneProjects/nekos-ai-clipper)** · 💜

</div>
