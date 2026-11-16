# Authorized one-time synthetic HiDrive run — aborted and rolled back

Test commit: `0b91aa98e5c6d3077f38d77badb0fe58ea4c0f0d`, PR #278 / Issue #230.
Run: `be7fc257-d46d-49d9-92cd-f9cfd85da03e`. All timestamps below UTC.
Scope was explicitly approved by the owner against HIDRIVE_SYNTHETIC_APPROVAL_PLAN.md.

## Observed result

- Receiver deployment `e3605322-e8d1-4b03-bc8d-15e94ab58bd0` reached SUCCESS and
  logged `HIDRIVE_SYNTHETIC_PRIVATE_RECEIVER_READY` at 21:43:51.532. This code path
  follows successful refresh and encrypted persistence of the existing OAuth state
  on the original /state volume, token validation and private-folder verification.
- Sender deployment `f5d247a7-983c-42a8-81b9-26427d43aeda` logged
  `HIDRIVE_SYNTHETIC_INTEGRATION_FAILED` at 21:45:04.427. Railway reported SUCCESS
  when polled, but that platform status is not application success.
- Restore deployment `d9d7ac76-9730-4887-959c-40d4c8ba054a` was DEPLOYING with no
  runtime success marker when failure was detected. Both temporary services were
  deleted immediately through the connector; deletion calls completed sequentially.
- No `HIDRIVE_SYNTHETIC_REMOTE_COMMIT_VERIFIED`, sender-completion or independent
  restore success marker was observed. Upload/download/restore success is NOT proven.
- Receiver DNS/network logs show private IPv6 communication on 8443 and a connection
  to api.hidrive.strato.com:443 around 21:45:02. Encrypted flow metadata cannot establish
  HTTP status, upload success, exact error, or which remote files exist.

The generic sender error and receiver's deliberately generic 422 response suppress
failure details. The exact cause is unresolved; do not infer a TLS, OAuth or provider
failure from these logs. A partial synthetic remote object may remain. No remote
inspection/deletion or second test was performed after the abort. Future work should
add allowlisted stage/error-code telemetry without tokens, response bodies or paths,
then review the storage adapter offline. Any further live run needs fresh approval.

## Verified rollback

- Initial rollback deployment `79371544-f8ed-4520-b5a8-0166cfb74f06` logged setup-only
  readiness, but its deployment metadata unexpectedly named branch head `7ce50e3`
  despite config commitSha `d36acf6`. Therefore its image was not accepted as exact rollback.
- Redeployed the original deployment `997727b4-ab05-4949-8ec7-63d10d3741c1` build.
  Final deployment `76de451e-465c-4f11-b205-a8a41d647150` reached SUCCESS, metadata
  confirms exact commit `d36acf6d8f5b268ffef907c53f0524c90d7b852f`, and runtime logged
  `HIDRIVE_WORKER_SETUP_READY_NO_DATA_TRANSFER` at 21:49:31.816. The intermediate
  rollback and test deployments are REMOVED. No synthetic test was repeated.
- Config readback: commit `d36acf6d8f5b268ffef907c53f0524c90d7b852f`, branch
  `release/production-promoted-20261114`, `Dockerfile.backup`, restart NEVER.
  BACKUP_MODE was explicitly restored to SETUP_ONLY_NO_DATA_TRANSFER; setup marker
  also confirms BACKUP_ENABLED=false passed the original worker's startup guard.
- Original volume `00e52dae-7be6-45aa-9e2d-898404b2c17e` remains mounted at /state.
  No token copy, reauthorization or state rewind occurred; refreshed state is retained.
- Deleted sender `28648f54-1d37-4383-aa15-6c5907238d02` and restore
  `6afa781d-a626-4b02-99e4-cbb7c413e2aa`; deletion responses report no detached volumes.
  Environment readback contains only original three services and no staged changes.
- Application deployment remains `caab895b-6bc2-4ad1-b096-711fbb305f3f`; PostgreSQL
  remains `3e489cc9-aab9-45a2-a6f3-4dd5c3f1f06f`. No R2, Stripe or BytePlus operations.
- No cron, automatic restart, public domain, TCP proxy or real customer-data source
  was introduced. Receiver runtime was under four minutes; temporary services were
  removed within two minutes of sender startup. No old test suite was rerun.

Machine-readable, non-secret runtime evidence is in HIDRIVE_SYNTHETIC_RUN_20261116.json.
This records a failed one-time integration with successful infrastructure rollback,
not a verified HiDrive backup or independently recovered archive. Remote synthetic
file state remains unverified. Provider usage costs were incurred; no billing total
is available from these logs.
