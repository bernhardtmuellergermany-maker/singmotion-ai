import { providerRequest } from "./timeout.ts";
import path from "node:path";
import { renameSync } from "node:fs";
import { mkdir, unlink, lstat, chmod } from "node:fs/promises";
import { enforceCap, type LiveTestConfig } from "./config.ts";
import {
  contractDigest,
  upperBoundMicroUsd,
  type VerifiedContract,
} from "./contract.ts";
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
      attempt.contractDigest &&
      attempt.contractDigest !== contractDigest(this.provider.contract)
    )
      throw new Error("Reviewed contract contents changed.");
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
    const output = path.join(this.outputDirectory, `${attempt.id}.mp4`);
    const partial = path.join(
      this.outputDirectory,
      `${attempt.id}.${lease}.partial.mp4`,
    );
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
          await validateOutput(
            output,
            attempt.media.durationSeconds,
            this.provider.contract,
          );
          recovered = true;
        }
      } catch {
        /* Missing/invalid output does not justify a new submission. */
      }
      if (recovered) return finish("completed", { outputPath: output });
      const result = await providerRequest((signal) =>
        this.provider.poll(attempt.providerJobId!, signal),
      );
      if (!["pending", "completed", "failed"].includes(result.state))
        throw new Error("Unexpected normalized provider status.");
      if (result.state === "failed")
        return finish("failed", { failureCode: "PROVIDER_JOB_FAILED" });
      if (result.state === "pending") return finish("processing");
      if (!result.outputUrl)
        return finish("failed", { failureCode: "MISSING_OUTPUT" });
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
      } catch {
        return finish("failed", {
          failureCode: "OUTPUT_DOWNLOAD_OR_VALIDATION_FAILED",
        });
      }
      try {
        await validateOutput(
          partial,
          attempt.media.durationSeconds,
          this.provider.contract,
        );
      } catch {
        return finish("failed", { failureCode: "INVALID_OUTPUT" });
      }
      return finish("completed", { outputPath: output }, () =>
        renameSync(partial, output),
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
