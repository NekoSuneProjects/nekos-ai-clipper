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
const https = require("https");
const { spawn, execFile } = require("child_process");
const { create: createYoutubeDl } = require("yt-dlp-exec");
const { prepareTools, TOOLS_DIR, ffmpegDirOf } = require("../tools/toolsManager");

// Music sources are LIVE-EDITABLE: fetched at runtime from the `musictracks`
// branch so the NCS/StreamBeats/etc. lists update WITHOUT rebuilding app/web.
// Falls back to the downloaded cache, then the bundled MusicTracks.json (offline).
const SOURCES_FILE = path.join(__dirname, "MusicTracks.json");          // bundled fallback
const REMOTE_SOURCES_URL = process.env.MUSIC_TRACKS_URL ||
  "https://raw.githubusercontent.com/NekoSuneProjects/nekos-ai-clipper/musictracks/MusicTracks.json";
const MUSIC_CACHE_DIR = process.env.MUSIC_DIR || path.join(TOOLS_DIR, "music");
const SOURCES_CACHE_FILE = path.join(TOOLS_DIR, "MusicTracks.cache.json");

let _sourcesCache = null;
let _sourcesFetchedAt = 0;
const SOURCES_TTL = 60 * 1000; // re-fetch from the branch at most once a minute

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function parseSources(data) {
  return {
    collections: Array.isArray(data.collections)
      ? data.collections.filter((c) => c && c.id && (c.url || (c.type === "search" && c.query)))
      : [],
    tracks: Array.isArray(data.tracks) ? data.tracks.filter((t) => t && t.id && t.url) : []
  };
}

