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

// Music
const musicBtn = document.getElementById("chooseMusic");
const musicInfo = document.getElementById("musicInfo");

// Status
function setStatus(msg) {
  const el = document.getElementById("status");
  if (el) el.textContent = msg;
}

// Global state
let chosenMusic = null;
let currentVideoPath = null;
let currentHighlights = [];
let outputDir = null;
let modeType = "reaction"; // reaction or fps
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

  if (h.type === "kill") {
    tag.textContent = "KILL";
    tag.classList.add("bg-tagKill");
  } else if (h.type === "killstreak") {
    tag.textContent = `STREAK x${h.killstreak}`;
    tag.classList.add("bg-tagStreak");
  } else {
    tag.textContent = "REACTION";
    tag.classList.add("bg-tagReaction");
  }

  return tag;
}

// ------------------------------------------------------------
// FILTER BASED ON MODE
// ------------------------------------------------------------
function filterHighlights() {
  if (modeType === "fps") {
    return currentHighlights.filter(
      (h) => h.type === "kill" || h.type === "killstreak"
    );
  }
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

  if (!outputDir) {
    outputDir = await window.api.chooseOutputDir();
    if (!outputDir) return;
  }

  setStatus("Rendering...");

  const musicPath = chosenMusic || null;

  const res = await window.api.renderStandard({
    videoPath: currentVideoPath,
    highlight,
    musicPath,
    outputDir
  });

  if (!res.ok) return setStatus("Render failed: " + res.error);

  await window.api.showInFolder(res.shortOut);
  setStatus("Render complete!");
}

// ------------------------------------------------------------
// RENDER SELECTED MONTAGE
// ------------------------------------------------------------
async function renderSelectedMontage() {
  const mode = document.querySelector('input[name="renderMode"]:checked').value;

  if (mode !== "montage") {
    return setStatus("Montage mode required.");
  }

  const musicPath = chosenMusic || null;

  const selected = filterHighlights().filter((h) => selectedIds.has(h.id));
  if (!selected.length) return setStatus("No highlights selected.");

  if (!outputDir) {
    outputDir = await window.api.chooseOutputDir();
    if (!outputDir) return;
  }

  setStatus("Rendering...");

  const res = await window.api.renderMontage({
    videoPath: currentVideoPath,
    highlights: selected,
    musicPath: musicPath,
    outputDir
  });

  if (!res.ok) return setStatus("Render failed: " + res.error);

  await window.api.showInFolder(res.shortOut);
  setStatus("Render complete!");
}

// ------------------------------------------------------------
// MUSIC PICKER
// ------------------------------------------------------------
musicBtn?.addEventListener("click", async () => {
  const file = await window.api.chooseMusic();
  if (file) {
    chosenMusic = file;
    musicInfo.textContent = "Selected: " + file;
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

  const res = await window.api.analyseVideo({
    path: currentVideoPath,
    mode: modeType
  });

  analyseBtn.disabled = false;

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

  const res = await window.api.downloadAndAnalyseVod({
    url,
    mode: modeType
  });

  importVodBtn.disabled = false;

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
document.querySelectorAll('input[name="modeType"]').forEach((el) => {
  el.addEventListener("change", () => {
    modeType = el.value;
    renderHighlights();
  });
});

window.api.onAnalyseProgress((p) => {
  if (!p) return;

  const { step, progress } = p;

  progressEl.textContent =
    `Step: ${step.replace("_", " ")} - ${progress}%`;
});