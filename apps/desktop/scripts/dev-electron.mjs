import { spawn } from "node:child_process";
import { existsSync, watch } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const electronBinary = resolve(projectRoot, "node_modules/.bin/electron");
const watched = [resolve(projectRoot, "dist/main"), resolve(projectRoot, "dist/workers"), resolve(projectRoot, "dist/preload")];
/* The workspace packages main imports at runtime (the main bundle leaves them
   external). Their tsc watchers rewrite dist a file at a time, so an Electron
   that launched in the middle read half a package — "does not provide an export
   named …" — and sat on the error dialog until something under dist/main
   changed. Watched, a rebuild restarts it once the writes have gone quiet. */
const packageDists = ["domain", "practice", "training", "visualizer", "provider", "database"]
  .map((name) => resolve(projectRoot, "../../packages", name, "dist"))
  .filter((directory) => existsSync(directory));
let child;
let restartTimer;
let stopping = false;

function launch() {
  const debuggingPort = /^\d+$/.test(process.env.SPAR_REMOTE_DEBUGGING_PORT ?? "") ? process.env.SPAR_REMOTE_DEBUGGING_PORT : "";
  child = spawn(electronBinary, [".", ...(debuggingPort ? [`--remote-debugging-port=${debuggingPort}`] : [])], { cwd: projectRoot, stdio: "inherit" });
  child.once("exit", (code, signal) => {
    child = undefined;
    if (!stopping && !restartTimer && code && signal !== "SIGTERM") process.exitCode = code;
  });
}

function restart(settle = 250) {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = undefined;
    if (!child) return launch();
    const previous = child;
    previous.once("exit", () => { if (!stopping) launch(); });
    previous.kill("SIGTERM");
  }, settle);
}

const watchers = [
  ...watched.map((directory) => watch(directory, { recursive: true }, () => restart())),
  // Declaration files and maps change on every rebuild too; only code matters.
  ...packageDists.map((directory) => watch(directory, { recursive: true }, (_event, file) => { if (file && /\.(js|mjs|json|py)$/.test(file)) restart(900); })),
];
launch();

function stop() {
  stopping = true;
  clearTimeout(restartTimer);
  for (const watcher of watchers) watcher.close();
  child?.kill("SIGTERM");
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