function fetchRemoteSources() {
  return new Promise((resolve) => {
    const req = https.get(REMOTE_SOURCES_URL, { headers: { "User-Agent": "NekosAIClipper" } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    });
    req.on("error", () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
  });
}

// Sync — returns the in-memory cache, else the downloaded cache, else the bundled
// file. Call refreshSources() (async) to pull the latest from the branch.
function readSources() {
  if (_sourcesCache) return _sourcesCache;
  for (const f of [SOURCES_CACHE_FILE, SOURCES_FILE]) {
    try { _sourcesCache = parseSources(JSON.parse(fs.readFileSync(f, "utf-8"))); return _sourcesCache; } catch {}
  }
  _sourcesCache = { collections: [], tracks: [] };
  return _sourcesCache;
}

// Pull the latest sources from the musictracks branch (cached for SOURCES_TTL).
async function refreshSources(force = false) {
  const now = Date.now();
  if (!force && _sourcesCache && (now - _sourcesFetchedAt) < SOURCES_TTL) return _sourcesCache;
  const remote = await fetchRemoteSources();
  if (remote) {
    _sourcesCache = parseSources(remote);
    _sourcesFetchedAt = now;
    try { ensureDir(path.dirname(SOURCES_CACHE_FILE)); fs.writeFileSync(SOURCES_CACHE_FILE, JSON.stringify(remote)); } catch {}
    return _sourcesCache;
  }
  return readSources();
}

function listTracks() {
  return readSources().tracks;
}

function listCollections() {
  return readSources().collections;
}

// What the user must put in their video description for a given source.
// A collection's `attribution` in MusicTracks.json is a TEMPLATE — it can use
// {artist}/{title}/{url} placeholders, filled in per-track here, so credit
// reads like "Artist: Pegboard Nerds / Track: Hero" instead of a generic
// per-collection blurb. {url} prefers track.listenUrl (the source's own
// release link, e.g. monster.cat/…, doub.link/…, pulled from the video's
// description — see extractBioLink below) and falls back to the YouTube url
// when no such link was found there.
//
// Generic fallback ONLY when a collection has no attribution template at all
// — do not assert a specific source/license here (this used to hardcode
// "[NCS Release] / ncs.io" for every track, including ones from Monstercat,
// Ninety9Lives, etc., which is simply false attribution).
function attributionFor(track) {
  if (track && track.attribution) {
    return track.attribution
      .replace(/\{artist\}/g, track.artist || "Unknown")
      .replace(/\{title\}/g, track.title || "")
      .replace(/\{url\}/g, (track.listenUrl || track.url) || "");
  }
  return `Music: ${track.title} — ${track.artist}`;
}

function cachedPathFor(id) {
  return path.join(MUSIC_CACHE_DIR, `${id}.mp3`);
}

// Fetch a video's description via yt-dlp without downloading anything — used
// to pull a source's own canonical release link (Monstercat's monster.cat
// short links, Ninety9Lives' doub.link/99l.tv links) out of the video bio,
// since there's no way to derive that URL from YouTube metadata alone.
function getVideoDescription(ytdlpPath, url) {
  return new Promise((resolve) => {
    const proc = spawn(ytdlpPath, ["--skip-download", "--no-warnings", "--print", "%(description)s", url], { windowsHide: true });
    let out = "";
    const timer = setTimeout(() => { try { proc.kill(); } catch {} resolve(out); }, 15000);
    proc.stdout.on("data", (d) => { out += d.toString(); });
    proc.on("close", () => { clearTimeout(timer); resolve(out); });
    proc.on("error", () => { clearTimeout(timer); resolve(""); });
  });
}

// First URL in `description` whose host matches `pattern` (a RegExp source
// string, e.g. "monster\\.cat"), trimmed of trailing punctuation picked up by
// naive URL matching. Returns null if the collection has no pattern set or
// nothing matched (callers fall back to the YouTube url).
function extractBioLink(description, pattern) {
  if (!description || !pattern) return null;
  const re = new RegExp(pattern, "i");
  const urls = description.match(/https?:\/\/\S+/gi) || [];
  const hit = urls.find((u) => re.test(u));
  return hit ? hit.replace(/[)\].,;:!?'"]+$/, "") : null;
}

// Resolve track.listenUrl from the collection's bioLinkPattern, if set.
// Never throws — a failed/slow lookup just means no listenUrl override.
async function resolveListenUrl(collection, url) {
  if (!collection || !collection.bioLinkPattern) return null;
  try {
    const tools = await prepareTools();
    const desc = await getVideoDescription(tools.ytdlp, url);
    return extractBioLink(desc, collection.bioLinkPattern);
  } catch {
    return null;
  }
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
      ...(process.env.YTDLP_IMPERSONATE ? ["--impersonate", process.env.YTDLP_IMPERSONATE] : []),
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
          // The channel/playlist IS the artist for these sources (Monstercat,
          // NCS, Ninety9Lives, StreamBeats all upload under their own name).
          // Without this, every picked track's artist came out empty, which
          // is why the picker showed "Unknown" regardless of source.
          return { id, title, artist: collection.name };
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
  const url = `https://www.youtube.com/watch?v=${pick.id}`;
  return {
    id: pick.id,
    title: pick.title || pick.id,
    artist: collection.name,
    url,
    listenUrl: await resolveListenUrl(collection, url),
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
  const ffmpegDir = ffmpegDirOf(tools.ffmpeg);

  // Same impersonation the VOD downloader uses (core/vodDownloader.js) — cloud/Docker
  // hosts get bot-blocked by YouTube without it. Don't combine with addHeader; a manual
  // UA alongside --impersonate breaks the TLS/UA fingerprint match.
  const impersonate = process.env.YTDLP_IMPERSONATE;

  function attempt() {
    return new Promise((resolve, reject) => {
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
        ...(impersonate
          ? { impersonate }
          : {
              addHeader: [
                "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                "Referer: https://www.youtube.com/"
              ]
            }),
        progress: true
      });

      subprocess.stdout.on("data", (chunk) => {
        const m = chunk.toString().match(/\[download\]\s+(\d+\.\d+)%/i);
        if (m && onProgress) onProgress(parseFloat(m[1]));
      });
      let stderr = "";
      subprocess.stderr.on("data", (d) => { stderr += d.toString(); console.log("[yt-dlp music]", d.toString()); });

      subprocess.on("close", (code) => {
        if (code !== 0) {
          const reason = stderr.trim().split(/\r?\n/).pop() || "no output";
          return reject(new Error(`yt-dlp (music) exited with code ${code}: ${reason}`));
        }
        resolve();
      });
      subprocess.on("error", reject);
    });
  }

  // yt-dlp occasionally fails a "cold" first request with a 403 (YouTube's bot
  // gating rejecting the request/challenge) and succeeds right after on retry —
  // same flakiness class documented elsewhere for this pipeline. Retry a few
  // times before surfacing the failure.
  let lastErr;
  for (let i = 1; i <= 3; i++) {
    try {
      await attempt();
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      if (i < 3) {
        console.log(`[yt-dlp music] attempt ${i}/3 failed (${err.message}), retrying...`);
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }
  if (lastErr) throw lastErr;

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
    throw new Error("No music sources configured in MusicTracks.json.");
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
//
// Concurrent requests for the same id are deduped onto a single in-flight
// download instead of each spawning their own yt-dlp process against the same
// output filename — two processes racing on one destination file is how you
// get one finished + one clobbering it mid-postprocess, which previously
// showed up as previewTrack() resolving a path that no longer existed by the
// time res.sendFile() read it.
const _previewInFlight = new Map(); // id -> Promise<string>

function previewTrack(idOrUrl) {
  const id = /^https?:/i.test(idOrUrl) ? (idOrUrl.match(/[?&]v=([\w-]+)/)?.[1] || idOrUrl) : idOrUrl;
  if (_previewInFlight.has(id)) return _previewInFlight.get(id);

  const promise = previewTrackUncached(idOrUrl, id).finally(() => _previewInFlight.delete(id));
  _previewInFlight.set(id, promise);
  return promise;
}

function previewTrackUncached(idOrUrl, id) {
  return new Promise(async (resolve, reject) => {
    ensureDir(MUSIC_CACHE_DIR);
    const url = /^https?:/i.test(idOrUrl) ? idOrUrl : `https://www.youtube.com/watch?v=${idOrUrl}`;
    const outFile = path.join(MUSIC_CACHE_DIR, `${id}_preview.mp3`);

    if (fs.existsSync(outFile) && fs.statSync(outFile).size > 0) return resolve(outFile);

    const tools = await prepareTools();
    const ffmpegDir = ffmpegDirOf(tools.ffmpeg);
    const args = [
      url,
      "--no-playlist", "--no-warnings", "--no-check-certificates",
      ...(process.env.YTDLP_IMPERSONATE ? ["--impersonate", process.env.YTDLP_IMPERSONATE] : []),
      "--download-sections", "*0:30-1:00",
      "--force-keyframes-at-cuts",
      "-x", "--audio-format", "mp3", "--audio-quality", "5",
      ...(ffmpegDir ? ["--ffmpeg-location", ffmpegDir] : []),
      "-o", path.join(MUSIC_CACHE_DIR, `${id}_preview.%(ext)s`)
    ];
    const proc = spawn(tools.ytdlp, args, { windowsHide: true });
    let stderr = "";
    let realFile = null;
    let stdoutBuf = "";
    proc.stdout.on("data", (d) => {
      // Buffer across chunks and match whole lines only — a "Destination:"
      // line arriving split across two 'data' events would silently fail to
      // match (and worse, capture a truncated path) if matched per-chunk.
      stdoutBuf += d.toString();
      const lines = stdoutBuf.split(/\r?\n/);
      stdoutBuf = lines.pop(); // keep the last (possibly incomplete) line buffered
      for (const line of lines) {
        // Trust yt-dlp's own reported destination over guessing from our -o
        // template — --download-sections can alter the final filename it writes.
        const m = line.match(/\[(?:ExtractAudio|Merger|Fixup\w*|download)\]\s+Destination:\s*(.+)/i);
        if (m) realFile = m[1].trim();
      }
    });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("close", (code) => {
      console.log(`[yt-dlp preview] id=${id} code=${code} realFile=${realFile || "(none)"}`);
      if (realFile && fs.existsSync(realFile)) return resolve(realFile);
      if (fs.existsSync(outFile)) return resolve(outFile);
      // yt-dlp named it differently — grab the newest file for THIS id
      // specifically. Matching any "*_preview.mp3" would risk resolving a
      // different track's stale cache file while this one is actually missing.
      const f = fs.readdirSync(MUSIC_CACHE_DIR)
        .filter((x) => x.startsWith(`${id}_preview`))
        .map((x) => ({ x, t: fs.statSync(path.join(MUSIC_CACHE_DIR, x)).mtimeMs }))
        .sort((a, b) => b.t - a.t);
      console.log(`[yt-dlp preview] id=${id} fallback candidates:`, f.map((c) => c.x));
      if (f.length) return resolve(path.join(MUSIC_CACHE_DIR, f[0].x));
      const reason = stderr.trim().split(/\r?\n/).pop() || "no output";
      console.log("[yt-dlp preview] stderr:", stderr.trim());
      reject(new Error(`Preview download failed (code ${code}): ${reason}`));
    });
    proc.on("error", reject);
  });
}

// Download a specific picked track and attach the right credit from its source.
//
// opts.attribution / opts.creditRequired / opts.warning let the caller supply
// the source's credit text directly (the picker UI already has this — it's
// the same collection data /api/music/sources returned) instead of relying
// solely on re-finding the collection by id here. That id-based lookup is
// kept as a fallback for callers that don't have it handy, but preferring the
// caller's own data avoids the whole class of bug where a later re-lookup
// mismatches what the user actually picked (which is how a picked Monstercat
// track was ending up with generic/wrong credit).
async function getTrack(opts = {}, onProgress = null) {
  const { collections } = readSources();
  const col = opts.collectionId ? collections.find((c) => c.id === opts.collectionId) : null;
  const id = opts.id || (opts.url && opts.url.match(/[?&]v=([\w-]+)/)?.[1]);
  if (!id && !opts.url) throw new Error("getTrack: need an id or url");
  const url = opts.url || `https://www.youtube.com/watch?v=${id}`;

  const track = {
    id: id,
    title: opts.title || id,
    artist: opts.artist || (col ? col.name : "Unknown"),
    url,
    listenUrl: await resolveListenUrl(col, url),
    attribution: opts.attribution !== undefined ? opts.attribution : (col ? col.attribution : undefined),
    creditRequired: opts.creditRequired !== undefined ? opts.creditRequired !== false : (col ? col.creditRequired !== false : true),
    warning: opts.warning !== undefined ? opts.warning : (col ? col.warning : undefined)
  };
  const res = await downloadTrack(track, onProgress);
  res.warning = track.warning;
  res.creditRequired = track.creditRequired;
  return res;
}

function audioDuration(ffprobe, file) {
  return new Promise((resolve) => {
    execFile(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file],
      (err, out) => resolve(err ? 0 : (parseFloat(String(out).trim()) || 0)));
  });
}

// Concatenate songs into one bed with 2s crossfades between them.
function concatWithCrossfade(ffmpeg, files, out) {
  return new Promise((resolve, reject) => {
    const inputs = files.flatMap((f) => ["-i", f]);
    let filter;
    if (files.length === 1) {
      filter = "[0:a]aresample=44100[a]";
    } else {
      let prev = "[0:a]";
      let chain = "";
      for (let i = 1; i < files.length; i++) {
        const lbl = i === files.length - 1 ? "[a]" : `[x${i}]`;
        chain += `${prev}[${i}:a]acrossfade=d=2:c1=tri:c2=tri${lbl};`;
        prev = `[x${i}]`;
      }
      filter = chain.replace(/;$/, "");
    }
    const args = ["-hide_banner", "-loglevel", "error", ...inputs,
      "-filter_complex", filter, "-map", "[a]", "-c:a", "libmp3lame", "-q:a", "2", "-y", out];
    execFile(ffmpeg, args, { maxBuffer: 1 << 24 }, (err) => err ? reject(err) : resolve(out));
  });
}

// Build a music bed that COVERS targetSec: starts with the chosen/first track,
// then appends more random tracks from the SAME source (crossfaded) until the
// montage is fully covered. Returns { path, attribution, creditRequired, count }.
async function prepareMontageMusic(opts = {}, targetSec = 0, onProgress = null) {
  const tools = await prepareTools();
  const collections = listCollections();
  const col = opts.collectionId && opts.collectionId !== "curated"
    ? collections.find((c) => c.id === opts.collectionId) : null;

  // 1) First track: the one the user picked, else an auto pick from the source.
  let first;
  if (opts.track && (opts.track.id || opts.track.url)) {
    first = await getTrack({ ...opts.track, collectionId: opts.collectionId }, onProgress);
  } else {
    first = await getAutoTrack({ collectionId: col ? opts.collectionId : undefined, seed: Date.now() }, onProgress);
  }

  const files = [first.path];
  const used = new Set([first.track && first.track.id].filter(Boolean));
  let total = await audioDuration(tools.ffprobe, first.path);

  // 2) Keep adding songs from the same source until the montage is covered.
  let guard = 0;
  while (total < targetSec && guard < 15) {
    guard++;
    let next = null;
    try {
      next = col ? await getRandomFromCollection(col, Date.now() + guard * 7) : null;
    } catch { next = null; }
    if (!next) {
      const tr = listTracks();
      if (!tr.length) break;
      next = tr[(Date.now() + guard) % tr.length];
    }
    if (used.has(next.id)) continue;
    used.add(next.id);
    try {
      const dl = await downloadTrack({ ...next, collectionId: opts.collectionId }, onProgress);
      files.push(dl.path);
      total += await audioDuration(tools.ffprobe, dl.path);
    } catch { /* skip a failed track */ }
  }

  const creditRequired = first.creditRequired !== false;
  const attribution = creditRequired ? first.attribution : null;

  if (files.length === 1) {
    return { path: files[0], attribution, creditRequired, count: 1 };
  }

  const bed = path.join(MUSIC_CACHE_DIR, `bed_${Date.now()}.mp3`);
  await concatWithCrossfade(tools.ffmpeg, files, bed);
  return { path: bed, attribution, creditRequired, count: files.length };
}

module.exports = {
  listTracks,
  listCollections,
  listCollectionItems,
  downloadTrack,
  getAutoTrack,
  getTrack,
  previewTrack,
  prepareMontageMusic,
  refreshSources,
  attributionFor,
  MUSIC_CACHE_DIR
};
