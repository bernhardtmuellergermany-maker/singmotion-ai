import { reportedBaseChargeMicroUsd } from "./contract.ts";
import { assertSharedBytePlusInputSeconds } from "../commerce/shared-byteplus-target-policy.ts";
import { superAdminStudioPolicy } from "./super-admin-policy.ts";
import { latestStudioBudget } from "./studio-budget-review.ts";
import { euroBudget, type EuroBudget } from "./studio-budget.ts";
import { reservedUsd, secondReview } from "./second-test.ts";
/** Studio projects use the SAME reservation ledger; operator slots are never touched. */
import { createHash } from "node:crypto";
import path from "node:path";
import {CommerceStore} from "../commerce/store.ts";
import {CreditWallet,type VideoReservation} from "../commerce/credit-wallet.ts";
import {quoteVideoCredits} from "../commerce/video-credit-quote.ts";
import {PlanLedger} from "../commerce/plans.ts";
import { mkdir, realpath, stat, unlink } from "node:fs/promises";
import { LiveTestStore, confirmationPhrase, type Attempt } from "./store.ts";
import { prepareStudioDraft } from "./media.ts";
import { parseStudioDraft, type StudioDraftExport } from "../studio-draft.ts";
import { OperatorWorkflow } from "./operator.ts";
import { type ReviewedProvider } from "./runner.ts";
import { type LiveTestConfig } from "./config.ts";
import { contractDigest } from "./contract.ts";
import { type downloadValidatedOutput } from "./output.ts";
import {
  StudioLiveError,
  studioGate,
  validateStudioPolicy,
  selectStudioPolicy,
  type StudioPolicy,
} from "./studio-policy.ts";
import { BytePlusError } from "./byteplus.ts";
import {
  tempoAuthorization,
  slowExcerpt,
  canApplySlowTempo,
  checkTempoSubmission,
} from "./tempo.ts";
import { pollError } from "./poll-error.ts";
/** Fixed stage diagnostics only. Never print source paths, private media,
 * provider responses or raw exception messages. Keep original error handling. */
async function tracedStudioPrepare<T>(
  stage: "tempo-authorization"|"policy"|"owned-media"|"tempo-validation"|"tempo-encode"|"ledger"|"cost-review",
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    const code=(error as NodeJS.ErrnoException | null)?.code;
    // Fixed diagnostic categories, not raw exception text or file paths.
    const ioError=code==="ENOENT"?"LOCAL_MEDIA_MISSING":
      code==="EACCES"||code==="EPERM"?"STORAGE_PERMISSION_DENIED":
      code==="ENOSPC"?"STORAGE_FULL":
      code==="EIO"?"STORAGE_IO_ERROR":null;
    console.warn("STUDIO_PREPARE_STAGE_FAILURE", {
      stage,
      category: error instanceof StudioLiveError ? error.code :
        ioError ?? "VALIDATION_OR_STORAGE",
    });
    throw error;
  }
}
const policyReviewKey = (p: StudioPolicy) =>
  createHash("sha256")
    .update(
      JSON.stringify([
        contractDigest(p.contract),
        p.reviewedBy,
        p.reviewedAt,
        p.expiresAt,
        p.billingEvidence,
        p.outputEvidence,
      ]),
    )
    .digest("hex");
/** Expose only fixed-format, server-generated diagnostics, never provider URLs or secrets.
 * A terminal failure may still have incurred a BytePlus charge; do not retry.
 */
