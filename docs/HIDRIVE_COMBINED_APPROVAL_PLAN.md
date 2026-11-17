# One combined cloud-only synthetic test — prepared, NOT authorized or run

Supersedes the earlier one-run activation proposal, not its historical evidence.
All implementation remains in PR #278. Preparation used local fixtures only, with
no Railway platform calls, HiDrive calls, deployment, production change or customer data.

## Implemented scope

- `hidrive-residual-check.mjs`: immutable three names from first run
  be7fc257-d46d-49d9-92cd-f9cfd85da03e; exactly one GET per name. No directory listing,
  PUT or DELETE. 404 means absent; all other errors abort. Artifact limit 1 MiB each,
  receipt 16 KiB. Reports ordinal/existence/size/ciphertext hash, never paths/bodies.
- Existing private receiver performs that check after original-volume OAuth refresh,
  before opening its upload listener. A check failure prevents the new upload.
- Existing fixed-length ciphertext upload, readback hash, encrypted signed manifest,
  TLS 1.3 pinned writer/reader identities and separate restore process retained.
- V2 test activation now expires (25 minutes from cloud preparation; no process
  exceeds 15 minutes, receiver listener at most 10 minutes). No download retry loop.
  Older V1 activation is no longer accepted by the temporary entrypoint.
- New test bundle: fresh RSA-3072 recovery key, Ed25519 signer, per-role short-lived
  certificates. Checks issuer signature, matching TLS private key and expiry before
  any OAuth activity. Recovery private key only restore, signer private key only
  sender; SHA-256 public-key IDs are signed into manifest and checked during restore.
- Cloud controller uses existing authenticated Railway connector; no Railway CLI,
  SSH, raw platform token or new login. It requires explicit approval argument,
  verifies baseline, creates only the two named fixture services, checks exact
  deployed commit, monitors fail/success markers, and executes cleanup in finally.
  No unencrypted keys enter its journal. All artifacts remain synthetic.
- Controller requires inspection completion, sender completion, remote commit and
  restore's run/service identity plus signature/AEAD/hash flags before success.
  Errors and deadline cause cleanup, not upload/deploy replay.
- Original image is reused on rollback, not just a config SHA pin. It waits for the
  setup-only config deployment to settle before redeploying the original image,
  preventing a pending rebuild from replacing that image afterward.

## Single requested approval

Approve ONE invocation of `runCombinedTest` on the reviewed PR commit, with a new
in-memory bundle, and the following changes only:

1. Existing Production worker 4dfb0406-e0a0-48b1-aa6b-0e36cd89190a temporarily uses
   Dockerfile.hidrive-integration and reviewed code. Change only BACKUP_MODE to the
   allowlisted PRIVATE_SYNTHETIC_V2 configuration. BACKUP_ENABLED remains false.
   Keep original /state volume, existing OAuth configuration and restart NEVER.
2. Create only backup230-hidrive-sender and backup230-hidrive-restore in that same
   private Production environment, each limited to 1 vCPU and 0.5 GB, restart NEVER,
   no volumes/public domains/TCP proxies/cron or unrelated service credentials.
3. Refresh existing OAuth and persist rotated state ONLY in original /state.
   Read exactly the three old synthetic files. Maximum returned body: 2 MiB +16 KiB.
   No cleanup/deletion of old files. Any unexpected status/oversize aborts the test.
4. If inspection succeeds, generate/upload ONE fresh fixed artificial text fixture
   and encrypted signed manifest, plus receipt: exactly three possible new files
   in existing private SingMotion-DR. New random run IDs, overwrite=false, no retry.
   At most 2 MiB + small receipt, normally a few KiB. No old-file overwrite.
5. After sender and remote commit markers, deploy separate restore service once.
   It downloads through pinned reader mTLS, verifies signed key IDs, signature,
   ciphertext hash, AEAD, plaintext hash and exact fixture. Its private key is never
   available to producer or receiver. No app/CMS/R2 data sources are enabled.
6. On success or failure remove both temporary services, restore original config,
   then reuse deployment 997727b4-ab05-4949-8ec7-63d10d3741c1 image. Verify runtime
   commit d36acf6d8f5b268ffef907c53f0524c90d7b852f, Dockerfile.backup,
   BACKUP_MODE=SETUP_ONLY_NO_DATA_TRANSFER, setup-only marker, original /state,
   no staged changes, and unchanged app/Postgres deployment IDs. Retain refreshed
   OAuth. Never delete/detach worker/volume or restore old OAuth tokens.

No authorization for real customer data, R2/Stripe/BytePlus/Postgres changes, public
exports, scheduled runs, subscriptions, remote-file deletion or another live attempt.
Old and new synthetic files remain. Test recovery keys are disposable and destroyed
with services/controller memory; do not present these files as long-term recoverable
archives after disposing of their keys.

