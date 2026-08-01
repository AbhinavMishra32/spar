import { ensureLocalEnvironment, runLongLived } from "./lib.mjs";

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("Usage: node scripts/run-with-env.mjs <command> [...args]");
  process.exit(1);
}
ensureLocalEnvironment();
runLongLived(command, args);
