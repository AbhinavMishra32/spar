import { app, Menu, type BrowserWindow } from "electron";
import type { MenuCommand } from "../shared/api.js";

export function installMenu(getWindow: () => BrowserWindow | null) {
  // One channel for every menu-driven action keeps the renderer's handling in a single place.
  const send = (command: MenuCommand) => () => getWindow()?.webContents.send("menu:command", command);

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [{ role: "about" }, { type: "separator" }, { label: "Settings…", accelerator: "CmdOrCtrl+,", click: send("settings") }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { type: "separator" }, { role: "quit" }] },
    { label: "File", submenu: [{ label: "New Session", accelerator: "CmdOrCtrl+N", click: send("new-session") }, { type: "separator" }, { role: "close" }] },
    { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "View", submenu: [{ label: "Search…", accelerator: "CmdOrCtrl+K", click: send("command-palette") }, { label: "Command Palette", accelerator: "CmdOrCtrl+Shift+P", click: send("command-palette") }, { type: "separator" }, { role: "toggleDevTools" }, { role: "togglefullscreen" }] },
    { role: "windowMenu" }
  ]));
}

