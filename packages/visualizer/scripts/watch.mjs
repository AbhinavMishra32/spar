import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import ts from "typescript";

const config = resolve(import.meta.dirname, "../tsconfig.build.json");
const host = ts.createWatchCompilerHost(
  config,
  { preserveWatchOutput: true },
  ts.sys,
  ts.createEmitAndSemanticDiagnosticsBuilderProgram,
);

// Electron imports these files while the watcher is running. A normal emit can
// leave an existing module temporarily empty, making its exports disappear.
// Write beside the destination, then replace it in one filesystem operation.
let nextTempId = 0;
host.writeFile = (fileName, data, writeByteOrderMark, onError) => {
  const directory = dirname(fileName);
  const temporary = resolve(directory, `.${basename(fileName)}.${process.pid}.${nextTempId++}.tmp`);
  try {
    mkdirSync(directory, { recursive: true });
    writeFileSync(temporary, `${writeByteOrderMark ? "\uFEFF" : ""}${data}`);
    renameSync(temporary, fileName);
  } catch (error) {
    rmSync(temporary, { force: true });
    if (onError) onError(String(error));
    else throw error;
  }
};

ts.createWatchProgram(host);
