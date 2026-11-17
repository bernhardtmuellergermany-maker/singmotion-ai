/**
 * Optional, one-shot-per-worker-boot private Production inventory. No public
 * endpoint, export, backup upload, provider/payment call or source mutation.
 * The operator must set a short-lived expiry timestamp explicitly. Disabled
 * unless that timestamp is present and valid.
 */
import { spawn as nativeSpawn } from "node:child_process";
const PROD = "36adc41d-7e54-4396-ad1a-fd432ba0441d";
const SOURCE_ENV = Object.freeze([
  "RAILWAY_ENVIRONMENT_ID",
  "RAILWAY_SERVICE_NAME",
  "DATA_DIR",
  "CMS_DATABASE_URL",
  "R2_ACCOUNT_ID",
  "R2_BUCKET",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
]);
const required = SOURCE_ENV.filter((x) => x !== "RAILWAY_ENVIRONMENT_ID" && x !== "RAILWAY_SERVICE_NAME");
const boundedNumber = (value) =>
  Number.isSafeInteger(value) && value >= 0 ? value : null;

export function privateInventoryConfig(env, now = Date.now()) {
  const activation = env.PRODUCTION_BACKUP_INVENTORY_EXPIRES_AT;
  if (activation === undefined || activation === "") return null;
  if (
    env.RAILWAY_ENVIRONMENT_ID !== PROD ||
    env.RAILWAY_SERVICE_NAME !== "singmotion-ai" ||
    required.some((key) => typeof env[key] !== "string" || !env[key]) ||
    !/^\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d(?:\\.\\d{3})?Z$/.test(activation)
  ) throw Error("INVENTORY_ACTIVATION_REFUSED");
  const expires = Date.parse(activation);
  if (!Number.isFinite(expires) || expires <= now || expires - now > 30 * 60_000)
    throw Error("INVENTORY_ACTIVATION_EXPIRED_OR_UNBOUNDED");
  return {
    env: Object.fromEntries(SOURCE_ENV.map((key) => [key, env[key]])),
    deadline: expires,
  };
}

function safeSummary(payload) {
  if (
    payload?.ok !== true ||
    payload.backupVerified !== false ||
    payload.restoreVerified !== false ||
    payload.local?.databases?.length < 3 ||
    payload.r2?.twoPassStable !== true
  ) throw Error("INVENTORY_RESULT_INVALID");
  const fields = [
    payload.local.files, payload.local.bytes,
    payload.postgres.tables, payload.postgres.rows,
    payload.r2.objects, payload.r2.bytes, payload.r2.pages,
  ].map(boundedNumber);
  if (fields.some((v) => v === null)) throw Error("INVENTORY_RESULT_INVALID");
  if (!payload.local.databases.every((db) => db.integrity === true && db.creditLedger !== false))
    throw Error("INVENTORY_SOURCE_CHECK_FAILED");
  return {
    ok: true,
    localFiles: fields[0],
    localBytes: fields[1],
    sqliteDatabases: payload.local.databases.length,
    postgresTables: fields[2],
    postgresRows: fields[3],
    r2Objects: fields[4],
    r2Bytes: fields[5],
    r2Pages: fields[6],
    r2TwoPassStable: true,
    backupVerified: false,
    restoreVerified: false,
  };
}

/** Injectable spawn and clock permit offline tests without Production access. */
export async function runProductionInventoryOnce(
  env,
  {
    now = Date.now,
    spawn = nativeSpawn,
    log = () => {},
    warn = () => {},
    nodePath = process.execPath,
    cwd = process.cwd(),
  } = {},
) {
  let config;
  try {
    config = privateInventoryConfig(env, now());
  } catch {
    warn("PRODUCTION_BACKUP_INVENTORY_REFUSED");
    return { status: "refused" };
  }
  if (!config) return { status: "disabled" };
  if (process.getuid?.() === 0) {
    warn("PRODUCTION_BACKUP_INVENTORY_REFUSED");
    return { status: "refused" };
  }
  const ms = Math.min(120_000, config.deadline - now());
  if (ms < 1000) {
    warn("PRODUCTION_BACKUP_INVENTORY_REFUSED");
    return { status: "refused" };
  }
  return new Promise((resolve) => {
    let child, result = "", failed = false, settled = false;
    const finish = (status) => {
      if (settled) return;
      settled = true;
      if (status === "success") {
        try {
          const lines = result.trim().split(/\\r?\\n/).filter(Boolean);
          if (lines.length !== 1 || !lines[0].startsWith("BACKUP_SOURCE_INVENTORY "))
            throw Error("INVENTORY_OUTPUT_INVALID");
          const safe = safeSummary(JSON.parse(lines[0].slice("BACKUP_SOURCE_INVENTORY ".length)));
          log("PRODUCTION_BACKUP_SOURCE_INVENTORY", JSON.stringify(safe));
          resolve({ status: "success", summary: safe });
          return;
        } catch { /* Never forward raw source data, errors or environment. */ }
      }
      warn("PRODUCTION_BACKUP_INVENTORY_FAILED");
      resolve({ status: "failed" });
    };
    try {
      child = spawn(nodePath, [
        "--experimental-strip-types",
        "scripts/backup-source-inventory.ts",
        "--read-only-no-transfer",
      ], {
        cwd,
        env: config.env, // NO Stripe, BytePlus, email or super-admin secrets.
        stdio: ["ignore", "pipe", "pipe"],
        timeout: ms,
        killSignal: "SIGKILL",
      });
      child.stdout.on("data", (chunk) => {
        if (settled || failed) return;
        result += String(chunk);
        if (result.length > 16_384) {
          failed = true;
          child.kill("SIGKILL");
        }
      });
      child.stderr?.resume();
      child.on("error", () => finish("failed"));
      child.on("close", (code) => finish(code === 0 && !failed ? "success" : "failed"));
    } catch {
      finish("failed");
    }
  });
}
