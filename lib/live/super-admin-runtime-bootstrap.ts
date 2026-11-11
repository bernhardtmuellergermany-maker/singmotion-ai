/** Private Super Admin only. No volume policy or browser-provided vendor metadata.
 * The owner accepts the reported USD 0.07/generated-second base rate.
 * This is an experimental *planning* profile; it cannot cap BytePlus invoices.
 * Exact task approval, signed-provider response, DNS/TLS/MP4 validation,
 * persistent reservation, and no retry on ambiguous submission still apply.
 */
import { validateStudioPolicy, type StudioPolicy } from "./studio-policy.ts";

export function superAdminRuntimeBootstrapPolicy(): StudioPolicy {
  const policy: StudioPolicy = {
    reviewedBy: "server-owned-super-admin-bootstrap",
    reviewedAt: "2026-11-05T00:00:00.000Z",
    expiresAt: "2027-01-01T00:00:00.000Z",
    billingEvidence:
      "Owner confirmation 2026-11-05: USD 0.07 per generated video second and no separately charged taxes. Rounding, minimum charges, failed-job charges and any other fees are unknown. Planning is not a guaranteed bill.",
    outputEvidence:
      "Experimental private Super Admin discovery: output URL only from authenticated signed BytePlus task status; public-DNS-pinned TLS with redirects blocked. Inspect actual downloaded MP4 for 720p, supported codec, AAC and FPS. No guaranteed vendor output shape assumed.",
    contract: {
      revision: "super-admin-runtime-bootstrap-tempo-v2",
      model: "OmniHuman 2.0",
      documentationUrl: "https://docs.byteplus.com/",
      maxDurationSeconds: 6,
      promptSupported: true,
      inputFetchWindowSeconds: 44100,
      generatedDurationBound: {
        minInputSeconds: 4,
        maxInputSeconds: 6,
        maxAdditionalSeconds: 1,
        evidence:
          "Experimental operator admission for 4-6s encoded provider inputs, including a 5s selected excerpt stretched to about 5.56s by the pitch-preserving 0.9 tempo option. Assume up to 7s generated for planning only; actual billed length may differ.",
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
        experimental: {
          kind: "operator-planning-v1",
          unknownDurationAccepted: true,
          unknownFeesAccepted: true,
          unknownMediaAccepted: true,
          hostEvidence:
            "Signed BytePlus task-status video_url plus DNS pinning, public address and TLS validation; no manually pre-approved hostname.",
        },
        inclusiveMaxMicroUsd: 583100,
        planningUpliftBasisPoints: 1900,
        maxGeneratedSeconds: 7,
        durationEvidence: "A 5.000s customer-selected clip becomes about 5.556s provider input at atempo=0.9. This is a local measured encoding relationship, not BytePlus evidence or a guaranteed generated-duration bound; experimental Super Admin accepts unknown billing/duration on each task.",
        evidence:
          "Experimental initial short-clip planning reservation USD 0.5831 (7s * USD 0.07 * 1.19) for a potential tempo-extended provider input; not an invoice guarantee and requires explicit per-task operator consent.",
      },
      output: {
        width: 720,
        height: 1280,
        fps: 30,
        videoCodec: "h264",
        audioCodec: "aac",
        durationToleranceSeconds: 1,
        maxDurationSeconds: 7,
        transfer: {
          maxBytes: 100 * 1024 * 1024,
          timeoutMs: 120000,
          evidence:
            "SingMotion bounded private network transfer for experimental Super Admin output; operational cap not a provider specification.",
        },
      },
      outputHosts: [],
      trustSignedProviderOutputHost: true,
      discover720p: true,
    },
  };
  return validateStudioPolicy(policy);
}
