import path from "node:path";
import { dataDir, db } from "../lib/db.ts";
import { bytePlusVerification } from "../lib/live/contract.ts";
import { liveTestConfig } from "../lib/live/config.ts";
import { prepareExistingJob } from "../lib/live/media.ts";
import { LiveTestStore } from "../lib/live/store.ts";

const args = process.argv.slice(2);
function argument(name: string) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}
const jobId = argument("--job"),
  owner = argument("--owner");
try {
  if (!jobId || !owner)
    throw new Error(
      "Usage: npm run byteplus:preflight -- --job <existing-project-id> --owner <owning-session-id> [--confirm-english]. This only prepares local files.",
    );
  const config = liveTestConfig();
  const media = await prepareExistingJob(
    jobId,
    owner,
    config.maxDurationSeconds,
  );
  media.promptLanguageConfirmed = args.includes("--confirm-english");
  const store = new LiveTestStore(path.join(dataDir, "live-test.sqlite"));
  try {
    const attempt = store.prepare(media, null, null);
    console.log(
      JSON.stringify(
        {
          planId: attempt.id,
          status: attempt.state,
          preparedMp3Seconds: media.durationSeconds,
          promptLanguageConfirmed: media.promptLanguageConfirmed,
          verifiedProviderContract: false,
          estimatedProviderCharge: null,
          paidSubmissionEnabled: false,
          blockers: bytePlusVerification.blockers,
        },
        null,
        2,
      ),
    );
  } finally {
    store.close();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Preflight failed.");
  process.exitCode = 1;
} finally {
  db.close();
}
