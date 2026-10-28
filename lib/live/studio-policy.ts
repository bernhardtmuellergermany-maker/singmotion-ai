import type { EuroBudget } from "./studio-budget.ts";
/** Server-reviewed pilot policy. Never accepts billing/output policy from browsers. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  contractDigest,
  planUpperBoundMicroUsd,
  type VerifiedContract,
} from "./contract.ts";
import { validateOutputUrl, outputTransferLimits } from "./output.ts";
import { inputDeliveryPolicy } from "./input-policy.ts";
import type { LiveTestConfig } from "./config.ts";
export class StudioLiveError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
export interface StudioPolicy {
  eurBudget?: EuroBudget;
  durationBands?: StudioPolicy[];
  reviewedBy: string;
  reviewedAt: string;
  expiresAt: string;
  billingEvidence: string;
  outputEvidence: string;
  contract: VerifiedContract & {
    output: VerifiedContract["output"] & {
      videoCodec: "h264" | "hevc";
      audioCodec: "aac";
    };
  };
}
export function validateStudioPolicy(
  value: unknown,
  checkExpiry = true,
): StudioPolicy {
  try {
    const p = value as StudioPolicy,
      c = p.contract;
    if (
      !p ||
      !["reviewedBy", "billingEvidence", "outputEvidence"].every(
        (k) =>
          typeof p[k as keyof StudioPolicy] === "string" &&
          String(p[k as keyof StudioPolicy]).trim().length >= 3,
      ) ||
      !Number.isFinite(Date.parse(p.reviewedAt)) ||
      Date.parse(p.reviewedAt) > Date.now() ||
      !Number.isFinite(Date.parse(p.expiresAt)) ||
      Date.parse(p.expiresAt) <= Date.parse(p.reviewedAt) ||
      (checkExpiry && Date.parse(p.expiresAt) <= Date.now())
    )
      throw Error();
    if (
      !c ||
      c.model !== "OmniHuman 2.0" ||
      !c.revision ||
      !c.promptSupported ||
      !Number.isFinite(c.maxDurationSeconds) ||
      c.maxDurationSeconds < 4 ||
      c.maxDurationSeconds > 300 ||
      c.inputFetchWindowSeconds !==
        inputDeliveryPolicy.minimumRemainingSeconds ||
      new URL(c.documentationUrl).protocol !== "https:"
    )
      throw Error();
    const b = c.generatedDurationBound;
    if (
      !b ||
      b.minInputSeconds < 4 ||
      b.maxInputSeconds > c.maxDurationSeconds ||
      b.maxInputSeconds + b.maxAdditionalSeconds > 300 ||
      (c.pilotAdmission &&
        c.output.maxDurationSeconds !== c.pilotAdmission.maxGeneratedSeconds) ||
      c.billing.microUsdPerSecond !== 70000
    )
      throw Error();
    planUpperBoundMicroUsd(b.minInputSeconds, c);
    planUpperBoundMicroUsd(b.maxInputSeconds, c);
    if (
      !Array.isArray(c.outputHosts) ||
      !c.outputHosts.length ||
      c.outputHosts.length > 8
    )
      throw Error();
    for (const h of c.outputHosts) {
      if (typeof h !== "string" || !/^[a-z0-9.-]+$/.test(h)) throw Error();
      validateOutputUrl(`https://${h}/`, [h]);
    }
    if (
      !["h264", "hevc"].includes(c.output.videoCodec) ||
      c.output.audioCodec !== "aac" ||
      !Number.isInteger(c.output.width) ||
      !Number.isInteger(c.output.height) ||
      Math.min(c.output.width, c.output.height) !== 720 ||
      Math.max(c.output.width, c.output.height) > 4096 ||
      !Number.isFinite(c.output.fps) ||
      c.output.fps <= 0 ||
      c.output.fps > 120 ||
      !Number.isFinite(c.output.durationToleranceSeconds) ||
      c.output.durationToleranceSeconds < 0 ||
      c.output.durationToleranceSeconds > b.maxAdditionalSeconds
    )
      throw Error();
    outputTransferLimits(c);
    if (
      b.maxInputSeconds > 5 &&
      c.pilotAdmission &&
      (!c.pilotAdmission.durationEvidence?.trim() || !c.output.transfer)
    )
      throw Error();
    if (p.durationBands) {
      if (!Array.isArray(p.durationBands) || p.durationBands.length > 20)
        throw Error();
      const ranges = [
        p,
        ...p.durationBands.map((band) => {
          if (band.durationBands) throw Error();
          return validateStudioPolicy(band, checkExpiry);
        }),
      ]
        .map((band) => band.contract.generatedDurationBound!)
        .sort((a, b) => a.minInputSeconds - b.minInputSeconds);
      for (let i = 1; i < ranges.length; i++)
        if (ranges[i].minInputSeconds < ranges[i - 1].maxInputSeconds)
          throw Error();
    }
    // Force a JSON-safe immutable policy snapshot before digesting/pricing.
    contractDigest(c);
    return p;
  } catch {
    throw new StudioLiveError(
      "POLICY_REVIEW_REQUIRED",
      "A current reviewed Studio policy covering generated duration, inclusive billing and exact output hosts/media is required.",
      503,
    );
  }
}
export function selectStudioPolicy(root: StudioPolicy, seconds: number) {
  const policies = [root, ...(root.durationBands || [])]
    .filter((p) => {
      const b = p.contract.generatedDurationBound!;
      return seconds >= b.minInputSeconds && seconds <= b.maxInputSeconds;
    })
    .sort(
      (a, b) =>
        a.contract.generatedDurationBound!.maxInputSeconds -
        b.contract.generatedDurationBound!.maxInputSeconds,
    );
  if (!policies.length)
    throw new StudioLiveError(
      "DURATION_NOT_REVIEWED",
      "No reviewed inclusive cost and media policy covers this encoded duration. No extrapolation from the five-second test is allowed.",
      409,
    );
  const { durationBands: _bands, ...selected } = policies[0];
  void _bands;
  return { ...selected, eurBudget: root.eurBudget };
}
export async function loadStudioPolicy(root: string, checkExpiry = true) {
  try {
    const file = await readFile(path.join(root, "studio-live-policy.json"));
    if (file.length > 65536) throw Error();
    return validateStudioPolicy(JSON.parse(file.toString()), checkExpiry);
  } catch (e) {
    if (e instanceof StudioLiveError) throw e;
    throw new StudioLiveError(
      "POLICY_MISSING",
      "Server studio-live-policy.json is missing or invalid. No price or provider terms were assumed.",
      503,
    );
  }
}
export function studioConfig(
  env: Record<string, string | undefined> = process.env,
): LiveTestConfig {
  const number = (key: string) => {
    const n = Number(env[key]);
    return Number.isSafeInteger(n) && n > 0 ? n : 0;
  };
  return {
    demoMode: false,
    enabled: env.BYTEPLUS_STUDIO_ENABLED === "true",
    operatorSecret: env.BYTEPLUS_STUDIO_OPERATOR_SECRET || "",
    // Private operator jobs do not have internal daily or cumulative spending caps.
    // Exact per-task confirmation and persistent reservations remain mandatory.
    maxJobMicroUsd: Number.MAX_SAFE_INTEGER,
    maxTotalMicroUsd: Number.MAX_SAFE_INTEGER,
    maxDurationSeconds: number("BYTEPLUS_STUDIO_MAX_DURATION_SECONDS"),
  };
}
export function studioGate(config: LiveTestConfig) {
  if (
    !config.enabled ||
    config.operatorSecret.length < 32 ||
    config.maxJobMicroUsd <= 0 ||
    config.maxTotalMicroUsd <= 0 ||
    config.maxDurationSeconds < 4 ||
    config.maxDurationSeconds > 300
  )
    throw new StudioLiveError(
      "STUDIO_DISABLED",
      "Private Studio requires server enablement, a strong operator secret and a valid provider duration limit.",
      503,
    );
}

/** Fixed diagnostics only: decoder stderr, provider text, paths and URLs stay private. */
export function studioDiagnostic(error: unknown): StudioLiveError {
  if (error instanceof StudioLiveError) return error;
  const message = error instanceof Error ? error.message : "";
  const known: Record<string, [string, string, number]> = {
    ONE_ACTIVE_GENERATION: [
      "ONE_ACTIVE_GENERATION",
      "One generation is already active or uncertain. Recover/reconcile that task before another approval; its reservation is retained.",
      409,
    ],
    EUR50_REVIEW_REQUIRED: [
      "EUR50_REVIEW_REQUIRED",
      "Renew the dated EUR/USD and fee review for the existing EUR 50 total budget. Missing/expired conversion bounds cannot enable another paid test.",
      409,
    ],
    "Total live-test spending cap exceeded.": [
      "TOTAL_BUDGET_EXCEEDED",
      "The EUR 50 budget cannot cover the next reviewed video ceiling after retaining every existing reservation, including operator tests. Review the budget; do not reset the ledger.",
      409,
    ],
    "Live-test spending cap exceeded or unset.": [
      "JOB_BUDGET_EXCEEDED",
      "The reviewed video ceiling is not admissible under the active authorization. Studio has no separate USD per-job cap; review the EUR 50 budget and the video cost evidence.",
      409,
    ],
    "Encoded MP3 exceeds the live-test duration limit; select a shorter excerpt.":
      [
        "ENCODED_DURATION_EXCEEDED",
        "The measured encoded MP3 exceeds the approved duration cap. Select a slightly shorter excerpt and review again.",
        400,
      ],
    "Audio exceeds documented OmniHuman 2.0 audio limits.": [
      "AUDIO_LIMIT",
      "Encoded audio must be 4–300 seconds and below 15 MB.",
      400,
    ],
    "Reference exceeds documented OmniHuman 2.0 image limits.": [
      "IMAGE_LIMIT",
      "Use a still JPEG/PNG, 300–4096 pixels per side with aspect ratio 0.4–2.5, below 30 MB.",
      400,
    ],
    "Reviewed generated-video duration bound is missing or does not cover this input.":
      [
        "DURATION_NOT_REVIEWED",
        "The reviewed billing policy does not cover this measured clip duration. Shorten it to the reviewed range or obtain an independently reviewed policy.",
        409,
      ],
    "Prepared inputs changed after review. Approval is not valid for these files.":
      [
        "SNAPSHOT_CHANGED",
        "An immutable input changed after review. Submission is blocked; preserve the ledger and investigate storage.",
        409,
      ],
    "A fresh plan and exact one-time confirmation are required.": [
      "ALREADY_CLAIMED",
      "This plan was already claimed or changed. Open its saved project and resume that task; do not submit a replacement.",
      409,
    ],
  };
  const safe = known[message];
  return safe
    ? new StudioLiveError(...safe)
    : new StudioLiveError(
        "STUDIO_VALIDATION_OR_STORAGE",
        "Studio preparation or approval failed. Check media constraints, private storage and the reviewed policy. No automatic resubmission.",
        400,
      );
}
