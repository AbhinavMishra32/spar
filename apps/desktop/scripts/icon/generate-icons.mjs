// Builds every icon artifact the app ships from one renderer.
//
//   pnpm --filter @spar/desktop icons
//
// Rendering needs AppKit, so this only runs on macOS. The outputs are committed
// precisely because of that: the Windows and Linux release jobs package the
// artifacts from the repository rather than rebuilding them.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, "..", "..");
const repo = path.resolve(desktop, "..", "..");
const renderer = path.join(here, "render-icon.swift");

const buildDir = path.join(desktop, "build");
const linuxDir = path.join(buildDir, "icons");
const runtimeDir = path.join(buildDir, "runtime-icons");
const docsDir = path.join(repo, "docs", "assets");

if (process.platform !== "darwin") {
  console.log("Skipping icon generation: the renderer needs AppKit. Using the committed icons.");
  process.exit(0);
}

// Linux wants a directory of square PNGs; .ico and .icns want their own sets.
const pngSizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icnsEntries = [
  ["icp4", 16], ["ic11", 32], ["icp5", 32], ["ic12", 64], ["icp6", 64],
  ["ic07", 128], ["ic13", 256], ["ic08", 256], ["ic14", 512], ["ic09", 512],
  ["ic10", 1024]
];

for (const dir of [buildDir, linuxDir, runtimeDir, docsDir]) {
  mkdirSync(dir, { recursive: true });
}

const scratch = mkdtempSync(path.join(os.tmpdir(), "spar-icons-"));
try {
  const dark = render("dark", pngSizes);
  const light = render("light", [512, 1024]);

  // The app icon is the dark mark: it is the product's hero, and it reads on a
  // light Dock as well as a dark one. The light mark ships alongside it for the
  // running app to swap in under a light appearance, and for the docs.
  writeFileSync(path.join(buildDir, "icon.icns"), buildIcns(dark, icnsEntries));
  writeFileSync(path.join(buildDir, "icon.ico"), buildIco(dark, icoSizes));
  writeFileSync(path.join(buildDir, "icon.png"), dark.get(512));
  for (const size of pngSizes) {
    writeFileSync(path.join(linuxDir, `${size}x${size}.png`), dark.get(size));
  }

  writeFileSync(path.join(runtimeDir, "dark.png"), dark.get(512));
  writeFileSync(path.join(runtimeDir, "light.png"), light.get(512));

  writeFileSync(path.join(docsDir, "icon-dark.png"), dark.get(1024));
  writeFileSync(path.join(docsDir, "icon-light.png"), light.get(1024));

  console.log(`Wrote icon.icns, icon.ico, ${pngSizes.length} Linux PNGs, 2 runtime icons, 2 doc icons.`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

/** Renders one appearance at every requested size. Returns size -> PNG bytes. */
function render(appearance, sizes) {
  const out = new Map();
  for (const size of sizes) {
    const file = path.join(scratch, `${appearance}-${size}.png`);
    const result = spawnSync("swift", [renderer, String(size), appearance, file], {
      stdio: ["ignore", "ignore", "inherit"]
    });
    if (result.status !== 0) {
      throw new Error(`render-icon.swift failed for ${appearance} at ${size}px`);
    }
    out.set(size, readFileSync(file));
  }
  return out;
}

function buildIco(images, sizes) {
  const entries = sizes.map((size) => ({ size, data: images.get(size) }));

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(entries.length * 16);
  let offset = header.length + directory.length;

  entries.forEach((entry, index) => {
    const at = index * 16;
    // 256 and above is encoded as 0 in this field.
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at);
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at + 1);
    directory.writeUInt16LE(1, at + 4);
    directory.writeUInt16LE(32, at + 6);
    directory.writeUInt32LE(entry.data.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += entry.data.length;
  });

  return Buffer.concat([header, directory, ...entries.map((entry) => entry.data)]);
}

function buildIcns(images, entries) {
  const chunks = entries.map(([type, size]) => {
    const data = images.get(size);
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, "ascii");
    header.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([header, data]);
  });

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const header = Buffer.alloc(8);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(8 + total, 4);
  return Buffer.concat([header, ...chunks]);
}
