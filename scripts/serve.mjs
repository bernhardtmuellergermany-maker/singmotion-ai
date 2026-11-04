import { mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { validateStaging } from "../lib/staging.ts";

if (process.getuid?.() === 0) {
  throw new Error(
    "Refusing to run the web server or worker as root; use the container entrypoint.",
  );
}
validateStaging();
const directory = path.resolve(process.env.DATA_DIR || ".data");
try {
  await mkdir(path.join(directory, "media"), { recursive: true, mode: 0o700 });
  for (const dir of [directory, path.join(directory, "media")]) {
    const probe = path.join(dir, `.startup-${randomUUID()}`);
    const file = await open(probe, "wx+", 0o600);
    try {
      await file.writeFile("volume-check");
      const bytes = Buffer.alloc(12);
      await file.read(bytes, 0, 12, 0);
      if (bytes.toString() !== "volume-check")
        throw new Error("Read-back failed");
    } finally {
      await file.close();
      await unlink(probe);
    }
  }
} catch {
  throw new Error(
    `DATA_DIR ${directory} is not readable/writable by UID ${process.getuid?.()}. Fix volume ownership before starting.`,
  );
}
console.log(`Persistent storage ready (UID ${process.getuid?.()}).`);
if(process.env.STAGING_R2_RUNTIME_CANARY_ENABLED==="true"){
  if(process.env.RAILWAY_ENVIRONMENT_ID!=="dfaeabed-03df-43ed-aa71-50f343a75041"||process.getuid?.()!==1000)
    throw new Error("Private R2 hydration canary is permitted on nonroot Staging only.");
  // Unlike Railway preDeploy, this runs AFTER the secure container entrypoint
  // mounted the persistent volume and dropped privileges to UID/GID 1000.
  const {canary}=await import("./r2-storage-canary.ts");
  await canary("runtime");
}

if (process.env.R2_MIGRATE_TEST_DATA === "true") {
  // Explicit staging-only one-shot pass on the mounted persistent volume.
  // Failure prevents starting new web/worker instances with partial records.
  const {migrateTestAssetsToR2}=await import("./migrate-test-assets-to-r2.ts");
  const result=await migrateTestAssetsToR2();
  console.log("R2_MIGRATION_VERIFIED "+JSON.stringify(result));
}

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
web.on("error", () => stop(1));
worker.on("error", () => stop(1));
web.on("exit", (code) => stop(code === 0 ? 1 : (code ?? 1)));
worker.on("exit", (code) => stop(code === 0 ? 1 : (code ?? 1)));
process.on("SIGTERM", () => stop(0));
process.on("SIGINT", () => stop(0));
