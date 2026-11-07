import { claimSecondTest, isSecondTest } from "./second-test.ts";
import { pollError } from "./poll-error.ts";
import {
  ReviewValidationError,
  type ReviewIssue,
} from "./review-diagnostics.ts";
import { reportedBaseChargeMicroUsd } from "./contract.ts";
/** Isolated operator-only workflow: CLI or authenticated, explicitly gated Payload adapter; never the public worker. */
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
import {
  liveTestConfig,
  authorizeOperator,
  enforceCap,
  type LiveTestConfig,
} from "./config.ts";
import { LiveTestStore, confirmationPhrase, type Attempt } from "./store.ts";
import {
  BytePlusProtocol,
  submitPreparedInputs,
  type Transport,
  type PrivateInputDelivery,
} from "./byteplus.ts";
import { providerRequest } from "./timeout.ts";
import { revalidateMedia } from "./media.ts";
import { validateOutputUrl } from "./output.ts";
import { inputDeliveryPolicy } from "./input-policy.ts";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
export function firstTestReviewTemplate(attempt: Attempt) {
  return {
    kind: "omni20-first-test-v1",
    planId: attempt.id,
    owner: attempt.media.owner,
    audioSha256: attempt.media.audioSha256,
    imageSha256: attempt.media.imageSha256,
    promptSha256: sha(attempt.media.prompt),
    encodedAudioSeconds: attempt.media.durationSeconds,
    generatedVideoMaxSeconds: null as number | null,
    baseMaxMicroUsd: null as number | null,
    taxMaxMicroUsd: null as number | null,
    feesMaxMicroUsd: null as number | null,
    inclusiveMaxMicroUsd: null as number | null,
    reviewedBy: "",
    reviewedAt: "",
    evidence: "",
    acknowledgment: "",
  };
}
export type FirstTestReview = ReturnType<typeof firstTestReviewTemplate>;
export function validateFirstTestReview(value: unknown, attempt: Attempt) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ReviewValidationError([
      { field: "review", message: "Must be a JSON object." },
    ]);
  const template = firstTestReviewTemplate(attempt);
  const input = value as Record<string, unknown>;
  // Aggregate approval is a reviewed upper bound, not a claimed tax/fee breakdown.
  const aggregate =
    input.acknowledgment === "INCLUSIVE_TOTAL_BOUND_FOR_EXACT_INPUT";
  const components = [
    "baseMaxMicroUsd",
    "taxMaxMicroUsd",
    "feesMaxMicroUsd",
  ] as const;
  const issues = new Map<ReviewIssue["field"], ReviewIssue>();
  const invalid = (field: ReviewIssue["field"], message: string) => {
    if (!issues.has(field)) issues.set(field, { field, message });
  };
  for (const field of Object.keys(template) as (keyof FirstTestReview)[])
    if (
      !Object.hasOwn(input, field) ||
      ((!aggregate ||
        !components.includes(field as (typeof components)[number])) &&
        (input[field] === null || input[field] === ""))
    )
      invalid(field, "Required; supply an explicitly reviewed value.");
  if (Object.keys(input).some((key) => !Object.hasOwn(template, key)))
    invalid(
      "review",
      "Unexpected fields are not allowed; use only the template fields.",
    );
  for (const key of [
    "kind",
    "planId",
    "owner",
    "audioSha256",
    "imageSha256",
    "promptSha256",
    "encodedAudioSeconds",
  ] as const)
    if (input[key] !== template[key])
      invalid(key, "Must match the existing prepared plan exactly.");
  if (
    !Number.isFinite(attempt.media.durationSeconds) ||
    attempt.media.durationSeconds < 4 ||
    attempt.media.durationSeconds > 5
  )
    invalid(
      "encodedAudioSeconds",
      "Prepared audio must measure between four and five seconds; prepare a new plan rather than editing this field.",
    );
  const money = [
    "baseMaxMicroUsd",
    "taxMaxMicroUsd",
    "feesMaxMicroUsd",
    "inclusiveMaxMicroUsd",
  ] as const;
  if (aggregate)
    for (const key of components)
      if (input[key] !== null)
        invalid(
          key,
          "Leave the unverified breakdown null in total-bound mode.",
        );
  for (const key of aggregate ? (["inclusiveMaxMicroUsd"] as const) : money)
    if (!Number.isSafeInteger(input[key]) || Number(input[key]) < 0)
      invalid(
        key,
        "Must be an explicitly reviewed nonnegative safe integer in microUSD; no default is supplied.",
      );
  const videoMax = input.generatedVideoMaxSeconds;
  const validVideo =
    typeof videoMax === "number" &&
    Number.isFinite(videoMax) &&
    videoMax >= attempt.media.durationSeconds &&
    videoMax <= 6;
  if (!validVideo)
    invalid(
      "generatedVideoMaxSeconds",
      "Must be a finite number covering the exact prepared input duration and no greater than six seconds.",
    );
  if (
    !aggregate &&
    validVideo &&
    !issues.has("baseMaxMicroUsd") &&
    Number(input.baseMaxMicroUsd) < reportedBaseChargeMicroUsd(videoMax)
  )
    invalid(
      "baseMaxMicroUsd",
      "Must cover the reported base charge for the reviewed generated-video bound.",
    );
  if (
    aggregate &&
    validVideo &&
    (!Number.isSafeInteger(input.inclusiveMaxMicroUsd) ||
      Number(input.inclusiveMaxMicroUsd) < reportedBaseChargeMicroUsd(videoMax))
  )
    invalid(
      "inclusiveMaxMicroUsd",
      "Inclusive total must cover the reported base charge for the reviewed video bound and all account-specific charges.",
    );
  if (
    !aggregate &&
    money.every(
      (key) => Number.isSafeInteger(input[key]) && Number(input[key]) >= 0,
    )
  ) {
    const total =
      BigInt(input.baseMaxMicroUsd as number) +
      BigInt(input.taxMaxMicroUsd as number) +
      BigInt(input.feesMaxMicroUsd as number);
    if (total <= 0n || total !== BigInt(input.inclusiveMaxMicroUsd as number))
      invalid(
        "inclusiveMaxMicroUsd",
        "Must be positive and equal baseMaxMicroUsd + taxMaxMicroUsd + feesMaxMicroUsd without overflow.",
      );
  }
  for (const key of ["reviewedBy", "reviewedAt", "evidence"] as const)
    if (
      typeof input[key] !== "string" ||
      !input[key].trim() ||
      input[key].length > 4000
    )
      invalid(
        key,
        "Must be nonblank text of at most 4000 characters; supply reviewed information, not a placeholder.",
      );
  if (
    !issues.has("reviewedAt") &&
    (!Number.isFinite(Date.parse(input.reviewedAt as string)) ||
      Date.parse(input.reviewedAt as string) > Date.now())
  )
    invalid(
      "reviewedAt",
      "Must be a valid review date that is not in the future.",
    );
  if (!aggregate && input.acknowledgment !== "INCLUSIVE_BOUND_FOR_EXACT_INPUT")
    invalid(
      "acknowledgment",
      "Must explicitly equal INCLUSIVE_BOUND_FOR_EXACT_INPUT after review.",
    );
  if (issues.size) throw new ReviewValidationError([...issues.values()]);
  // Fixed field order: equivalent JSON formatting does not invalidate confirmation.
  const review = Object.fromEntries(
    Object.keys(template).map((key) => [key, input[key]]),
  ) as FirstTestReview;
  return {
    review,
    digest: sha(JSON.stringify(review)),
    cost: Number(review.inclusiveMaxMicroUsd),
  };
}
export function firstTestConfig(
  env: Record<string, string | undefined>,
  planId: string,
): LiveTestConfig {
  if (
    env.BYTEPLUS_FIRST_TEST_ENABLED !== "true" ||
    env.BYTEPLUS_FIRST_TEST_PLAN_ID !== planId ||
    env.BYTEPLUS_LIVE_TEST_ENABLED !== "true" ||
    env.DEMO_MODE !== "true" ||
    env.GENERATIONS_ENABLED !== "false" ||
    env.ADMIN_DEMO_ENABLED !== "false"
  )
    throw new Error(
      "First-test gates require an exact plan and a disabled public demo-only application.",
    );
  // Isolated operator permission only. Never mutate process.env or public app config.
  const config = liveTestConfig({ ...env, DEMO_MODE: "false" });
  if (config.maxDurationSeconds < 4 || config.maxDurationSeconds > 5)
    throw new Error("First-test duration cap must be four or five seconds.");
  authorizeOperator(config, env.BYTEPLUS_LIVE_TEST_OPERATOR_SECRET || "");
  return config;
}