## Costs and time bounds

- Two fixture service builds/deployments, temporary receiver build/deployment,
  setup-only rollback build and original-image redeployment. Provider build time,
  rollout overhead and billing granularity are additional to process runtime.
- Two new services together: at most 0.5 vCPU-hours and 0.25 GB-hours for 15 minutes
  each at resource limits. Existing receiver uses its existing limits for at most
  15 minutes. A 20-minute controller deadline covers progression; individual
  deployment/marker waits cap at 3 minutes and cleanup proceeds separately.
- Three old-file GETs; successful new run uses 3 PUTs +5 GETs, plus OAuth/tokeninfo/
  private-folder metadata. Few KiB expected new storage/egress; retained objects may
  incur ongoing storage fees under existing HiDrive plan. Failed runs may leave
  fewer synthetic objects; do not claim exact zero residuals without inspection.
- No new paid plan, persistent volume, always-on service or agent automation.
  Exact euro cost is not known; resource limits are not a monetary provider cap.

## Automatic rollback: scope and limitation

`hidrive-combined-controller.mjs` performs rollback automatically in finally after
normal success, detected runtime/build failure and deadline. Each cleanup attempt
is independent; a service deletion error does not suppress worker restoration.
It journals resource IDs and checkpoints, discovers only the two exact newly-owned
names after a lost creation response, and refuses deletion of unexpected volumes.
Rollback failures are explicitly ROLLBACK_INCOMPLETE, never a false success.

This is NOT a provider-hosted durable timer. If the Codex cloud execution environment
is killed, a connector call never returns, or Railway's control plane is unavailable,
finally cannot guarantee timely config restoration/service deletion. In-process
expiry stops backup work within its limit but cannot restore platform config. No
additional control-plane credentials or paid watchdog service have been silently
introduced. This limitation is part of the approval, not a guarantee of unattended
infrastructure cleanup under platform failure.

If interrupted, resume from the non-secret cloud journal: inspect the two exact
names, delete only those volume-free services, restore mode/source/Dockerfile and
reuse original build, verify logs and runtime SHA. This uses the same connector
from the cloud; no personal computer or OAuth login is necessary.

## Cloud execution handoff (after approval only)

- Read current reviewed commit and baseline; no existing staged changes may be applied.
- Generate bundle with createCombinedBundle inside cloud execution, capture the
  returned JSON without printing/storing secrets. Do not regenerate after test failure.
- Load runCombinedTest into the cloud tool orchestration context; pass the current
  authenticated `tools` object, approved full SHA, bundle and exact approval string
  ONE_SYNTHETIC_COMBINED_RUN_WITH_ROLLBACK. It calls only named connector methods.
- Supply an awaited journal callback saving sanitized controller evidence in the
  cloud workspace before each activation, after creation and verification, and on
  cleanup. The journal must never include bundle or raw connector variables/logs.
- Clear bundle references after cleanup; commit only sanitized evidence to PR #278.
  No new PR. Any subsequent live run requires a fresh approval.

## New verification, not repeated historical suites

Six new local tests pass: exact residual GET scope; rejection/oversize/truncation
abort; key/certificate/expiry validation; controller success with original-image
rollback; provisioning/activation failure rollback and refusal without approval;
signed key-ID mismatch rejection before artifact access. Targeted ESLint passes.
Connector calls are simulated in controller tests. No claim of real HiDrive success
or live-tested automatic rollback is made for this implementation.

## Remaining requirements for full automatic customer backup

The prepared test completes the artificial HiDrive transport/restore acceptance path
when successful. It does not by itself complete disaster recovery for SingMotion:

- Application-context SQLite snapshots, native PostgreSQL dump, paginated R2 SDK
  adapter and encrypted artifact producer exist from earlier work. Live source
  wiring, realistic scale/chunking, cross-store consistency and actual application
  recovery acceptance remain unproven and need separately authorized staging data.
- Current receiver's committed-run index is in memory. Long-term restore discovery
  after worker loss/restart needs authenticated durable inventory/reconstruction;
  a fresh separate restore process in this test does not prove that scenario.
- Permanent recovery-key escrow independent of worker, versioned recovery/signing
  keyring retention, automated certificate renewal with verified overlap/revocation,
  and durable expiry/run-failure alert delivery are not provisioned. Test key IDs,
  role separation and expiry checks are implemented foundations, not escrow.
- Retention deletion remains disabled until owner approves generations/horizon and
  recovery-key retention. No automatic schedule, RPO/RTO or backup attestation.
- Structured runtime errors and controller failure/rollback events are available;
  an external alert destination is not configured and no messages were sent.

Do not activate recurring or customer backups based solely on this synthetic run.
