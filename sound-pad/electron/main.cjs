const { app, BrowserWindow, Menu, ipcMain } = require("electron");
const path = require("path");

const isDev = !app.isPackaged;
let mainWindow = null;

function sendAction(action) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("desktop-action", action);
  }
}

function createMenu() {
  const template = [
    {
      label: "File",
      submenu: [
        {
          label: "Stop All Sounds",
          accelerator: "CmdOrCtrl+Shift+S",
          click: () => sendAction("stop-all"),
        },
        { type: "separator" },
        { role: "quit", label: "Quit" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload", label: "Reload" },
        { role: "forceReload", label: "Force Reload" },
        { role: "toggleDevTools", label: "Developer Tools" },
        { type: "separator" },
        { role: "resetZoom", label: "Reset Zoom" },
        { role: "zoomIn", label: "Zoom In" },
        { role: "zoomOut", label: "Zoom Out" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Fullscreen" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Keyboard Shortcuts",
          click: () => sendAction("show-shortcuts"),
        },
      ],
    },
  ];

  if (process.platform === "darwin") {
    template.unshift({
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  }

  return Menu.buildFromTemplate(template);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "John & Joy Sound Pad",
    backgroundColor: "#1a1208",
    icon: path.join(__dirname, "../icons/icon-512.png"),
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const indexPath = path.join(__dirname, "../www/index.html");
  mainWindow.loadFile(indexPath);

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(createMenu());
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.on("desktop-ready", () => {
  sendAction("init-desktop");
});
