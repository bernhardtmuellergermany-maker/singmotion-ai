/** Bounded, explicitly invoked recovery for already acknowledged paid jobs ONLY.
 * Does not submit, cancel, retry or claim BytePlus generation tasks.
 * Dry-run is the default. Execution requires a reviewed output policy digest.
 */
import { createHash } from "node:crypto";
import { readFile, open, unlink } from "node:fs/promises";
import path from "node:path";
import { CommerceStore } from "../lib/commerce/store.ts";
import { dataDir } from "../lib/db.ts";
import { runPaidRecoveryBatch } from "../lib/commerce/paid-recovery-batch.ts";
import { createSignedTransport } from "../lib/live/signed-transport.ts";
import { privateOutputTransport } from "../lib/live/output-transport.ts";
import { outputTransferLimits, validateOutputUrl, type OutputValidationContract } from "../lib/live/output.ts";
import type { Transport } from "../lib/live/byteplus.ts";

export function reviewedPolicy(raw: unknown): OutputValidationContract {
  if (!raw || typeof raw !== "object") throw Error("Output review missing");
  const p = raw as Partial<OutputValidationContract>;
  const o = p.output;
  if (!o || !Array.isArray(p.outputHosts) || p.outputHosts.length < 1 ||
      p.outputHosts.length > 8 || p.outputHosts.some(host =>
        typeof host !== "string" || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host) ||
        host.endsWith(".local") || host.endsWith(".localhost")) ||
      ![o.width,o.height,o.fps,o.maxDurationSeconds].every(x =>
        typeof x === "number" && Number.isSafeInteger(x) && x > 0) ||
      o.width > 4096 || o.height > 4096 || o.fps > 120 ||
      o.maxDurationSeconds! > 300 ||
      typeof o.durationToleranceSeconds !== "number" ||
      !Number.isFinite(o.durationToleranceSeconds) ||
      o.durationToleranceSeconds < 0 || o.durationToleranceSeconds > 2 ||
      !["h264","hevc"].includes(o.videoCodec ?? "") ||
      o.audioCodec !== "aac" || !o.transfer) throw Error("Output review incomplete");
  // The customer delivery contract must be an explicitly reviewed final 720p
  // export, not a discovery policy that accepts arbitrary provider dimensions.
  if (p.discover720p === true ||
      !((o.width === 720 && o.height === 1280) ||
        (o.width === 1280 && o.height === 720)))
    throw Error("Only reviewed 720p customer output is eligible");
  for (const host of p.outputHosts)
    validateOutputUrl(`https://${host}/result.mp4`,[host]);
  outputTransferLimits(p as OutputValidationContract);
  return p as OutputValidationContract;
}

export async function runPaidRecoveryCommand(args: readonly string[], env = process.env) {
  if (args.length === 0 || (args.length === 1 && args[0] === "--dry-run")) {
    const store = new CommerceStore(path.join(dataDir, "commerce.sqlite"));
    try {
      return {mode:"dry-run", acknowledged:store.acknowledgedPaidRecovery(100).length,
        networkRequests:0, generatedTasks:0};
    } finally {store.close();}
  }
  if (args.length !== 5 || args[0] !== "--once" ||
      args[1] !== "--review-file" || args[3] !== "--confirm-sha256" ||
      !/^[a-f0-9]{64}$/.test(args[4])) throw Error("Invalid recovery invocation");
  // Never silently run in Production, even when credentials or flags exist.
  if (env.RAILWAY_ENVIRONMENT_ID !== "dfaeabed-03df-43ed-aa71-50f343a75041")
    throw Error("Recovery execution requires the staging environment");
  const source = await readFile(args[2]);
  if (source.length > 16384 ||
      createHash("sha256").update(source).digest("hex") !== args[4])
    throw Error("Reviewed output policy digest mismatch");
  const policy = reviewedPolicy(JSON.parse(source.toString("utf8")));
  // Exclusive process lock; no overlap and no automatic stale-lock removal.
  const lock = path.join(dataDir,"paid-recovery-execution.lock");
  const handle = await open(lock,"wx",0o600);
  let store: CommerceStore | undefined;
  try {
    store = new CommerceStore(path.join(dataDir,"commerce.sqlite"));
    const signed = createSignedTransport(fetch);
    const statusOnly: Transport = (request, signal) => {
      const url = new URL(request.url);
      if (url.origin !== "https://cv.byteplusapi.com" ||
          url.searchParams.get("Action") !== "CVSync2AsyncGetResult" ||
          request.method !== "POST") throw Error("Recovery status-only barrier");
      return signed(request, signal);
    };
    const results = await runPaidRecoveryBatch(store,dataDir,policy,statusOnly,
      privateOutputTransport,AbortSignal.timeout(540000),10);
    const counts: Record<string,number> = {};
    for(const result of results) counts[result.state]=(counts[result.state]??0)+1;
    return {mode:"once", examined:results.length, outcomes:counts,
      generatedTasks:0};
  } finally {
    store?.close();
    await handle.close();
    await unlink(lock);
  }
}

if (process.argv[1]?.endsWith("paid-recovery-worker.ts")) {
  runPaidRecoveryCommand(process.argv.slice(2))
    .then(result=>process.stdout.write(JSON.stringify(result)+"\n"))
    .catch(()=>{process.stderr.write("Paid recovery stopped safely; inspect review, lock and staging configuration. No generation was submitted.\n");process.exitCode=1;});
}
