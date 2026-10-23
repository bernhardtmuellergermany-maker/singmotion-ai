import { providerRequest } from "./timeout.ts";
import path from "node:path";
import { mkdir, unlink } from "node:fs/promises";
import { enforceCap, type LiveTestConfig } from "./config.ts";
import { upperBoundMicroUsd, type VerifiedContract } from "./contract.ts";
import { revalidateMedia } from "./media.ts";
import { downloadValidatedOutput, validateOutput } from "./output.ts";
import { type Attempt, type PreparedMedia, LiveTestStore } from "./store.ts";

/** Internal normalized interface. No OmniHuman HTTP parameter mapping is implied. */
export interface ReviewedProvider {
  contract: VerifiedContract;
  submit(
    media: PreparedMedia,
    requestKey: string,
    signal: AbortSignal,
  ): Promise<{ jobId: string }>;
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
  constructor(
    store: LiveTestStore,
    provider: ReviewedProvider,
    config: LiveTestConfig,
    outputDirectory: string,
    download = downloadValidatedOutput,
  ) {
    this.store = store;
    this.provider = provider;
    this.config = config;
    this.outputDirectory = outputDirectory;
    this.download = download;
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
      attempt.upperBoundMicroUsd !==
      upperBoundMicroUsd(
        attempt.media.durationSeconds,
        this.provider.contract.billing,
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
    try {
      // A failed read leaves the provider ID intact. Future invocations only poll.
      const result = await providerRequest((signal) =>
        this.provider.poll(attempt.providerJobId!, signal),
      );
      if (!["pending", "completed", "failed"].includes(result.state))
        throw new Error("Unexpected normalized provider status.");
      if (result.state === "failed")
        return this.store.transition(id, "failed", {
          failureCode: "PROVIDER_JOB_FAILED",
        });
      if (result.state === "pending")
        return this.store.transition(id, "processing");
      if (!result.outputUrl)
        return this.store.transition(id, "failed", {
          failureCode: "MISSING_OUTPUT",
        });
      await mkdir(this.outputDirectory, { recursive: true, mode: 0o700 });
      const output = path.join(this.outputDirectory, `${attempt.id}.mp4`);
      try {
        // Recover a crash after a fully validated download without resubmitting.
        await validateOutput(
          output,
          attempt.media.durationSeconds,
          this.provider.contract,
        );
      } catch {
        await unlink(output).catch(() => {});
        try {
          await this.download(
            result.outputUrl,
            output,
            attempt.media.durationSeconds,
            this.provider.contract,
          );
        } catch {
          return this.store.transition(id, "failed", {
            failureCode: "OUTPUT_DOWNLOAD_OR_VALIDATION_FAILED",
          });
        }
      }
      // Validation is mandatory even with an injected downloader in tests.
      try {
        await validateOutput(
          output,
          attempt.media.durationSeconds,
          this.provider.contract,
        );
      } catch {
        await unlink(output).catch(() => {});
        return this.store.transition(id, "failed", {
          failureCode: "INVALID_OUTPUT",
        });
      }
      return this.store.transition(id, "completed", { outputPath: output });
    } finally {
      this.store.releasePoll(id, lease);
    }
  }
}
