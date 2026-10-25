import { euroBudget } from "./studio-budget.ts";
import {
  contractDigest,
  planUpperBoundMicroUsd,
  type VerifiedContract,
} from "./contract.ts";
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
  | "output_observed"
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
  contractDigest?: string;
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
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS live_attempts (
        id TEXT PRIMARY KEY, source_job_id TEXT NOT NULL UNIQUE, data TEXT NOT NULL,
        reserved_micro_usd INTEGER NOT NULL DEFAULT 0,
        token_hash TEXT, expires_at INTEGER, consumed INTEGER NOT NULL DEFAULT 0,
        poll_token TEXT, poll_lease_until INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS live_input_deliveries (
        attempt_id TEXT PRIMARY KEY, manifest TEXT NOT NULL, state TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS live_contract_reviews (
        attempt_id TEXT PRIMARY KEY, contract_json TEXT NOT NULL, reviewed_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS live_first_test (
        slot INTEGER PRIMARY KEY CHECK(slot=1), attempt_id TEXT NOT NULL,
        digest TEXT NOT NULL, claimed_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS live_second_test (
        slot INTEGER PRIMARY KEY CHECK(slot=2), attempt_id TEXT NOT NULL UNIQUE,
        digest TEXT NOT NULL, claimed_at INTEGER NOT NULL, authorization_digest TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS live_second_authorizations (
        attempt_id TEXT PRIMARY KEY, review_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS live_first_test_results (
        attempt_id TEXT PRIMARY KEY, result_json TEXT NOT NULL, observed_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS live_output_reviews (
        attempt_id TEXT NOT NULL, digest TEXT NOT NULL, review_json TEXT NOT NULL,
        reviewed_at INTEGER NOT NULL, PRIMARY KEY(attempt_id,digest)
      );
      CREATE TABLE IF NOT EXISTS live_operator_actions (
        attempt_id TEXT NOT NULL, action TEXT NOT NULL, state TEXT NOT NULL,
        PRIMARY KEY(attempt_id, action)
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
  /** Trusted reviewed-contract caller only. No environment/file-based verifier. */
  pricePrepared(
    id: string,
    owner: string,
    expectedMedia: PreparedMedia,
    contract: VerifiedContract,
  ) {
    return this.priceReviewedBound(
      id,
      owner,
      expectedMedia,
      contract.revision,
      contractDigest(contract),
      planUpperBoundMicroUsd(expectedMedia.durationSeconds, contract),
      contract,
    );
  }
  /** Server-only exact-case operator review; does not certify a production contract. */
  priceReviewedBound(
    id: string,
    owner: string,
    expectedMedia: PreparedMedia,
    revision: string,
    digest: string,
    cost: number,
    review: unknown,
  ) {
    if (
      !revision ||
      !/^[a-f0-9]{64}$/.test(digest) ||
      !Number.isSafeInteger(cost) ||
      cost <= 0
    )
      throw new Error("Invalid reviewed bound.");
    return this.transaction(() => {
      const attempt = this.get(id);
      const row = this.db
        .prepare(
          "SELECT consumed,reserved_micro_usd FROM live_attempts WHERE id=?",
        )
        .get(id)!;
      if (
        attempt.media.owner !== owner ||
        JSON.stringify(attempt.media) !== JSON.stringify(expectedMedia) ||
        attempt.state !== "prepared" ||
        row.consumed ||
        row.reserved_micro_usd !== 0
      )
        throw new Error(
          "Only the exact owned, unreserved prepared plan may be priced.",
        );
      if (
        attempt.contractRevision !== null ||
        attempt.upperBoundMicroUsd !== null
      ) {
        if (
          attempt.contractRevision !== revision ||
          attempt.contractDigest !== digest ||
          attempt.upperBoundMicroUsd !== cost
        )
          throw new Error(
            "Priced contract is immutable; changed terms require review.",
          );
        return attempt;
      }
      attempt.contractRevision = revision;
      attempt.contractDigest = digest;
      attempt.upperBoundMicroUsd = cost;
      this.db
        .prepare("INSERT INTO live_contract_reviews VALUES (?,?,?)")
        .run(id, JSON.stringify(review), Date.now());
      this.save(attempt);
      return attempt;
    });
  }
  claimFirstTest(id: string, digest: string) {
    this.transaction(() => {
      const row = this.firstTest();
      if (row && (row.attempt_id !== id || row.digest !== digest))
        throw new Error(
          "The single first-test slot is already bound; never reset this ledger.",
        );
      if (!row)
        this.db
          .prepare("INSERT INTO live_first_test VALUES (1,?,?,?)")
          .run(id, digest, Date.now());
    });
  }
  firstTest() {
    return this.db
      .prepare("SELECT * FROM live_first_test WHERE slot=1")
      .get() as
      { attempt_id: string; digest: string; claimed_at: number } | undefined;
  }
  secondTest() {
    return this.db
      .prepare("SELECT * FROM live_second_test WHERE slot=2")
      .get() as
      | {
          attempt_id: string;
          digest: string;
          claimed_at: number;
          authorization_digest: string;
        }
      | undefined;
  }
  testSlot(id: string) {
    const first = this.firstTest();
    if (first?.attempt_id === id) return first;
    const second = this.secondTest();
    return second?.attempt_id === id ? second : undefined;
  }
  firstTestResult(id: string) {
    const row = this.db
      .prepare(
        "SELECT result_json,observed_at FROM live_first_test_results WHERE attempt_id=?",
      )
      .get(id) as { result_json: string; observed_at: number } | undefined;
    return row
      ? { result: JSON.parse(row.result_json), observedAt: row.observed_at }
      : null;
  }
  recordFirstTestResult(id: string, result: unknown) {
    // Called inside transition's poll-fenced transaction via its commit callback.
    this.db
      .prepare(
        "INSERT INTO live_first_test_results VALUES (?,?,?) ON CONFLICT(attempt_id) DO UPDATE SET result_json=excluded.result_json,observed_at=excluded.observed_at",
      )
      .run(id, JSON.stringify(result), Date.now());
  }
  claimCancellation(id: string, lease: string) {
    this.transaction(() => {
      this.assertPollLease(id, lease);
      this.db
        .prepare(
          "INSERT INTO live_operator_actions VALUES (?,'cancel','claimed')",
        )
        .run(id);
    });
  }
  finishCancellation(id: string, state: "done" | "uncertain") {
    this.db
      .prepare(
        "UPDATE live_operator_actions SET state=? WHERE attempt_id=? AND action='cancel'",
      )
      .run(state, id);
  }
  assertPollLease(id: string, token: string) {
    const row = this.db
      .prepare(
        "SELECT poll_token,poll_lease_until FROM live_attempts WHERE id=?",
      )
      .get(id);
    if (
      !row ||
      row.poll_token !== token ||
      Number(row.poll_lease_until) <= Date.now()
    )
      throw new Error(
        "Poll lease expired or replaced; stale worker cannot commit.",
      );
  }
  private studioGuard(attempt: Attempt, config: LiveTestConfig) {
    const studio = attempt.media.sourceJobId.startsWith("studio-");
    const active = this.db
      .prepare(
        `SELECT id FROM live_attempts WHERE id<>? AND json_extract(data,'$.state') IN ('authorized','submitting','submitted','processing','output_observed','uncertain') AND (?=1 OR source_job_id LIKE 'studio-%') LIMIT 1`,
      )
      .get(attempt.id, studio ? 1 : 0);
    if (active) throw new Error("ONE_ACTIVE_GENERATION");
    if (!studio) return config.maxTotalMicroUsd;
    const reserved = Number(
      (
        this.db
          .prepare(
            "SELECT COALESCE(SUM(reserved_micro_usd),0) AS n FROM live_attempts",
          )
          .get() as { n: number }
      ).n,
    );
    return euroBudget(config.eurBudget, reserved, config.maxTotalMicroUsd)
      .usdCapMicro;
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
      const cumulativeCap = this.studioGuard(attempt, config);
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
      if (
        !Number.isSafeInteger(total) ||
        total + attempt.upperBoundMicroUsd! > cumulativeCap
      )
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
      const cumulativeCap = this.studioGuard(attempt, config);
      if (!Number.isSafeInteger(total) || total > cumulativeCap)
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
      accountId: string;
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
  inputDelivery(id: string) {
    const row = this.db
      .prepare(
        "SELECT manifest,state FROM live_input_deliveries WHERE attempt_id=?",
      )
      .get(id) as { manifest: string; state: string } | undefined;
    if (!row) throw new Error("Input delivery not found.");
    return {
      state: row.state,
      manifest: JSON.parse(row.manifest) as {
        accountId: string;
        bucket: string;
        audioKey: string;
        imageKey: string;
        expiresAt: number;
      },
    };
  }
  markInputDeliveryCleaned(id: string) {
    this.db
      .prepare(
        "UPDATE live_input_deliveries SET state='cleaned' WHERE attempt_id=?",
      )
      .run(id);
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
    return this.claimReadLease(id, ["submitted", "processing"]);
  }
  claimOutputDownload(id: string): string {
    return this.claimReadLease(id, ["output_observed", "completed"]);
  }
  recordOutputReview(
    id: string,
    digest: string,
    review: unknown,
    lease: string,
  ) {
    this.transaction(() => {
      this.assertPollLease(id, lease);
      this.db
        .prepare("INSERT OR IGNORE INTO live_output_reviews VALUES (?,?,?,?)")
        .run(id, digest, JSON.stringify(review), Date.now());
    });
  }
  private claimReadLease(id: string, allowed: LiveState[]): string {
    return this.transaction(() => {
      const attempt = this.get(id);
      if (!allowed.includes(attempt.state) || !attempt.providerJobId)
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
    pollToken?: string,
    commitFile?: () => void,
  ) {
    return this.transaction(() => {
      const attempt = this.get(id);
      if (pollToken !== undefined) this.assertPollLease(id, pollToken);
      const allowed: Record<LiveState, LiveState[]> = {
        prepared: [],
        authorized: [],
        submitting: ["submitted", "uncertain"],
        submitted: ["processing", "output_observed", "completed", "failed"],
        processing: ["processing", "output_observed", "completed", "failed"],
        output_observed: ["output_observed", "completed"],
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
      commitFile?.(); // Synchronous atomic rename under the lease-check transaction.
      Object.assign(attempt, patch, { state });
      this.save(attempt);
      return attempt;
    });
  }
}
