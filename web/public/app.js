// web/public/app.js — frontend for the cloud clipper
const $ = (id) => document.getElementById(id);
const api = (p, opt) => fetch(p, opt).then((r) => r.json());
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

const STEP_LABEL = {
  queued: "Queued", downloading: "Downloading VOD", analysing: "Analysing",
  extract_audio: "Extracting audio", reading_audio: "Reading audio",
  audio_analysis: "Audio analysis", fps_scanning: "Scanning for kills/deaths",
  downloading_music: "Fetching music", rendering_montage: "Rendering montage",
  rendering_clips: "Rendering clips", finalising: "Finalising", done: "Done", no_audio: "No audio (skipped)",
};

async function loadOptions() {
  const games = await api("/api/games").catch(() => []);
  const g = $("game");
  g.innerHTML = '<option value="">Auto / none</option>' +
    games.map((x) => `<option value="${x.id}">${x.name} (${x.id})</option>`).join("");

  // Supporter links (configured via env on the server)
  const support = await api("/api/support").catch(() => ({ links: [] }));
  const el = $("supportLinks");
  if (el) {
    el.innerHTML = (support.links || []).map((l) =>
      `<a href="${l.url}" target="_blank" rel="noopener" class="text-xs px-3 py-1.5 rounded-lg btn-grad font-semibold">${l.label}</a>`
    ).join("") || '<span class="text-xs text-gray-500">(set SUPPORT_* env vars to add donate buttons)</span>';
  }

  syncVisibility();
}

function syncVisibility() {
  const gaming = $("mode").value === "gaming";
  const montage = $("renderMode").value === "montage";
  $("gameWrap").style.opacity = gaming ? "1" : ".45";
  $("game").disabled = !gaming;
  $("musicWrap").style.display = montage ? "" : "none";
}
$("mode").addEventListener("change", syncVisibility);
$("renderMode").addEventListener("change", syncVisibility);

// ---------------- MUSIC PICKER ----------------
let chosenMusic = null; // { id, url, collection, title, artist }
let musicTabsBuilt = false;

function updateChosenMusic() {
  const el = $("chosenMusic");
  if (!el) return;
  el.textContent = chosenMusic
    ? `🎵 ${chosenMusic.artist ? chosenMusic.artist + " — " : ""}${chosenMusic.title}`
    : "No music selected";
}

$("pickMusic").addEventListener("click", () => {
  $("musicModal").classList.remove("hidden");
  if (!musicTabsBuilt) buildMusicTabs();
});
$("clearMusic").addEventListener("click", () => { chosenMusic = null; updateChosenMusic(); });
$("musicClose").addEventListener("click", closeMusicModal);
$("musicModal").addEventListener("click", (e) => { if (e.target === $("musicModal")) closeMusicModal(); });
function closeMusicModal() {
  $("musicModal").classList.add("hidden");
  try { $("musicAudio").pause(); } catch {}
}

let sourcesById = {}; // collection id -> full source object (attribution/creditRequired/warning)

async function buildMusicTabs() {
  const sources = await api("/api/music/sources").catch(() => []);
  sourcesById = Object.fromEntries((sources || []).map((c) => [c.id, c]));
  const tabs = (sources || []).map((c) => ({ id: c.id, name: c.name }));
  tabs.push({ id: "curated", name: "NCS Picks" });
  $("musicTabs").innerHTML = "";
  tabs.forEach((t) => {
    const b = document.createElement("button");
    b.className = "px-3 py-1 rounded text-sm border bg-card2 border-white/10 hover:bg-white/5";
    b.textContent = t.name;
    b.dataset.id = t.id;
    b.onclick = () => selectMusicTab(t.id);
    $("musicTabs").appendChild(b);
  });
  musicTabsBuilt = true;
  if (tabs.length) selectMusicTab(tabs[0].id);
}

function highlightMusicTab(id) {
  [...$("musicTabs").children].forEach((b) => {
    const active = b.dataset.id === id;
    b.classList.toggle("btn-grad", active);
    b.classList.toggle("text-white", active);
    b.classList.toggle("bg-card2", !active);
  });
}

