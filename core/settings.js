// core/settings.js
//
// Tiny persisted settings store (JSON in userData). Remembers the user's output
// folder etc. across launches.

const fs = require("fs");
const path = require("path");

let settingsPath = null;
let cache = null;

function ensureDir(dir) {
  try { if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch {}
}

function init(userDataDir, documentsDir) {
  settingsPath = path.join(userDataDir, "settings.json");
  const defaults = {
    outputDir: path.join(documentsDir || userDataDir, "NekosAIClipper"),
    encoder: "auto", // "auto" | "gpu" | "cpu"
  };
  try {
    cache = { ...defaults, ...JSON.parse(fs.readFileSync(settingsPath, "utf8")) };
  } catch {
    cache = { ...defaults };
  }
  ensureDir(cache.outputDir);
  return cache;
}

function get() { return cache || {}; }

function set(patch) {
  cache = { ...(cache || {}), ...(patch || {}) };
  if (cache.outputDir) ensureDir(cache.outputDir);
  try { fs.writeFileSync(settingsPath, JSON.stringify(cache, null, 2)); } catch {}
  return cache;
}

module.exports = { init, get, set };
