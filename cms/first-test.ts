import {
  PreparationError,
  preparationError,
  type PreparationStage,
} from "./preparation-error.ts";
/** Server-only adapter for the existing one-task ledger; no public generation path. */
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { hasRole } from "./policy.ts";
import { cmsOriginFailure } from "./request-security.ts";
import { validateStaging } from "../lib/staging.ts";
import { LiveTestStore } from "../lib/live/store.ts";
import {
  FirstTestWorkflow,
  firstTestConfig,
  validateFirstTestReview,
} from "../lib/live/first-test.ts";
import {
  outputReviewTemplate,
  reviewOutput,
  downloadFirstTestResult,
} from "../lib/live/first-test-download.ts";
import {
  validateReference,
  sha256File,
  revalidateMedia,
} from "../lib/live/media.ts";
import { validateAudio } from "../lib/media.ts";
import {
  validateOmniAudio,
  validateEncodedDuration,
} from "../lib/live/limits.ts";
import { enforceCap } from "../lib/live/config.ts";
import { composePrompt } from "../lib/domain.ts";
import type { Transport, PrivateInputDelivery } from "../lib/live/byteplus.ts";
import type { OutputTransport } from "../lib/live/output-transport.ts";
type Env = Record<string, string | undefined>;
export class AdminTestError extends Error {}
export function adminTestOwner(
  user: unknown,
  method: string,
  headers: Headers,
  env: Env,
) {
  if (
    env.CMS_ENABLED !== "true" ||
    !hasRole(user, ["super-admin"]) ||
    cmsOriginFailure(method, headers, env.CMS_ORIGIN)
  )
    throw new AdminTestError(
      "Super Admin authentication and exact CMS Origin are required.",
    );
  const rawId = (user as { id: unknown }).id;
  if (typeof rawId !== "string" && typeof rawId !== "number")
    throw new AdminTestError("Invalid administrator identity.");
  const id = String(rawId);
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id))
    throw new AdminTestError("Invalid administrator identity.");
  return `cms-staff-${id}`;
}
export function adminTestEnvironment(env: Env, id: string) {
  validateStaging(env); // Do not change staging's existing public/CLI restrictions.
  if (env.BYTEPLUS_ADMIN_TEST_ENABLED !== "true")
    throw new AdminTestError(
      "Server-side BYTEPLUS_ADMIN_TEST_ENABLED is disabled.",
    );
  // Explicit, isolated delegation to the existing workflow, not process.env mutation.
  // Exact plan ID, operator secret, duration and both budget caps remain mandatory.
  const scoped = { ...env, BYTEPLUS_LIVE_TEST_ENABLED: "true" };
  firstTestConfig(scoped, id);
  return scoped;
}
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const offline: Transport = async () => {
  throw new Error("Offline only");
};
const noDelivery: PrivateInputDelivery = {
  issue: async () => {
    throw new Error("Offline only");
  },
};
export type AdminDependencies = {
  transport?: Transport;
  delivery?: PrivateInputDelivery;
  inputHosts?: readonly string[];
  output?: OutputTransport;
};
export class AdminFirstTest {
  readonly store: LiveTestStore;
  readonly root: string;
  readonly owner: string;
  readonly env: Env;
  readonly deps: AdminDependencies;
  constructor(
    store: LiveTestStore,
    root: string,
    owner: string,
    env: Env,
    deps: AdminDependencies = {},
  ) {
    this.store = store;
    this.root = root;
    this.owner = owner;
    this.env = env;
    this.deps = deps;
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS live_admin_reviews (plan_id TEXT PRIMARY KEY, cost_json TEXT, output_json TEXT)",
    );
  }
  workflow(
    env = this.env,
    transport = offline,
    delivery = noDelivery,
    hosts: readonly string[] = [],
  ) {
    return new FirstTestWorkflow(
      this.store,
      this.root,
      env,
      transport,
      delivery,
      hosts,
    );
  }
  owned(id: string) {
    return this.workflow().owned(id, this.owner);
  }
  reviews(id: string) {
    this.owned(id);
    const row = this.store.db
      .prepare(
        "SELECT cost_json, output_json FROM live_admin_reviews WHERE plan_id=?",
      )
      .get(id) as
      { cost_json: string | null; output_json: string | null } | undefined;
    return {
      cost: row?.cost_json ? JSON.parse(row.cost_json) : undefined,
      output: row?.output_json ? JSON.parse(row.output_json) : undefined,
    };
  }
  async upload(
    image: File,
    audio: File,
    customPrompt: string,
    rights: boolean,
    english: boolean,
  ) {
    if (this.store.firstTest())
      throw new AdminTestError(
        "The one-test slot is already claimed. Resume the existing task; do not create another.",
      );
    if (
      !rights ||
      !english ||
      !image.size ||
      image.size > 5_000_000 ||
      !audio.size ||
      audio.size >= 15_000_000 ||
      customPrompt.length > 1000
    )
      throw new AdminTestError(
        "Confirm rights and English direction; use a JPEG/PNG up to 5 MB and a 4–5 second MP3 under 15 MB.",
      );
    const mediaRoot = path.join(this.root, "media");
    let stage: PreparationStage = "storage";
    let temp: string | undefined;
    try {
      await mkdir(mediaRoot, { recursive: true, mode: 0o700 });
      temp = await mkdtemp(path.join(mediaRoot, "admin-upload-"));
      const imageTemp = path.join(temp, "image"),
        audioTemp = path.join(temp, "audio");
      await writeFile(imageTemp, Buffer.from(await image.arrayBuffer()), {
        flag: "wx",
        mode: 0o600,
      });
      await writeFile(audioTemp, Buffer.from(await audio.arrayBuffer()), {
        flag: "wx",
        mode: 0o600,
      });
      stage = "image";
      await validateReference(imageTemp);
      stage = "audio";
      const duration = await validateAudio(audioTemp, true);
      try {
        validateOmniAudio({ format: "mp3", bytes: audio.size, duration });
        validateEncodedDuration(duration, 5);
      } catch {
        throw new PreparationError(
          "audio-duration",
          `Encoded MP3 duration limit: measured ${duration.toFixed(6)} seconds; required 4–5 seconds including encoder padding. Select a shorter excerpt if over 5 seconds.`,
        );
      }
      stage = "snapshot";
      const imageSha256 = await sha256File(imageTemp),
        audioSha256 = await sha256File(audioTemp);
      const imagePath = path.join(
        mediaRoot,
        `admin-${hash(this.owner)}-${imageSha256}.reference`,
      );
      const audioPath = path.join(
        mediaRoot,
        `admin-${hash(this.owner)}-${audioSha256}.mp3`,
      );
      for (const [from, to, digest] of [
        [imageTemp, imagePath, imageSha256],
        [audioTemp, audioPath, audioSha256],
      ]) {
        try {
          await copyFile(from, to, 1);
        } catch (error) {
          if (
            (error as NodeJS.ErrnoException).code !== "EEXIST" ||
            (await sha256File(to)) !== digest
          )
            throw error;
        }
      }
      const prompt = composePrompt("Natural", "Static Close-Up", customPrompt);
      const media = {
        sourceJobId: `admin-${hash(this.owner + imageSha256 + audioSha256 + prompt)}`,
        owner: this.owner,
        audioPath,
        imagePath,
        audioSha256,
        imageSha256,
        durationSeconds: duration,
        prompt,
        promptLanguageConfirmed: true,
      };
      await revalidateMedia(media);
      stage = "plan";
      const attempt = this.store.prepare(media, null, null);
      return await this.status(attempt.id);
    } catch (error) {
      throw preparationError(error, stage);
    } finally {
      if (temp) await rm(temp, { recursive: true, force: true });
    }
  }
  async status(id?: string) {
    const slot = this.store.firstTest();
    if (
      !id &&
      slot &&
      this.store.get(slot.attempt_id).media.owner === this.owner
    )
      id = slot.attempt_id;
    if (!id) {
      const row = this.store.db
        .prepare(
          "SELECT id FROM live_attempts WHERE json_extract(data,'$.media.owner')=? ORDER BY json_extract(data,'$.createdAt') DESC LIMIT 1",
        )
        .get(this.owner) as { id: string } | undefined;
      if (!row)
        return {
          plan: null,
          blocker: this.store.firstTest()
            ? "The shared one-test slot is already claimed."
            : null,
        };
      id = row.id;
    }
    const attempt = this.owned(id),
      saved = this.reviews(id);
    const report = await this.workflow().dryRun(id, this.owner, saved.cost);
    let output = saved.output,
      outputDigest: string | null = null;
    if (
      attempt.providerJobId &&
      ["submitted", "processing", "output_observed", "completed"].includes(
        attempt.state,
      )
    ) {
      if (!output)
        output = outputReviewTemplate(this.workflow(), id, this.owner);
      else
        outputDigest = reviewOutput(
          this.workflow(),
          id,
          this.owner,
          output,
          report.review.generatedVideoMaxSeconds!,
        ).digest;
    }
    const observed = this.store.firstTestResult(id)?.result;
    let blocker: string | null = null;
    try {
      const scoped = adminTestEnvironment(this.env, id);
      if (report.inclusiveMaxMicroUsd !== null)
        enforceCap(
          firstTestConfig(scoped, id),
          attempt.media.durationSeconds,
          report.inclusiveMaxMicroUsd,
        );
      if (slot && slot.attempt_id !== id)
        throw new Error("One-test slot already claimed");
    } catch {
      blocker =
        "Server authorization is disabled or incomplete: exact plan ID, secret, duration and spending caps must be configured.";
    }
    return {
      plan: {
        id,
        state: attempt.state,
        taskId: attempt.providerJobId,
        failureCode: attempt.failureCode,
        seconds: report.encodedAudioSeconds,
        prompt: report.prompt,
        costReview: report.review,
        costDigest: report.confirmationDigest,
        outputReview: output ?? null,
        outputDigest,
        observedHostname: observed?.observedHostname || null,
        completed: attempt.state === "completed",
      },
      blocker,
    };
  }
  async saveReview(id: string, kind: "cost" | "output", value: unknown) {
    const attempt = this.owned(id);
    if (kind === "cost") {
      if (attempt.state !== "prepared" || attempt.contractDigest)
        throw new AdminTestError("Submitted cost approvals are immutable.");
      const checked = await this.workflow().dryRun(id, this.owner, value);
      this.store.db
        .prepare(
          "INSERT INTO live_admin_reviews(plan_id,cost_json) VALUES (?,?) ON CONFLICT(plan_id) DO UPDATE SET cost_json=excluded.cost_json",
        )
        .run(id, JSON.stringify(checked.review));
    } else {
      const cost = validateFirstTestReview(this.reviews(id).cost, attempt);
      const checked = reviewOutput(
        this.workflow(),
        id,
        this.owner,
        value,
        cost.review.generatedVideoMaxSeconds!,
      );
      this.store.db
        .prepare("UPDATE live_admin_reviews SET output_json=? WHERE plan_id=?")
        .run(JSON.stringify(checked.review), id);
    }
    return this.status(id);
  }
  async execute(
    action: string,
    id: string,
    confirmation: string,
    outputConfirmation: string,
    phrase: string,
  ) {
    const attempt = this.owned(id),
      saved = this.reviews(id);
    const cost = validateFirstTestReview(saved.cost, attempt);
    if (confirmation !== cost.digest)
      throw new AdminTestError(
        "Review changed. Review the current cost again.",
      );
    if (
      action === "start" &&
      phrase !==
        `AUTHORIZE ONE PAID BYTEPLUS TEST ${id} UP TO ${cost.cost} MICROUSD`
    )
      throw new AdminTestError("Type the exact one-test cost approval phrase.");
    const env = adminTestEnvironment(this.env, id);
    enforceCap(
      firstTestConfig(env, id),
      attempt.media.durationSeconds,
      cost.cost,
    );
    let delivery = noDelivery,
      hosts: readonly string[] = [],
      transport = offline;
    let r2: import("../lib/live/r2.ts").R2PrivateInputDelivery | undefined;
    // Authorize before constructing network clients. The actual call repeats all gates.
    if (action !== "start")
      this.workflow(env).authorizeExisting(
        id,
        this.owner,
        saved.cost,
        confirmation,
      );
    try {
      if (["start", "poll", "cancel", "refresh"].includes(action)) {
        if (this.deps.transport) transport = this.deps.transport;
        else {
          const { createSignedTransport } =
            await import("../lib/live/signed-transport.ts");
          const { loadBytePlusCredentials } =
            await import("../lib/live/signing.ts");
          loadBytePlusCredentials();
          transport = createSignedTransport(fetch);
        }
      }
      if (["start", "cleanup"].includes(action)) {
        if (this.deps.delivery) {
          delivery = this.deps.delivery;
          hosts = this.deps.inputHosts || [];
        } else {
          const { R2PrivateInputDelivery } = await import("../lib/live/r2.ts");
          r2 = new R2PrivateInputDelivery(this.store, this.root);
          delivery = r2;
          hosts = r2.inputHosts;
        }
      }
      const workflow = this.workflow(env, transport, delivery, hosts);
      if (action === "start")
        await workflow.submit(id, this.owner, saved.cost, confirmation);
      else if (action === "poll") {
        const slot = this.store.firstTest();
        if (!slot || Date.now() >= slot.claimed_at + 12 * 3600000)
          throw new AdminTestError(
            "Task lifetime exceeded; reconcile without resubmitting.",
          );
        await workflow.poll(id, this.owner, saved.cost, confirmation);
      } else if (action === "cancel")
        await workflow.cancel(id, this.owner, saved.cost, confirmation);
      else if (action === "refresh")
        await workflow.refreshResult(id, this.owner, saved.cost, confirmation);
      else if (action === "download")
        await downloadFirstTestResult(
          workflow,
          id,
          this.owner,
          saved.cost,
          confirmation,
          saved.output,
          outputConfirmation,
          this.deps.output,
        );
      else if (action === "cleanup" && r2)
        await r2.cleanupExpired(id, AbortSignal.timeout(60000));
      else throw new AdminTestError("Unsupported action.");
      return this.status(id);
    } finally {
      r2?.close();
    }
  }
}
