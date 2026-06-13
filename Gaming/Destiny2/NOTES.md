# Destiny 2 — no sheet (footage has no combat)

The source video is almost entirely **character customization, menus and tutorial
text**, not gameplay. OCR found no real combat events:
- "Combatants defeated" is a passive **stat counter** (not a per-kill callout).
- The "Defeat ..." strings are **tutorial/objective subtitles**, not events.
- No `VICTORY`/`DEFEAT` end screens appear.

`DES2.json` was given best-effort detectors (`DEFEATED` in CenterMessages, victory/defeat
in EndGame), but a meaningful sheet needs **actual gameplay footage** (Crucible PvP or a
strike/raid). Re-run with combat footage to generate `pos_sheet.png`.
