const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jjDesktop", {
  isElectron: true,
  platform: process.platform,
  onAction(callback) {
    ipcRenderer.on("desktop-action", (_event, action) => callback(action));
  },
  ready() {
    ipcRenderer.send("desktop-ready");
  },
});
