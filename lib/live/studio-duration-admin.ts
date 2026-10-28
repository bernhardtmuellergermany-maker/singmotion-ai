/** Local-only policy editing behind Payload Super Admin authentication. */
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, rename, unlink, open } from "node:fs/promises";
import path from "node:path";
import {
  StudioLiveError,
  validateStudioPolicy,
  type StudioPolicy,
} from "./studio-policy.ts";

export interface DurationBandReview {
  reviewMode?: "evidence" | "experimental";
  experimental?: NonNullable<
    StudioPolicy["contract"]["pilotAdmission"]
  >["experimental"];
  minInputSeconds: number;
  maxInputSeconds: number;
  maxGeneratedSeconds: number;
  ceilingUsd: number;
  billingEvidence: string;
  durationEvidence: string;
  outputEvidence: string;
  transferEvidence: string;
  maxBytes: number;
  timeoutSeconds: number;
  hosts: string;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  audioCodec: string;
  toleranceSeconds: number;
  expiresAt: string;
}
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
function invalid(message: string): never {
  throw new StudioLiveError("DURATION_REVIEW_REQUIRED", message, 400);
}
export async function inspectDurationPolicy(root: string) {
  try {
    const text = await readFile(
      path.join(root, "studio-live-policy.json"),
      "utf8",
    );
    if (Buffer.byteLength(text) > 65536) throw Error();
    const policy = validateStudioPolicy(JSON.parse(text), false);
    return { digest: digest(text), policy };
  } catch {
    throw new StudioLiveError(
      "DURATION_POLICY_MISSING",
      "An existing valid short-clip Studio policy is required. Create or repair it before adding duration bands.",
      409,
    );
  }
}
export function durationReview(band: StudioPolicy): DurationBandReview {
  const c = band.contract,
    b = c.generatedDurationBound!,
    p = c.pilotAdmission;
  return {
    reviewMode: p?.experimental ? "experimental" : "evidence",
    experimental: p?.experimental,
    minInputSeconds: b.minInputSeconds,
    maxInputSeconds: b.maxInputSeconds,
    maxGeneratedSeconds:
      p?.maxGeneratedSeconds || c.output.maxDurationSeconds || 0,
    ceilingUsd: (p?.inclusiveMaxMicroUsd || 0) / 1000000,
    billingEvidence: band.billingEvidence,
    durationEvidence: p?.durationEvidence || b.evidence,
    outputEvidence: band.outputEvidence,
    transferEvidence: c.output.transfer?.evidence || "",
    maxBytes: c.output.transfer?.maxBytes || 0,
    timeoutSeconds: (c.output.transfer?.timeoutMs || 0) / 1000,
    hosts: c.outputHosts.join("\n"),
    width: c.output.width,
    height: c.output.height,
    fps: c.output.fps,
    videoCodec: c.output.videoCodec,
    audioCodec: c.output.audioCodec,
    toleranceSeconds: c.output.durationToleranceSeconds,
    expiresAt: band.expiresAt,
  };
}
export function reviewedDurationBand(
  value: unknown,
  actor: string,
  base: StudioPolicy,
): StudioPolicy {
  if (!value || typeof value !== "object")
    invalid("Duration review is required.");
  const r = value as DurationBandReview;
  if (
    r.reviewMode !== undefined &&
    !["evidence", "experimental"].includes(r.reviewMode)
  )
    invalid("Choose evidence-backed or experimental planning review.");
  const experimental = r.reviewMode === "experimental";
  if (
    experimental &&
    (r.experimental?.kind !== "operator-planning-v1" ||
      r.experimental.unknownDurationAccepted !== true ||
      r.experimental.unknownFeesAccepted !== true ||
      r.experimental.unknownMediaAccepted !== true ||
      typeof r.experimental.hostEvidence !== "string" ||
      r.experimental.hostEvidence.trim().length < 20 ||
      r.experimental.hostEvidence.length > 4000)
  )
    invalid(
      "Experimental mode requires separate acknowledgment of unknown generated duration, fees and media properties, plus actual exact-host approval evidence.",
    );
  if (
    !experimental &&
    (r.experimental ||
      [
        r.billingEvidence,
        r.durationEvidence,
        r.outputEvidence,
        r.transferEvidence,
      ].some(
        (text) =>
          typeof text === "string" &&
          text.startsWith("OPERATOR PLANNING ASSUMPTION"),
      ))
  )
    invalid(
      "Experimental assumptions cannot be relabeled as provider evidence. Replace them with an independently reviewed evidence-based policy.",
    );
  const planning = (text: string) =>
    experimental
      ? `OPERATOR PLANNING ASSUMPTION — NOT A PROVIDER GUARANTEE: ${text.replace(/^OPERATOR PLANNING ASSUMPTION — NOT A PROVIDER GUARANTEE: /, "")}`
      : text;
  const number = (
    key: keyof DurationBandReview,
    min: number,
    max: number,
    integer = false,
  ) => {
    const v = r[key];
    if (
      typeof v !== "number" ||
      !Number.isFinite(v) ||
      v < min ||
      v > max ||
      (integer && !Number.isSafeInteger(v))
    )
      invalid(
        `${key}: enter ${integer ? "a whole number" : "a number"} between ${min} and ${max}.`,
      );
    return v as number;
  };
  const min = number("minInputSeconds", 5, 300),
    max = number("maxInputSeconds", min, 300);
  const generated = number("maxGeneratedSeconds", max, 300);
  const ceiling = number("ceilingUsd", 0.000001, 10000);
  const micro = Math.round(ceiling * 1000000);
  if (Math.abs(ceiling * 1000000 - micro) > 0.000001)
    invalid("ceilingUsd: use at most six decimal places.");
  if (micro < Math.ceil(generated * 70000 * 1.19))
    invalid(
      "ceilingUsd: the finite reservation must cover at least the existing 19% planning allowance. The allowance is NOT verified tax or a guaranteed provider charge.",
    );
  for (const key of [
    "billingEvidence",
    "durationEvidence",
    "outputEvidence",
    "transferEvidence",
  ] as const)
    if (
      typeof r[key] !== "string" ||
      r[key].trim().length < 20 ||
      r[key].length > 4000
    )
      invalid(
        `${key}: provide 20–4000 characters of ${experimental ? "conservative operator planning assumptions" : "reviewed, applicable evidence"}; do not present the five-second result as a longer-duration guarantee.`,
      );
  const maxBytes = number("maxBytes", 1, 256 * 1024 * 1024, true);
  const timeoutMs = number("timeoutSeconds", 1, 180, true) * 1000;
  const width = number("width", 720, 4096, true),
    height = number("height", 720, 4096, true);
  if (Math.min(width, height) !== 720)
    invalid("Media dimensions: one side must be exactly 720 pixels.");
  const fps = number("fps", 0.01, 120);
  const tolerance = number("toleranceSeconds", 0, generated - min);
  if (!["h264", "hevc"].includes(r.videoCodec) || r.audioCodec !== "aac")
    invalid(
      "Media codecs: only reviewed h264/hevc video with aac audio are supported.",
    );
  if (typeof r.hosts !== "string")
    invalid(
      "hosts: enter approved exact HTTPS hostnames, without paths or wildcards.",
    );
  const hosts = r.hosts.split(/[\s,]+/).filter(Boolean);
  if (
    experimental &&
    hosts.some((host) => !base.contract.outputHosts.includes(host))
  )
    invalid(
      "Experimental mode can only reuse exact hosts already approved in the preserved short policy. It cannot assume a new output host is safe.",
    );
  const now = Date.now(),
    expiry = Date.parse(r.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= now || expiry > now + 7 * 86400000)
    invalid("expiresAt: choose a future review expiry within seven days.");
  const band: StudioPolicy = {
    reviewedBy: actor,
    reviewedAt: new Date(now).toISOString(),
    expiresAt: new Date(expiry).toISOString(),
    billingEvidence: planning(r.billingEvidence),
    outputEvidence: planning(r.outputEvidence),
    contract: {
      ...base.contract,
      revision: `studio-band-${randomUUID()}`,
      maxDurationSeconds: max,
      generatedDurationBound: {
        minInputSeconds: min,
        maxInputSeconds: max,
        maxAdditionalSeconds: generated - min,
        evidence: planning(r.durationEvidence),
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
        ...(experimental ? { experimental: r.experimental } : {}),
        maxGeneratedSeconds: generated,
        inclusiveMaxMicroUsd: micro,
        planningUpliftBasisPoints: 1900,
        evidence: planning(r.billingEvidence),
        durationEvidence: planning(r.durationEvidence),
      },
      outputHosts: hosts,
      output: {
        width,
        height,
        fps,
        videoCodec: r.videoCodec as "h264" | "hevc",
        audioCodec: "aac",
        durationToleranceSeconds: tolerance,
        maxDurationSeconds: generated,
        transfer: {
          maxBytes,
          timeoutMs,
          evidence: planning(r.transferEvidence),
        },
      },
    },
  };
  try {
    return validateStudioPolicy(band);
  } catch {
    invalid(
      "Host/media/duration policy is unsupported. Use exact public HTTPS hosts (no IPs or wildcards), reviewed duration bounds and supported 720p media. No policy was saved.",
    );
  }
}
export async function saveDurationBand(
  root: string,
  actor: string,
  input: {
    digest?: unknown;
    index?: unknown;
    review?: unknown;
    confirmation?: unknown;
  },
) {
  const experimental =
    (input.review as DurationBandReview | undefined)?.reviewMode ===
    "experimental";
  if (
    input.confirmation !==
      (experimental
        ? "APPROVE_EXPERIMENTAL_PLANNING_BAND"
        : "APPROVE_REVIEWED_DURATION_BAND") ||
    !actor
  )
    invalid(
      "Explicit Super Admin approval of the duration, inclusive ceiling and output policy is required.",
    );
  const lockPath = path.join(root, ".studio-duration-review.lock");
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch {
    throw new StudioLiveError(
      "POLICY_EDIT_BUSY",
      "Another policy edit is active. Retry after it finishes; do not overwrite its review.",
      409,
    );
  }
  const temp = path.join(root, `.studio-policy-${randomUUID()}`);
  try {
    const current = await inspectDurationPolicy(root);
    if (current.digest !== input.digest)
      throw new StudioLiveError(
        "POLICY_CHANGED",
        "Policy changed. Reload and review before saving.",
        409,
      );
    const bands = [...(current.policy.durationBands || [])];
    if (
      !Number.isInteger(input.index) ||
      Number(input.index) < 0 ||
      Number(input.index) > bands.length
    )
      invalid(
        "Choose an existing duration band or Add new band. The original short-clip policy cannot be replaced here.",
      );
    bands[Number(input.index)] = reviewedDurationBand(
      input.review,
      actor,
      current.policy,
    );
    const updated = { ...current.policy, durationBands: bands };
    try {
      validateStudioPolicy(updated);
    } catch {
      invalid(
        "Bands overlap, exceed supported limits, or an existing review has expired. Preserve the short policy and use adjoining, current reviewed ranges (for example 5–15 seconds).",
      );
    }
    const text = JSON.stringify(updated, null, 2);
    if (Buffer.byteLength(text) > 65536)
      invalid("Combined policy exceeds 64 KiB. Shorten evidence references.");
    // Preserve the complete prior settings as a private, immutable revision.
    await writeFile(
      path.join(root, `studio-policy-history-${randomUUID()}.json`),
      JSON.stringify({
        actor,
        at: new Date().toISOString(),
        previousDigest: current.digest,
        previous: current.policy,
        nextDigest: digest(text),
      }),
      { flag: "wx", mode: 0o600 },
    );
    await writeFile(temp, text, { flag: "wx", mode: 0o600 });
    await rename(temp, path.join(root, "studio-live-policy.json"));
    return { saved: true };
  } finally {
    await unlink(temp).catch(() => {});
    await lock.close();
    await unlink(lockPath);
  }
}