/** Positive allowlist projection: never retain arbitrary provider messages, headers or echoed inputs. */
export function sanitizeFirstTestResult(body: unknown) {
  const raw =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const data =
    raw.data && typeof raw.data === "object"
      ? (raw.data as Record<string, unknown>)
      : {};
  return {
    code: Number.isSafeInteger(raw.code) ? raw.code : null,
    request_id:
      typeof raw.request_id === "string" &&
      /^[\w-]{1,128}$/.test(raw.request_id)
        ? raw.request_id
        : null,
    data: {
      status: [
        "in_queue",
        "generating",
        "done",
        "not_found",
        "expired",
        "canceled",
      ].includes(String(data.status))
        ? data.status
        : null,
      // Deliberately retained only after safe URL syntax validation. This is a
      // private bearer capability, not a credential or an approved destination.
      ...(typeof data.video_url === "string"
        ? { video_url: observationUrl(data.video_url).href }
        : {}),
    },
  };
}
function observationUrl(raw: string) {
  if (raw.length > 8192 || /[\x00-\x20\x7f]/.test(raw))
    throw new Error("Invalid observed output URL.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid observed output URL.");
  }
  // Syntax only. No DNS, GET, allowlist mutation or trust in this hostname.
  return validateOutputUrl(raw, [url.hostname]);
}

