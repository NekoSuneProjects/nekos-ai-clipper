// ------------------------------------------------------------
// CLEAN RENDERER.JS — NO VIDEO PREVIEW
// ------------------------------------------------------------

// Buttons / Inputs
const pickVideoBtn = document.getElementById("pickVideo");
const analyseBtn = document.getElementById("analyse");
const importVodBtn = document.getElementById("importVod");
const vodUrlInput = document.getElementById("vodUrl");

// Highlight section
const highlightList = document.getElementById("highlightList");
const progressEl = document.getElementById("analyseProgress");

// Game config
const gameSelect = document.getElementById("gameSelect");

// Live capture
const startCaptureBtn = document.getElementById("startCapture");
const stopCaptureBtn = document.getElementById("stopCapture");
const captureModeSelect = document.getElementById("captureMode");
const windowSelect = document.getElementById("windowSelect");
const refreshWindowsBtn = document.getElementById("refreshWindows");
const audioDeviceSelect = document.getElementById("audioDeviceSelect");
const audioDeviceCustom = document.getElementById("audioDeviceCustom");
const segmentSecInput = document.getElementById("segmentSec");
const captureFpsInput = document.getElementById("captureFps");
const autoClipInput = document.getElementById("autoClip");
const captureStatusEl = document.getElementById("captureStatus");

// Music
const musicBtn = document.getElementById("chooseMusic");
const musicInfo = document.getElementById("musicInfo");

// Status
function setStatus(msg) {
  const el = document.getElementById("status");
  if (el) el.textContent = msg;
}

function setCaptureStatus(msg) {
  if (captureStatusEl) captureStatusEl.textContent = msg;
}

async function loadWindowTitles() {
  if (!windowSelect) return;

  let titles = [];
  try {
    titles = await window.api.listWindows();
  } catch {
    titles = [];
  }

  windowSelect.innerHTML = "";

  const none = document.createElement("option");
  none.value = "";
  none.textContent = "Select game window";
  windowSelect.appendChild(none);

  let obsOption = null;
  titles.forEach((t) => {
    const title = typeof t === "string" ? t : t.title;
    if (!title) return;
    const opt = document.createElement("option");
    opt.value = title;
    opt.textContent = t.process ? `${title} (${t.process})` : title;
    windowSelect.appendChild(opt);
    if (!obsOption && /obs/i.test(title)) obsOption = opt;
  });

  const mode = (captureModeSelect?.value || "").trim();
  if (mode === "console_obs" && obsOption) {
    obsOption.selected = true;
  }
}

async function loadAudioDevices() {
  if (!audioDeviceSelect) return;

  let devices = [];
  try {
    devices = await window.api.listAudioDevices();
  } catch (err) {
    setCaptureStatus("Failed to list audio devices.");
    devices = [];
  }

  audioDeviceSelect.innerHTML = "";

  const none = document.createElement("option");
  none.value = "";
  none.textContent = "No audio (video only)";
  audioDeviceSelect.appendChild(none);

  devices.forEach((d) => {
    const opt = document.createElement("option");
    opt.value = d;
    opt.textContent = d;
    audioDeviceSelect.appendChild(opt);
  });
}

async function loadGameConfigs() {
  if (!gameSelect) return;

  let games = [];
  try {
    games = await window.api.getGameConfigs();
  } catch (err) {
    setStatus("Failed to load game configs: " + err.message);
    games = [];
  }
  gameSelect.innerHTML = "";

  if (!games.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No game configs found";
    gameSelect.appendChild(opt);
    currentGameId = null;
    return;
  }

  games = games.slice().sort((a, b) => a.name.localeCompare(b.name));
  const bf6Index = games.findIndex((g) => g.id === "BF6");

  games.forEach((g, i) => {
    const opt = document.createElement("option");
    opt.value = g.id;
    opt.textContent = `${g.name} (${g.id})`;
    if (i === (bf6Index >= 0 ? bf6Index : 0)) opt.selected = true;
    gameSelect.appendChild(opt);
  });

  currentGameId = gameSelect.value;
}

