# Private Studio tempo processing

OFF by default. Normal BytePlus audio is unchanged unless both
AUDIO_TEMPO_ENABLED=true and a valid scoped provider authorization exist.
Rights confirmation is required regardless of the flag. The unchecked checkbox
links to /terms and is validated against STUDIO_TERMS_VERSION server-side.
The private rights_confirmations table records authenticated staff ID (live) or
session owner (demo), project ID, server timestamp, statement and Terms version.
For the private Studio pilot, rights_content_confirmations additionally binds
authenticated staff, media session and a hash of the exact selection. Repeated
review/approval of the same project does not duplicate the receipt. The checkbox
starts unchecked; only an authenticated server receipt can restore it after a
reload. New audio/image, excerpt, motion/camera prompt or Terms requires fresh
confirmation. Changing unrelated UI controls does not. Existing receipts remain.
Publish/review the actual Terms before activation; the version is not legal review.

## Railway variables

- AUDIO_TEMPO_ENABLED=false initially; true only for authorized processing.
- STUDIO_TERMS_VERSION=staging-terms-2026-10-26, or the actual published revision.
  Bump this when the Terms change.
- Keep DATA_DIR=/app/.data, private Studio caps/allowlist, BytePlus/R2 credentials
  and recovery settings unchanged. Existing containers include FFmpeg/ffprobe.
- Keep public GENERATIONS_ENABLED=false, demo safeguards and Stripe unchanged.

## Exact staging activation steps (not performed here)

1. Deploy the reviewed branch through your normal authorized process when ready.
   Initially keep AUDIO_TEMPO_ENABLED=false.
2. Review/publish the Payload /terms page covering music/image rights and this
   processing. Set STUDIO_TERMS_VERSION to its published revision. Reload Studio
   and verify the AGB/Terms link. The checkbox must remain unchecked initially.
3. Obtain real written BytePlus permission explicitly covering pitch-preserving
   0.9x processing of the specific recording OR the broader standard workflow.
   General API access and ownership alone are not provider authorization.
4. Through approved private volume provisioning (Railway SSH as the app UID),
   create /app/.data/byteplus-tempo-authorization.json, mode 0600, owned by the
   non-root app user. Never commit the populated file. Exact schema:

       {
         "provider": "BytePlus OmniHuman 2.0",
         "owner": "<Studio session owner from existing draft export>",
         "sourceSha256": "<SHA-256 of entire original uploaded recording>",
         "imageSha256": "<SHA-256 of exact uploaded artist image>",
         "explicitlyAllowsTempoProcessing": true,
         "evidence": "<actual provider permission reference and scope>",
         "expiresAt": "<actual authorization expiry, ISO UTC>"
       }

   Compute hashes from private original bytes. Evidence needs at least 20
   characters; never fabricate permission or expiry. This file records externally
   verified permission, not automated document authentication. Missing or
   differently scoped permission leaves the original audio path. Malformed,
   incomplete or expired matching permission blocks preparation.

   If actual written permission covers **all owned recordings and reference
   images for this owner's standard preprocessing workflow**, the SAME private
   file can instead contain the schema below. No per-recording file is needed:

       {
         "provider": "BytePlus OmniHuman 2.0",
         "scope": "standard-preprocessing",
         "owner": "<authorized Studio session owner>",
         "coversAllOwnedRecordings": true,
         "explicitlyAllowsTempoProcessing": true,
         "evidence": "<real provider reference explicitly covering this scope and 0.9x processing>",
         "reviewedBy": "<responsible operator>",
         "reviewedAt": "<actual review ISO UTC>",
         "expiresAt": "<reviewed permission validity ISO UTC>"
       }

   The broader scope is never inferred or enabled automatically. Do not choose it
   if permission is restricted to particular recordings/images. An omitted scope
   retains the original exact-hash schema; `scope: "recording"` is equivalent.
   Owner scope, expiry and moderation history still apply to every preparation
   and submission. Changes to permission require a new immutable review. No
   populated permission, scope or expiry has been supplied by this implementation.

5. Set AUDIO_TEMPO_ENABLED=true only after verifying permission, through the normal
   approved Railway configuration/deployment process. Prepare a NEW review.
   Existing immutable plans are never converted.
6. Review the measured slowed provider MP3 duration and reservation. Provider
   duration is roughly original / 0.9: a 15s excerpt becomes about 16.67s plus
   MP3 padding. Existing policies/caps must cover the actual encoded duration;
   a 5–15s band does not cover that slowed 15s input. No cap is enlarged.
7. Generation still requires separate explicit paid approval. These setup steps
   themselves do not submit anything.

## Safety and recovery

