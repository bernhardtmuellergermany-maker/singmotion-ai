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
// Read-only, startup-only CMS readiness check. Never emit email addresses,
// account identifiers, credentials, connection strings or password hashes.
if (process.env.CMS_ENABLED === "true" && process.env.CMS_DATABASE_URL) {
  let client;
  try {
    const {Client}=await import("pg");
    client=new Client({connectionString:process.env.CMS_DATABASE_URL,connectionTimeoutMillis:3500,statement_timeout:3500});
    await client.connect();
    const result=await client.query("SELECT to_regclass('public.staff') IS NOT NULL AS has_staff, to_regclass('public.payload_migrations') IS NOT NULL AS has_migrations");
    const {has_staff,has_migrations}=result.rows[0];
    const count=has_staff?Number((await client.query("SELECT COUNT(*) AS total FROM public.staff")).rows[0].total):null;
    console.log("CMS_READONLY_STATUS "+JSON.stringify({environment:process.env.RAILWAY_ENVIRONMENT_NAME||"unknown",hasStaffTable:has_staff,hasMigrationTable:has_migrations,staffCount:count}));
  } catch(error) {
    console.warn("CMS_READONLY_STATUS "+JSON.stringify({status:"unavailable",code:typeof error?.code==="string"?error.code.slice(0,32):"unknown"}));
  } finally {
    if(client)await client.end().catch(()=>{});
  }
}
if (process.env.PRODUCTION_R2_READONLY_PREFLIGHT_ENABLED === "true") {
  // Optional HEAD-only diagnostic. Failure cannot start the paid customer
  // worker or open public checkout, and never blocks the existing demo server.
  const { productionR2ReadOnlyPreflight } = await import("./production-r2-readonly-preflight.ts");
  const status = await productionR2ReadOnlyPreflight();
  console.log("PRODUCTION_R2_READONLY_PREFLIGHT " + status);
}
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

// Startup-only private Studio diagnostic. Read-only: no paid provider requests.
if (process.env.BYTEPLUS_STUDIO_ENABLED === "true") {
  try {
    const [{ studioGate, studioConfig }, { studioReadiness, loadRuntimeStudioPolicy }] =
      await Promise.all([
        import("../lib/live/studio-policy.ts"),
        import("../lib/live/studio-runtime.ts"),
      ]);
    const checks = [
      ["studio-gate", () => studioGate(studioConfig())],
      ["studio-policy", () => loadRuntimeStudioPolicy(directory, process.env, process.env.SUPER_ADMIN_PRIVATE_GENERATION_ENABLED === "true")],
      ["studio-recovery", () => studioReadiness(directory)],
    ];
    for (const [name, check] of checks) {
      try {
        const result = await check();
        const bootstrap = name === "studio-policy" && result?.contract?.revision === "super-admin-runtime-bootstrap-v1";
        console.log("PRIVATE_STUDIO_CHECK", name, bootstrap ? "BOOTSTRAP_READY" : "READY");
      }
      catch (error) {
        const code = error && typeof error === "object" && "code" in error
          ? String(error.code).replace(/[^A-Z0-9_]/g, "").slice(0, 64)
          : "UNEXPECTED";
        console.warn("PRIVATE_STUDIO_CHECK", name, code);
      }
    }
  } catch {
    console.warn("PRIVATE_STUDIO_CHECK", "diagnostic", "UNAVAILABLE");
  }
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

// Production R2 canary MUST NOT block the webserver's first healthy response.
// A temporary S3 network slowdown used to obscure the preflight result and
// prevented us from diagnosing private output storage on the live environment.
// The canary uses an isolated random object, not any customer asset, and never
// grants payment, storage release or provider authorization.
if (process.env.PRODUCTION_R2_WRITE_PREFLIGHT_ENABLED === "true") {
  console.log("PRODUCTION_R2_WRITE_PREFLIGHT started");
  void import("./production-r2-write-preflight.ts")
    .then(({productionR2WritePreflight}) => productionR2WritePreflight())
    .then(status => console.log("PRODUCTION_R2_WRITE_PREFLIGHT " + status))
    .catch(() => console.warn("PRODUCTION_R2_WRITE_PREFLIGHT blocked"));
}

if (process.env.PRODUCTION_R2_MP4_PREFLIGHT_ENABLED === "true") {
  console.log("PRODUCTION_R2_MP4_PREFLIGHT started");
  void import("./production-r2-mp4-preflight.ts")
    .then(({productionR2Mp4Preflight}) => productionR2Mp4Preflight())
    .then(status => console.log("PRODUCTION_R2_MP4_PREFLIGHT " + status))
    .catch(() => console.warn("PRODUCTION_R2_MP4_PREFLIGHT blocked"));
}

if (process.env.BYTEPLUS_READONLY_ACCESS_PREFLIGHT_ENABLED === "true") {
  console.log("BYTEPLUS_READONLY_ACCESS_PREFLIGHT started");
  void import("./byteplus-readonly-access-probe.ts")
    .then(({readonlyBytePlusAccessProbe}) => readonlyBytePlusAccessProbe())
    .then(status => console.log("BYTEPLUS_READONLY_ACCESS_PREFLIGHT " + status))
    .catch(() => console.warn("BYTEPLUS_READONLY_ACCESS_PREFLIGHT blocked"));
}
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