function setActiveTab(tab) {
  document.querySelectorAll(".tab-section").forEach((el) => {
    el.classList.toggle("hidden", el.getAttribute("data-tab") !== tab);
  });

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    const isActive = btn.getAttribute("data-tab") === tab;
    btn.classList.toggle("bg-accent", isActive);
    btn.classList.toggle("text-white", isActive);
    btn.classList.toggle("bg-card2", !isActive);
  });
}

// Global state
let chosenMusic = null;
let chosenMusicInfo = null; // { collection, track } for multi-song montage beds
let currentVideoPath = null;
let currentHighlights = [];
let outputDir = null;
let modeType = "reaction"; // reaction, fps_kills, fps_deaths, fps_both
let currentGameId = null;
let selectedIds = new Set();

// convert MS → hh:mm:ss
function msToTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// ------------------------------------------------------------
// TAG ELEMENT
// ------------------------------------------------------------
function getTagElement(h) {
  const tag = document.createElement("span");
  tag.className = "px-2 py-1 text-xs rounded font-bold";

  const tagText = h.tag ||
    (h.type === "death" ? "DEATH" :
    h.type === "killstreak" ? `STREAK x${h.killstreak}` :
    h.type === "kill" ? "KILL" : "REACTION");

  tag.textContent = tagText;

  if (h.type === "death") {
    tag.classList.add("bg-tagDeath");
  } else if (h.type === "killstreak") {
    tag.classList.add("bg-tagStreak");
  } else if (h.type === "event") {
    tag.classList.add("bg-tagStreak");
  } else if (h.type === "kill" || h.type === "headshot" || h.type === "longshot") {
    tag.classList.add("bg-tagKill");
  } else {
    tag.classList.add("bg-tagReaction");
  }

  return tag;
}

// ------------------------------------------------------------
// Content type -> analyser mode + highlight filter
//   reaction / irl -> audio reactions
//   gaming         -> audio + auto game detection (kills/deaths/wins from config)
// ------------------------------------------------------------
function analyserMode() {
  return modeType === "gaming" ? "both" : "reaction";
}
function currentFormat() {
  return document.querySelector('input[name="videoFormat"]:checked')?.value || "both";
}

function filterHighlights() {
  if (modeType === "gaming") {
    return currentHighlights.filter((h) =>
      ["kill", "killstreak", "headshot", "longshot", "death", "event", "reaction"].includes(h.type)
    );
  }
  // reactions + IRL
  return currentHighlights.filter((h) => h.type === "reaction");
}

// ------------------------------------------------------------
// RENDER HIGHLIGHTS LIST
// ------------------------------------------------------------
function renderHighlights() {
  highlightList.innerHTML = "";

  const mode = document.querySelector('input[name="renderMode"]:checked').value;
  const finalList = filterHighlights();

  progressEl.classList.add("hidden");

  if (!finalList.length) {
    highlightList.innerHTML = `<p class="text-gray-400">No highlights detected.</p>`;
    return;
  }

  finalList.forEach((h) => {
    const wrapper = document.createElement("div");
    wrapper.className =
      "bg-card2 p-4 border border-gray-700 rounded-lg space-y-3";

    const header = document.createElement("div");
    header.className = "flex justify-between items-center";

    const t = document.createElement("span");
    t.className = "font-semibold";
    t.textContent = `${msToTime(h.startMs)} → ${msToTime(h.endMs)}`;

    const tag = getTagElement(h);

    header.appendChild(t);
    header.appendChild(tag);

    // =====================================================
    // STANDARD MODE: show button per clip ("Render This Clip")
    // =====================================================
    if (mode === "standard") {
      const btn = document.createElement("button");
      btn.textContent = "Render This Clip";
      btn.className =
        "py-2 px-4 bg-accent rounded-lg font-bold hover:bg-accent2";
      btn.onclick = () => renderStandardMode(h); // <-- pass THIS highlight
      header.appendChild(btn);
    }

    // =====================================================
    // MONTAGE MODE: show selection checkboxes
    // =====================================================
    if (mode === "montage") {
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = selectedIds.has(h.id);
      cb.className = "w-5 h-5";
      cb.onchange = (ev) => {
        if (ev.target.checked) selectedIds.add(h.id);
        else selectedIds.delete(h.id);
      };
      header.appendChild(cb);
    }

    wrapper.appendChild(header);
    highlightList.appendChild(wrapper);
  });

  // ---------------------------------------------------
  // Montage mode bottom button
  // ---------------------------------------------------
  if (mode === "montage") {
    const renderBtn = document.createElement("button");
    renderBtn.textContent = "Render Selected Highlights";
    renderBtn.className =
      "w-full mt-5 py-3 bg-accent rounded-lg font-bold hover:bg-accent2";
    renderBtn.onclick = renderSelectedMontage;
    highlightList.appendChild(renderBtn);
  }
}

