import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vite = spawn(process.execPath, [resolve(root, "node_modules/vite/bin/vite.js"), "--configLoader", "runner"], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
const api = spawn(process.execPath, [resolve(root, "server/index.js")], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  vite.kill();
  api.kill();
  process.exitCode = code;
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
vite.on("exit", (code) => { if (!stopping) stop(code || 0); });
api.on("exit", (code) => { if (!stopping) stop(code || 0); });
