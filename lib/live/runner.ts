import { restoreTempoOutput, validateRestored } from "./tempo.ts";
import { providerRequest } from "./timeout.ts";
import path from "node:path";
import { renameSync } from "node:fs";
import { mkdir, unlink, lstat, chmod, copyFile } from "node:fs/promises";
import { enforceCap, type LiveTestConfig } from "./config.ts";
import {
  contractDigest,
  planUpperBoundMicroUsd,
  type VerifiedContract,
} from "./contract.ts";
import { revalidateMedia } from "./media.ts";
import {
  downloadValidatedOutput,
  validateOutput,
  exportContract,
  fitOutputFormat,
} from "./output.ts";
import { type Attempt, type PreparedMedia, LiveTestStore } from "./store.ts";

/** Fixed, non-sensitive download diagnostics. Never persist raw errors, URLs or headers. */
export function outputFailureCode(error: unknown): string {
  if (!(error instanceof Error)) return "OUTPUT_DOWNLOAD_OR_VALIDATION_FAILED";
  const message = error.message;
  const detailCodes = new Set([
    "OUTPUT_FORMAT_INVALID",
    "OUTPUT_STREAM_MISSING",
    "OUTPUT_CODEC_MISMATCH",
    "OUTPUT_DIMENSIONS_MISMATCH",
    "OUTPUT_DURATION_MISMATCH",
    "OUTPUT_FRAMERATE_MISMATCH",
    "OUTPUT_NORMALIZATION_POLICY_REJECTED",
    "OUTPUT_NORMALIZATION_TIMING_FAILED",
    "OUTPUT_NORMALIZATION_AUDIO_CHANGED",
  ]);
  if (detailCodes.has(message)) return message;
  // Accept only bounded numeric dimensions; never expose arbitrary provider errors.
  if (
    /^OUTPUT_DIMENSIONS_MISMATCH_ACTUAL_(?:[1-9]\d{0,3})x(?:[1-9]\d{0,3})_EXPECTED_(?:(?:[1-9]\d{0,3})x(?:[1-9]\d{0,3})|720P)$/.test(
      message,
    )
  ) {
    const values = message.match(/\d+/g)?.map(Number) || [];
    if (values.every((value) => value > 0 && value <= 8192)) return message;
  }

  if (
    message === "Provider output URL is invalid." ||
    message ===
      "Provider output URL is not an approved HTTPS download destination."
  )
    return "OUTPUT_HOST_REJECTED";
  if (message === "Provider output DNS resolution failed or timed out.")
    return "OUTPUT_DNS_FAILED";
  if (
    message === "Provider output connection failed or timed out." ||
    error.name === "TimeoutError" ||
    error.name === "AbortError"
  )
    return "OUTPUT_CONNECTION_FAILED";
  if (
    message ===
      "Provider output HTTP status rejected; redirects are forbidden." ||
    message === "Provider download did not return a complete file."
  )
    return "OUTPUT_HTTP_REJECTED";
  if (
    message.includes("too large") ||
    message.includes("length/encoding") ||
    message === "Provider output length did not match."
  )
    return "OUTPUT_SIZE_REJECTED";
  if (
    message ===
      "Provider MP4 failed duration, dimensions, audio or frame-rate validation." ||
    message === "Output is not a supported MP4 container."
  )
    return "OUTPUT_MP4_VALIDATION_FAILED";
  if (message === "Cannot create private provider output file.")
    return "OUTPUT_STORAGE_FAILED";
  return "OUTPUT_DOWNLOAD_OR_VALIDATION_FAILED";
}