async function renderStandardMode(highlight) {
  if (!highlight) return setStatus("No highlight provided.");

  startRenderUI("Rendering clip…");
  const res = await window.api.renderStandard({
    videoPath: currentVideoPath,
    highlight,
    musicPath: chosenMusic || null,
    outputDir,
    format: currentFormat()
  });
  finishRenderUI(res, [res.short, res.normal]);
}

// ------------------------------------------------------------
// RENDER SELECTED MONTAGE
// ------------------------------------------------------------
async function renderSelectedMontage() {
  const mode = document.querySelector('input[name="renderMode"]:checked').value;
  if (mode !== "montage") return setStatus("Montage mode required.");

  const selected = filterHighlights().filter((h) => selectedIds.has(h.id));
  if (!selected.length) return setStatus("No highlights selected.");

  startRenderUI("Rendering montage…");
  const res = await window.api.renderMontage({
    videoPath: currentVideoPath,
    highlights: selected,
    musicPath: chosenMusic || null,
    outputDir,
    format: currentFormat(),
    musicCollection: chosenMusicInfo ? chosenMusicInfo.collection : null,
    musicTrack: chosenMusicInfo ? chosenMusicInfo.track : null
  });
  finishRenderUI(res, [res.shortOut, res.normalOut]);
}

// ------------------------------------------------------------
// SETTINGS · RENDER PROGRESS · LIVE CLIPS
// ------------------------------------------------------------
async function loadSettings() {
  try {
    const s = await window.api.getSettings();
    if (s && s.outputDir) {
      outputDir = s.outputDir;
      const el = document.getElementById("outputPath");
      if (el) el.textContent = s.outputDir;
    }
    const enc = document.getElementById("encoderSelect");
    if (enc && s && s.encoder) enc.value = s.encoder;
  } catch {}
  detectEncoderStatus();
}

const encoderSelect = document.getElementById("encoderSelect");
encoderSelect?.addEventListener("change", async () => {
  await window.api.setSettings({ encoder: encoderSelect.value });
  setStatus("Encoder set to: " + encoderSelect.value.toUpperCase());
});

async function detectEncoderStatus() {
  const el = document.getElementById("encoderStatus");
  if (!el) return;
  try {
    const p = await window.api.detectEncoders();
    if (!p || !p.ok) { el.textContent = "Could not detect hardware."; return; }
    const found = [];
    if (p.nvenc) found.push("NVIDIA NVENC");
    if (p.amf) found.push("AMD AMF");
    if (p.qsv) found.push("Intel QuickSync");
    el.textContent = found.length
      ? "✓ GPU encoder available: " + found.join(", ")
      : "No GPU encoder detected — CPU will be used.";
    el.className = "text-xs " + (found.length ? "text-green-400" : "text-gray-400");
  } catch {
    el.textContent = "";
  }
}
document.getElementById("changeOutput")?.addEventListener("click", async () => {
  const s = await window.api.chooseOutputFolder();
  if (s && s.outputDir) {
    outputDir = s.outputDir;
    const el = document.getElementById("outputPath");
    if (el) el.textContent = s.outputDir;
    setStatus("Output folder set to: " + s.outputDir);
  }
});
document.getElementById("openOutput")?.addEventListener("click", () => window.api.openOutputFolder());

