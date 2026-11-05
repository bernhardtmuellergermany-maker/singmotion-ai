/** User-confirmed SingMotion pilot assumptions as of 2026-11-05.
 * Distinct from vendor-issued invoice evidence. No credentials, card data,
 * customer media or provider output URLs are included here.
 *
 * Known observed output host is deliberately exact, NOT a wildcard.
 * A changed host must stop delivery for review rather than widen SSRF access.
 */
import type {StudioPolicy} from "../live/studio-policy.ts";

export const OWNER_CONFIRMED_BYTEPLUS_RATE_MICRO_USD = 70_000;
export const OWNER_CONFIRMED_SINGLE_JOB_MAX_INPUT_SECONDS = 30;
export const OWNER_CONFIRMED_BUDGET = Object.freeze({
 dailyCapMicroUsd: 1_500_000, // at most $1.50 of conservative reservations per rolling 24h
 lifetimeCapMicroUsd: 5_000_000, // staging-only total reserve, never resets on restart
});

export function ownerConfirmedBytePlusPolicy():StudioPolicy&{
 dailyCapMicroUsd:number;lifetimeCapMicroUsd:number
}{
 return {
  reviewedBy:"SingMotion-owner-user-confirmation-2026-11-05",
  reviewedAt:"2026-11-05T00:00:00.000Z",
  expiresAt:"2026-12-04T23:59:59.000Z",
  billingEvidence:"SingMotion owner confirmed USD 0.07 per generated video second, no additional BytePlus fees, taxes or surcharges on 2026-11-05; operator-relayed support output-meter policy.",
  outputEvidence:"Existing task 2062100414 returned a valid MP4; owner confirmed successful private video delivery. Exact observed v16m-default.tiktokcdn.com output host only, with validated 720p normalization, AAC/H264 checks and limited 120-second private transfer.",
  dailyCapMicroUsd:OWNER_CONFIRMED_BUDGET.dailyCapMicroUsd,
  lifetimeCapMicroUsd:OWNER_CONFIRMED_BUDGET.lifetimeCapMicroUsd,
  contract:{
   revision:"owner-confirmed-2026-11-05-staging-v1",
   model:"OmniHuman 2.0",
   documentationUrl:"https://www.byteplus.com/",
   maxDurationSeconds:300,
   promptSupported:true,
   inputFetchWindowSeconds:44100,
   generatedDurationBound:{
    evidence:"Owner confirms prior reviewed music-video length rules; conservative bound admits 4-30 encoded input seconds and at most 2s additional generated media; stop if provider exceeds that range.",
    minInputSeconds:4,
    maxInputSeconds:OWNER_CONFIRMED_SINGLE_JOB_MAX_INPUT_SECONDS,
    maxAdditionalSeconds:2,
   },
   billing:{
    microUsdPerSecond:OWNER_CONFIRMED_BYTEPLUS_RATE_MICRO_USD,
    minimumBillableMs:0,
    billingQuantumMs:1000,
    minimumChargeMicroUsd:0,
    fixedFeeMicroUsd:0,
    taxBasisPointsUpperBound:0,
   },
   output:{
    width:720,height:1280,fps:25,
    videoCodec:"h264",audioCodec:"aac",
    maxDurationSeconds:32,durationToleranceSeconds:0.1,
    transfer:{
     maxBytes:100_000_000,timeoutMs:120_000,
     evidence:"Private verified MP4 output under 100 MB, 120-second transfer and 720p normalized export with immutable owner-only delivery",
    },
   },
   outputHosts:["v16m-default.tiktokcdn.com"],
  },
 };
}