/** Internal normalized interface. No OmniHuman HTTP parameter mapping is implied. */
export interface ReviewedProvider {
  contract: VerifiedContract;
  submit(
    media: PreparedMedia,
    requestKey: string,
    signal: AbortSignal,
  ): Promise<{ jobId: string }>;
  cancelQueued?(jobId: string, signal: AbortSignal): Promise<void>;
  poll(
    jobId: string,
    signal: AbortSignal,
  ): Promise<{ state: "pending" | "completed" | "failed"; outputUrl?: string }>;
}
export class LiveTestRunner {
  readonly store: LiveTestStore;
  readonly provider: ReviewedProvider;
  readonly config: LiveTestConfig;
  readonly outputDirectory: string;
  readonly download: typeof downloadValidatedOutput;
  readonly recoverableOutput: boolean;
  constructor(
    store: LiveTestStore,
    provider: ReviewedProvider,
    config: LiveTestConfig,
    outputDirectory: string,
    download = downloadValidatedOutput,
    recoverableOutput = false,
  ) {
    this.store = store;
    this.provider = provider;
    this.config = config;
    this.outputDirectory = outputDirectory;
    this.download = download;
    this.recoverableOutput = recoverableOutput;
  }
  private assertEnabled(attempt: Attempt) {
    if (this.config.demoMode || !this.config.enabled)
      throw new Error("Paid provider access is disabled in DEMO_MODE.");
    if (
      this.provider.contract.model !== "OmniHuman 2.0" ||
      attempt.contractRevision !== this.provider.contract.revision
    )
      throw new Error("Provider contract changed or is not OmniHuman 2.0.");
    enforceCap(
      this.config,
      attempt.media.durationSeconds,
      attempt.upperBoundMicroUsd,
    );
    if (
      attempt.media.durationSeconds >
        this.provider.contract.maxDurationSeconds ||
      !this.provider.contract.promptSupported
    )
      throw new Error(
        "The reviewed contract does not support this duration or composed prompt.",
      );
    if (
      attempt.contractDigest &&
      attempt.contractDigest !== contractDigest(this.provider.contract)
    )
      throw new Error("Reviewed contract contents changed.");
    if (
      attempt.upperBoundMicroUsd !==
      planUpperBoundMicroUsd(
        attempt.media.durationSeconds,
        this.provider.contract,
      )
    )
      throw new Error("Reviewed provider cost changed.");
  }
  async submitOnce(id: string, oneTimeToken: string) {
    const attempt = this.store.get(id);
    this.assertEnabled(attempt);
    await revalidateMedia(attempt.media);
    this.store.claimSubmission(id, oneTimeToken, this.config);
    try {
      // Exactly one invocation. Even a timeout may have incurred a charge.
      const result = await providerRequest((signal) =>
        this.provider.submit(attempt.media, attempt.id, signal),
      );
      if (!result.jobId || result.jobId.length > 512)
        throw new Error("Missing provider task identifier.");
      return this.store.transition(id, "submitted", {
        providerJobId: result.jobId,
      });
    } catch {
      // Do not persist raw provider errors, signed URLs or credentials.
      return this.store.transition(id, "uncertain", {
        failureCode: "SUBMISSION_OUTCOME_UNKNOWN",
      });
    }
  }
  async pollOnce(id: string): Promise<Attempt> {
    const attempt = this.store.get(id);
    this.assertEnabled(attempt);
    const lease = this.store.claimPoll(id);
    const output = path.join(this.outputDirectory, `${attempt.id}.mp4`);
    const partial = path.join(
      this.outputDirectory,
      `${attempt.id}.${lease}.partial.mp4`,
    );
    const retainedSource = path.join(this.outputDirectory, `${attempt.id}.provider-source.mp4`);
    const finish = (
      state: "processing" | "completed" | "failed",
      patch: Parameters<LiveTestStore["transition"]>[2] = {},
      commit?: () => void,
    ) => this.store.transition(id, state, patch, lease, commit);
    try {
      await mkdir(this.outputDirectory, { recursive: true, mode: 0o700 });
      // Recover a validated final file BEFORE provider polling: its URL/task may
      // have expired after a crash between atomic rename and SQLite commit.
      let recovered = false;
      try {
        const info = await lstat(output);
        if (info.isFile() && !info.isSymbolicLink()) {
          if (attempt.media.tempo) {
            exportStage = "final-tempo-validation";
            await validateRestored(
              output,
              attempt.media,
              exportContract(
                this.provider.contract,
                attempt.media.outputFormat,
              ),
            );
          else
            await validateOutput(
              output,
              attempt.media.durationSeconds,
              exportContract(
                this.provider.contract,
                attempt.media.outputFormat,
              ),
            );
          recovered = true;
        }
      } catch {
        /* Missing/invalid output does not justify a new submission. */
      }
      if (recovered)
        return finish("completed", { outputPath: output, failureCode: null });
      const cached = this.recoverableOutput
        ? this.store.firstTestResult(id)
        : null;
      const result =
        cached && Date.now() - cached.observedAt < 50 * 60000
          ? (cached.result as { state: "completed"; outputUrl: string })
          : await providerRequest((signal) =>
              this.provider.poll(attempt.providerJobId!, signal),
            );
      if (!["pending", "completed", "failed"].includes(result.state))
        throw new Error("Unexpected normalized provider status.");
      if (result.state === "failed")
        return finish("failed", { failureCode: "PROVIDER_JOB_FAILED" });
      if (result.state === "pending") return finish("processing");
      if (!result.outputUrl)
        return finish("failed", { failureCode: "MISSING_OUTPUT" });
      if (
        this.recoverableOutput &&
        (!cached || Date.now() - cached.observedAt >= 50 * 60000)
      )
        finish("processing", {}, () =>
          this.store.recordFirstTestResult(id, result),
        );
      try {
        await this.download(
          result.outputUrl,
          partial,
          attempt.media.durationSeconds,
          this.provider.contract,
        );
        const info = await lstat(partial);
        if (!info.isFile() || info.isSymbolicLink()) throw new Error();
        await chmod(partial, 0o600);
      } catch (error) {
        return finish(this.recoverableOutput ? "processing" : "failed", {
          failureCode: outputFailureCode(error),
        });
      }
      let exportStage = "provider-validation";
      try {
        await validateOutput(
          partial,
          attempt.media.durationSeconds,
          this.provider.contract,
        );
        if (attempt.media.tempo) {
          // Keep one immutable provider response for local recovery/debugging.
          // Do not overwrite an earlier captured source or re-submit the task.
          await copyFile(partial, retainedSource, 1).then(() => chmod(retainedSource, 0o600)).catch((e: NodeJS.ErrnoException) => {
            if (e.code !== "EEXIST") throw e;
          });
          exportStage = "tempo-restoration";
          const restored = partial + ".restored.mp4";
          try {
            await restoreTempoOutput(
              partial,
              restored,
              attempt.media,
              this.provider.contract,
            );
            renameSync(restored, partial);
          } finally {
            await unlink(restored).catch(() => {});
          }
        }
        if (attempt.media.outputFormat) {
          exportStage = "output-format-fit";
          const timingContract = attempt.media.tempo
            ? {
                ...this.provider.contract,
                output: {
                  ...this.provider.contract.output,
                  videoCodec: "h264",
                  audioCodec: "mp3",
                  durationToleranceSeconds: 0.2,
                  maxDurationSeconds:
                    attempt.media.tempo.originalDuration + 0.2,
                },
              }
            : this.provider.contract;
          await fitOutputFormat(
            partial,
            attempt.media.tempo?.originalDuration ??
              attempt.media.durationSeconds,
            timingContract,
            attempt.media.outputFormat,
          );
          if (attempt.media.tempo)
            await validateRestored(
              partial,
              attempt.media,
              exportContract(
                this.provider.contract,
                attempt.media.outputFormat,
              ),
            );
          }
        }
      } catch (error) {
        // Raw FFmpeg stderr, provider URLs and media paths are never logged.
        console.error("STUDIO_EXPORT_STAGE_FAILURE", {
          attemptId: id,
          stage: exportStage,
          category: outputFailureCode(error),
        });
        return finish(this.recoverableOutput ? "processing" : "failed", {
          failureCode: attempt.media.tempo
            ? "TEMPO_RESTORATION_FAILED"
            : "INVALID_OUTPUT",
        });
      }
      return finish(
        "completed",
        { outputPath: output, failureCode: null },
        () => renameSync(partial, output),
      );
    } finally {
      await unlink(partial).catch(() => {});
      this.store.releasePoll(id, lease);
    }
  }
  async cancelOnce(id: string) {
    const attempt = this.store.get(id);
    this.assertEnabled(attempt);
    if (!this.provider.cancelQueued)
      throw new Error("Provider cancellation is not available.");
    const lease = this.store.claimPoll(id);
    try {
      this.store.claimCancellation(id, lease); // Durable before any provider call.
      try {
        await providerRequest((signal) =>
          this.provider.cancelQueued!(attempt.providerJobId!, signal),
        );
      } catch {
        this.store.finishCancellation(id, "uncertain");
        throw new Error(
          "Cancellation outcome unknown; poll the persisted task, never repeat cancellation automatically.",
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