Never use this as a copyright-filter workaround. Known failures/rejections of
the recording block tempo processing, including reuploads matched by full-file
hash. A legacy rejection without resolvable recording provenance also blocks
tempo conservatively. Do not reset/delete history to bypass this check.
Disabling a provider filter does not erase a rejection or grant permission.
Checks run during preparation and again before Studio submission.

Original uploads and precise immutable MP3 excerpts remain unchanged. FFmpeg
atempo=0.9 creates a separately hashed private snapshot. Only approved inputs
go to private R2; spending limits use the measured slowed duration. Cleanup
retains both snapshots.

Provider video first passes the existing pinned-IP HTTPS, exact-host, size and
MP4 checks. FFmpeg measures original and processed decoded audio sample lengths,
excluding encoder padding; their ratio must remain within 0.005 of 0.9. Video
must cover that processed timeline (within one frame), start within 100ms, and
already satisfy the reviewed provider duration/size policy. A permitted trailing
provider tail is trimmed, not stretched across the music. Video timestamps use
the measured ratio; generated audio is removed. FFmpeg
copies the original excerpt's MP3 packets unchanged into the final MP4.
Final audio is MP3, not re-encoded AAC. Offline browser checks exercise H.264/
MP3-in-MP4 decoding and playback to completion in installed Chromium, desktop
and mobile emulation. This does NOT establish physical iOS/Safari/Android or
Firefox compatibility: verify the actual target devices before rollout. No
silent lossy fallback or claimed universal codec support is added. Firefox and
WebKit installation was attempted here but their download hosts returned HTTP 403
`Domain forbidden`. On a machine with those Playwright engines installed, run
`TEMPO_BROWSER=firefox npx tsx tests/tempo.browser.ts` and
`TEMPO_BROWSER=webkit npx tsx tests/tempo.browser.ts` (test-only variables).

Completion requires matching original hashes/audio packets, duration within
200ms, AV stream starts within 100ms, approved dimensions/FPS and byte limits.
Restoration failures report TEMPO_RESTORATION_FAILED in the existing project
status, do not mark success, and never retry paid submission. Recovery uses
persisted original metadata even after the feature flag is OFF.

Checks validate temporal alignment, not perceptual phoneme/lip accuracy.
Automatic semantic lip-sync scoring is not implemented. A human must preview
start/middle/end and assess lip-sync. Excess timing mismatch is rejected rather
than arbitrarily stretched, and a validation failure does not undo provider charges.

## Manual checklist

- Flag OFF: unchanged audio path; unchecked required rights checkbox; working link.
- Missing/stale Terms or unchecked consent: blocked preparation/submission.
  Valid review: private consent audit has actor, project, time and Terms version.
- Flag ON without matching permission: original path. Expired permission or
  rejection history: blocked without a new provider task.
- Offline regression: node --experimental-strip-types --test tests/tempo.test.ts
  uses synthetic media only and checks pitch, timing, original packets and recovery.
- Only after separate paid authorization: inspect preview/download, original
  soundtrack/pitch, duration and lip-sync on target desktop/mobile browsers.
  Recovery must keep the same task ID and reservation.
- Disable flag: new tempo submissions stop; existing task recovery still works.

## Consecutive private tests

After authorized activation, select audio/image/excerpt and motion prompt, confirm
rights, click **Review real video cost — no paid request**, inspect the measured
processed duration and reservation, then explicitly confirm that paid generation.
Preview/download the completed private project. Use **Start fresh test**, change
inputs or prompt and review/approve the next generation. An intentional repeat of
an identical selection uses **Review another test of this selection — no paid
request**. Cost approval is always new, even when rights confirmation is reused.
No restart is necessary. Completed or definitively failed tasks release only the
active-generation lock: every reservation and task ID remains. Uncertain outcomes
still block; reconcile the existing task through the established staff workflow.
A failed/rejected recording cannot be retried through tempo processing. Use a
separate permitted recording; unresolved legacy provenance still fails closed.

Offline integration coverage includes four independent plans: success, success,
terminal rejection, then a different recording; fresh workflow instances recover
the saved task IDs, duplicate submits don't call the provider, foreign owners
cannot read MP4s, and all four reservations count against the EUR 50 policy.
No real provider/R2 call or staging configuration change is part of these tests.

Run `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`,
`npx tsx tests/tempo.browser.ts` and `npx tsx tests/studio-live.browser.ts`.
Before any live test verify the recovery worker health, actual provider permission,
current reviewed **processed-duration** bands and available cumulative budget.
Manually check musical pitch and lip-sync at beginning/middle/end: duration/sample
checks cannot prove perceptual lip synchronization or compensate for provider drift.
