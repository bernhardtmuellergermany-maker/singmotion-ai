#!/usr/bin/env node
/**
 * Operator-run, offline, no-network preflight from two directly browser
 * downloaded encrypted HiDrive objects. Never prints contents or file paths.
 */
import { verifyLocalHiDriveReceiptManifest230 } from "../lib/ops/hidrive-local-receipt-verifier.mjs";

async function main() {
  if (process.argv.length !== 4 ||
      (process.getuid && process.getuid() === 0) ||
      process.env.RAILWAY_PROJECT_ID === "96ab3402-f974-4cdf-b9a3-408443b17025" ||
      ["36adc41d-7e54-4396-ad1a-fd432ba0441d","dfaeabed-03df-43ed-aa71-50f343a75041"].includes(process.env.RAILWAY_ENVIRONMENT_ID))
    throw Error("INDEPENDENT_NONROOT_INPUTS_REQUIRED");
  const report=await verifyLocalHiDriveReceiptManifest230({
    receiptPath:process.argv[2],manifestPath:process.argv[3],
  });
  process.stdout.write(JSON.stringify(report)+"\n");
}
main().catch(e=>{
  const code=typeof e?.message==="string" &&
    /^[A-Z][A-Z0-9_]{2,90}$/.test(e.message)
    ? e.message : "LOCAL_MANIFEST_PREFLIGHT_FAILED";
  process.stderr.write(code+"\n");
  process.exitCode=1;
});
