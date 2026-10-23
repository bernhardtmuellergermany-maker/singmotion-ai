import path from "node:path";
import { dataDir, db } from "../lib/db.ts";
import { bytePlusVerification } from "../lib/live/contract.ts";
import { liveTestConfig } from "../lib/live/config.ts";
import { prepareExistingJob, prepareStudioDraft } from "../lib/live/media.ts";
import { readDraftFile, writeOfflineReview } from "../lib/live/review.ts";
import { LiveTestStore } from "../lib/live/store.ts";

const args = process.argv.slice(2);
function argument(name: string) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}
const jobId = argument("--job"),
  owner = argument("--owner"),
  draftFile = argument("--draft");
try {
  if ((!jobId && !draftFile) || (jobId && draftFile) || !owner)
    throw new Error(
      "Usage: npm run byteplus:preflight -- (--job <existing-project-id> | --draft <studio-export.json>) --owner <owning-session-id> [--confirm-english]. This only prepares local files.",
    );
  const config = liveTestConfig();
  const media = draftFile
    ? await prepareStudioDraft(
        await readDraftFile(draftFile),
        owner,
        config.maxDurationSeconds,
      )
    : await prepareExistingJob(jobId!, owner, config.maxDurationSeconds);
  media.promptLanguageConfirmed = args.includes("--confirm-english");
  const store = new LiveTestStore(path.join(dataDir, "live-test.sqlite"));
  try {
    const attempt = store.prepare(media, null, null);
    const reviewFile = draftFile
      ? await writeOfflineReview(attempt, dataDir)
      : undefined;
    console.log(
      JSON.stringify(
        {
          planId: attempt.id,
          ...(reviewFile ? { reviewFile } : {}),
          status: attempt.state,
          preparedMp3Seconds: media.durationSeconds,
          review: {
            audioSha256: media.audioSha256,
            imageSha256: media.imageSha256,
            composedPrompt: media.prompt,
          },
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