async function selectMusicTab(id) {
  highlightMusicTab(id);
  $("musicWarn").classList.add("hidden");
  $("musicItems").innerHTML = `<p class="text-gray-400 text-sm">Loading…</p>`;
  const res = await api(`/api/music/items?collection=${encodeURIComponent(id)}`).catch(() => ({ ok: false }));
  if (!res.ok) { $("musicItems").innerHTML = `<p class="text-red-400 text-sm">Failed to load.</p>`; return; }
  if (res.warning) { $("musicWarn").textContent = "⚠ " + res.warning; $("musicWarn").classList.remove("hidden"); }
  renderMusicItems(res.items || [], id);
}

function renderMusicItems(items, sourceId) {
  const cont = $("musicItems");
  cont.innerHTML = "";
  if (!items.length) { cont.innerHTML = `<p class="text-gray-400 text-sm">No tracks found.</p>`; return; }
  items.forEach((it) => {
    const row = document.createElement("div");
    row.className = "flex items-center justify-between gap-2 p-2 rounded bg-card2 border border-white/10";
    const label = document.createElement("div");
    label.className = "text-sm truncate flex-1";
    label.textContent = it.artist ? `${it.artist} — ${it.title}` : it.title;
    const prev = document.createElement("button");
    prev.className = "px-2 py-1 text-xs rounded bg-bg2 border border-white/10 hover:bg-white/5 shrink-0";
    prev.textContent = "▶";
    prev.onclick = () => {
      const a = $("musicAudio");
      a.src = `/api/music/preview?id=${encodeURIComponent(it.id)}&url=${encodeURIComponent(it.url || "")}`;
      a.play().catch(() => {});
    };
    const use = document.createElement("button");
    use.className = "px-2 py-1 text-xs rounded btn-grad shrink-0";
    use.textContent = "Use";
    use.onclick = () => {
      const src = sourceId !== "curated" ? sourcesById[sourceId] : null;
      chosenMusic = {
        id: it.id, url: it.url || "", collection: sourceId === "curated" ? "" : sourceId,
        title: it.title, artist: it.artist || "",
        // Carry the source's own credit text/warning through directly, rather
        // than relying on the server re-finding this same collection by id
        // later at render time.
        attribution: src ? src.attribution : undefined,
        creditRequired: src ? src.creditRequired : undefined,
        warning: src ? src.warning : undefined
      };
      updateChosenMusic();
      closeMusicModal();
    };
    row.appendChild(label); row.appendChild(prev); row.appendChild(use);
    cont.appendChild(row);
  });
}

function jobCard(j) {
  const pct = Math.max(0, Math.min(100, j.progress || 0));
  const statusColor = j.status === "done" ? "text-green-400" : j.status === "error" ? "text-red-400" : "text-accent2";
  const step = STEP_LABEL[j.step] || j.step || "";
  const title = j.fileName || j.url || j.id;

  const outputs = (j.outputs || []).map((o) =>
    `<a class="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-card2 border border-white/10 hover:bg-white/5 mr-2 mb-2"
        href="/api/jobs/${j.id}/files/${encodeURIComponent(o.file)}" download>⬇ ${o.type}${o.tag ? " · " + o.tag : ""}</a>`
  ).join("");

  return `
  <div class="glass border border-white/5 rounded-2xl p-4" data-id="${j.id}">
    <div class="flex items-center justify-between gap-3">
      <div class="min-w-0">
        <div class="font-semibold truncate">${title}</div>
        <div class="text-xs text-gray-400">${j.mode || ""}${j.gameId ? " · " + j.gameId : ""} · ${j.renderMode || ""}</div>
      </div>
      <div class="text-sm ${statusColor} shrink-0">${j.status === "queued" ? "Queued #" + (j.position || "?") : j.status}</div>
    </div>
    <div class="mt-3 h-2 rounded-full bg-card2 overflow-hidden">
      <div class="bar h-full btn-grad" style="width:${pct}%"></div>
    </div>
    <div class="mt-1 text-xs text-gray-400">${step} ${pct ? "· " + pct + "%" : ""}</div>
    ${j.error ? `<div class="mt-2 text-xs text-red-400">${j.error}</div>` : ""}
    ${j.status === "done" ? `<div class="mt-2 text-xs text-gray-300">${j.highlightCount || 0} highlight(s)</div>` : ""}
    ${outputs ? `<div class="mt-2">${outputs}</div>` : ""}
    ${j.musicCredit ? `
    <div class="mt-2">
      <div class="flex items-center justify-between mb-1">
        <span class="text-[11px] text-gray-500">⚠ Music credit — paste into your video description</span>
        <button class="copy-credit-btn text-[11px] px-2 py-0.5 rounded bg-card2 border border-white/10 hover:bg-white/5 shrink-0" data-credit="${escapeHtml(j.musicCredit)}">📋 Copy</button>
      </div>
      <pre class="text-[11px] text-gray-400 bg-bg2 border border-white/10 rounded-lg p-2 whitespace-pre-wrap break-words overflow-x-auto"><code>${escapeHtml(j.musicCredit)}</code></pre>
    </div>` : ""}
    ${j.musicError ? `<div class="mt-1 text-[11px] text-yellow-500">⚠ Music not attached: ${j.musicError}</div>` : ""}
  </div>`;
}

