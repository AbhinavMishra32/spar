import { app, nativeImage, nativeTheme } from "electron";
import path from "node:path";

/** The bundle icon is a single image — the legacy `.icns` format electron-builder
 *  packages has no field for a second appearance, and the layered `.icon` that
 *  macOS 26 reads for that needs an Icon Composer document compiled into an asset
 *  catalog. What the app can do is set its own Dock icon while it runs, so the
 *  mark follows the system appearance for as long as Spar is open. Finder and
 *  Launchpad keep showing the dark mark from the bundle.
 *
 *  macOS only: no other platform lets a running app replace its own dock or
 *  taskbar icon, and on Windows and Linux the packaged icon is already correct. */
export function installDockIcon(): void {
  if (process.platform !== "darwin") return;

  const directory = app.isPackaged
    ? path.join(process.resourcesPath, "runtime-icons")
    : path.join(app.getAppPath(), "build", "runtime-icons");

  const icons = new Map<string, Electron.NativeImage>();
  const load = (appearance: "dark" | "light") => {
    const cached = icons.get(appearance);
    if (cached) return cached;
    const image = nativeImage.createFromPath(path.join(directory, `${appearance}.png`));
    icons.set(appearance, image);
    return image;
  };

  const apply = () => {
    const image = load(nativeTheme.shouldUseDarkColors ? "dark" : "light");
    // An unreadable file yields an empty image, and handing that to the dock
    // clears the icon rather than leaving it alone.
    if (image.isEmpty()) return;
    app.dock?.setIcon(image);
  };

  apply();
  nativeTheme.on("updated", apply);
}
