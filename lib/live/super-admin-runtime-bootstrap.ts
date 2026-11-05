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
      revision: "super-admin-runtime-bootstrap-v1",
      model: "OmniHuman 2.0",
      documentationUrl: "https://docs.byteplus.com/",
      maxDurationSeconds: 5,
      promptSupported: true,
      inputFetchWindowSeconds: 44100,
      generatedDurationBound: {
        minInputSeconds: 4,
        maxInputSeconds: 5,
        maxAdditionalSeconds: 1,
        evidence:
          "Experimental operator admission for initial 4-5s inputs only. Assume up to 6s generated while actual billed length may differ; do not treat this as verified vendor bound.",
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
        inclusiveMaxMicroUsd: 499800,
        planningUpliftBasisPoints: 1900,
        maxGeneratedSeconds: 6,
        evidence:
          "Experimental initial short-clip planning reservation USD 0.4998 (6s * USD 0.07 * 1.19); not an invoice guarantee.",
      },
      output: {
        width: 720,
        height: 1280,
        fps: 30,
        videoCodec: "h264",
        audioCodec: "aac",
        durationToleranceSeconds: 1,
        maxDurationSeconds: 6,
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
