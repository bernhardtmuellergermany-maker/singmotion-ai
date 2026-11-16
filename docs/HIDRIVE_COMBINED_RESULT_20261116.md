# Single authorized combined test: inspection succeeded, controller aborted, rollback verified

Approved/tested commit: `57c6c51384b99fad5614a18f8d20496b1e059140`.
New reserved synthetic run: `4201c975-ca06-4422-a8b5-dd24650e01ec`.
All evidence timestamps below UTC on 2026-11-16. The one-use approval is consumed.
No second invocation, repair/redeploy of the test, upload retry or old test rerun.

## Actual HiDrive result

Receiver deployment `d041de2c-3e37-46a5-903e-78b6ef2be51b` ran exactly the approved
commit. At 22:13:15 it logged all three `HIDRIVE_RESIDUAL_RESULT` entries as `absent`,
then the completed-inspection and private-ready markers. In this implementation,
`absent` is emitted only for HTTP 404 from GET of the exact corresponding filename.
The old artificial run `be7fc257-d46d-49d9-92cd-f9cfd85da03e` therefore had none of its
three known artifact/manifest/receipt names present at inspection time. No directory
listing, content download of an existing file, deletion or overwrite was performed.
Existing OAuth was refreshed and persisted on the original /state before inspection.

Railway returned the three result logs in ordinal order **3, 1, 2**. Their stored
collector timestamps were also ordered that way (all within the same millisecond).
The controller at the approved commit requires `ordinal === array index + 1` and
therefore took its `RESIDUAL_EVIDENCE_INVALID` branch despite all three results being
present. The journal records TEST_FAILED immediately after receiver readiness.
This is a controller evidence-ordering defect, not a demonstrated HiDrive rejection.
No code change or second attempt was made under this single-use approval.

## Upload and independent restore

Neither temporary sender nor restore was connected to a source or deployed: the
failure occurred before their activation statements. Consequently no new synthetic
file PUT and no new-run download/restore happened. The three old-file GETs succeeded
as absence checks; the full upload/download/restore chain remains unproven.
No customer data or production application/database data was accessed by the test.

## Actual automatic rollback

The controller's finally block ran and ended with ROLLBACK_VERIFIED:

- Deleted temporary sender `c8ec5b3b-7961-49ca-a8cd-a26d7922a8f8` and restore
  `f0a0e85f-d5fe-4859-b9c5-98992a61c127`. Final inventory contains only original
  application, PostgreSQL and backup worker services.
- Restored source branch, source pin, Dockerfile.backup and
  BACKUP_MODE=SETUP_ONLY_NO_DATA_TRANSFER; waited for setup-only deployment
  `638c6a73-dc97-4971-b1de-5cb97f6b28c5` before reusing the original build.
- Reused original deployment `997727b4-ab05-4949-8ec7-63d10d3741c1` image. Final
  deployment `508c9c41-f634-4d8d-8c22-84633eefec42` is SUCCESS, runtime metadata
  confirms exact commit `d36acf6d8f5b268ffef907c53f0524c90d7b852f`, and logs
  `HIDRIVE_WORKER_SETUP_READY_NO_DATA_TRANSFER` at **22:15:22.304876361**.
- Intermediate rollback and test deployments are REMOVED. Receiver execution was
  under two minutes; no test process exceeded 15 minutes.
- Original OAuth volume `00e52dae-7be6-45aa-9e2d-898404b2c17e` remains at /state.
  Refreshed OAuth state was retained; no copies, new login or token rewind.
- No pending staged changes, no public domain/TCP proxy, restart NEVER, no cron.
- App remains `caab895b-6bc2-4ad1-b096-711fbb305f3f`; PostgreSQL remains
  `3e489cc9-aab9-45a2-a6f3-4dd5c3f1f06f`. No R2/Stripe/BytePlus operations.

Non-secret runtime logs, controller journal and final readback are in the companion
JSON. Temporary bundle references were cleared after cleanup. Provider usage costs
for receiver/rollback execution may have accrued; the logs do not establish a bill.
No further live test is authorized.
