// core/musicBpm.js
const { runPython } = require("./pythonRunner");

async function getBpmForTrack(musicPath) {
  const out = await runPython("bpm_detector.py", [musicPath]);
  const bpm = parseInt(out, 10);
  if (Number.isNaN(bpm)) return 0;
  return bpm;
}

module.exports = { getBpmForTrack };