export function studioFailedProjectStage(
  failureCode: string | null,
  diagnostic: string | null,
): string {
  const safeCode = failureCode && /^[A-Z][A-Z0-9_]{2,79}$/.test(failureCode)
    ? failureCode
    : "FAILED_WITHOUT_CODE";
  const messages: Record<string, string> = {
    PROVIDER_JOB_FAILED: "BytePlus reported a terminal task failure.",
    CONTENT_PREFILTER_REJECTED: "BytePlus rejected the content before generation.",
    MISSING_OUTPUT: "BytePlus marked the task complete without an output URL.",
    INVALID_OUTPUT: "The generated MP4 failed validation.",
    OUTPUT_HOST_REJECTED: "The output URL was rejected by the private download safety check.",
  };
  // Diagnostics from pollError are server-owned, but do not return raw values
  // from legacy records: codes alone suffice to locate the underlying error.
  void diagnostic;
  return `${messages[safeCode] || "The video could not be completed."} [${safeCode}] Do not submit the same paid task again before checking BytePlus billing and status.`;
}
export interface StudioProject {
  id: string;
  hidden: boolean;
  experimental: boolean;
  privateException: boolean;
  overlapExposure: boolean;
  providerJobId: string | null;
  state: Attempt["state"];
  createdAt: number;
  durationSeconds: number;
  prompt: string;
  imageId: string;
  artistName: string;
  projectName: string;
  /** Original Studio draft ID when this render was prepared from a saved project. */
  sourceDraftId?: string | null;
  selection: StudioDraftExport;
  estimatedBaseMicroUsd: number;
  estimatedGeneratedSeconds: number;
  planningUpliftMicroUsd: number | null;
  ceilingMicroUsd: number | null;
  digest: string | null;
  stage: string;
  outputReady: boolean;
  budget: ReturnType<typeof euroBudget> | null;
  budgetBlocker: string | null;
  creditCharge?: {credits:number;status:"estimated"|"reserved"|"review"|"settled"|"released"|"legacy"};
}
interface StudioDependencies {
  ready?: () => Promise<void>;
  policy: () => Promise<StudioPolicy>;
  provider: (policy: StudioPolicy) => ReviewedProvider;
  download?: typeof downloadValidatedOutput;
}
export class StudioWorkflow {
  readonly store: LiveTestStore;
  readonly root: string;
  readonly config: LiveTestConfig;
  readonly dependencies: StudioDependencies;
  readonly superAdmin: boolean;
  readonly requirePrepaidCredits: boolean;
  constructor(
    store: LiveTestStore,
    root: string,
    config: LiveTestConfig,
    dependencies: StudioDependencies,
    superAdmin = false,
    requirePrepaidCredits = false,
  ) {
    this.superAdmin = superAdmin;
    this.requirePrepaidCredits = requirePrepaidCredits;
    this.store = store;
    this.root = root;
    this.config = config;
    this.dependencies = dependencies;
    store.db.exec(
      `CREATE TABLE IF NOT EXISTS live_studio_projects (attempt_id TEXT PRIMARY KEY, owner TEXT NOT NULL, selection_json TEXT NOT NULL, policy_json TEXT NOT NULL, artist_name TEXT NOT NULL, diagnostic TEXT, started_at INTEGER);`,
    );
    const projectColumns = store.db.prepare("PRAGMA table_info(live_studio_projects)").all() as {name:string}[];
    if (!projectColumns.some(column => column.name === "project_name")) store.db.exec("ALTER TABLE live_studio_projects ADD COLUMN project_name TEXT NOT NULL DEFAULT ''");
    store.db.exec(`CREATE TABLE IF NOT EXISTS live_studio_actions (
      id INTEGER PRIMARY KEY, attempt_id TEXT NOT NULL, action TEXT NOT NULL,
      actor TEXT NOT NULL, evidence TEXT NOT NULL, created_at INTEGER NOT NULL
    );`);
  }
  private row(id: string, owner: string) {
    const row = this.store.db
      .prepare(
        "SELECT * FROM live_studio_projects WHERE attempt_id=? AND owner=?",
      )
      .get(id, owner) as
      | {
          selection_json: string;
          policy_json: string;
          artist_name: string;
          project_name: string;
          diagnostic: string | null;
        }
      | undefined;
    if (!row || this.store.get(id).media.owner !== owner)
      throw new StudioLiveError(
        "PROJECT_NOT_FOUND",
        "Private project not found.",
        404,
      );
    return row;
  }
  private budgetReview(policy: StudioPolicy): EuroBudget | undefined {
    const slot = this.store.secondTest();
    return (
      latestStudioBudget(this.store.db) ??
      policy.eurBudget ??
      (slot ? secondReview(this.store, slot.attempt_id) : undefined)
    );
  }
  budget(policy: StudioPolicy) {
    return euroBudget(
      this.budgetReview(policy),
      reservedUsd(this.store),
      this.config.maxTotalMicroUsd,
    );
  }
  async currentBudget() {
    return this.budget(validateStudioPolicy(await this.dependencies.policy()));
  }
  /** Reconcile only an owned, already-bound hold. Unknown provider outcomes
   * retain credits; never deduct from historical uncharged operator projects. */
  private reconcileVideoCredit(id:string,state:string,failureCode?:string|null):VideoReservation|null {
    const store=new CommerceStore(path.join(this.root,"commerce.sqlite"));
    try {
      const wallet=new CreditWallet(store.db);
      if(state==="completed")return wallet.reconcileVideo(id,"completed");
      if(state==="failed"&&failureCode==="CONTENT_PREFILTER_REJECTED")
       return wallet.reconcileVideo(id,"nonbillable");
      if(state==="failed"||state==="uncertain")
       return wallet.reconcileVideo(id,"review");
      return wallet.videoReservation(id);
    }finally{store.close();}
  }
  async withCurrentBudget(project: StudioProject): Promise<StudioProject> {
    if(!this.requirePrepaidCredits)return {...project,budget:null,budgetBlocker:null};
    const attempt=this.store.get(project.id);
    const hold=this.reconcileVideoCredit(project.id,attempt.state,attempt.failureCode);
    const quote=quoteVideoCredits(project.selection.start,project.selection.end);
    const status=hold?hold.state:attempt.state==="prepared"?"estimated":"legacy";
    return { ...project, budget:null, budgetBlocker:null,
      ...(quote?{creditCharge:{credits:hold?.credits??quote.credits,status}}:{})
    };
  }

