import { DatabaseSync } from "node:sqlite";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import {
  authorizeOperator,
  enforceCap,
  type LiveTestConfig,
} from "./config.ts";
export type LiveState =
  | "prepared"
  | "authorized"
  | "submitting"
  | "submitted"
  | "processing"
  | "completed"
  | "failed"
  | "uncertain";
export interface PreparedMedia {
  sourceJobId: string;
  owner: string;
  audioPath: string;
  imagePath: string;
  audioSha256: string;
  imageSha256: string;
  durationSeconds: number;
  prompt: string;
  promptLanguageConfirmed: boolean;
}
export interface Attempt {
  id: string;
  media: PreparedMedia;
  contractRevision: string | null;
  upperBoundMicroUsd: number | null;
  state: LiveState;
  providerJobId: string | null;
  outputPath: string | null;
  failureCode: string | null;
  createdAt: number;
  updatedAt: number;
}
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function confirmationPhrase(attempt: Attempt) {
  return `AUTHORIZE ONE PAID BYTEPLUS TEST ${attempt.id} UP TO ${attempt.upperBoundMicroUsd} MICROUSD`;
}
export class LiveTestStore {
  readonly db: DatabaseSync;
  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS live_attempts (
        id TEXT PRIMARY KEY, source_job_id TEXT NOT NULL UNIQUE, data TEXT NOT NULL,
        reserved_micro_usd INTEGER NOT NULL DEFAULT 0,
        token_hash TEXT, expires_at INTEGER, consumed INTEGER NOT NULL DEFAULT 0,
        poll_token TEXT, poll_lease_until INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS live_input_deliveries (
        attempt_id TEXT PRIMARY KEY, manifest TEXT NOT NULL, state TEXT NOT NULL
      );`);
  }
  close() {
    this.db.close();
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  get(id: string): Attempt {
    const row = this.db
      .prepare("SELECT data FROM live_attempts WHERE id=?")
      .get(id) as { data: string } | undefined;
    if (!row) throw new Error("Live-test plan not found.");
    return JSON.parse(row.data);
  }
  private save(attempt: Attempt) {
    attempt.updatedAt = Date.now();
    this.db
      .prepare("UPDATE live_attempts SET data=? WHERE id=?")
      .run(JSON.stringify(attempt), attempt.id);
  }
  prepare(
    media: PreparedMedia,
    contractRevision: string | null,
    upperBound: number | null,
  ): Attempt {
    return this.transaction(() => {
      const row = this.db
        .prepare("SELECT data FROM live_attempts WHERE source_job_id=?")
        .get(media.sourceJobId) as { data: string } | undefined;
      if (row) {
        const prior = JSON.parse(row.data) as Attempt;
        if (
          JSON.stringify(prior.media) !== JSON.stringify(media) ||
          prior.contractRevision !== contractRevision ||
          prior.upperBoundMicroUsd !== upperBound
        )
          throw new Error(
            "Source job already has a different immutable live-test plan.",
          );
        return prior;
      }
      const attempt: Attempt = {
        id: randomUUID(),
        media,
        contractRevision,
        upperBoundMicroUsd: upperBound,
        state: "prepared",
        providerJobId: null,
        outputPath: null,
        failureCode: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.db
        .prepare(
          "INSERT INTO live_attempts (id,source_job_id,data) VALUES (?,?,?)",
        )
        .run(attempt.id, media.sourceJobId, JSON.stringify(attempt));
      return attempt;
    });
  }
  authorize(
    id: string,
    config: LiveTestConfig,
    secret: string,
    phrase: string,
  ): string {
    authorizeOperator(config, secret);
    return this.transaction(() => {
      const attempt = this.get(id);
      enforceCap(
        config,
        attempt.media.durationSeconds,
        attempt.upperBoundMicroUsd,
      );
      if (!attempt.contractRevision)
        throw new Error("A verified contract revision is required.");
      if (
        attempt.state !== "prepared" ||
        phrase !== confirmationPhrase(attempt)
      )
        throw new Error(
          "A fresh plan and exact one-time confirmation are required.",
        );
      const total = (
        this.db
          .prepare(
            "SELECT COALESCE(SUM(reserved_micro_usd),0) AS total FROM live_attempts",
          )
          .get() as { total: number }
      ).total;
      if (total + attempt.upperBoundMicroUsd! > config.maxTotalMicroUsd)
        throw new Error("Total live-test spending cap exceeded.");
      const token = randomBytes(32).toString("hex");
      this.db
        .prepare(
          "UPDATE live_attempts SET reserved_micro_usd=?,token_hash=?,expires_at=? WHERE id=?",
        )
        .run(
          attempt.upperBoundMicroUsd!,
          hash(token),
          Date.now() + 10 * 60_000,
          id,
        );
      attempt.state = "authorized";
      this.save(attempt);
      return token;
    });
  }
  claimSubmission(id: string, token: string, config: LiveTestConfig): Attempt {
    return this.transaction(() => {
      const row = this.db
        .prepare(
          "SELECT token_hash,expires_at,consumed FROM live_attempts WHERE id=?",
        )
        .get(id) as
        | { token_hash: string; expires_at: number; consumed: number }
        | undefined;
      const attempt = this.get(id);
      if (
        !row ||
        row.consumed ||
        row.expires_at <= Date.now() ||
        row.token_hash !== hash(token) ||
        attempt.state !== "authorized"
      )
        throw new Error(
          "Approval expired, invalid or already consumed; never resubmit automatically.",
        );
      if (config.demoMode || !config.enabled)
        throw new Error("Paid provider access is disabled.");
      enforceCap(
        config,
        attempt.media.durationSeconds,
        attempt.upperBoundMicroUsd,
      );
      const total = (
        this.db
          .prepare(
            "SELECT COALESCE(SUM(reserved_micro_usd),0) AS total FROM live_attempts",
          )
          .get() as { total: number }
      ).total;
      if (!Number.isSafeInteger(total) || total > config.maxTotalMicroUsd)
        throw new Error("Total live-test spending cap exceeded.");
      this.db
        .prepare(
          "UPDATE live_attempts SET consumed=1,token_hash=NULL WHERE id=?",
        )
        .run(id);
      attempt.state = "submitting";
      this.save(attempt);
      return attempt;
    });
  }
  assertInputDeliveryAllowed(media: PreparedMedia): string {
    const row = this.db
      .prepare(
        "SELECT id,consumed,reserved_micro_usd FROM live_attempts WHERE source_job_id=?",
      )
      .get(media.sourceJobId) as
      { id: string; consumed: number; reserved_micro_usd: number } | undefined;
    if (!row)
      throw new Error("Private input delivery requires a claimed approval.");
    const attempt = this.get(row.id);
    if (
      attempt.state !== "submitting" ||
      row.consumed !== 1 ||
      row.reserved_micro_usd <= 0 ||
      !attempt.contractRevision ||
      JSON.stringify(attempt.media) !== JSON.stringify(media)
    )
      throw new Error(
        "Private input delivery requires the exact approved media.",
      );
    return attempt.id;
  }
  claimInputDelivery(
    media: PreparedMedia,
    manifest: {
      bucket: string;
      audioKey: string;
      imageKey: string;
      expiresAt: number;
    },
  ) {
    return this.transaction(() => {
      const id = this.assertInputDeliveryAllowed(media);
      if (
        this.db
          .prepare(
            "SELECT attempt_id FROM live_input_deliveries WHERE attempt_id=?",
          )
          .get(id)
      )
        throw new Error(
          "Input delivery already claimed; reconcile instead of uploading again.",
        );
      this.db
        .prepare("INSERT INTO live_input_deliveries VALUES (?,?,?)")
        .run(id, JSON.stringify(manifest), "uploading");
      return id;
    });
  }
  finishInputDelivery(id: string, state: "ready" | "failed") {
    this.db
      .prepare(
        "UPDATE live_input_deliveries SET state=? WHERE attempt_id=? AND state='uploading'",
      )
      .run(state, id);
  }
  removeUnsubmittedOwnerPlans(owner: string) {
    this.transaction(() => {
      const rows = this.db.prepare("SELECT data FROM live_attempts").all() as {
        data: string;
      }[];
      const owned = rows
        .map((row) => JSON.parse(row.data) as Attempt)
        .filter((attempt) => attempt.media.owner === owner);
      if (owned.some((attempt) => attempt.state !== "prepared"))
        throw new Error(
          "Operator reconciliation is required before deleting authorized live-test records.",
        );
      for (const attempt of owned)
        this.db
          .prepare(
            "DELETE FROM live_attempts WHERE id=? AND reserved_micro_usd=0",
          )
          .run(attempt.id);
    });
  }
  claimPoll(id: string): string {
    return this.transaction(() => {
      const attempt = this.get(id);
      if (
        !["submitted", "processing"].includes(attempt.state) ||
        !attempt.providerJobId
      )
        throw new Error(
          "Only a persisted provider job may be polled; uncertain submissions require manual reconciliation.",
        );
      const token = randomUUID();
      const result = this.db
        .prepare(
          "UPDATE live_attempts SET poll_token=?,poll_lease_until=? WHERE id=? AND poll_lease_until<?",
        )
        .run(token, Date.now() + 600_000, id, Date.now());
      if (!result.changes)
        throw new Error("Another worker is polling this attempt.");
      return token;
    });
  }
  releasePoll(id: string, token: string) {
    this.db
      .prepare(
        "UPDATE live_attempts SET poll_token=NULL,poll_lease_until=0 WHERE id=? AND poll_token=?",
      )
      .run(id, token);
  }
  transition(
    id: string,
    state: LiveState,
    patch: Partial<
      Pick<Attempt, "providerJobId" | "outputPath" | "failureCode">
    > = {},
  ) {
    return this.transaction(() => {
      const attempt = this.get(id);
      const allowed: Record<LiveState, LiveState[]> = {
        prepared: [],
        authorized: [],
        submitting: ["submitted", "uncertain"],
        submitted: ["processing", "completed", "failed"],
        processing: ["processing", "completed", "failed"],
        completed: [],
        failed: [],
        uncertain: [],
      };
      if (!allowed[attempt.state].includes(state))
        throw new Error(`Cannot transition ${attempt.state} to ${state}.`);
      if (
        patch.providerJobId !== undefined &&
        (!patch.providerJobId ||
          (attempt.providerJobId &&
            attempt.providerJobId !== patch.providerJobId))
      )
        throw new Error("Provider job ID is immutable.");
      if (state === "submitted" && !patch.providerJobId)
        throw new Error("Missing provider job ID.");
      if (state === "completed" && !patch.outputPath)
        throw new Error("A validated private output is required.");
      Object.assign(attempt, patch, { state });
      this.save(attempt);
      return attempt;
    });
  }
}
