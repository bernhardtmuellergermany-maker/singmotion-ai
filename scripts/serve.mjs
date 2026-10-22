import { spawn } from "node:child_process";
const web = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "0.0.0.0",
    "-p",
    process.env.PORT || "3000",
  ],
  { stdio: "inherit" },
);
const worker = spawn(
  process.execPath,
  ["--experimental-strip-types", "scripts/worker.ts"],
  { stdio: "inherit" },
);
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  web.kill("SIGTERM");
  worker.kill("SIGTERM");
  setTimeout(() => process.exit(code), 1500);
}
web.on("exit", (code) => stop(code ?? 1));
worker.on("exit", (code) => stop(code === 0 ? 1 : (code ?? 1)));
process.on("SIGTERM", () => stop(0));
process.on("SIGINT", () => stop(0));
