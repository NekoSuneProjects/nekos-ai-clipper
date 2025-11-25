// preload.js
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  openVideoDialog: () => ipcRenderer.invoke("dialog:openVideo"),
  analyseVideo: (opt) =>
    ipcRenderer.invoke("video:analyseWithMode",opt),
  downloadAndAnalyseVod: (opt) =>
    ipcRenderer.invoke("vod:downloadAndAnalyseWithMode", opt),
  onAnalyseProgress: (cb) => ipcRenderer.on("analyse:progress", (_, data) => cb(data)),
  chooseOutputDir: () => ipcRenderer.invoke("dialog:chooseOutputDir"),
  showInFolder: (file) => ipcRenderer.invoke("os:showInFolder", file),

  // 🔥 YOU MUST ADD THIS OR MUSIC WON'T WORK
  chooseMusic: () => ipcRenderer.invoke("dialog:chooseMusic"),

  // Standard / montage renders
  renderStandard: (payload) => ipcRenderer.invoke("video:renderStandard", payload),
  renderMontage: (payload) => ipcRenderer.invoke("video:renderMontage", payload),
});

contextBridge.exposeInMainWorld("tools", {
  ffmpeg: () => global.TOOLS.ffmpeg,
  python: () => global.TOOLS.python
});
