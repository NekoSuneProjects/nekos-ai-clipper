<div align="center">

# 🎵 Nekos AI Clipper — Music Sources (Live)

### Edit `MusicTracks.json` here and the app + web pick it up at runtime — **no rebuild needed**.

> 🌿 This is the **`musictracks` branch**. The desktop **`app`** and the **`web`** server fetch this file live from
> `raw.githubusercontent.com/.../musictracks/MusicTracks.json`, cache it for ~60s, and fall back to a bundled copy when offline.

</div>

---

## How the live update works

1. You edit **`MusicTracks.json`** on this branch and push.
2. Next time anyone opens the **Music Library** in the app/web, it re-fetches this file (cached up to 60s).
3. New sources/songs appear instantly — **you don't rebuild or redeploy anything**.

Override the source URL with the `MUSIC_TRACKS_URL` env var if you host it elsewhere.

## 📐 `MusicTracks.json` format

```jsonc
{
  "collections": [        // playlists / channels / searches expanded by yt-dlp at runtime
    {
      "id": "ncs",                                   // unique key
      "name": "NCS (NoCopyrightSounds)",             // shown as a tab
      "type": "channel",                             // "channel" | "playlist" | "search"
      "url": "https://www.youtube.com/@NoCopyrightSounds/videos",
      "creditRequired": true,                        // show "credit required" in the UI
      "attribution": "Music provided by NoCopyrightSounds — http://ncs.io/",
      "warning": "..."                               // optional ⚠️ banner (e.g. copyrighted)
    },
    { "id": "tiktok", "name": "TikTok", "type": "search", "query": "tiktok viral songs",
      "creditRequired": true, "warning": "Copyrighted — may be claimed/struck." }
  ],
  "tracks": [             // individual curated songs (the "NCS Picks" tab)
    { "id": "K4DyBUG242c", "title": "On & On (feat. Daniel Levi)", "artist": "Cartoon",
      "url": "https://www.youtube.com/watch?v=K4DyBUG242c" }
  ]
}
```

**Collection types**
- `channel` / `playlist` → a YouTube URL; yt-dlp lists the videos.
- `search` → a `query` string; yt-dlp runs a YouTube search.

**Fields**
| field | where | meaning |
|---|---|---|
| `id` | both | unique identifier |
| `name` | collection | tab label |
| `type` / `url` / `query` | collection | how to expand it |
| `creditRequired` | collection | `false` = no attribution needed (e.g. StreamBeats) |
| `attribution` | collection | the exact credit line shown to the user |
| `warning` | collection | optional ⚠️ banner (Monstercat license / TikTok copyright) |
| `title` / `artist` / `url` | track | a single curated song |

## ➕ Add a source

- **A whole catalog** → add a `collections` entry (channel/playlist URL or a search query).
- **A specific song** → add a `tracks` entry (its YouTube `id` + `url`).
- Validate the JSON, commit, push. Done — it's live.

## ⚠️ Licensing

NCS & Ninety9Lives need **attribution** (the app shows the credit line). **StreamBeats** needs none. **Monstercat** needs a license and **TikTok** songs are **copyrighted** — keep their `warning` set so users are told before they use them.

---

<div align="center">

Part of **[Nekos AI Clipper](https://github.com/NekoSuneProjects/nekos-ai-clipper)** · 💜
</div>
