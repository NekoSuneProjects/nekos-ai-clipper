// core/musicLibrary.js
//
// Auto music library — pulls free / copyright-free music via the bundled yt-dlp
// and caches it in AppData. Two kinds of source:
//   - collections: a YouTube playlist/channel expanded at runtime (NCS,
//     StreamBeats, Ninety9Lives) → effectively unlimited, always current.
//   - tracks: individual curated fallbacks.
//
// LICENSING: NCS & Ninety9Lives require crediting the artist in your video
// description (we return the `attribution` string). StreamBeats does not.

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { create: createYoutubeDl } = require("yt-dlp-exec");
const { prepareTools, TOOLS_DIR } = require("../tools/toolsManager");

const SOURCES_FILE = path.join(__dirname, "ncsTracks.json");
// Music (and 30s previews) cache. Desktop sets MUSIC_DIR to the user's Documents
// folder; otherwise it lives under the app's tools dir.
const MUSIC_CACHE_DIR = process.env.MUSIC_DIR || path.join(TOOLS_DIR, "music");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readSources() {
  try {
    const data = JSON.parse(fs.readFileSync(SOURCES_FILE, "utf-8"));
    return {
      collections: Array.isArray(data.collections)
        ? data.collections.filter((c) => c && c.id && (c.url || (c.type === "search" && c.query)))
        : [],
      tracks: Array.isArray(data.tracks) ? data.tracks.filter((t) => t && t.id && t.url) : []
    };
  } catch (err) {
    console.error("Failed to read music sources (ncsTracks.json):", err);
    return { collections: [], tracks: [] };
  }
}

function listTracks() {
  return readSources().tracks;
}

function listCollections() {
  return readSources().collections;
}

// What the user must put in their video description for a given source.
function attributionFor(track) {
  if (track && track.attribution) return track.attribution;
  return `Music: ${track.title} — ${track.artist} [NCS Release]\nFree Download / Stream: http://ncs.io/`;
}

function cachedPathFor(id) {
  return path.join(MUSIC_CACHE_DIR, `${id}.mp3`);
}

// Expand a playlist/channel/search to a flat list of {id,title} (metadata only).
function listCollectionItems(collection, max = 200) {
  return new Promise(async (resolve) => {
    const tools = await prepareTools();
    // "search" collections query YouTube directly (e.g. TikTok songs).
    const target = collection.type === "search"
      ? `ytsearch${max}:${collection.query || collection.name}`
      : collection.url;
    const args = [
      "--flat-playlist",
      "--playlist-end", String(max),
      "--no-warnings",
      "--print", "%(id)s\t%(title)s",
      target
    ];
    const proc = spawn(tools.ytdlp, args, { windowsHide: true });
    let out = "";
    proc.stdout.on("data", (d) => { out += d.toString(); });
    proc.stderr.on("data", () => {});
    proc.on("close", () => {
      const items = out
        .split(/\r?\n/)
        .map((line) => {
          const tab = line.indexOf("\t");
          if (tab === -1) return null;
          const id = line.slice(0, tab).trim();
          const title = line.slice(tab + 1).trim();
          if (!id || id.length < 6) return null;
          return { id, title };
        })
        .filter(Boolean);
      resolve(items);
    });
    proc.on("error", () => resolve([]));
  });
}

// Pick one track from a collection (seed varies the choice deterministically).
async function getRandomFromCollection(collection, seed) {
  const items = await listCollectionItems(collection);
  if (!items.length) throw new Error(`Couldn't load any tracks from ${collection.name}.`);
  const pick = Number.isFinite(seed)
    ? items[Math.abs(Math.floor(seed)) % items.length]
    : items[Math.floor(Math.random() * items.length)];
  return {
    id: pick.id,
    title: pick.title || pick.id,
    artist: collection.name,
    url: `https://www.youtube.com/watch?v=${pick.id}`,
    attribution: collection.attribution,
    creditRequired: collection.creditRequired !== false
  };
}

