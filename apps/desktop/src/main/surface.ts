import { release } from "node:os";
import type { BrowserWindow, BrowserWindowConstructorOptions } from "electron";

/**
 * Which translucent material, if any, the OS will paint behind the window.
 *
 * The renderer needs to know: the sidebar is a transparent hole punched in the
 * window so the material shows through, and a hole with nothing behind it shows
 * the desktop. So when the answer is "none" the renderer paints its own fill.
 */
export type NativeSurface = "liquid-glass" | "vibrancy" | "mica" | "none";

/**
 * Which edge of our first row the OS draws its window buttons over, and so which
 * edge has to reserve room for them. "none" is a native frame — Linux, or any
 * platform where we did not hide the title bar — where the buttons are outside
 * our content and nothing needs reserving.
 */
export type WindowControls = "left" | "right" | "none";

export type SurfacePlan = {
  surface: NativeSurface;
  controls: WindowControls;
  options: BrowserWindowConstructorOptions;
};

/** Liquid Glass is macOS 26 (Tahoe) and later; Darwin 25 is macOS 26. */
function macMajor(): number {
  return Number.parseInt(release().split(".")[0] ?? "0", 10);
}

/** Mica needs Windows 11, which is NT 10.0 build 22000 and up. */
function isWindows11(): boolean {
  const build = Number.parseInt(release().split(".")[2] ?? "0", 10);
  return build >= 22_000;
}

/**
 * Picks the best material the current OS can give us, and the window options
 * that go with it. Nothing here is conditional on the material *working* — that
 * is settled later in `applyNativeSurface`, which can still downgrade.
 */
export function planSurface(): SurfacePlan {
  if (process.platform === "darwin") {
    const tahoe = macMajor() >= 25;
    return {
      // On Tahoe we install a real NSGlassEffectView ourselves, and vibrancy
      // must stay unset or it wins and the result is a flat blur.
      surface: tahoe ? "liquid-glass" : "vibrancy",
      controls: "left",
      options: {
        transparent: true,
        ...(tahoe ? {} : { vibrancy: "sidebar" as const }),
        titleBarStyle: "hiddenInset",
        // Centres the buttons in the sidebar's own top row. Kept in step with
        // --titlebar-height / --traffic-lights-inset in theme.css.
        trafficLightPosition: { x: 19, y: 15 },
        visualEffectState: "followWindow",
        backgroundColor: "#00000000",
      },
    };
  }

  if (process.platform === "win32" && isWindows11()) {
    return {
      surface: "mica",
      controls: "right",
      options: {
        // `transparent` and `backgroundMaterial` are mutually exclusive on
        // Windows, and transparent windows there lose snap and resize borders.
        backgroundMaterial: "mica",
        titleBarStyle: "hidden",
        titleBarOverlay: true,
        backgroundColor: "#00000000",
      },
    };
  }

  // Windows 10 has no Mica, but still gets the custom title bar so the chrome
  // matches; everywhere else keeps the native frame.
  if (process.platform === "win32") {
    return { surface: "none", controls: "right", options: { titleBarStyle: "hidden", titleBarOverlay: true } };
  }

  return { surface: "none", controls: "none", options: {} };
}

/**
 * Installs the macOS 26 Liquid Glass view behind the web contents.
 *
 * The module is an optional native dependency: it is darwin-only, and it reaches
 * for NSGlassEffectView, which is private API. Every failure path downgrades to
 * the vibrancy the window would have had anyway, so a missing or unloadable
 * module costs appearance and nothing else.
 *
 * Returns the surface actually in force.
 */
export async function applyNativeSurface(window: BrowserWindow, plan: SurfacePlan): Promise<NativeSurface> {
  if (plan.surface !== "liquid-glass") return plan.surface;

  try {
    /* Imported through a variable specifier on purpose. The package is an
       optional darwin-only dependency, so on a Linux or Windows build machine it
       is simply not installed — and a static import of a module that is not there
       is a type error that fails the whole build, on the one platform that was
       never going to load it anyway. A variable defeats that resolution, and the
       shape actually used is declared here instead. */
    const specifier: string = "electron-liquid-glass";
    const module = (await import(specifier)) as {
      default: { addView(handle: Buffer, options: { cornerRadius: number }): number };
    };
    // Matches the window corner macOS 26 draws, so the glass reaches the edge
    // of the frame instead of stopping short of it inside a squarer rectangle.
    const id = module.default.addView(window.getNativeWindowHandle(), { cornerRadius: 16 });
    if (id < 0) throw new Error("NSGlassEffectView unavailable");
    return "liquid-glass";
  } catch (cause) {
    console.warn("Liquid Glass unavailable, falling back to vibrancy:", cause);
    // setVibrancy still works on a window that was created without it.
    window.setVibrancy("sidebar");
    return "vibrancy";
  }
}

/** Keeps the Windows caption buttons legible when the theme flips. */
export function syncWindowControls(window: BrowserWindow, dark: boolean) {
  if (process.platform !== "win32" || !window.setTitleBarOverlay) return;
  window.setTitleBarOverlay({
    color: "#00000000",
    symbolColor: dark ? "#fafafa" : "#1a1a1a",
    height: 44,
  });
}
