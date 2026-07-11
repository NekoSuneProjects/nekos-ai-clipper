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
  copyText: (text) => ipcRenderer.invoke("os:copyText", text),

  // 🔥 YOU MUST ADD THIS OR MUSIC WON'T WORK
  chooseMusic: () => ipcRenderer.invoke("dialog:chooseMusic"),

  // Free NCS auto-music
  listNcsMusic: () => ipcRenderer.invoke("music:listNcs"),
  listMusicSources: () => ipcRenderer.invoke("music:listSources"),
  getAutoMusic: (opt) => ipcRenderer.invoke("music:getAuto", opt),

  // Music Library picker
  listMusicItems: (opt) => ipcRenderer.invoke("music:listItems", opt),
  previewMusic: (opt) => ipcRenderer.invoke("music:preview", opt),
  useMusicTrack: (opt) => ipcRenderer.invoke("music:useTrack", opt),

  // Standard / montage renders
  renderStandard: (payload) => ipcRenderer.invoke("video:renderStandard", payload),
  renderMontage: (payload) => ipcRenderer.invoke("video:renderMontage", payload),
  onRenderProgress: (cb) => ipcRenderer.on("render:progress", (_, data) => cb(data)),

  // Settings
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (patch) => ipcRenderer.invoke("settings:set", patch),
  chooseOutputFolder: () => ipcRenderer.invoke("settings:chooseOutputDir"),
  openOutputFolder: () => ipcRenderer.invoke("settings:openOutputDir"),
  detectEncoders: () => ipcRenderer.invoke("encoder:detect"),

  // Game configs
  getGameConfigs: () => ipcRenderer.invoke("config:listGames"),

  // Live capture
  startCapture: (opt) => ipcRenderer.invoke("capture:start", opt),
  stopCapture: () => ipcRenderer.invoke("capture:stop"),
  onCaptureStatus: (cb) => ipcRenderer.on("capture:status", (_, data) => cb(data)),
  listAudioDevices: () => ipcRenderer.invoke("audio:listDevices"),
  listWindows: () => ipcRenderer.invoke("window:list"),
});

contextBridge.exposeInMainWorld("tools", {
  ffmpeg: () => global.TOOLS.ffmpeg,
  python: () => global.TOOLS.python
});