function fmtEta(sec) {
  if (sec == null) return "";
  if (sec <= 0) return "almost done";
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  if (h > 0) return `~${h}h ${m}m left`;
  if (m > 0) return `~${m}m ${s}s left`;
  return `~${s}s left`;
}

function setRenderBar(pct, step, eta) {
  const bar = document.getElementById("renderBar"); if (bar) bar.style.width = pct + "%";
  const p = document.getElementById("renderPct"); if (p) p.textContent = pct + "%";
  const st = document.getElementById("renderStep"); if (st && step) st.textContent = step;
  const e = document.getElementById("renderEta"); if (e) e.textContent = eta || "";
}
function startRenderUI(msg) {
  setStatus(msg);
  setActiveTab("clips");
  const w = document.getElementById("renderProgressWrap");
  if (w) w.classList.remove("hidden");
  setRenderBar(0, "Starting…", "");
}
function finishRenderUI(res, files) {
  const w = document.getElementById("renderProgressWrap");
  if (!res || !res.ok) {
    setStatus("Render failed: " + (res && res.error));
    if (w) w.classList.add("hidden");
    return;
  }
  setRenderBar(100, "Done", "");
  setStatus("Render complete!");
  const list = (files || []).filter(Boolean);
  list.forEach(addRenderedFile);
  if (list[0]) window.api.showInFolder(list[0]);
  setTimeout(() => { if (w) w.classList.add("hidden"); }, 1800);
}
function fileCard(file, icon) {
  const name = String(file).split(/[\\/]/).pop();
  const card = document.createElement("div");
  card.className = "flex items-center justify-between gap-2 p-2.5 rounded-lg bg-card2 border border-white/10 fade-in";
  const label = document.createElement("div");
  label.className = "text-sm truncate";
  label.textContent = (icon || "") + name;
  const btn = document.createElement("button");
  btn.className = "text-xs px-2 py-1 rounded bg-bg2 border border-white/10 hover:bg-white/5 shrink-0";
  btn.textContent = "Open";
  btn.onclick = () => window.api.showInFolder(file);
  card.appendChild(label); card.appendChild(btn);
  return card;
}
function addRenderedFile(file) {
  const cont = document.getElementById("renderedFiles");
  if (cont) cont.prepend(fileCard(file, ""));
}
window.api.onRenderProgress((d) => {
  if (!d) return;
  setRenderBar(d.percent || 0, d.step, fmtEta(d.etaSec));
});

// Real-time clips during live capture
let liveClipN = 0;
function addLiveClip(file) {
  const cont = document.getElementById("liveClips");
  if (!cont || !file) return;
  liveClipN++;
  const cnt = document.getElementById("liveClipCount");
  if (cnt) cnt.textContent = "(" + liveClipN + ")";
  cont.prepend(fileCard(file, "🎬 "));
}

loadSettings();

// ------------------------------------------------------------
// MUSIC PICKER
// ------------------------------------------------------------
musicBtn?.addEventListener("click", async () => {
  const file = await window.api.chooseMusic();
  if (file) {
    chosenMusic = file;
    chosenMusicInfo = null; // own file → no source to chain from
    musicInfo.textContent = "Selected: " + file;
    const credit = document.getElementById("musicCredit");
    if (credit) credit.textContent = "";
  }
});

