#!/usr/bin/env node
/**
 * Explicit, operator-run HiDrive ciphertext-only verification for #230.
 *
 * Prerequisites (provided directly on a separate trusted cloud runner, never
 * pasted into GitHub/ChatGPT): a 0600 rclone config holding a fresh HiDrive
 * OAuth grant with verified user,ro scope. No RSA key is used here.
 *
 * RESTORE_HIDRIVE_RO_RCLONE_CONFIG=/private/rclone.conf
 * RESTORE_HIDRIVE_RO_REMOTE=hidrive-ro:SingMotion-DR
 * node scripts/hidrive-readonly-commit-preflight.mjs --manifest-only
 *
 * The --all-ciphertext mode downloads and hashes every encrypted remote object
 * and MUST be separately enabled by RESTORE_FULL_READ_APPROVED=YES.
 */
import { spawn } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { attestHiDriveReadOnlyGrant } from "../lib/ops/hidrive-ro-grant-attestation.mjs";
import path from "node:path";
import {
  PRODUCTION_RECEIPT_PIN_230,
  verifyRemoteCommittedCiphertext230,
} from "../lib/ops/hidrive-readonly-commit-preflight.mjs";

const fail = (code) => { throw Error(code); };
const sourceProject = "96ab3402-f974-4cdf-b9a3-408443b17025";
const sourceEnvironments = new Set([
  "36adc41d-7e54-4396-ad1a-fd432ba0441d",
  "dfaeabed-03df-43ed-aa71-50f343a75041",
]);
const selectedMode = process.argv.slice(2);
const config = process.env.RESTORE_HIDRIVE_RO_RCLONE_CONFIG;
const remote = process.env.RESTORE_HIDRIVE_RO_REMOTE;

function strictRemote(value) {
  if (typeof value !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}:(?:[a-zA-Z0-9_-]{1,80}\/)*SingMotion-DR$/.test(value))
    fail("RESTORE_REMOTE_INVALID");
  return value;
}

async function assertPrivateConfig(value) {
  if (typeof value !== "string" || !path.isAbsolute(value))
    fail("PRIVATE_CONFIG_PATH_REQUIRED");
  let info;
  try { info = await lstat(value); }
  catch { fail("PRIVATE_CONFIG_REQUIRED"); }
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 ||
      (process.getuid && info.uid !== process.getuid()))
    fail("PRIVATE_CONFIG_PERMISSIONS_INVALID");
}

/**
 * Spawn only `rclone cat`. Never a shell, `copy`, `sync`, `delete`,
 * `move`, or a browser-visible endpoint. No dynamic flags from user input.
 * The config may contain an OAuth token; the runner prints none of it.
 */
function classifyRcloneReadError(output, spawnError) {
  if (spawnError) return "HIDRIVE_RCLONE_EXECUTION_ERROR";
  const s=output.slice(0,8192);
  if (/unknown flag|flag provided but not defined|unknown command|unknown backend/i.test(s))
    return "HIDRIVE_RCLONE_VERSION_INCOMPATIBLE";
  if (/invalid_grant|invalid_token|unauthorized|unauthorised|token expired|401|invalid credentials/i.test(s))
    return "HIDRIVE_AUTH_REJECTED";
  if (/permission denied|forbidden|403|access denied/i.test(s))
    return "HIDRIVE_ACCESS_FORBIDDEN";
  if (/not found|404|does not exist|directory not found|object not found/i.test(s))
    return "HIDRIVE_OBJECT_NOT_FOUND";
  if (/429|rate limit|too many requests/i.test(s))
    return "HIDRIVE_RATE_LIMITED";
  if (/network|timeout|connection refused|connection reset|no such host|tls handshake/i.test(s))
    return "HIDRIVE_NETWORK_ERROR";
  return "HIDRIVE_READ_ERROR_UNCLASSIFIED";
}

