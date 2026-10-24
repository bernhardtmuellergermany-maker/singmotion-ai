/** Explicit, local operator approval; never adds a global provider hostname. */
import path from "node:path";
import { createHash } from "node:crypto";
import { renameSync } from "node:fs";
import { mkdir, realpath, lstat, unlink, chmod } from "node:fs/promises";
import type { FirstTestWorkflow } from "./first-test.ts";
import {
  downloadValidatedOutput,
  validateOutput,
  validateOutputUrl,
  type OutputValidationContract,
} from "./output.ts";
import type { OutputTransport } from "./output-transport.ts";

export const outputHostnameCandidate = Object.freeze({
  hostname: "v16m-default.tiktokcdn.com",
  approved: false,
  source: "Operator-relayed BytePlus Technical Support",
});
export function outputReviewTemplate(
  workflow: FirstTestWorkflow,
  id: string,
  owner: string,
  preparedCostDigest?: string,
) {
  const attempt = workflow.owned(id, owner);
  const preparing =
    attempt.state === "prepared" &&
    !attempt.providerJobId &&
    /^[a-f0-9]{64}$/.test(preparedCostDigest || "");
  if (
    !preparing &&
    (!attempt.providerJobId ||
      !["submitted", "processing", "output_observed", "completed"].includes(
        attempt.state,
      ))
  )
    throw new Error(
      "A persisted provider task is required; uncertain submissions cannot be prepared for retrieval.",
    );
  return {
    kind: "first-test-output-review-v1",
    planId: id,
    taskId: attempt.providerJobId,
    costReviewDigest: preparing ? preparedCostDigest! : attempt.contractDigest,
    hostname: "",
    width: null as number | null,
    height: null as number | null,
    fps: null as number | null,
    minDurationSeconds: null as number | null,
    maxDurationSeconds: null as number | null,
    videoCodec: "",
    audioCodec: "",
    reviewedBy: "",
    reviewedAt: "",
    evidence: "",
    acknowledgment: "",
  };
}
export function reviewOutput(
  workflow: FirstTestWorkflow,
  id: string,
  owner: string,
  value: unknown,
  generatedMax: number,
  preparedCostDigest?: string,
) {
  const template = outputReviewTemplate(
    workflow,
    id,
    owner,
    preparedCostDigest,
  );
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Output approval is missing.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join() !== Object.keys(template).sort().join())
    throw new Error("Unexpected output review fields.");
  const discover = input.kind === "first-test-output-discovery-v1";
  for (const key of ["kind", "planId", "taskId", "costReviewDigest"] as const)
    if (!(key === "kind" && discover) && input[key] !== template[key])
      throw new Error(
        "Output review does not match the persisted task/cost approval.",
      );
  if (
    typeof input.hostname !== "string" ||
    input.hostname.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(input.hostname)
  )
    throw new Error("An exact reviewed DNS hostname is required.");
  validateOutputUrl(`https://${input.hostname}/`, [input.hostname]);
  if (discover && input.minDurationSeconds !== 1)
    throw new Error(
      "Discovery requires a one-second minimum acceptance duration.",
    );
  if (
    discover &&
    (input.width !== null ||
      input.height !== null ||
      input.fps !== null ||
      input.videoCodec !== "" ||
      input.audioCodec !== "")
  )
    throw new Error("Discovery policy must leave unknown metadata unset.");
  for (const key of discover ? [] : ["width", "height"])
    if (
      !Number.isSafeInteger(input[key]) ||
      Number(input[key]) < 1 ||
      Number(input[key]) > 4096
    )
      throw new Error("Review bounded output dimensions.");
  if (
    (!discover &&
      (typeof input.fps !== "number" ||
        !Number.isFinite(input.fps) ||
        input.fps <= 0 ||
        input.fps > 120)) ||
    typeof input.minDurationSeconds !== "number" ||
    !Number.isFinite(input.minDurationSeconds) ||
    input.minDurationSeconds <= 0 ||
    typeof input.maxDurationSeconds !== "number" ||
    !Number.isFinite(input.maxDurationSeconds) ||
    input.maxDurationSeconds < input.minDurationSeconds ||
    input.maxDurationSeconds > generatedMax ||
    (!discover &&
      (!["h264", "hevc"].includes(String(input.videoCodec)) ||
        input.audioCodec !== "aac"))
  )
    throw new Error("Review bounded duration, FPS and supported MP4 codecs.");
  for (const key of ["reviewedBy", "reviewedAt", "evidence"])
    if (
      typeof input[key] !== "string" ||
      !input[key].trim() ||
      input[key].length > 4000
    )
      throw new Error("Output approval provenance is required.");
  if (
    !Number.isFinite(Date.parse(input.reviewedAt as string)) ||
    Date.parse(input.reviewedAt as string) > Date.now() ||
    input.acknowledgment !== "APPROVE_EXACT_HOST_AND_MEDIA_POLICY"
  )
    throw new Error("Explicit dated output approval is required.");
  const review = Object.fromEntries(
    Object.keys(template).map((key) => [key, input[key]]),
  ) as ReturnType<typeof outputReviewTemplate>;
  const duration =
    (review.minDurationSeconds! + review.maxDurationSeconds!) / 2;
  const contract: OutputValidationContract = {
    outputHosts: [review.hostname],
    discover720p: discover,
    output: {
      width: review.width!,
      height: review.height!,
      fps: review.fps!,
      durationToleranceSeconds:
        (review.maxDurationSeconds! - review.minDurationSeconds!) / 2,
      videoCodec: discover ? undefined : review.videoCodec,
      audioCodec: discover ? undefined : review.audioCodec,
    },
  };
  return {
    review,
    digest: createHash("sha256").update(JSON.stringify(review)).digest("hex"),
    duration,
    contract,
  };
}