// ------------------------------------------------------------
// MUSIC LIBRARY MODAL (browse sources, preview 30s, pick a track)
// ------------------------------------------------------------
const musicLibraryBtn = document.getElementById("musicLibrary");
const musicModal = document.getElementById("musicModal");
const musicModalClose = document.getElementById("musicModalClose");
const musicTabsEl = document.getElementById("musicTabs");
const musicWarningEl = document.getElementById("musicWarning");
const musicListEl = document.getElementById("musicList");
const previewAudio = document.getElementById("musicPreviewAudio");

let musicTabsBuilt = false;

function openMusicModal() {
  if (!musicModal) return;
  musicModal.classList.remove("hidden");
  if (!musicTabsBuilt) initMusicTabs();
}
function closeMusicModal() {
  musicModal?.classList.add("hidden");
  try { previewAudio.pause(); } catch {}
}
musicLibraryBtn?.addEventListener("click", openMusicModal);
musicModalClose?.addEventListener("click", closeMusicModal);
musicModal?.addEventListener("click", (e) => { if (e.target === musicModal) closeMusicModal(); });

async function initMusicTabs() {
  let sources = { collections: [], tracks: [] };
  try { sources = await window.api.listMusicSources(); } catch {}
  musicTabsEl.innerHTML = "";
  const tabs = (sources.collections || []).map((c) => ({ id: c.id, name: c.name }));
  if ((sources.tracks || []).length) tabs.push({ id: "curated", name: "NCS Picks" });

  tabs.forEach((t) => {
    const btn = document.createElement("button");
    btn.className = "px-3 py-1 rounded text-sm border bg-card2 border-gray-700 hover:bg-gray-700";
    btn.textContent = t.name;
    btn.dataset.id = t.id;
    btn.onclick = () => selectMusicTab(t.id);
    musicTabsEl.appendChild(btn);
  });

  musicTabsBuilt = true;
  if (tabs.length) selectMusicTab(tabs[0].id);
}

function highlightMusicTab(id) {
  [...musicTabsEl.children].forEach((b) => {
    const active = b.dataset.id === id;
    b.classList.toggle("bg-accent", active);
    b.classList.toggle("text-white", active);
    b.classList.toggle("border-accent", active);
    b.classList.toggle("bg-card2", !active);
  });
}

async function selectMusicTab(id) {
  highlightMusicTab(id);
  musicWarningEl.classList.add("hidden");
  musicListEl.innerHTML = `<p class="text-gray-400">Loading…</p>`;
  let res;
  try { res = await window.api.listMusicItems({ collectionId: id, max: 60 }); }
  catch (e) { musicListEl.innerHTML = `<p class="text-red-400">Failed to load.</p>`; return; }
  if (!res.ok) { musicListEl.innerHTML = `<p class="text-red-400">Failed: ${res.error}</p>`; return; }
  if (res.warning) {
    musicWarningEl.textContent = "⚠ " + res.warning;
    musicWarningEl.classList.remove("hidden");
  }
  renderMusicItems(res.items || [], id);
}

function renderMusicItems(items, sourceId) {
  musicListEl.innerHTML = "";
  if (!items.length) { musicListEl.innerHTML = `<p class="text-gray-400">No tracks found.</p>`; return; }
  items.forEach((it) => {
    const row = document.createElement("div");
    row.className = "flex items-center justify-between gap-2 p-2 rounded bg-gray-800 border border-gray-700";
    const label = document.createElement("div");
    label.className = "text-sm truncate flex-1";
    label.textContent = it.artist ? `${it.artist} — ${it.title}` : it.title;
    const prev = document.createElement("button");
    prev.className = "px-2 py-1 text-xs rounded bg-card2 border border-gray-700 hover:bg-gray-700 shrink-0";
    prev.textContent = "▶ Preview";
    prev.onclick = () => previewMusicItem(it, prev);
    const use = document.createElement("button");
    use.className = "px-2 py-1 text-xs rounded bg-accent hover:bg-accent2 shrink-0";
    use.textContent = "Use";
    use.onclick = () => useMusicItem(it, sourceId, use);
    row.appendChild(label); row.appendChild(prev); row.appendChild(use);
    musicListEl.appendChild(row);
  });
}

