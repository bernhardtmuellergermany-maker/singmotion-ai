# Private Studio tempo processing

OFF by default. Normal BytePlus audio is unchanged unless both
AUDIO_TEMPO_ENABLED=true and a valid exact-recording provider authorization exist.
Rights confirmation is required regardless of the flag. The unchecked checkbox
links to /terms and is validated against STUDIO_TERMS_VERSION server-side.
The private rights_confirmations table records authenticated staff ID (live) or
session owner (demo), project ID, server timestamp, statement and Terms version.
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
   0.9x processing of the specific recording. General API access and ownership
   alone are not provider authorization.
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
MP4 checks. FFmpeg scales video timestamps by 0.9, removes generated audio and
copies the original excerpt's MP3 packets unchanged into the final MP4.
Final audio is MP3, not re-encoded AAC. Verify target-browser MP3-in-MP4 support;
there is no lossy compatibility fallback.

Completion requires matching original hashes/audio packets, duration within
200ms, AV stream starts within 100ms, approved dimensions/FPS and byte limits.
Restoration failures do not mark success or retry paid submission. Recovery uses
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
