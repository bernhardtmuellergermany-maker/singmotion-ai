# Private Studio tempo processing

OFF by default. `AUDIO_TEMPO_ENABLED=true` enables standard pitch-preserving
0.9x processing under the operator's existing BytePlus authorization. No custom
authorization file, SSH, recording/image-hash entry or additional permission
checkbox is required. The flag is an operator configuration decision, not proof
of provider permission. It does not expand the actual authorization scope.
Leave it OFF if that authorization does not cover the workflow or selected content.
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

1. Make this reviewed revision available through your normal authorized staging
   deployment process. No deployment or Railway settings were changed here.
2. In Railway **staging service → Variables**, set `AUDIO_TEMPO_ENABLED=true`.
   This uses the operator's existing authorization for standard 0.9x processing;
   it does not claim new BytePlus permission or bypass content moderation.
3. Keep `STUDIO_TERMS_VERSION` aligned with the published `/terms` page. Keep
   `DATA_DIR=/app/.data`, `GENERATIONS_ENABLED=false`, existing private pilot
   allowlist, worker, cost policies, EUR 50 budget and all other safeguards.
   Apply the variable through your normal staging rollout process; no SSH needed.
4. Reload Studio and prepare a **new cost review**. Old file-bound unsubmitted
   tempo plans require a fresh review; no stored plan is converted or deleted.
   Existing submitted jobs still recover from their immutable media and task IDs,
   with the flag ON or OFF. Any old `byteplus-tempo-authorization.json` is ignored
   and left untouched; no cleanup or replacement is required.
5. Inspect the measured slowed MP3 duration and reservation: a 15-second selection
   becomes approximately 16.67 seconds plus MP3 padding. The existing reviewed
   band and ceiling must cover that encoded duration. Nothing silently increases
   a spending limit or shortens your selection.
6. Confirm rights if the content/Terms changed, then separately approve the paid
   generation. Activation and cost review never submit a paid request themselves.

Remaining authorization limitation: this software cannot independently verify
private account agreements or the recordings covered by them. Existing operator
permission is used as instructed, not replaced with invented provider evidence.
If permission expires, is withdrawn or excludes particular content, disable the
flag or do not submit that content. Normal BytePlus moderation stays in place.

## Safety and recovery

Never use this as a copyright-filter workaround. Known failures/rejections of
the recording block tempo processing, including reuploads matched by full-file
hash. Different retained full-source hashes can establish a byte-level non-match;
source IDs are compared with their owner. Exact rejected clips are checked again
after trimming and before paid submission. New plans record full-source identity
at preparation, including plans prepared without tempo processing.

A legacy rejection without resolvable recording provenance is **unknown**, not a
match to every recording. Studio displays `TEMPO_IDENTITY_REVIEW_REQUIRED` and a
Super Admin independent-recording evidence form. For a newly uploaded recording,
reference the original recording/session or master, creation date and verifiable
basis for independence, then explicitly confirm you reviewed that evidence.
Upload date, filename, hash difference or a generic acknowledgment alone is not
proof. The server requires an upload after the historical tasks and stores the
assessment against its owner, source ID, exact full-source hash and retained
legacy evidence. This is a staff evidence assessment, not automatic verification
of its truth, reconstructed historical provenance or extra provider permission.
If you cannot substantiate independence, do not approve the assessment or submit
a modified recording. Rights confirmation remains separately mandatory.

After saving the assessment, click **Review real video cost — no paid request**
again. No generation or retry starts automatically. Known source/clip matches
always block, even with an assessment. Changed bytes, another upload ID or newly
retained rejection evidence require a new applicable review. Missing historical
files remain unknown; nothing is fabricated, deleted or backfilled into old jobs.
Existing reservations, task IDs and rejection records stay unchanged. Evidence is
appended to private `live_recording_independence_reviews` audit records. Matching
is based on reliable retained identifiers/hashes, not semantic/acoustic recognition;
re-encoding or renaming rejected material is never an authorized workaround.
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
- Flag ON: no file needed; automatic source/image integrity and ownership checks
  remain. Rejection history blocks tempo without a new provider task.
- Existing file-bound unsubmitted review: obtain a fresh cost review. Submitted
  task recovery remains independent of the removed authorization file.
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
separate permitted recording. Unresolved legacy identity requires the scoped
evidence review above; it is never silently treated as a non-match.

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