async function previewMusicItem(it, btn) {
  const old = btn.textContent;
  btn.textContent = "…"; btn.disabled = true;
  try {
    const res = await window.api.previewMusic({ id: it.id, url: it.url });
    if (res.ok && res.path) {
      previewAudio.src = "file:///" + res.path.replace(/\\/g, "/");
      previewAudio.play().catch(() => {});
      btn.textContent = "⏸ Playing";
    } else {
      btn.textContent = "✕";
    }
  } catch { btn.textContent = "✕"; }
  finally { setTimeout(() => { btn.textContent = old; btn.disabled = false; }, 1200); }
}

async function useMusicItem(it, sourceId, btn) {
  btn.textContent = "…"; btn.disabled = true;
  const creditEl = document.getElementById("musicCredit");
  try {
    const res = await window.api.useMusicTrack({
      id: it.id, url: it.url, title: it.title, artist: it.artist,
      collectionId: sourceId === "curated" ? null : sourceId
    });
    if (!res.ok) { btn.textContent = "✕"; btn.disabled = false; return; }
    chosenMusic = res.path;
    // Remember the source + track so the montage can chain more songs from the
    // same category if it runs longer than this one.
    chosenMusicInfo = {
      collection: sourceId === "curated" ? null : sourceId,
      track: { id: it.id, url: it.url, title: it.title, artist: it.artist }
    };
    musicInfo.textContent = `🎵 ${it.artist ? it.artist + " — " : ""}${it.title}`;
    if (creditEl) {
      creditEl.textContent = res.creditRequired === false
        ? "✓ No attribution required."
        : "⚠ Credit required:\n" + (res.attribution || "");
    }
    closeMusicModal();
  } catch (e) {
    btn.textContent = "✕"; btn.disabled = false;
  }
}

// ------------------------------------------------------------
// LIVE CAPTURE CONTROLS
// ------------------------------------------------------------
startCaptureBtn?.addEventListener("click", async () => {
  const output = await window.api.chooseOutputDir();
  if (!output) return setCaptureStatus("Select an output folder first.");

  const segmentSec = Math.max(4, Number(segmentSecInput?.value || 10));
  const fps = Math.max(10, Number(captureFpsInput?.value || 60));
  const selectedDevice = (audioDeviceSelect?.value || "").trim();
  const customDevice = (audioDeviceCustom?.value || "").trim();
  const audioDevice = customDevice || selectedDevice;
  const autoClip = !!autoClipInput?.checked;
  const captureMode = (captureModeSelect?.value || "desktop").trim();
  const windowTitle = (windowSelect?.value || "").trim();
  const resolution = (document.getElementById("captureResolution")?.value || "1920x1080");
  const quality = (document.getElementById("captureQuality")?.value || "high");

  const needsWindow = captureMode === "window" || captureMode === "console_obs";

  if (needsWindow && !windowTitle) {
    return setCaptureStatus("Select a game window to capture.");
  }

  setCaptureStatus("Starting capture...");

  const res = await window.api.startCapture({
    outputDir: output,
    mode: analyserMode(),
    gameId: currentGameId,
    segmentSec,
    fps,
    audioDevice,
    autoClip,
    captureMode,
    windowTitle,
    resolution,
    quality
  });

  if (!res.ok) return setCaptureStatus("Capture failed: " + res.error);
  setCaptureStatus("Capture started. Recording to: " + (res.outputFile || output));
});

stopCaptureBtn?.addEventListener("click", async () => {
  setCaptureStatus("Stopping & finalising recording...");
  stopCaptureBtn.disabled = true;
  const res = await window.api.stopCapture();
  stopCaptureBtn.disabled = false;
  if (!res.ok) return setCaptureStatus("Stop failed: " + res.error);
  if (res.file) {
    setCaptureStatus("Saved recording: " + res.file);
    try { await window.api.showInFolder(res.file); } catch {}
  } else {
    setCaptureStatus("Capture stopped.");
  }
});