export class FirstTestWorkflow {
  readonly store: LiveTestStore;
  readonly root: string;
  readonly env: Record<string, string | undefined>;
  readonly transport: Transport;
  readonly delivery: PrivateInputDelivery;
  readonly inputHosts: readonly string[];
  constructor(
    store: LiveTestStore,
    root: string,
    env: Record<string, string | undefined>,
    transport: Transport,
    delivery: PrivateInputDelivery,
    inputHosts: readonly string[],
  ) {
    this.store = store;
    this.root = root;
    this.env = env;
    this.transport = transport;
    this.delivery = delivery;
    this.inputHosts = inputHosts;
  }
  owned(id: string, owner: string) {
    const attempt = this.store.get(id);
    if (attempt.media.owner !== owner) throw new Error("Owned plan not found.");
    return attempt;
  }
  async dryRun(id: string, owner: string, review?: unknown) {
    const attempt = this.owned(id, owner);
    const root = await realpath(path.join(this.root, "media"));
    for (const file of [attempt.media.audioPath, attempt.media.imagePath])
      if (!(await realpath(file)).startsWith(root + path.sep))
        throw new Error("Snapshots must remain in private storage.");
    await revalidateMedia(attempt.media);
    const priced =
      review === undefined ? null : validateFirstTestReview(review, attempt);
    return {
      planId: id,
      state: attempt.state,
      encodedAudioSeconds: attempt.media.durationSeconds,
      prompt: attempt.media.prompt,
      review: priced?.review ?? firstTestReviewTemplate(attempt),
      confirmationDigest: priced?.digest ?? null,
      inclusiveMaxMicroUsd: priced?.cost ?? null,
      networkRequests: 0,
      automaticDownload: false,
      publicLiveGeneration: false,
    };
  }
  private gate(
    id: string,
    owner: string,
    review: unknown,
    confirmation: string,
    requireBinding = true,
  ) {
    const attempt = this.owned(id, owner),
      config = firstTestConfig(this.env, id);
    const checked = validateFirstTestReview(review, attempt);
    if (confirmation !== checked.digest)
      throw new Error(
        "--confirm-live-test must match the reviewed dry-run digest.",
      );
    enforceCap(config, attempt.media.durationSeconds, checked.cost);
    if (requireBinding) {
      const slot = this.store.testSlot(id);
      if (
        !slot ||
        slot.attempt_id !== id ||
        slot.digest !== checked.digest ||
        attempt.contractDigest !== checked.digest ||
        attempt.upperBoundMicroUsd !== checked.cost
      )
        throw new Error("First-test review or durable slot does not match.");
    }
    return { attempt, config, ...checked };
  }
  authorizeExisting(
    id: string,
    owner: string,
    review: unknown,
    confirmation: string,
  ) {
    return this.gate(id, owner, review, confirmation);
  }
  async refreshResult(
    id: string,
    owner: string,
    review: unknown,
    confirmation: string,
  ) {
    const { attempt } = this.gate(id, owner, review, confirmation);
    if (attempt.state !== "output_observed")
      throw new Error("Only an observed task result may be refreshed.");
    const lease = this.store.claimOutputDownload(id);
    try {
      let sanitized: ReturnType<typeof sanitizeFirstTestResult> | null = null;
      const protocol = new BytePlusProtocol(async (request, signal) => {
        const response = await this.transport(request, signal);
        sanitized = sanitizeFirstTestResult(response.body);
        return response;
      });
      const result = await providerRequest((signal) =>
        protocol.status(attempt.providerJobId!, signal),
      );
      if (result.status !== "done")
        throw new Error(
          "Output refresh unavailable; no resubmission is allowed.",
        );
      const url = observationUrl(result.outputUrl!);
      return this.store.transition(id, "output_observed", {}, lease, () =>
        this.store.recordFirstTestResult(id, {
          taskId: attempt.providerJobId,
          sanitizedResult: sanitized,
          video_url: url.href,
          observedHostname: url.hostname,
          hostnameVerified: false,
          downloaded: false,
        }),
      );
    } finally {
      this.store.releasePoll(id, lease);
    }
  }
  async submit(
    id: string,
    owner: string,
    review: unknown,
    confirmation: string,
  ) {
    const checked = this.gate(id, owner, review, confirmation, false);
    await this.dryRun(id, owner, review); // Revalidate immutable bytes before reservation.
    if (this.owned(id, owner).state !== "prepared")
      throw new Error(
        "Never repeat first-test submission; resume a persisted task or reconcile uncertainty.",
      );
    if (isSecondTest(checked.attempt)) {
      if (
        this.env.BYTEPLUS_SECOND_TEST_ENABLED !== "true" ||
        this.env.BYTEPLUS_SECOND_TEST_PLAN_ID !== id
      )
        throw new Error(
          "Separate second-test server authorization is required.",
        );
      const budget = claimSecondTest(
        this.store,
        id,
        checked.digest,
        checked.cost,
      );
      checked.config.maxTotalMicroUsd = Math.min(
        checked.config.maxTotalMicroUsd,
        budget.usdCapMicro,
      );
    } else this.store.claimFirstTest(id, checked.digest); // Original singleton is never reset.
    const priced = this.store.priceReviewedBound(
      id,
      owner,
      checked.attempt.media,
      "operator-first-test-v1",
      checked.digest,
      checked.cost,
      checked.review,
    );
    const token = this.store.authorize(
      id,
      checked.config,
      checked.config.operatorSecret,
      confirmationPhrase(priced),
    );
    this.store.claimSubmission(id, token, checked.config); // Durable before R2 or BytePlus.
    try {
      const result = await providerRequest((signal) =>
        submitPreparedInputs(
          priced.media,
          this.delivery,
          this.inputHosts,
          inputDeliveryPolicy.minimumRemainingSeconds,
          new BytePlusProtocol(this.transport),
          signal,
        ),
      );
      return this.store.transition(id, "submitted", {
        providerJobId: result.jobId,
      });
    } catch {
      return this.store.transition(id, "uncertain", {
        failureCode: "SUBMISSION_OUTCOME_UNKNOWN",
      });
    }
  }
  async poll(id: string, owner: string, review: unknown, confirmation: string) {
    const { attempt } = this.gate(id, owner, review, confirmation);
    if (["output_observed", "completed", "failed"].includes(attempt.state))
      return attempt;
    let lease: string;
    try {
      lease = this.store.claimPoll(id);
    } catch (error) {
      throw pollError(error);
    }
    let sanitized: ReturnType<typeof sanitizeFirstTestResult> | null = null;
    try {
      const protocol = new BytePlusProtocol(async (request, signal) => {
        const response = await this.transport(request, signal);
        sanitized = sanitizeFirstTestResult(response.body);
        return response;
      });
      const status = await providerRequest((signal) =>
        protocol.status(attempt.providerJobId!, signal),
      );
      const done = status.status === "done";
      const pending =
        status.status === "in_queue" || status.status === "generating";
      const output = done ? observationUrl(status.outputUrl!) : null;
      return this.store.transition(
        id,
        done ? "output_observed" : pending ? "processing" : "failed",
        { failureCode: pending || done ? null : "PROVIDER_TERMINAL_FAILURE" },
        lease,
        () =>
          this.store.recordFirstTestResult(id, {
            taskId: attempt.providerJobId,
            sanitizedResult: sanitized,
            video_url: output?.href ?? null,
            observedHostname: output?.hostname ?? null,
            hostnameVerified: false,
            downloaded: false,
          }),
      );
    } catch (error) {
      // Read failure never means task failure/refund. Persist only safe evidence;
      // keep the same task ID and allow an explicitly resumed read.
      if (sanitized)
        this.store.transition(id, "processing", {}, lease, () =>
          this.store.recordFirstTestResult(id, {
            taskId: attempt.providerJobId,
            sanitizedResult: sanitized,
            readFailed: true,
          }),
        );
      throw pollError(error);
    } finally {
      this.store.releasePoll(id, lease);
    }
  }
  async cancel(
    id: string,
    owner: string,
    review: unknown,
    confirmation: string,
  ) {
    const { attempt } = this.gate(id, owner, review, confirmation);
    const lease = this.store.claimPoll(id);
    try {
      this.store.claimCancellation(id, lease);
      try {
        await providerRequest((signal) =>
          new BytePlusProtocol(this.transport).cancelQueued(
            attempt.providerJobId!,
            signal,
          ),
        );
      } catch {
        this.store.finishCancellation(id, "uncertain");
        throw new Error(
          "Cancellation uncertain; resume polling, never repeat cancellation automatically.",
        );
      }
      this.store.finishCancellation(id, "done");
      return this.store.transition(
        id,
        "failed",
        { failureCode: "PROVIDER_TASK_CANCELED" },
        lease,
      );
    } finally {
      this.store.releasePoll(id, lease);
    }
  }
}
