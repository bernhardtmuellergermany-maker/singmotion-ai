import { euroBudget, type EuroBudget } from "./studio-budget.ts";
import { reservedUsd, secondReview } from "./second-test.ts";
/** Studio projects use the SAME reservation ledger; operator slots are never touched. */
import { createHash } from "node:crypto";
import path from "node:path";
import { mkdir, realpath, stat } from "node:fs/promises";
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
import { pollError } from "./poll-error.ts";
export interface StudioProject {
  id: string;
  state: Attempt["state"];
  createdAt: number;
  durationSeconds: number;
  prompt: string;
  imageId: string;
  artistName: string;
  selection: StudioDraftExport;
  estimatedBaseMicroUsd: number;
  planningUpliftMicroUsd: number | null;
  ceilingMicroUsd: number | null;
  digest: string | null;
  stage: string;
  outputReady: boolean;
  budget: ReturnType<typeof euroBudget> | null;
  budgetBlocker: string | null;
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
  constructor(
    store: LiveTestStore,
    root: string,
    config: LiveTestConfig,
    dependencies: StudioDependencies,
  ) {
    this.store = store;
    this.root = root;
    this.config = config;
    this.dependencies = dependencies;
    store.db.exec(
      `CREATE TABLE IF NOT EXISTS live_studio_projects (attempt_id TEXT PRIMARY KEY, owner TEXT NOT NULL, selection_json TEXT NOT NULL, policy_json TEXT NOT NULL, artist_name TEXT NOT NULL, diagnostic TEXT, started_at INTEGER);`,
    );
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
  async withCurrentBudget(project: StudioProject): Promise<StudioProject> {
    try {
      return {
        ...project,
        budget: await this.currentBudget(),
        budgetBlocker: null,
      };
    } catch {
      return {
        ...project,
        budget: null,
        budgetBlocker:
          "EUR 50 conversion/fee or policy review is missing or expired. Existing task recovery remains available.",
      };
    }
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
    let budget: ReturnType<typeof euroBudget> | null = null,
      budgetBlocker: string | null = null;
    try {
      budget = this.budget(JSON.parse(row.policy_json));
    } catch {
      budgetBlocker =
        "EUR 50 conversion/fee review is missing or expired. No paid submission until reviewed.";
    }
    return {
      budget,
      budgetBlocker,
      id: a.id,
      state: a.state,
      createdAt: a.createdAt,
      durationSeconds: a.media.durationSeconds,
      prompt: a.media.prompt,
      imageId: JSON.parse(row.selection_json).imageId,
      artistName: row.artist_name,
      selection: JSON.parse(row.selection_json),
      estimatedBaseMicroUsd: Math.ceil(a.media.durationSeconds * 70000),
      planningUpliftMicroUsd: JSON.parse(row.policy_json).contract
        .pilotAdmission
        ? Math.ceil(a.media.durationSeconds * 70000 * 1.19)
        : null,
      ceilingMicroUsd: a.upperBoundMicroUsd,
      digest: a.contractDigest || null,
      stage: row.diagnostic || stages[a.state] || a.state,
      outputReady: a.state === "completed" && !!a.outputPath,
    };
  }
  list(owner: string) {
    return (
      this.store.db
        .prepare(
          "SELECT attempt_id FROM live_studio_projects WHERE owner=? ORDER BY rowid DESC",
        )
        .all(owner) as { attempt_id: string }[]
    ).map((r) => this.view(r.attempt_id, owner));
  }
  async prepare(
    value: unknown,
    owner: string,
    artistName: unknown,
    consent: unknown,
    english: unknown,
    repeatOf?: unknown,
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
      selection.end - selection.start < 4 ||
      selection.end - selection.start > 60
    )
      throw new StudioLiveError(
        "SELECTION_INVALID",
        "Select your own image/audio and an excerpt of at least 4 seconds.",
      );
    let source = `studio-${createHash("sha256").update(JSON.stringify(selection)).digest("hex")}`;
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
    const old = this.store.db
      .prepare("SELECT id FROM live_attempts WHERE source_job_id=?")
      .get(source) as { id: string } | undefined;
    if (old) {
      const row = this.row(old.id, owner);
      const a = this.store.get(old.id);
      if (a.state === "prepared" && a.upperBoundMicroUsd === null)
        await this.operator(
          validateStudioPolicy(JSON.parse(row.policy_json)),
        ).price(a.id, owner);
      return this.withCurrentBudget(this.view(old.id, owner));
    }
    const rootPolicy = validateStudioPolicy(await this.dependencies.policy());
    const media = await prepareStudioDraft(
      selection,
      owner,
      Math.min(this.config.maxDurationSeconds, 60),
    );
    const policy = selectStudioPolicy(rootPolicy, media.durationSeconds);
    media.sourceJobId = source;
    media.promptLanguageConfirmed = true;
    const a = this.store.prepare(media, null, null);
    this.store.db
      .prepare(
        "INSERT OR IGNORE INTO live_studio_projects (attempt_id,owner,selection_json,policy_json,artist_name) VALUES (?,?,?,?,?)",
      )
      .run(
        a.id,
        owner,
        JSON.stringify(selection),
        JSON.stringify(policy),
        typeof artistName === "string" ? artistName.slice(0, 80) : "My artist",
      );
    await this.operator(policy).price(a.id, owner);
    return this.withCurrentBudget(this.view(a.id, owner));
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
  ) {
    const row = this.row(id, owner),
      a = this.store.get(id);
    studioGate(this.config);
    if (a.state !== "prepared")
      return this.withCurrentBudget(this.view(id, owner)); // Durable idempotency: never authorize or submit again.
    const policy = validateStudioPolicy(JSON.parse(row.policy_json)),
      current = selectStudioPolicy(
        validateStudioPolicy(await this.dependencies.policy()),
        a.media.durationSeconds,
      );
    if (
      contractDigest(current.contract) !== contractDigest(policy.contract) ||
      digest !== a.contractDigest ||
      ceiling !== a.upperBoundMicroUsd ||
      confirmation !==
        `CONFIRM PAID STUDIO ${id} ${a.contractDigest} ${a.upperBoundMicroUsd}`
    )
      throw new StudioLiveError(
        "APPROVAL_CHANGED",
        "Confirm this exact project, policy and spending ceiling. Changed terms require review.",
        409,
      );
    await this.dependencies.ready?.();
    const workflow = this.operator({ ...policy, eurBudget: current.eurBudget });
    const token = await workflow.approve(
      id,
      owner,
      this.config.operatorSecret,
      confirmationPhrase(a),
    );
    this.store.db
      .prepare(
        "UPDATE live_studio_projects SET started_at=? WHERE attempt_id=?",
      )
      .run(Date.now(), id);
    await workflow.submit(id, owner, token, this.config.operatorSecret);
    return this.withCurrentBudget(this.view(id, owner));
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
          failure
            ? `[${failure}] Output is not ready. Resume this same task; never generate a replacement automatically.`
            : null,
          id,
        );
    } catch (e) {
      const safe = pollError(e);
      this.store.db
        .prepare(
          "UPDATE live_studio_projects SET diagnostic=? WHERE attempt_id=?",
        )
        .run(safe.message, id);
    }
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
