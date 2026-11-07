/** Offline-only activation preparation: local successful output, no provider/R2 imports. */
import { DatabaseSync } from "node:sqlite";
import {
  readFile,
  realpath,
  stat,
  writeFile,
  unlink,
  link,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { probe } from "../media.ts";
import { sha256File } from "./media.ts";
import { validateOutput, validateOutputUrl } from "./output.ts";
import {
  StudioLiveError,
  validateStudioPolicy,
  type StudioPolicy,
} from "./studio-policy.ts";
import type { Attempt } from "./store.ts";
export const activationTask = "2062100414";
export async function activationEvidence(root: string, owner: string) {
  const db = new DatabaseSync(path.join(root, "live-test.sqlite"), {
    readOnly: true,
  });
  try {
    const rows = db
      .prepare(
        "SELECT data FROM live_attempts WHERE json_extract(data,'$.providerJobId')=? AND json_extract(data,'$.media.owner')=?",
      )
      .all(activationTask, owner) as { data: string }[];
    if (rows.length !== 1) throw Error();
    const a = JSON.parse(rows[0].data) as Attempt;
    if (
      a.state !== "completed" ||
      !a.outputPath ||
      a.media.durationSeconds < 4 ||
      a.media.durationSeconds > 5
    )
      throw Error();
    const result = db
      .prepare(
        "SELECT result_json FROM live_first_test_results WHERE attempt_id=?",
      )
      .get(a.id) as { result_json: string } | undefined;
    const r = JSON.parse(result?.result_json || "null");
    if (
      !r?.downloaded ||
      r.outputPath !== a.outputPath ||
      r.taskId !== activationTask ||
      r.hostnameVerified !== "operator-reviewed"
    )
      throw Error();
    const approval = db
      .prepare(
        "SELECT review_json FROM live_output_reviews WHERE attempt_id=? AND digest=?",
      )
      .get(a.id, r.outputApprovalDigest) as { review_json: string } | undefined;
    const review = JSON.parse(approval?.review_json || "null");
    if (
      !review ||
      review.hostname !== r.approvedHostname ||
      !Number.isFinite(review.minDurationSeconds) ||
      !Number.isFinite(review.maxDurationSeconds) ||
      review.maxDurationSeconds < review.minDurationSeconds ||
      review.maxDurationSeconds > 6 ||
      review.minDurationSeconds <= 0 ||
      review.acknowledgment !== "APPROVE_EXACT_HOST_AND_MEDIA_POLICY"
    )
      throw Error();
    validateOutputUrl(r.video_url, [review.hostname]);
    const base = await realpath(path.join(root, "live-output")),
      file = await realpath(a.outputPath);
    if (!file.startsWith(base + path.sep) || !(await stat(file)).isFile())
      throw Error();
    const p = await probe(file),
      v = p.streams.find((s) => s.codec_type === "video"),
      audio = p.streams.find((s) => s.codec_type === "audio");
    const [n, d] = v?.avg_frame_rate?.split("/").map(Number) || [];
    const fps = n / d,
      duration = Number(p.format.duration);
    if (
      !v?.width ||
      !v.height ||
      !["h264", "hevc"].includes(v.codec_name) ||
      audio?.codec_name !== "aac" ||
      !Number.isFinite(fps) ||
      fps <= 0 ||
      !Number.isFinite(duration) ||
      duration < review.minDurationSeconds ||
      duration > review.maxDurationSeconds
    )
      throw Error();
    const output = {
      width: v.width,
      height: v.height,
      fps,
      videoCodec: v.codec_name as "h264" | "hevc",
      audioCodec: "aac" as const,
      durationToleranceSeconds: 2,
      maxDurationSeconds: 6,
    };
    await validateOutput(file, duration, {
      outputHosts: [review.hostname],
      output: { ...output, durationToleranceSeconds: 0 },
    });
    const sha256 = await sha256File(file);
    const reservedMicroUsd = Number(
      (
        db
          .prepare(
            "SELECT COALESCE(SUM(reserved_micro_usd),0) AS n FROM live_attempts",
          )
          .get() as { n: number }
      ).n,
    );
    if (!Number.isSafeInteger(reservedMicroUsd) || reservedMicroUsd < 0)
      throw Error();
    const evidence = {
      reservedMicroUsd,
      taskId: activationTask,
      inputSeconds: a.media.durationSeconds,
      outputSeconds: duration,
      hostname: review.hostname as string,
      sha256,
      output,
    };
    return {
      ...evidence,
      digest: createHash("sha256")
        .update(JSON.stringify(evidence))
        .digest("hex"),
    };
  } catch {
    throw new StudioLiveError(
      "SUCCESS_METADATA_REQUIRED",
      "Owned successful task 2062100414, its approved hostname and validated local MP4 are required. No codec, FPS or duration was assumed.",
      409,
    );
  } finally {
    db.close();
  }
}
export async function recoveryHealth(root: string) {
  try {
    const value = JSON.parse(
      await readFile(path.join(root, "studio-recovery-health.json"), "utf8"),
    );
    return {
      healthy:
        value.status === "ready" &&
        Number.isFinite(value.at) &&
        value.at <= Date.now() &&
        Date.now() - value.at < 180000,
      status: value.status === "ready" ? "ready" : "error",
      checkedAt: Number.isFinite(value.at) ? value.at : null,
    };
  } catch {
    return { healthy: false, status: "missing", checkedAt: null };
  }
}
export async function prepareActivationPolicy(
  root: string,
  owner: string,
  input: {
    digest?: unknown;
    ceilingMicroUsd?: unknown;
    evidence?: unknown;
    confirmation?: unknown;
  },
) {
  const observed = await activationEvidence(root, owner);
  if (
    input.digest !== observed.digest ||
    input.confirmation !== "APPROVE_SHORT_STUDIO_POLICY_WITH_PROVISIONAL_UPLIFT"
  )
    throw new StudioLiveError(
      "ACTIVATION_CONFIRMATION",
      "Review the measured output and explicitly approve the short-clip policy.",
      409,
    );
  if (
    !Number.isSafeInteger(input.ceilingMicroUsd) ||
    Number(input.ceilingMicroUsd) < 499800 ||
    typeof input.evidence !== "string" ||
    input.evidence.trim().length < 20 ||
    input.evidence.length > 4000
  )
    throw new StudioLiveError(
      "CEILING_REVIEW_REQUIRED",
      "Provide a separately reviewed conservative inclusive USD ceiling (at least USD 0.4998) and its basis, covering the approved 4–5s input / maximum 6s output policy. The provisional 19% uplift alone is not evidence of tax/fees.",
      400,
    );
  const now = Date.now();
  const policy: StudioPolicy = {
    reviewedBy: owner,
    reviewedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 7 * 86400000).toISOString(),
    billingEvidence: input.evidence,
    outputEvidence: `Local validated MP4 task ${activationTask}, SHA-256 ${observed.sha256}; exact hostname from stored operator approval. Codec, dimensions and FPS measured offline. These are acceptance limits, not universal provider guarantees.`,
    contract: {
      revision: `studio-short-${observed.digest.slice(0, 16)}`,
      model: "OmniHuman 2.0",
      documentationUrl: "https://docs.byteplus.com/",
      maxDurationSeconds: 5,
      promptSupported: true,
      inputFetchWindowSeconds: 44100,
      generatedDurationBound: {
        minInputSeconds: 4,
        maxInputSeconds: 5,
        maxAdditionalSeconds: 2,
        evidence: input.evidence,
      },
      billing: {
        microUsdPerSecond: 70000,
        minimumBillableMs: null,
        billingQuantumMs: null,
        minimumChargeMicroUsd: null,
        fixedFeeMicroUsd: null,
        taxBasisPointsUpperBound: null,
      },
      pilotAdmission: {
        inclusiveMaxMicroUsd: Number(input.ceilingMicroUsd),
        planningUpliftBasisPoints: 1900,
        maxGeneratedSeconds: 6,
        evidence: input.evidence,
      },
      output: observed.output,
      outputHosts: [observed.hostname],
    },
  };
  validateStudioPolicy(policy);
  const target = path.join(root, "studio-live-policy.json"),
    temp = path.join(root, `.studio-policy-${randomUUID()}`);
  try {
    await writeFile(temp, JSON.stringify(policy, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
    await link(temp, target);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST")
      throw new StudioLiveError(
        "POLICY_EXISTS",
        "A Studio policy already exists. It was preserved; inspect it before any separately reviewed replacement.",
        409,
      );
    throw e;
  } finally {
    await unlink(temp).catch(() => {});
  }
  return {
    saved: true,
    expiresAt: policy.expiresAt,
    ceilingMicroUsd: input.ceilingMicroUsd,
  };
}
