import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function inspectEnvironment({
  env = process.env,
  nodeVersion = process.versions.node,
  run = spawnSync,
  makeDirectory = mkdirSync,
  makeTemp = mkdtempSync,
  remove = rmSync,
} = {}) {
  const checks = [];
  const add = (label, ok, detail) =>
    checks.push({ label, ok: Boolean(ok), detail });

  const major = Number.parseInt(nodeVersion.split(".")[0], 10);
  add("Node.js 24", major === 24, `Detected Node.js ${nodeVersion}; use Node 24.`);

  for (const command of ["ffmpeg", "ffprobe"]) {
    const result = run(command, ["-version"], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    });
    add(
      command,
      !result.error && result.status === 0,
      result.error ? "Not executable or missing from PATH." : `Exit status: ${result.status}`,
    );
  }

  const dataDir = path.resolve(env.DATA_DIR || ".data");
  try {
    makeDirectory(dataDir, { recursive: true, mode: 0o700 });
    const probe = makeTemp(path.join(dataDir, ".doctor-"));
    remove(probe, { recursive: true });
    add("Private data directory", true, `Writable: ${dataDir}`);
  } catch {
    add("Private data directory", false, `Cannot safely create temporary files in ${dataDir}.`);
  }

  add(
    "Demo mode",
    env.DEMO_MODE !== "false",
    env.DEMO_MODE === "false"
      ? "DEMO_MODE=false disables the API; it does not activate a live provider."
      : "Local demonstration enabled (no AI provider calls).",
  );
  add(
    "Live generation disabled",
    env.GENERATIONS_ENABLED !== "true",
    env.GENERATIONS_ENABLED === "true"
      ? "Turn GENERATIONS_ENABLED off; the live provider contract is unverified."
      : "No paid rendering enabled.",
  );

  if (env.NODE_ENV === "production") {
    add(
      "Staging authentication",
      env.STAGING_AUTH_ENABLED === "true" && Boolean(env.STAGING_PASSWORD?.trim()),
      "Production demo requires STAGING_AUTH_ENABLED=true and a nonempty STAGING_PASSWORD.",
    );
  }

  return checks;
}

export function main() {
  const checks = inspectEnvironment();
  for (const check of checks)
    console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.label}: ${check.detail}`);
  if (checks.some((check) => !check.ok)) {
    console.error("Local prerequisites are not ready. No live provider was contacted.");
    process.exitCode = 1;
  } else {
    console.log("Local demo prerequisites look ready. Run the app, worker, and npm run smoke next.");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main();
}