const watching = new Set();
function watch(id) {
  if (watching.has(id)) return;
  watching.add(id);
  const es = new EventSource(`/api/jobs/${id}/events`);
  es.onmessage = (e) => {
    const j = JSON.parse(e.data);
    const el = document.querySelector(`[data-id="${id}"]`);
    if (el) el.outerHTML = jobCard(j);
    if (j.status === "done" || j.status === "error") { es.close(); watching.delete(id); }
  };
  es.onerror = () => { es.close(); watching.delete(id); };
}

async function refresh() {
  const jobs = await api("/api/jobs").catch(() => []);
  jobs.reverse();
  $("jobs").innerHTML = jobs.length ? jobs.map(jobCard).join("") : '<div class="text-gray-500 text-sm">No jobs yet.</div>';
  jobs.forEach((j) => { if (j.status === "queued" || j.status === "running") watch(j.id); });
}

$("submit").addEventListener("click", async () => {
  const url = $("url").value.trim();
  const file = $("file").files[0];
  if (!url && !file) { $("submitMsg").textContent = "Paste a URL or choose a file."; return; }

  $("submit").disabled = true;
  $("submitMsg").textContent = "Submitting…";
  try {
    const fd = new FormData();
    if (url) fd.append("url", url);
    if (file) fd.append("video", file);
    fd.append("mode", $("mode").value);
    fd.append("gameId", $("game").value);
    fd.append("renderMode", $("renderMode").value);
    fd.append("format", $("format").value);
    if (chosenMusic) {
      fd.append("musicId", chosenMusic.id || "");
      fd.append("musicUrl", chosenMusic.url || "");
      fd.append("musicCollection", chosenMusic.collection || "");
      fd.append("musicTitle", chosenMusic.title || "");
      fd.append("musicArtist", chosenMusic.artist || "");
      if (chosenMusic.attribution) fd.append("musicAttribution", chosenMusic.attribution);
      if (chosenMusic.creditRequired !== undefined) fd.append("musicCreditRequired", chosenMusic.creditRequired ? "1" : "0");
      if (chosenMusic.warning) fd.append("musicWarning", chosenMusic.warning);
    }
    const res = await fetch("/api/jobs", { method: "POST", body: fd }).then((r) => r.json());
    if (res.error) { $("submitMsg").textContent = "Error: " + res.error; }
    else {
      $("submitMsg").textContent = "Queued ✓";
      $("url").value = ""; $("file").value = "";
      await refresh();
      watch(res.id);
    }
  } catch (e) {
    $("submitMsg").textContent = "Failed: " + (e.message || e);
  } finally {
    $("submit").disabled = false;
  }
});

$("refresh").addEventListener("click", refresh);

// Event delegation: job cards get replaced wholesale (innerHTML/outerHTML) on
// every refresh/SSE update, so a listener bound directly to a copy button
// would stop working after the next re-render. #jobs itself is never
// replaced, only its children, so binding here survives that.
$("jobs").addEventListener("click", (e) => {
  const btn = e.target.closest(".copy-credit-btn");
  if (!btn) return;
  const text = btn.dataset.credit;
  const old = btn.textContent;
  navigator.clipboard.writeText(text)
    .then(() => { btn.textContent = "✓ Copied"; })
    .catch(() => { btn.textContent = "✕ Failed"; })
    .finally(() => setTimeout(() => { btn.textContent = old; }, 1500));
});

loadOptions();
refresh();
setInterval(refresh, 15000);