function rcloneCat(remoteFile) {
  return (async function* () {
    const child = spawn("rclone", [
      "cat", "--config", config,
      "--hidrive-scope-access", "ro",
      "--hidrive-scope-role", "user",
      remoteFile,
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
        HOME: "/tmp",
        TMPDIR: "/tmp",
      },
    });
    let spawnError = false;
    let stderr = "";
    // Capture only in memory, never emit raw rclone stderr: it may contain
    // credential-bearing URLs or private object paths. Emit a fixed code only.
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 8192) stderr += chunk.toString("utf8").slice(0,8192-stderr.length);
    });
    child.once("error", () => { spawnError = true; });
    const closed = new Promise((resolve) => child.once("close", resolve));
    try {
      for await (const chunk of child.stdout) yield chunk;
      const code = await closed;
      if (spawnError || code !== 0) {
        console.error(classifyRcloneReadError(stderr, spawnError));
        fail("HIDRIVE_READ_FAILED");
      }
    } catch { fail("HIDRIVE_READ_FAILED"); }
    finally {
      if (child.exitCode === null && !child.killed) child.kill("SIGTERM");
      await closed;
    }
  })();
}

async function main() {
  if (selectedMode.length !== 1 ||
      !["--manifest-only", "--all-ciphertext"].includes(selectedMode[0]))
    fail("READONLY_MODE_REQUIRED");
  if ((process.getuid && process.getuid() === 0) ||
      process.env.RAILWAY_PROJECT_ID === sourceProject ||
      sourceEnvironments.has(process.env.RAILWAY_ENVIRONMENT_ID))
    fail("SOURCE_ENVIRONMENT_FORBIDDEN");
  if (selectedMode[0] === "--all-ciphertext" &&
      process.env.RESTORE_FULL_READ_APPROVED !== "YES")
    fail("FULL_READ_APPROVAL_REQUIRED");
  await assertPrivateConfig(config);
  strictRemote(remote);
  if (Object.keys(process.env).some(name =>
      /^(STRIPE_|BYTEPLUS_|R2_|PGPASSWORD|CMS_DATABASE_URL|DATABASE_URL|BACKUP_RECOVERY_PRIVATE|BACKUP_SIGNING_PRIVATE|HIDRIVE_CLIENT_SECRET|HIDRIVE_AUTH_CODE)/.test(name)))
    fail("SOURCE_SECRETS_FORBIDDEN");
  const remoteName = remote.slice(0,remote.indexOf(":"));
  // Read the token only in the owner-controlled process, never send it to
  // ChatGPT/GitHub/Railway variables or print it. Verify *granted* scope.
  const roReport = await attestHiDriveReadOnlyGrant({
    configText:await readFile(config,"utf8"),
    remoteName,
    async tokeninfo(token) {
      const response = await fetch("https://my.hidrive.com/oauth2/tokeninfo", {
        method:"POST", redirect:"error",
        headers:{"Content-Type":"application/x-www-form-urlencoded","Cache-Control":"no-store"},
        body:new URLSearchParams({access_token:token}),
        signal:AbortSignal.timeout(15000),
      });
      if (!response.ok) fail("TOKENINFO_UNAVAILABLE");
      const body = await response.text();
      if (body.length > 4096) fail("TOKENINFO_INVALID");
      try { return JSON.parse(body); }
      catch { fail("TOKENINFO_INVALID"); }
    },
  });
  const prefix = remote + "/sm-" + PRODUCTION_RECEIPT_PIN_230.run + "-";
  const session = {
    dir: remote,
    async request(method, endpoint, params, body) {
      if (method !== "GET" || endpoint !== "/file" ||
          body !== null || typeof params?.path !== "string" ||
          !params.path.startsWith(prefix))
        fail("GET_ONLY_POLICY");
      const artifact = params.path.slice(prefix.length);
      if (artifact !== "COMMITTED.enc" &&
          !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.enc$/.test(artifact))
        fail("ARTIFACT_NOT_ALLOWLISTED");
      return {ok:true, body:rcloneCat(params.path)};
    },
  };
  const report = await verifyRemoteCommittedCiphertext230({
    session, verifyAll:selectedMode[0] === "--all-ciphertext",
  });
  process.stdout.write(JSON.stringify({...roReport,...report}) + "\n");
}

main().catch((error) => {
  const code = typeof error?.message === "string" &&
    /^[A-Z][A-Z0-9_]{2,90}$/.test(error.message)
    ? error.message : "READONLY_PREFLIGHT_FAILED";
  process.stderr.write(code + "\n");
  process.exitCode = 1;
});
