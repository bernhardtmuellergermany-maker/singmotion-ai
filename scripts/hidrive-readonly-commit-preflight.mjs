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
import { lstat } from "node:fs/promises";
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
      !/^[a-zA-Z0-9_-]{1,64}:(?:[a-zA-Z0-9_-]{1,80}\/)*SingMotion-DR$/.test(value))
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
function rcloneCat(remoteFile) {
  return (async function* () {
    const child = spawn("rclone", [
      "cat", "--config", config,
      "--hidrive-scope-access", "ro",
      "--hidrive-scope-role", "user",
      remoteFile,
    ], {
      stdio: ["ignore", "pipe", "ignore"],
      env: {
        PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
        HOME: "/tmp",
        TMPDIR: "/tmp",
      },
    });
    let spawnError = false;
    child.once("error", () => { spawnError = true; });
    const closed = new Promise((resolve) => child.once("close", resolve));
    try {
      for await (const chunk of child.stdout) yield chunk;
      const code = await closed;
      if (spawnError || code !== 0) fail("HIDRIVE_READ_FAILED");
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
  process.stdout.write(JSON.stringify(report) + "\n");
}

main().catch((error) => {
  const code = typeof error?.message === "string" &&
    /^[A-Z][A-Z0-9_]{2,90}$/.test(error.message)
    ? error.message : "READONLY_PREFLIGHT_FAILED";
  process.stderr.write(code + "\n");
  process.exitCode = 1;
});
