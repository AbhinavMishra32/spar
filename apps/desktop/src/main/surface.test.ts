import { afterEach, describe, expect, it, vi } from "vitest";

/* The whole point of `planSurface` is that it answers differently on different
   builds of different operating systems, so the release is what the test has to
   be able to change. */
const release = vi.fn(() => "");
vi.mock("node:os", () => ({ release: () => release() }));

const { planSurface } = await import("./surface.js");

const platform = process.platform;

function on(os: NodeJS.Platform, version: string) {
  Object.defineProperty(process, "platform", { value: os, configurable: true });
  release.mockReturnValue(version);
  return planSurface();
}

afterEach(() => {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
});

describe("what Windows will paint behind the window", () => {
  /* Acrylic is a real blur of what is behind the window; Mica samples the
     wallpaper once and holds it still. The sidebar is a hole punched for the
     first of those, so it is asked for wherever it exists. */
  it("asks for Acrylic on Windows 11 22H2 and later", () => {
    const plan = on("win32", "10.0.22621");

    expect(plan.surface).toBe("acrylic");
    expect(plan.options.backgroundMaterial).toBe("acrylic");
  });

  it("keeps Mica on the first Windows 11 builds, which have no window Acrylic", () => {
    const plan = on("win32", "10.0.22000");

    expect(plan.surface).toBe("mica");
    expect(plan.options.backgroundMaterial).toBe("mica");
  });

  /* Windows 10 has neither. It must also keep its opaque background: clearing
     it for a material that will never arrive leaves a hole showing the desktop,
     and the renderer only paints the sidebar itself when it is told "none". */
  it("asks for no material at all on Windows 10, and keeps the window opaque", () => {
    const plan = on("win32", "10.0.19045");

    expect(plan.surface).toBe("none");
    expect(plan.options.backgroundMaterial).toBeUndefined();
    expect(plan.options.backgroundColor).toBeUndefined();
  });

  /* `transparent` and `backgroundMaterial` are mutually exclusive on Windows,
     and a transparent window there loses snap and its resize borders. */
  it("never asks Windows for a transparent window", () => {
    for (const version of ["10.0.22621", "10.0.22000", "10.0.19045"]) {
      expect(on("win32", version).options.transparent).toBeUndefined();
    }
  });

  it("draws the caption buttons itself on every Windows version", () => {
    for (const version of ["10.0.22621", "10.0.19045"]) {
      const plan = on("win32", version);
      expect(plan.controls).toBe("right");
      expect(plan.options.titleBarStyle).toBe("hidden");
    }
  });

  /* The one number a Windows user will notice immediately if it is wrong. The
     shell's caption buttons are 32px tall; handing the overlay anything else
     stretches the minimise, maximise and close targets past every other window
     on the desktop. It is asked for at construction as well as on every theme
     change, so the first frame is already the right size. */
  it("gives the caption buttons the shell's own height from the first frame", () => {
    for (const version of ["10.0.22621", "10.0.22000", "10.0.19045"]) {
      expect(on("win32", version).options.titleBarOverlay).toMatchObject({ height: 32 });
    }
  });
});

describe("what macOS gets, which the Windows work must not have moved", () => {
  it("installs Liquid Glass on macOS 26, with vibrancy left unset so it cannot win", () => {
    const plan = on("darwin", "25.5.0");

    expect(plan.surface).toBe("liquid-glass");
    expect(plan.options.vibrancy).toBeUndefined();
    expect(plan.options.transparent).toBe(true);
    expect(plan.options.titleBarStyle).toBe("hiddenInset");
  });

  it("falls back to sidebar vibrancy below macOS 26", () => {
    const plan = on("darwin", "23.6.0");

    expect(plan.surface).toBe("vibrancy");
    expect(plan.options.vibrancy).toBe("sidebar");
  });

  it("keeps the traffic lights where the sidebar's first row expects them", () => {
    expect(on("darwin", "25.5.0").options.trafficLightPosition).toEqual({ x: 19, y: 15 });
    expect(on("darwin", "25.5.0").controls).toBe("left");
  });
});

describe("everywhere else", () => {
  /* Linux keeps the native frame: there is no material to punch a hole for, and
     nothing owns the window buttons but the desktop environment. */
  it("keeps the native frame and paints its own sidebar", () => {
    const plan = on("linux", "6.8.0");

    expect(plan).toEqual({ surface: "none", controls: "none", options: {} });
  });
});
