import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const electronBinary = resolve(projectRoot, "node_modules/.bin/electron");
const watched = [resolve(projectRoot, "dist/main"), resolve(projectRoot, "dist/workers"), resolve(projectRoot, "dist/preload")];
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

function restart() {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = undefined;
    if (!child) return launch();
    const previous = child;
    previous.once("exit", () => { if (!stopping) launch(); });
    previous.kill("SIGTERM");
  }, 250);
}

const watchers = watched.map((directory) => watch(directory, { recursive: true }, restart));
launch();

function stop() {
  stopping = true;
  clearTimeout(restartTimer);
  for (const watcher of watchers) watcher.close();
  child?.kill("SIGTERM");
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