// ------------------------------------------------------------
// SELECT LOCAL VIDEO
// ------------------------------------------------------------
pickVideoBtn.addEventListener("click", async () => {
  const path = await window.api.openVideoDialog();

  if (!path) {
    setStatus("No file selected.");
    return;
  }

  // STORE PATH
  currentVideoPath = path;

  // ENABLE ANALYSE BUTTON COMPLETELY
  analyseBtn.disabled = false;
  analyseBtn.removeAttribute("disabled");   // <--- REQUIRED
  analyseBtn.classList.remove(
    "bg-gray-700",
    "text-gray-400",
    "border-gray-600",
    "cursor-not-allowed"
  );
  analyseBtn.classList.add(
    "bg-accent",
    "hover:bg-accent2",
    "cursor-pointer",
    "text-white",
    "border-accent"
  );

  setStatus("Video loaded. Ready to analyse.");
});

// ------------------------------------------------------------
// ANALYSE LOCAL VIDEO
// ------------------------------------------------------------
analyseBtn.addEventListener("click", async () => {
  if (!currentVideoPath) return;

  analyseBtn.disabled = true;
  setStatus("Analysing...");
  startAnalyseUI();

  const res = await window.api.analyseVideo({
    path: currentVideoPath,
    mode: analyserMode(),
    gameId: currentGameId
  });

  analyseBtn.disabled = false;
  stopAnalyseUI();

  if (!res.ok) return setStatus("Analyse failed: " + res.error);

  currentHighlights = res.highlights;
  selectedIds = new Set(currentHighlights.map((h) => h.id));

  renderHighlights();
  setStatus(`Detected ${currentHighlights.length} highlight(s).`);
});

// ------------------------------------------------------------
// IMPORT VOD
// ------------------------------------------------------------
importVodBtn.addEventListener("click", async () => {
  const url = vodUrlInput.value.trim();
  if (!url) return setStatus("Enter URL.");

  importVodBtn.disabled = true;
  setStatus("Downloading...");
  startAnalyseUI();

  const res = await window.api.downloadAndAnalyseVod({
    url,
    mode: analyserMode(),
    gameId: currentGameId
  });

  importVodBtn.disabled = false;
  stopAnalyseUI();

  if (!res.ok) return setStatus("Failed: " + res.error);

  currentVideoPath = res.videoPath;

  currentHighlights = res.highlights;
  selectedIds = new Set(currentHighlights.map((h) => h.id));

  renderHighlights();
  setStatus("VOD downloaded & analysed.");
});

// ------------------------------------------------------------
// MODE SWITCH
// ------------------------------------------------------------
function updateGameProfileVisibility() {
  const isGaming = modeType === "gaming";
  const hint = document.getElementById("gameProfileHint");
  if (hint) hint.classList.toggle("hidden", isGaming);
  if (gameSelect) {
    gameSelect.disabled = !isGaming;
    gameSelect.classList.toggle("opacity-50", !isGaming);
  }
}

document.querySelectorAll('input[name="modeType"]').forEach((el) => {
  el.addEventListener("change", () => {
    modeType = el.value;
    updateGameProfileVisibility();
    renderHighlights();
  });
});

gameSelect?.addEventListener("change", () => {
  currentGameId = gameSelect.value;
});

updateGameProfileVisibility();
loadGameConfigs();
loadAudioDevices();
loadWindowTitles();
setActiveTab("clipping");

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    setActiveTab(btn.getAttribute("data-tab"));
  });
});

refreshWindowsBtn?.addEventListener("click", () => {
  loadWindowTitles();
});

captureModeSelect?.addEventListener("change", () => {
  if (captureModeSelect.value === "console_obs") {
    loadWindowTitles();
  }
});