  view(id: string, owner: string): StudioProject {
    const row = this.row(id, owner),
      a = this.store.get(id);
    const stages: Record<string, string> = {
      prepared:
        "Review the measured audio, prompt and spending ceiling before confirming.",
      authorized:
        "Approval reserved. Submission was interrupted before claiming; operator reconciliation required. Do not create a replacement.",
      submitting: "Submission outcome pending or unknown. Never resubmit.",
      uncertain:
        "Submission outcome unknown. Reservation retained; operator reconciliation required.",
      submitted: "Task accepted; waiting for provider.",
      processing: "Provider processing or output retrieval pending.",
      completed: "Validated private MP4 ready.",
      failed:
        "Provider reported a terminal failure; reservation retained pending billing reconciliation.",
    };
    const savedContract = JSON.parse(row.policy_json)
      .contract as StudioPolicy["contract"];
    const estimatedGeneratedSeconds = Math.min(
      300,
      a.media.durationSeconds +
        (savedContract.generatedDurationBound?.maxAdditionalSeconds || 0),
    );
    const sourceRecord=this.store.db.prepare("SELECT source_job_id FROM live_attempts WHERE id=?")
      .get(id) as {source_job_id:string|null}|undefined;
    // The workflow embeds the opaque Studio draft request key in the
    // idempotency source. Only an exact UUID link is returned: do not merge
    // projects just because they share the same uploaded photo or song.
    const linkedDraft=sourceRecord?.source_job_id?.match(
      /-request-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:$|-review-)/i
    )?.[1]||null;
    const budget = null;
    const budgetBlocker = null;
    return {
      budget,
      budgetBlocker,
      id: a.id,
      providerJobId: a.providerJobId || null,
      privateException: this.hasPrivateException(id, owner),
      overlapExposure: !!this.store.db
        .prepare(
          "SELECT 1 FROM live_private_exceptions e JOIN live_attempts a ON a.id=e.attempt_id WHERE e.owner=? AND json_extract(a.data,'$.state') NOT IN ('completed','failed')",
        )
        .get(owner),
      hidden: !!this.store.db
        .prepare(
          "SELECT 1 FROM live_studio_actions WHERE attempt_id=? AND action='hide'",
        )
        .get(id),
      experimental: !!JSON.parse(row.policy_json).contract.pilotAdmission
        ?.experimental,
      state: a.state,
      createdAt: a.createdAt,
      durationSeconds: a.media.durationSeconds,
      prompt: a.media.prompt,
      imageId: JSON.parse(row.selection_json).imageId,
      artistName: row.artist_name,
      projectName: row.project_name || row.artist_name,
      sourceDraftId:linkedDraft,
      selection: JSON.parse(row.selection_json),
      estimatedGeneratedSeconds,
      estimatedBaseMicroUsd: reportedBaseChargeMicroUsd(
        estimatedGeneratedSeconds,
      ),
      planningUpliftMicroUsd: null,
      ceilingMicroUsd: a.upperBoundMicroUsd,
      digest: a.contractDigest || null,
      stage:
        a.state === "failed"
          ? studioFailedProjectStage(a.failureCode, row.diagnostic)
          : row.diagnostic || stages[a.state] || a.state,
      outputReady: a.state === "completed" && !!a.outputPath,
    };
  }
  list(owner: string) {
    return (
      this.store.db
        .prepare(
          "SELECT attempt_id FROM live_studio_projects WHERE owner=? AND attempt_id NOT IN (SELECT attempt_id FROM live_studio_actions WHERE action='hide') ORDER BY rowid DESC",
        )
        .all(owner) as { attempt_id: string }[]
    ).map((r) => this.view(r.attempt_id, owner));
  }
  private hasPrivateException(id: string, owner: string) {
    return !!this.store.db
      .prepare(
        "SELECT 1 FROM live_private_exceptions WHERE attempt_id=? AND owner=? AND task_id=? AND (task_id='176942047' OR attempt_id IN (SELECT attempt_id FROM live_first_test UNION SELECT attempt_id FROM live_second_test))",
      )
      .get(id, owner, this.store.get(id).providerJobId);
  }
  acknowledgePrivateRisk(
    id: string,
    owner: string,
    actor: string,
    confirmation: unknown,
    verifiedCreditSubject?: string,
  ) {
    const row = this.row(id, owner),
      a = this.store.get(id);
    if (
      a.providerJobId !== "176942047" ||
      !["submitted", "processing", "uncertain"].includes(a.state) ||
      confirmation !== `ACCEPT OVERLAPPING BILLING ${id} 176942047`
    )
      throw new StudioLiveError(
        "RISK_CONFIRMATION_REQUIRED",
        "Explicitly acknowledge the unresolved outcome and overlapping billing for task 176942047. This exception cannot apply to another task.",
      );
    this.store.db
      .prepare(
        "INSERT OR IGNORE INTO live_private_exceptions (attempt_id,task_id,owner,actor,evidence,created_at) VALUES (?,?,?,?,?,?)",
      )
      .run(
        id,
        a.providerJobId,
        owner,
        actor,
        JSON.stringify({
          state: a.state,
          diagnostic: row.diagnostic,
          reservedCeilingMicroUsd: a.upperBoundMicroUsd,
          acknowledgment:
            "Unverified outcome retained; possible concurrent generation and overlapping billing. Full reservation retained within EUR 50.",
          supportEvidence:
            "Operator-reported BytePlus Technical Support: 50510 Content Pre-filter rejection, no generation. Filter disabled by operator; not proof of this task outcome.",
        }),
        Date.now(),
      );
    return this.view(id, owner);
  }
  acknowledgeOperatorRisk(
    id: string,
    owner: string,
    actor: string,
    confirmation: unknown,
  ) {
    const a = this.store.get(id);
    if (
      !actor ||
      !this.store.testSlot(id) ||
      !a.providerJobId ||
      !["submitted", "processing", "uncertain", "output_observed"].includes(
        a.state,
      ) ||
      confirmation !== `ACCEPT OVERLAPPING BILLING ${id} ${a.providerJobId}`
    )
      throw new StudioLiveError(
        "RISK_CONFIRMATION_REQUIRED",
        "Confirm this exact historical operator task and its unresolved billing exposure.",
      );
    this.store.db
      .prepare(
        "INSERT OR IGNORE INTO live_private_exceptions (attempt_id,task_id,owner,actor,evidence,created_at) VALUES (?,?,?,?,?,?)",
      )
      .run(
        id,
        a.providerJobId,
        owner,
        actor,
        JSON.stringify({
          workflow: "operator",
          state: a.state,
          reservedCeilingMicroUsd: a.upperBoundMicroUsd,
          acknowledgment:
            "Outcome unverified; possible overlapping generation and billing. Full reservation retained within EUR 50.",
        }),
        Date.now(),
      );
  }
  private reconcileRetainedOperatorEvidence(id: string, actor: string) {
    if (!this.store.testSlot(id)) return;
    const a = this.store.get(id),
      saved = this.store.firstTestResult(id);
    const result = saved?.result;
    if (
      !a.providerJobId ||
      !["submitted", "processing"].includes(a.state) ||
      result?.taskId !== a.providerJobId ||
      result?.readFailed !== true ||
      result?.sanitizedResult?.code !== 50510
    )
      return;
    // Evidence originates in the first-test poll lease, not a browser request.
    // Keep the original response record; append an audit inside the transition.
    const lease = this.store.db
      .prepare("SELECT poll_lease_until FROM live_attempts WHERE id=?")
      .get(id) as { poll_lease_until: number };
    if (lease.poll_lease_until > Date.now()) return;
    this.store.transition(
      id,
      "failed",
      { failureCode: "CONTENT_PREFILTER_REJECTED" },
      undefined,
      () => {
        if (
          JSON.stringify(this.store.firstTestResult(id)) !==
          JSON.stringify(saved)
        )
          throw new StudioLiveError(
            "EVIDENCE_CHANGED",
            "Provider evidence changed during reconciliation. Retry Start fresh test.",
            409,
          );
        const current = this.store.db
          .prepare("SELECT poll_lease_until FROM live_attempts WHERE id=?")
          .get(id) as { poll_lease_until: number };
        if (current.poll_lease_until > Date.now())
          throw new StudioLiveError(
            "POLL_IN_PROGRESS",
            "Operator recovery is in progress. Retry Start fresh test.",
            409,
          );
        this.store.db
          .prepare(
            "INSERT INTO live_studio_actions (attempt_id,action,actor,evidence,created_at) VALUES (?,'retained-operator-rejection',?,?,?)",
          )
          .run(
            id,
            actor,
            JSON.stringify({
              taskId: a.providerJobId,
              code: 50510,
              responseSha256: createHash("sha256")
                .update(JSON.stringify(result))
                .digest("hex"),
              observedAt: saved!.observedAt,
              semantics:
                "Operator-provided BytePlus Support: 50510 Content Pre-filter rejection, task will not be generated.",
            }),
            Date.now(),
          );
      },
    );
  }
  async freshTest(owner: string, staffActor?: string) {
    // Inspect the entire ledger, including hidden projects and operator slots.
    // Only owning Studio tasks can be polled through this session.
    const active = () =>
      this.store.db
        .prepare(
          "SELECT id FROM live_attempts WHERE json_extract(data,'$.state') IN ('authorized','submitting','submitted','processing','output_observed','uncertain')",
        )
        .all() as { id: string }[];
    if (staffActor)
      for (const { id } of active())
        this.reconcileRetainedOperatorEvidence(id, staffActor);
    for (const { id } of active().slice(0, 20)) {
      const owned = this.store.db
        .prepare(
          "SELECT 1 FROM live_studio_projects WHERE attempt_id=? AND owner=?",
        )
        .get(id, owner);
      const a = this.store.get(id);
      if (
        owned &&
        a.media.owner === owner &&
        ["submitted", "processing"].includes(a.state)
      )
        await this.poll(id, owner); // Read/recover only: never authorize or submit.
    }
    const blockers: {
      projectId: string | null;
      message: string;
      taskId?: string | null;
      state?: string;
      workflow?: string;
      attemptId?: string;
      canAcknowledge?: boolean;
    }[] = active()
      .filter(({ id }) => !this.hasPrivateException(id, owner))
      .map(({ id }) => {
        const owned = this.store.db
          .prepare(
            "SELECT 1 FROM live_studio_projects WHERE attempt_id=? AND owner=?",
          )
          .get(id, owner);
        const a = this.store.get(id);
        const workflow = this.store.testSlot(id)
          ? "operator"
          : a.media.sourceJobId.startsWith("studio-")
            ? "Studio"
            : "private";
        const metadata = staffActor
          ? {
              taskId: a.providerJobId,
              state: a.state,
              workflow,
              attemptId: id,
              canAcknowledge:
                workflow === "operator" &&
                !!a.providerJobId &&
                [
                  "submitted",
                  "processing",
                  "uncertain",
                  "output_observed",
                ].includes(a.state),
            }
          : {};
        if (!owned || a.media.owner !== owner)
          return {
            ...metadata,
            projectId: null,
            message:
              staffActor && workflow === "operator"
                ? "Retained evidence does not establish terminal rejection. Explicitly acknowledge this operator task's possible overlapping generation and billing to continue private Studio testing; its full reservation remains."
                : "Another private or operator task has an unresolved outcome. Its owner must recover or reconcile it; its lock and reservation remain.",
          };
        return {
          ...metadata,
          projectId: id,
          message:
            this.view(id, owner).stage +
            " No new paid test until this task is terminal. Open its recovery page; if BytePlus confirms a terminal outcome, use evidence-backed reconciliation.",
        };
      });
    // This legacy diagnostics view must not require a fresh EUR budget.
    const budget = null;
    return {
      ready: blockers.length === 0,
      blockers,
      budget,
      exceptionExposure: active().some(({ id }) =>
        this.hasPrivateException(id, owner),
      ),
    };
  }
  async deleteProject(id: string, owner: string, confirmation: unknown) {
    this.row(id, owner);
    if (confirmation !== `DELETE ${id}`)
      throw new StudioLiveError("CONFIRMATION_REQUIRED","Confirm permanent deletion of this project.",400);
    const attempt = this.store.get(id);
    if (!["prepared","completed","failed"].includes(attempt.state))
      throw new StudioLiveError("ACTIVE_TASK","Active or uncertain provider jobs cannot be deleted.",409);
    const file = attempt.outputPath;
    // An unsubmitted prepared project has no provider task. Deleting it may
    // safely release its hold, while completed/failed accounting is retained.
    if(this.requirePrepaidCredits&&attempt.state==="prepared"){
      const commerce=new CommerceStore(path.join(this.root,"commerce.sqlite"));
      try{new CreditWallet(commerce.db).reconcileVideo(id,"nonbillable");}
      finally{commerce.close();}
    }
    // Keep billing/authorization ledger and immutable provider task evidence
    // for reconciliation. Remove the owned project from every gallery/list.
    this.store.db.prepare("DELETE FROM live_studio_projects WHERE attempt_id=? AND owner=?").run(id,owner);
    if (file) {
      const outputDir = await realpath(path.join(this.root,"live-output"));
      const candidate = await realpath(file).catch(() => null);
      if (candidate?.startsWith(outputDir + path.sep))
        await unlink(candidate).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
    }
    return { deleted: true };
  }
  hide(id: string, owner: string, actor: string, confirmation: unknown) {
    this.row(id, owner);
    if (confirmation !== `HIDE ${id}`)
      throw new StudioLiveError(
        "CONFIRMATION_REQUIRED",
        "Confirm hiding this exact project.",
      );
    if (!this.view(id, owner).hidden)
      this.store.db
        .prepare(
          "INSERT INTO live_studio_actions (attempt_id,action,actor,evidence,created_at) VALUES (?,'hide',?,'{}',?)",
        )
        .run(id, actor, Date.now());
    return this.view(id, owner);
  }
  reconcile(id: string, owner: string, actor: string, evidence: unknown) {
    this.row(id, owner);
    const e = evidence as Record<string, unknown> | null;
    const a = this.store.get(id);
    if (
      !e ||
      !a.providerJobId ||
      e.taskId !== a.providerJobId ||
      !["rejected", "failed", "canceled"].includes(String(e.outcome)) ||
      typeof e.reference !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9 ._/#:-]{7,199}$/.test(e.reference) ||
      typeof e.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(e.sha256) ||
      e.verified !== true ||
      e.confirmation !== `RECONCILE ${id} ${a.providerJobId}`
    )
      throw new StudioLiveError(
        "EVIDENCE_REQUIRED",
        "Verify provider evidence for this exact task: terminal outcome, support reference, SHA-256 of the retained response and explicit confirmation. A 50510 status-read error alone is insufficient.",
      );
    if (!["submitted", "processing"].includes(a.state))
      throw new StudioLiveError(
        "RECONCILIATION_STATE",
        "Only an accepted task awaiting a final outcome can be reconciled here.",
        409,
      );
    this.store.transition(
      id,
      "failed",
      { failureCode: "STAFF_VERIFIED_TERMINAL" },
      undefined,
      () => {
        const lease = this.store.db
          .prepare("SELECT poll_lease_until FROM live_attempts WHERE id=?")
          .get(id) as { poll_lease_until: number };
        if (lease.poll_lease_until > Date.now())
          throw new StudioLiveError(
            "POLL_IN_PROGRESS",
            "A recovery poll is in progress. Wait for its lease to finish before reconciling.",
            409,
          );
        this.store.db
          .prepare(
            "INSERT INTO live_studio_actions (attempt_id,action,actor,evidence,created_at) VALUES (?,'terminal-reconciliation',?,?,?)",
          )
          .run(
            id,
            actor,
            JSON.stringify({
              taskId: e.taskId,
              outcome: e.outcome,
              reference: e.reference,
              sha256: e.sha256,
            }),
            Date.now(),
          );
      },
    );
    return this.view(id, owner);
  }
  async prepare(
    value: unknown,
    owner: string,
    artistName: unknown,
    consent: unknown,
    english: unknown,
    repeatOf?: unknown,
    requestKey?: unknown,
    projectName?: unknown,
  ) {
    studioGate(this.config);
    if (consent !== true || english !== true)
      throw new StudioLiveError(
        "CONSENT_REQUIRED",
        "Confirm media rights and that the composed prompt is English.",
      );
    const selection = parseStudioDraft(value);
    if (
      selection.owner !== owner ||
      selection.end - selection.start < 5 ||
      selection.end - selection.start > 300
    )
      throw new StudioLiveError(
        "SELECTION_INVALID",
        "Select your own image/audio and an excerpt of 5–300 seconds.",
      );
    const tempo = await tracedStudioPrepare("tempo-authorization", () => tempoAuthorization(
      this.root,
      this.store,
      selection,
      owner,
    ));
    let source = `studio-${createHash("sha256").update(JSON.stringify(selection)).digest("hex")}${tempo ? "-tempo-" + tempo.digest : ""}`;
    if (repeatOf !== undefined) {
      if (typeof repeatOf !== "string")
        throw new StudioLiveError(
          "INVALID_REPEAT",
          "Choose a completed or terminal failed owned project.",
          409,
        );
      const prior = this.row(repeatOf, owner),
        attempt = this.store.get(repeatOf);
      if (
        !["completed", "failed"].includes(attempt.state) ||
        prior.selection_json !== JSON.stringify(selection)
      )
        throw new StudioLiveError(
          "INVALID_REPEAT",
          "Only an explicitly selected terminal project with the same inputs may be reviewed as another test. Uncertain jobs must be reconciled.",
          409,
        );
      source += `-repeat-${repeatOf}`;
    }
    if (requestKey !== undefined) {
      if (
        typeof requestKey !== "string" ||
        !/^[a-zA-Z0-9-]{16,80}$/.test(requestKey)
      )
        throw new StudioLiveError(
          "INVALID_REQUEST_KEY",
          "A valid project request identifier is required.",
        );
      source += `-request-${requestKey}`;
    }
    const originalSource = source;
    const findStarted = () =>
      this.store.db
        .prepare(
          "SELECT id FROM live_attempts WHERE (source_job_id=? OR source_job_id LIKE ?) AND json_extract(data,'$.state')<>'prepared' ORDER BY rowid DESC LIMIT 1",
        )
        .get(originalSource, originalSource + "-review-%") as
        { id: string } | undefined;
    const started = findStarted();
    if (started) {
      this.row(started.id, owner);
      return this.withCurrentBudget(this.view(started.id, owner));
    }
    const old = this.store.db
      .prepare("SELECT id FROM live_attempts WHERE source_job_id=?")
      .get(source) as { id: string } | undefined;
    // Unlimited new projects for every plan. Provider authorization, concurrent
    // work caps, paid seconds, and upload bytes remain independent safeguards.
    const rootPolicy = await tracedStudioPrepare("policy", async () => this.superAdmin
      ? superAdminStudioPolicy(await this.dependencies.policy())
      : validateStudioPolicy(await this.dependencies.policy()));
    let media: Awaited<ReturnType<typeof prepareStudioDraft>>;
    let refreshed = false;
    if (old) {
      const row = this.row(old.id, owner),
        a = this.store.get(old.id);
      if (tempo)
        await tempoAuthorization(
          this.root,
          this.store,
          selection,
          owner,
          a.media.tempo?.originalSha256 ?? a.media.audioSha256,
        );
      // Match the current band to the actual immutable encoded duration, not the
      // requested waveform span. Never reprice or mutate a saved review.
      const current = this.superAdmin ? rootPolicy : selectStudioPolicy(rootPolicy, a.media.durationSeconds);
      const currentDigest = policyReviewKey(current);
      if (policyReviewKey(JSON.parse(row.policy_json)) === currentDigest) {
        if (a.upperBoundMicroUsd === null)
          await this.operator(current).price(a.id, owner);
        return this.withCurrentBudget(this.view(a.id, owner));
      }
      source += `-review-${currentDigest}`;
      refreshed = true;
      media = { ...a.media };
    } else {
      media = await tracedStudioPrepare("owned-media", () => prepareStudioDraft(
        selection,
        owner,
        this.superAdmin ? 300 : Math.min(this.config.maxDurationSeconds, 300),
      ));
    }
    // Check exact trimmed bytes against legacy rejected clips before any tempo change.
    if (tempo) {
      const checked = await tracedStudioPrepare("tempo-validation", () => tempoAuthorization(
        this.root,
        this.store,
        selection,
        owner,
        media.tempo?.originalSha256 ?? media.audioSha256,
      ));
      if (checked?.digest !== tempo.digest)
        throw new StudioLiveError(
          "RECORDING_CHANGED",
          "Recording changed during preparation. Review the current upload again; no paid request was made.",
        );
    }
    // Preserve the full selected clip. A 0.9x slowdown would push long
    // recordings over the documented 300s provider-audio maximum, so
    // retain the original-tempo MP3 rather than truncating or rejecting it.
    const tempoInputCap = this.superAdmin ? 300 : Math.min(this.config.maxDurationSeconds, 300);
    if (tempo && !media.tempo && canApplySlowTempo(media.durationSeconds, tempoInputCap))
      media = await tracedStudioPrepare("tempo-encode", () => slowExcerpt(
        media,
        this.root,
        selection.songId,
        tempo,
        tempoInputCap,
      ));
    // The measured encoded audio, not only the user-selected waveform span,
    // must fit the owner-approved range in both Railway environments.
    assertSharedBytePlusInputSeconds(media.durationSeconds);
    const policy = this.superAdmin ? rootPolicy : selectStudioPolicy(rootPolicy, media.durationSeconds);
    // Recheck after asynchronous preparation: a concurrent approval must win.
    const nowStarted = findStarted();
    if (nowStarted) {
      this.row(nowStarted.id, owner);
      return this.withCurrentBudget(this.view(nowStarted.id, owner));
    }
    const existing = this.store.db
      .prepare("SELECT id FROM live_attempts WHERE source_job_id=?")
      .get(source) as { id: string } | undefined;
    if (existing) {
      this.row(existing.id, owner);
      if (this.store.get(existing.id).upperBoundMicroUsd === null)
        await this.operator(policy).price(existing.id, owner);
      return this.withCurrentBudget(this.view(existing.id, owner));
    }
    media.sourceJobId = source;
    if (selection.outputFormat) media.outputFormat = selection.outputFormat;
    media.promptLanguageConfirmed = true;
    const a = await tracedStudioPrepare("ledger", async () => this.store.prepare(media, null, null));
    this.store.db
      .prepare(
        "INSERT OR IGNORE INTO live_studio_projects (attempt_id,owner,selection_json,policy_json,artist_name,project_name) VALUES (?,?,?,?,?,?)",
      )
      .run(
        a.id,
        owner,
        JSON.stringify(selection),
        JSON.stringify(policy),
        typeof artistName === "string" ? artistName.slice(0, 80) : "My artist",
        typeof projectName === "string" && projectName.trim() ? projectName.trim().slice(0, 100) : typeof artistName === "string" ? artistName.slice(0, 80) : "Untitled Project",
      );
    await tracedStudioPrepare("cost-review", () => this.operator(policy).price(a.id, owner));
    const result = await this.withCurrentBudget(this.view(a.id, owner));
    return refreshed
      ? {
          ...result,
          stage:
            "Policy changed: this is a NEW unapproved review using the current duration band. Previous projects and reservations are preserved. Review the new ceiling and confirm explicitly.",
        }
      : result;
  }
  private operator(policy: StudioPolicy, recovery = false) {
    const config = recovery
      ? {
          ...this.config,
          enabled: true,
          maxDurationSeconds: 300,
          maxJobMicroUsd: Number.MAX_SAFE_INTEGER,
          maxTotalMicroUsd: Number.MAX_SAFE_INTEGER,
        }
      : this.superAdmin
        ? { ...this.config, maxDurationSeconds: 300, eurBudget: undefined }
        : { ...this.config, eurBudget: this.budgetReview(policy) };
    return new OperatorWorkflow(this.store, config, this.root, {
      verifiedContract: () => policy.contract,
      provider: this.dependencies.provider(policy),
      download: this.dependencies.download,
      recoverableOutput: true,
    });
  }
  async submit(
    id: string,
    owner: string,
    digest: unknown,
    ceiling: unknown,
    confirmation: unknown,
    verifiedCreditSubject?: string,
  ) {
    const row = this.row(id, owner),
      a = this.store.get(id);
    studioGate(this.config);
    if (a.state !== "prepared")
      return this.withCurrentBudget(this.view(id, owner)); // Durable idempotency: never authorize or submit again.
    const policy = validateStudioPolicy(JSON.parse(row.policy_json), false),
      current = this.superAdmin
        ? superAdminStudioPolicy(await this.dependencies.policy())
        : selectStudioPolicy(
            validateStudioPolicy(await this.dependencies.policy()),
            a.media.durationSeconds,
          );
    const currentDigest = contractDigest(current.contract),
      savedDigest = contractDigest(policy.contract);
    if (
      currentDigest !== savedDigest ||
      policyReviewKey(current) !== policyReviewKey(policy)
    )
      throw new StudioLiveError(
        "POLICY_CHANGED",
        `Saved review ${policyReviewKey(policy).slice(0, 12)} differs from current review ${policyReviewKey(current).slice(0, 12)} for the ${a.media.durationSeconds.toFixed(3)}s encoded MP3. Click Review real video cost again to create a new unapproved review. No paid request was made.`,
        409,
      );
    if (digest !== a.contractDigest)
      throw new StudioLiveError(
        "REVIEW_DIGEST_CHANGED",
        "The displayed project digest is stale. Click Review real video cost again and explicitly approve the returned review.",
        409,
      );
    if (ceiling !== a.upperBoundMicroUsd)
      throw new StudioLiveError(
        "REVIEW_CEILING_CHANGED",
        "The displayed spending ceiling differs from the saved review. Click Review real video cost again; no reservation or paid request was made.",
        409,
      );
    if (
      !this.superAdmin &&
      confirmation !==
      `CONFIRM PAID STUDIO ${id} ${a.contractDigest} ${a.upperBoundMicroUsd}${policy.contract.pilotAdmission?.experimental ? " ACCEPT EXPERIMENTAL UNKNOWN DURATION FEES MEDIA" : ""}`
    )
      throw new StudioLiveError(
        "EXPLICIT_CONFIRMATION_REQUIRED",
        policy.contract.pilotAdmission?.experimental
          ? "Confirm the experimental review, including unknown duration, fees and media risks. If this repeats, reload Studio to load the current approval form, then review again. No paid request was made."
          : "Confirm this exact reviewed project and spending ceiling before submitting. No paid request was made.",
        409,
      );
    await checkTempoSubmission(
      a.media,
      this.root,
      this.store,
      JSON.parse(row.selection_json),
    );
    await this.dependencies.ready?.();
    // A trusted CMS Super Admin's wallet is required even for private
    // operator tests. A role/owner string from the browser is never an auth key.
    // Reserve BEFORE the first externally billable approval/submission.
    if(this.requirePrepaidCredits){
      if(!this.superAdmin || verifiedCreditSubject!=="super-admin:"+owner.slice("cms-staff-".length)||
         !owner.startsWith("cms-staff-"))
        throw new StudioLiveError("CREDIT_IDENTITY_REQUIRED","Verified account required before generating a paid video.",403);
      const selection=JSON.parse(row.selection_json) as StudioDraftExport;
      const quote=quoteVideoCredits(selection.start,selection.end);
      if(!quote)throw new StudioLiveError("CREDIT_QUOTE_INVALID","Select a valid 5–300-second audio excerpt.",400);
      const commerce=new CommerceStore(path.join(this.root,"commerce.sqlite"));
      try {
        const wallet=new CreditWallet(commerce.db);
        try {wallet.reserveVideo(id,verifiedCreditSubject,quote.credits);}
        catch(error){
          if(error instanceof Error&&error.message==="Insufficient video credits")
           throw new StudioLiveError("INSUFFICIENT_CREDITS",
             "Not enough available Credits. Top up your wallet before generating this video.",402);
          throw error;
        }
      }finally{commerce.close();}
    }
    // STAGING customer entitlements are checked at the last gate before any provider approval.
    // Keep operational staff workflows independent of consumer billing.
    if (!this.superAdmin && owner.startsWith("customer-") &&
        process.env.RAILWAY_ENVIRONMENT_ID === "dfaeabed-03df-43ed-aa71-50f343a75041") {
      const customerStore = new CommerceStore(path.join(this.root, "commerce.sqlite"));
      try {
        const ledger = new PlanLedger(customerStore.db);
        const accountId = owner.slice("customer-".length);
        const plan = ledger.snapshot(accountId);
        if (plan.code !== "hobby")
          throw new StudioLiveError("VIDEO_PLAN_REQUIRED", "Free accounts have no included video seconds. A verified paid purchase or subscription is required.", 402);
        const seconds = Math.ceil(a.media.durationSeconds);
        if (seconds < 5 || seconds > 30)
          throw new StudioLiveError("VIDEO_SECONDS_EXCEEDED", `This video requires ${seconds} seconds; ${plan.secondsRemaining} seconds remain this month.`, 402);
        try { ledger.reserve(accountId, id, seconds); }
        catch { throw new StudioLiveError("VIDEO_SECONDS_EXCEEDED", "Monthly video seconds are already reserved or exhausted.", 402); }
      } finally { customerStore.close(); }
    }
    const workflow = this.operator({ ...policy, eurBudget: current.eurBudget });
    let token:string;
    try {
      token = await workflow.approve(
        id,
        owner,
        this.config.operatorSecret,
        confirmationPhrase(a),
      );
    }catch(error){
      // An approval failure in PREPARED has not started any provider request.
      // The non-billable hold is safe to release only after re-reading the
      // durable provider state; never release if another request progressed.
      if(this.requirePrepaidCredits&&this.store.get(id).state==="prepared"){
        const commerce=new CommerceStore(path.join(this.root,"commerce.sqlite"));
        try{new CreditWallet(commerce.db).reconcileVideo(id,"nonbillable");}
        finally{commerce.close();}
      }
      throw error;
    }
    this.store.db
      .prepare(
        "UPDATE live_studio_projects SET started_at=? WHERE attempt_id=?",
      )
      .run(Date.now(), id);
    // From this point onward the result may be unknown despite an exception:
    // keep its hold until a verified provider outcome and never auto-resubmit.
    await workflow.submit(id, owner, token, this.config.operatorSecret);
    return this.withCurrentBudget(this.view(id, owner));
  }
  private reconcileHobbyUsage(id: string, owner: string, state: string, failureCode?: string | null) {
    if (this.superAdmin || !owner.startsWith("customer-") ||
        process.env.RAILWAY_ENVIRONMENT_ID !== "dfaeabed-03df-43ed-aa71-50f343a75041") return;
    // Never refund unknown provider outcomes: a failed task may still be billable.
    if (state !== "completed" && !(state === "failed" && failureCode === "CONTENT_PREFILTER_REJECTED")) return;
    const accountStore = new CommerceStore(path.join(this.root, "commerce.sqlite"));
    try {
      new PlanLedger(accountStore.db).settle(id, state === "completed");
    } finally { accountStore.close(); }
  }
  async poll(id: string, owner: string) {
    const row = this.row(id, owner),
      a = this.store.get(id);
    if (!["submitted", "processing"].includes(a.state))
      return this.withCurrentBudget(this.view(id, owner));
    // Recovery may continue after new submissions are disabled or policy expires.
    // This path never calls authorize/submit or changes reservation caps.
    const policy = validateStudioPolicy(JSON.parse(row.policy_json), false);
    try {
      await this.operator(policy, true).poll(
        id,
        owner,
        this.config.operatorSecret,
      );
      const failure = this.store.get(id).failureCode;
      this.store.db
        .prepare(
          "UPDATE live_studio_projects SET diagnostic=? WHERE attempt_id=?",
        )
        .run(
          failure === "TEMPO_RESTORATION_FAILED"
            ? "[TEMPO_RESTORATION_FAILED] Original-audio export failed timing, integrity or MP4 validation. No video published. Resume this task after resolving export validation; no replacement paid submission."
            : failure
              ? `[${failure}] Output is not ready. Resume this same task; never generate a replacement automatically.`
              : null,
          id,
        );
    } catch (e) {
      const safe = pollError(e);
      if (
        e instanceof BytePlusError &&
        e.rejection?.taskId === a.providerJobId &&
        e.rejection.code === 50510 &&
        e.rejection.httpStatus === 500
      ) {
        // Only structured task-bound protocol evidence, never a diagnostic string.
        this.store.transition(
          id,
          "failed",
          { failureCode: "CONTENT_PREFILTER_REJECTED" },
          undefined,
          () => {
            const lease = this.store.db
              .prepare("SELECT poll_lease_until FROM live_attempts WHERE id=?")
              .get(id) as { poll_lease_until: number };
            if (lease.poll_lease_until > Date.now())
              throw new StudioLiveError(
                "POLL_IN_PROGRESS",
                "Recovery is in progress; retry this same task.",
                409,
              );
            this.store.db
              .prepare(
                "INSERT INTO live_studio_actions (attempt_id,action,actor,evidence,created_at) VALUES (?,'provider-terminal-rejection','provider',?,?)",
              )
              .run(
                id,
                JSON.stringify({
                  ...e.rejection,
                  priorDiagnostic: row.diagnostic,
                  semantics:
                    "Operator-provided BytePlus Technical Support confirms 50510 pre-filter rejection: task will not be generated.",
                }),
                Date.now(),
              );
          },
        );
      }
      this.store.db
        .prepare(
          "UPDATE live_studio_projects SET diagnostic=? WHERE attempt_id=?",
        )
        .run(safe.message, id);
    }
    const latest = this.store.get(id);
    this.reconcileHobbyUsage(id, owner, latest.state, latest.failureCode);
    if(this.requirePrepaidCredits)this.reconcileVideoCredit(id, latest.state, latest.failureCode);
    return this.withCurrentBudget(this.view(id, owner));
  }
  async output(id: string, owner: string) {
    this.row(id, owner);
    const a = this.store.get(id);
    if (a.state !== "completed" || !a.outputPath)
      throw new StudioLiveError(
        "OUTPUT_NOT_READY",
        "Validated MP4 is not ready.",
        409,
      );
    const base = await realpath(path.join(this.root, "live-output")),
      file = await realpath(a.outputPath);
    if (!file.startsWith(base + path.sep) || !(await stat(file)).isFile())
      throw new StudioLiveError(
        "OUTPUT_PATH_INVALID",
        "Private result is unavailable.",
        503,
      );
    return file;
  }
}
export async function openStudioStore(root: string) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  return new LiveTestStore(path.join(root, "live-test.sqlite"));
}
