import { release } from "node:os";
import type { BrowserWindow, BrowserWindowConstructorOptions } from "electron";

/**
 * Which translucent material, if any, the OS will paint behind the window.
 *
 * The renderer needs to know: the sidebar is a transparent hole punched in the
 * window so the material shows through, and a hole with nothing behind it shows
 * the desktop. So when the answer is "none" the renderer paints its own fill.
 */
export type NativeSurface = "liquid-glass" | "vibrancy" | "acrylic" | "mica" | "none";

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

/** The Windows 11 build number, or 0 anywhere else. `os.release()` there is
 *  "10.0.<build>", and the build is the only part that separates the materials:
 *  Mica arrived with Windows 11 itself (22000), and window-level Acrylic with
 *  22H2 (22621). */
function windowsBuild(): number {
  return Number.parseInt(release().split(".")[2] ?? "0", 10);
}

/**
 * Which material Windows will paint behind the window.
 *
 * Acrylic where it exists, because the sidebar is the surface this is for and
 * Mica is not really translucent: it is a wallpaper tint, sampled once and held
 * still, so a sidebar over it reads as a flat grey panel rather than as a hole
 * in the window. Acrylic actually blurs what is behind it, which is the effect
 * macOS has had all along and the one the sidebar's tint was drawn against.
 *
 * Mica stays the answer for the first Windows 11 builds, where Acrylic is not
 * available at window level, and Windows 10 gets no material at all — the
 * renderer paints the sidebar itself there.
 */
function windowsSurface(): "acrylic" | "mica" | "none" {
  const build = windowsBuild();
  if (build >= 22_621) return "acrylic";
  if (build >= 22_000) return "mica";
  return "none";
}

/**
 * The caption buttons Windows draws over our first row, at 100% scale.
 *
 * These are the shell's own metrics, not a taste of ours: 46x32 per button and
 * three of them. Handing `setTitleBarOverlay` a taller height does not pad the
 * row, it stretches the hit targets, and a close button half again as tall as
 * every other Windows app's is the single loudest tell that a window is not
 * native. The renderer reads the real, DPI-scaled numbers back out of
 * `env(titlebar-area-*)` and sizes its own title row to match — see theme.css.
 */
const CAPTION_HEIGHT = 32;

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

  if (process.platform === "win32") {
    const surface = windowsSurface();
    return {
      surface,
      controls: "right",
      options: {
        titleBarStyle: "hidden",
        // Given its metrics here as well as in `syncWindowControls`, so the very
        // first frame is already the native size — an overlay that resizes after
        // the theme is first synced is a visible twitch on launch.
        titleBarOverlay: { color: "#00000000", symbolColor: "#1a1a1a", height: CAPTION_HEIGHT },
        /* `transparent` and `backgroundMaterial` are mutually exclusive on
           Windows, and transparent windows there lose snap and the resize
           borders — so the material is asked for by name and the background is
           cleared to let it through. Windows 10 has neither material and keeps
           its opaque fill, which the renderer then paints the sidebar over. */
        ...(surface === "none" ? {} : { backgroundMaterial: surface, backgroundColor: "#00000000" }),
      },
    };
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

/** Keeps the Windows caption buttons legible when the theme flips.
 *
 *  Only the glyph colour moves. The height is the shell's own and is restated
 *  rather than recomputed, because `setTitleBarOverlay` replaces the whole
 *  overlay: omitting it here would drop the row back to Chromium's default on
 *  the first theme change of the session. */
export function syncWindowControls(window: BrowserWindow, dark: boolean) {
  if (process.platform !== "win32" || !window.setTitleBarOverlay) return;
  window.setTitleBarOverlay({
    // Transparent, so the caption strip shows the same Acrylic or Mica as the
    // title row it sits in rather than a band of flat colour across the top.
    color: "#00000000",
    symbolColor: dark ? "#fafafa" : "#1a1a1a",
    height: CAPTION_HEIGHT,
  });
}
