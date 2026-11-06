# SingMotion AI — Phase 1: controlled release and video integrity

## Non-negotiable rules

1. Never use a paid BytePlus submission to test a release. Synthetic FFmpeg MP4s and mock transport validate the code; any real provider pilot is separately authorized.
2. Never republish an output if its timing, video format, audio packets, codec or ownership checks fail. Keep the original provider task ID, billing reservation and recovery source for reconciliation; never automatically resubmit a paid task.
3. **No direct Production-first changes.** Prepare changes on a feature branch, run the offline export suite, deploy the exact commit to Staging, validate it there, and only then promote that tested commit to Production.
4. A successful web build alone is not an export acceptance test. `npm run build` now runs `test:video:release` so the Docker/Railway builder cannot silently skip the FFmpeg checks.
5. A green build does not imply a successful provider integration or an accepted watermark preference. Do not claim real-video success until an authorized provider output has been verified.

## Commands

```sh
npm ci
npm run test:release-parity
npm run test:video:release
npm run build
```

`test:video:release` covers audio-preserving MP3 remux, AAC-only validation, video orientation and format, duration, tempo restoration, upload errors and BytePlus request wire format (including `enable_watermark: false`). No network or payable generation is required.

## Staging → Production promotion

Retrieve the **actual** deployment status, Git commit and build strategy from Railway for the target environment (not from the local Git branch or a guessed branch name).

```sh
node scripts/release-parity.mjs \
  --staging-sha STAGING_DEPLOYED_COMMIT_SHA \
  --candidate-sha PROPOSED_PRODUCTION_COMMIT_SHA \
  --staging-status SUCCESS \
  --staging-builder RAILPACK \
  --production-builder RAILPACK
```

If deploying the same immutable image rather than separate builds, include `--staging-image-digest sha256:...` and `--candidate-image-digest sha256:...` so both must match. The script exits nonzero when supplied metadata do not match. Verify provenance from Railway; command-line values alone are **not an attestation**. Never use the current Production Git branch tip as proof of what was already tested in Staging.

Only after a passing check and human review: deploy the identical commit/image, confirm Railway `SUCCESS`, verify startup/recovery health, and check one previously authorized existing video output (status, duration, original audio and download). Roll back the deployment on failure without erasing provider ledgers.

**Important:** This repository-only guard does not stop Railway's currently configured automatic Production deployments. Production must be configured to require review/approved CI and prevented from auto-deploying arbitrary branch pushes before this process can be called enforced end-to-end. Do not switch the live Production source or restart paid workers merely to test the release guard.

## Observed environment drift — action required

At the Phase 1 audit on November 6, 2026:

| Environment | Deployed commit | Git branch | Builder |
|---|---|---|---|
| Staging | `7306966daaba41e4bb2c77ed9801f186a3518868` | `feat/production-private-customer-preview-300s-20261105` | NIXPACKS |
| Production | `f228d31ca2bed3c69f6633f8a49ab5e82856f587` | `fix/super-admin-visible-provider-quote-20261105` | RAILPACK |

**Current promotion is BLOCKED:** source commits and builders differ. Preserve the working Production deployment while testing the new Phase 1 branch in Staging. Do not merge or promote blindly: Staging may contain separate customer-preview changes that need review before any source reconfiguration.

## Runtime incident checklist

When Studio displays a `TEMPO_RESTORATION_FAILED` error, find the bounded `STUDIO_EXPORT_STAGE_FAILURE` diagnostic in private Railway logs for the exact attempt ID. Determine whether the cause is `OUTPUT_CODEC_MISMATCH`, normalization timing, audio packet integrity, duration, filesystem/FFmpeg, or provider transport. Never expose signed provider URLs, uploaded audio, raw FFmpeg stderr or private file paths to browser diagnostics. Fix the specific failing predicate, introduce a synthetic regression case that fails before the fix and passes afterward, then promote by exact commit.