// ---- Analysis progress: overall % + ETA across steps ----
const STEP_LABELS = {
  downloading: "Downloading VOD",
  extract_audio: "Extracting audio",
  reading_audio: "Reading audio",
  audio_analysis: "Audio analysis",
  fps_scanning: "Scanning kills/deaths",
  finalising: "Finalising",
  downloading_music: "Fetching music",
  no_audio: "No audio (skipped)",
};
let analyseStart = 0;

function analyseRanges() {
  // Weight steps so the bar reflects real time. Gaming (OCR) is dominated by
  // fps_scanning; reaction/IRL by audio analysis.
  if (analyserMode() === "both") {
    return { downloading: [0, 12], extract_audio: [12, 20], reading_audio: [20, 22], audio_analysis: [22, 30], fps_scanning: [30, 96], finalising: [96, 100] };
  }
  return { downloading: [0, 20], extract_audio: [20, 45], reading_audio: [45, 48], audio_analysis: [48, 96], finalising: [96, 100] };
}

function startAnalyseUI() {
  analyseStart = Date.now();
  const w = document.getElementById("analyseProgressWrap");
  if (w) w.classList.remove("hidden");
  setAnalyseBar(0, "Starting…", "");
}
function stopAnalyseUI() {
  const w = document.getElementById("analyseProgressWrap");
  if (w) w.classList.add("hidden");
  analyseStart = 0;
}
function setAnalyseBar(pct, label, eta) {
  const bar = document.getElementById("analyseBar"); if (bar) bar.style.width = pct + "%";
  const p = document.getElementById("analysePct"); if (p) p.textContent = pct + "%";
  const st = document.getElementById("analyseStep"); if (st && label) st.textContent = label;
  const e = document.getElementById("analyseEta"); if (e) e.textContent = eta || "";
}

window.api.onAnalyseProgress((raw) => {
  if (raw == null) return;
  // The channel can deliver a bare number (download) or a {step, progress} object.
  let step, progress;
  if (typeof raw === "number") { step = "downloading"; progress = raw; }
  else { step = raw.step; progress = typeof raw.progress === "number" ? raw.progress : 0; }
  if (!step) return;

  if (!analyseStart) analyseStart = Date.now();

  if (step === "downloading_music") {
    setAnalyseBar(progress, "Fetching music", "");
    return;
  }

  const ranges = analyseRanges();
  const r = ranges[step] || [0, 100];
  const overall = Math.max(0, Math.min(100, Math.round(r[0] + (progress / 100) * (r[1] - r[0]))));

  const elapsed = (Date.now() - analyseStart) / 1000;
  const eta = overall > 2 && overall < 100 ? fmtEta(Math.round(elapsed * (100 - overall) / overall)) : "";

  setAnalyseBar(overall, STEP_LABELS[step] || step, eta);
  if (progressEl) progressEl.textContent = (STEP_LABELS[step] || step) + " — " + overall + "%";
});

window.api.onCaptureStatus((p) => {
  if (!p) return;

  if (p.state === "started") {
    return setCaptureStatus("Capture started.");
  }
  if (p.state === "stopping") {
    return setCaptureStatus("Stopping & finalising recording...");
  }
  if (p.state === "stopped") {
    return setCaptureStatus(p.file ? ("Saved recording: " + p.file) : "Capture stopped.");
  }
  if (p.state === "analysing") {
    return setCaptureStatus("Analysing segment...");
  }
  if (p.state === "segment_done") {
    return setCaptureStatus("Segment analysed.");
  }
  if (p.state === "clip") {
    addLiveClip(p.clip);
    return setCaptureStatus("Clip created: " + (p.clip ? p.clip.split(/[\\/]/).pop() : ""));
  }
  if (p.state === "clip_error") {
    return setCaptureStatus("Clip error: " + p.error);
  }
  if (p.state === "warn") {
    return setCaptureStatus(p.message);
  }
  if (p.state === "error") {
    return setCaptureStatus("Error: " + p.error);
  }
});