export async function downloadFirstTestResult(
  workflow: FirstTestWorkflow,
  id: string,
  owner: string,
  costReview: unknown,
  costConfirmation: string,
  outputReview: unknown,
  outputConfirmation: string,
  transport?: OutputTransport,
) {
  if (workflow.env.BYTEPLUS_FIRST_TEST_DOWNLOAD_ENABLED !== "true")
    throw new Error("Operator download gate is disabled.");
  const checked = workflow.authorizeExisting(
    id,
    owner,
    costReview,
    costConfirmation,
  );
  const approval = reviewOutput(
    workflow,
    id,
    owner,
    outputReview,
    checked.review.generatedVideoMaxSeconds!,
  );
  if (outputConfirmation !== approval.digest)
    throw new Error("--confirm-output must match the reviewed output digest.");
  const store = workflow.store,
    lease = store.claimOutputDownload(id);
  let partial: string | undefined;
  try {
    const root = await realpath(workflow.root),
      directory = path.join(root, "live-output");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if ((await realpath(directory)) !== directory)
      throw new Error("Private output directory must not be redirected.");
    const final = path.join(directory, `${id}.${approval.digest}.mp4`);
    partial = path.join(directory, `${id}.${lease}.partial.mp4`);
    store.recordOutputReview(id, approval.digest, approval.review, lease);
    const existing = await lstat(final).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      },
    );
    if (existing) {
      if (!existing.isFile() || existing.isSymbolicLink())
        throw new Error("Unsafe existing output path.");
      // Recover a completed rename before DB commit, even after the URL expires.
      await validateOutput(final, approval.duration, approval.contract);
      store.assertPollLease(id, lease);
      if (checked.attempt.state === "completed") {
        if (checked.attempt.outputPath !== final)
          throw new Error("Completed output approval changed.");
        return store.get(id);
      }
      const prior = store.firstTestResult(id);
      return store.transition(
        id,
        "completed",
        { outputPath: final },
        lease,
        () =>
          store.recordFirstTestResult(id, {
            ...prior?.result,
            downloaded: true,
            outputApprovalDigest: approval.digest,
            approvedHostname: approval.review.hostname,
            hostnameVerified: "operator-reviewed",
            outputPath: final,
          }),
      );
    }
    if (checked.attempt.state === "completed")
      throw new Error(
        "Completed private output is missing; reconcile without overwriting it.",
      );
    const observation = store.firstTestResult(id);
    if (
      observation?.result.taskId !== checked.attempt.providerJobId ||
      typeof observation.result.video_url !== "string"
    )
      throw new Error("No stored output URL for this task.");
    validateOutputUrl(
      observation.result.video_url,
      approval.contract.outputHosts,
    );
    // No provider submit/poll or R2 dependency. Default is the pinned HTTPS transport.
    await downloadValidatedOutput(
      observation.result.video_url,
      partial,
      approval.duration,
      approval.contract,
      transport,
    );
    const info = await lstat(partial);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error("Invalid private output file.");
    await chmod(partial, 0o600);
    await validateOutput(partial, approval.duration, approval.contract);
    return store.transition(
      id,
      "completed",
      { outputPath: final },
      lease,
      () => {
        renameSync(partial!, final);
        store.recordFirstTestResult(id, {
          ...observation.result,
          downloaded: true,
          outputApprovalDigest: approval.digest,
          approvedHostname: approval.review.hostname,
          hostnameVerified: "operator-reviewed",
          outputPath: final,
        });
      },
    );
  } finally {
    if (partial) await unlink(partial).catch(() => {});
    store.releasePoll(id, lease);
  }
}

/** Poll the existing task then download promptly under already confirmed output
 * approval. No submission/upload dependency and no retry on read/transfer errors.
 */
export async function retrieveFirstTestResult(
  workflow: FirstTestWorkflow,
  id: string,
  owner: string,
  costReview: unknown,
  costConfirmation: string,
  outputReview: unknown,
  outputConfirmation: string,
  dependencies: {
    transport?: OutputTransport;
    wait?: () => Promise<void>;
  } = {},
) {
  if (workflow.env.BYTEPLUS_FIRST_TEST_DOWNLOAD_ENABLED !== "true")
    throw new Error("Operator download gate is disabled.");
  const checked = workflow.authorizeExisting(
    id,
    owner,
    costReview,
    costConfirmation,
  );
  const approved = reviewOutput(
    workflow,
    id,
    owner,
    outputReview,
    checked.review.generatedVideoMaxSeconds!,
  );
  if (approved.digest !== outputConfirmation)
    throw new Error("Output confirmation does not match.");
  const slot = workflow.store.firstTest()!;
  while (
    ["submitted", "processing"].includes(workflow.owned(id, owner).state)
  ) {
    if (Date.now() >= slot.claimed_at + 12 * 3600000)
      throw new Error(
        "Task polling lifetime exceeded; reconcile without resubmitting.",
      );
    const result = await workflow.poll(id, owner, costReview, costConfirmation);
    if (["submitted", "processing"].includes(result.state)) {
      if (dependencies.wait) await dependencies.wait();
      else await new Promise((resolve) => setTimeout(resolve, 15000));
    }
  }
  return downloadFirstTestResult(
    workflow,
    id,
    owner,
    costReview,
    costConfirmation,
    outputReview,
    outputConfirmation,
    dependencies.transport,
  );
}