// Download a single track's audio as mp3 (cached). Returns { path, attribution }.
async function downloadTrack(track, onProgress = null) {
  if (!track || !track.url) throw new Error("downloadTrack: invalid track");

  ensureDir(MUSIC_CACHE_DIR);

  const outFile = cachedPathFor(track.id);
  const attribution = attributionFor(track);

  if (fs.existsSync(outFile) && fs.statSync(outFile).size > 0) {
    if (onProgress) onProgress(100);
    return { path: outFile, attribution, creditRequired: track.creditRequired !== false, cached: true, track };
  }

  const tools = await prepareTools();
  const ytdlp = createYoutubeDl(tools.ytdlp);
  const ffmpegDir = path.dirname(tools.ffmpeg);

  const subprocess = ytdlp.exec(track.url, {
    output: path.join(MUSIC_CACHE_DIR, `${track.id}.%(ext)s`),
    extractAudio: true,
    audioFormat: "mp3",
    audioQuality: 0,
    format: "bestaudio/best",
    ffmpegLocation: ffmpegDir,
    noPlaylist: true,
    noWarnings: true,
    noCheckCertificates: true,
    addHeader: [
      "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "Referer: https://www.youtube.com/"
    ],
    progress: true
  });

  subprocess.stdout.on("data", (chunk) => {
    const m = chunk.toString().match(/\[download\]\s+(\d+\.\d+)%/i);
    if (m && onProgress) onProgress(parseFloat(m[1]));
  });
  subprocess.stderr.on("data", (d) => console.log("[yt-dlp music]", d.toString()));

  await new Promise((resolve, reject) => {
    subprocess.on("close", (code) => {
      if (code !== 0) return reject(new Error(`yt-dlp (music) exited with code ${code}`));
      resolve();
    });
    subprocess.on("error", reject);
  });

  let finalFile = outFile;
  if (!fs.existsSync(finalFile)) {
    // Never fall back to a *_preview.mp3 (those are 30s clips) — prefer the
    // track id, else the newest FULL mp3.
    const cands = fs
      .readdirSync(MUSIC_CACHE_DIR)
      .filter((f) => f.toLowerCase().endsWith(".mp3") && !f.toLowerCase().endsWith("_preview.mp3"));
    const byId = cands.find((f) => f === `${track.id}.mp3`) || cands.find((f) => f.startsWith(track.id + "."));
    if (byId) {
      finalFile = path.join(MUSIC_CACHE_DIR, byId);
    } else {
      const newest = cands
        .map((f) => ({ f, t: fs.statSync(path.join(MUSIC_CACHE_DIR, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t)[0];
      if (!newest) throw new Error("Music download finished but no mp3 found.");
      finalFile = path.join(MUSIC_CACHE_DIR, newest.f);
    }
  }

  return { path: finalFile, attribution, creditRequired: track.creditRequired !== false, cached: false, track };
}

// Resolve + download a track. opts:
//   { collectionId } → random track from that playlist/channel
//   { id }           → a specific curated track
//   { seed }         → varies the random pick
async function getAutoTrack(opts = {}, onProgress = null) {
  const { collections, tracks } = readSources();

  if (opts.collectionId) {
    const col = collections.find((c) => c.id === opts.collectionId);
    if (!col) throw new Error("Unknown music source: " + opts.collectionId);
    const track = await getRandomFromCollection(col, opts.seed);
    return downloadTrack(track, onProgress);
  }

  if (!tracks.length) {
    // No curated tracks — fall back to the first collection if present.
    if (collections.length) {
      const track = await getRandomFromCollection(collections[0], opts.seed);
      return downloadTrack(track, onProgress);
    }
    throw new Error("No music sources configured in ncsTracks.json.");
  }

  let track;
  if (opts.id) {
    track = tracks.find((t) => t.id === opts.id);
    if (!track) throw new Error("Requested track id not found: " + opts.id);
  } else {
    const seed = Number.isFinite(opts.seed) ? opts.seed : tracks.length;
    track = tracks[Math.abs(Math.floor(seed)) % tracks.length];
  }
  return downloadTrack(track, onProgress);
}

// Download a ~30s preview snippet of a track for the picker. Cached separately.
function previewTrack(idOrUrl) {
  return new Promise(async (resolve, reject) => {
    ensureDir(MUSIC_CACHE_DIR);
    const id = /^https?:/i.test(idOrUrl) ? (idOrUrl.match(/[?&]v=([\w-]+)/)?.[1] || idOrUrl) : idOrUrl;
    const url = /^https?:/i.test(idOrUrl) ? idOrUrl : `https://www.youtube.com/watch?v=${idOrUrl}`;
    const outFile = path.join(MUSIC_CACHE_DIR, `${id}_preview.mp3`);

    if (fs.existsSync(outFile) && fs.statSync(outFile).size > 0) return resolve(outFile);

    const tools = await prepareTools();
    const args = [
      url,
      "--no-playlist", "--no-warnings", "--no-check-certificates",
      "--download-sections", "*0:30-1:00",
      "--force-keyframes-at-cuts",
      "-x", "--audio-format", "mp3", "--audio-quality", "5",
      "--ffmpeg-location", path.dirname(tools.ffmpeg),
      "-o", path.join(MUSIC_CACHE_DIR, `${id}_preview.%(ext)s`)
    ];
    const proc = spawn(tools.ytdlp, args, { windowsHide: true });
    proc.stderr.on("data", () => {});
    proc.on("close", (code) => {
      if (fs.existsSync(outFile)) return resolve(outFile);
      // yt-dlp may have named it differently; grab newest *_preview.mp3
      const f = fs.readdirSync(MUSIC_CACHE_DIR).filter((x) => x.endsWith("_preview.mp3"));
      if (f.length) return resolve(path.join(MUSIC_CACHE_DIR, f.sort().pop()));
      reject(new Error("Preview download failed (code " + code + ")"));
    });
    proc.on("error", reject);
  });
}

// Download a specific picked track and attach the right credit from its source.
async function getTrack(opts = {}, onProgress = null) {
  const { collections } = readSources();
  const col = opts.collectionId ? collections.find((c) => c.id === opts.collectionId) : null;
  const id = opts.id || (opts.url && opts.url.match(/[?&]v=([\w-]+)/)?.[1]);
  if (!id && !opts.url) throw new Error("getTrack: need an id or url");

  const track = {
    id: id,
    title: opts.title || id,
    artist: opts.artist || (col ? col.name : "Unknown"),
    url: opts.url || `https://www.youtube.com/watch?v=${id}`,
    attribution: col ? col.attribution : undefined,
    creditRequired: col ? col.creditRequired !== false : true,
    warning: col ? col.warning : undefined
  };
  const res = await downloadTrack(track, onProgress);
  res.warning = track.warning;
  res.creditRequired = track.creditRequired;
  return res;
}

module.exports = {
  listTracks,
  listCollections,
  listCollectionItems,
  downloadTrack,
  getAutoTrack,
  getTrack,
  previewTrack,
  attributionFor,
  MUSIC_CACHE_DIR
};
