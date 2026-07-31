import { app, Menu, type BrowserWindow } from "electron";
export function installMenu(getWindow: () => BrowserWindow | null) {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [{ role: "about" }, { type: "separator" }, { label: "Settings…", accelerator: "CmdOrCtrl+,", click: () => getWindow()?.webContents.send("navigation", "settings") }, { type: "separator" }, { role: "quit" }] },
    { label: "File", submenu: [{ label: "New Session", accelerator: "CmdOrCtrl+N", click: () => getWindow()?.webContents.send("navigation", "new-session") }, { type: "separator" }, { role: "close" }] },
    { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "View", submenu: [{ label: "Command Palette", accelerator: "CmdOrCtrl+Shift+P", click: () => getWindow()?.webContents.send("command-palette") }, { type: "separator" }, { role: "toggleDevTools" }, { role: "togglefullscreen" }] },
    { role: "windowMenu" }
  ]));
}

