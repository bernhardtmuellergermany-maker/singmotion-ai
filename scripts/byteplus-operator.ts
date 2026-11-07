import path from "node:path";
import { dataDir, db } from "../lib/db.ts";
import { LiveTestStore } from "../lib/live/store.ts";
import { liveTestConfig } from "../lib/live/config.ts";
import { assertBytePlusVerified } from "../lib/live/contract.ts";
import { OperatorWorkflow } from "../lib/live/operator.ts";
const [action, ...args] = process.argv.slice(2);
let store: LiveTestStore | undefined;
try {
  if (action !== "review") {
    if (
      !["price", "approve", "submit", "poll", "cancel", "cleanup"].includes(
        action,
      )
    )
      throw new Error(
        "Usage: byteplus:operator review --plan <id> --owner <owner>. Live actions remain blocked.",
      );
    assertBytePlusVerified(); // No flag, file, secret or operator JSON can bypass this.
  }
  if (
    args.length !== 4 ||
    args[0] !== "--plan" ||
    args[2] !== "--owner" ||
    !args[1] ||
    !args[3]
  )
    throw new Error("Review requires --plan <id> --owner <owner>.");
  store = new LiveTestStore(path.join(dataDir, "live-test.sqlite"));
  const attempt = new OperatorWorkflow(store, liveTestConfig(), dataDir).review(
    args[1],
    args[3],
  );
  console.log(
    JSON.stringify(
      {
        planId: attempt.id,
        state: attempt.state,
        durationSeconds: attempt.media.durationSeconds,
        prompt: attempt.media.prompt,
        audioSha256: attempt.media.audioSha256,
        imageSha256: attempt.media.imageSha256,
        contractRevision: attempt.contractRevision,
        contractDigest: attempt.contractDigest ?? null,
        upperBoundMicroUsd: attempt.upperBoundMicroUsd,
        providerJobId: attempt.providerJobId,
        hasPrivateOutput: attempt.outputPath !== null,
        liveSubmissionEnabled: false,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Operator action failed.",
  );
  process.exitCode = 1;
} finally {
  store?.close();
  db.close();
}
