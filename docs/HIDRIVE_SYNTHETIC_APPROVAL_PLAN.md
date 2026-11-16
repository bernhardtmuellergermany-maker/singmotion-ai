# Proposed bounded HiDrive integration — approval required

Status: code prepared in PR #278, **not deployed or activated**. No Production
configuration, OAuth state, HiDrive data or customer data was changed by this work.
The successful 8/8 restore and two-service mTLS tests were not rerun.

## New implementation and checks

- `hidriveCiphertextSink.readStream` fetches from actual HiDrive `/file`, verifies
  byte count and SHA-256 in private temporary storage before exposing ciphertext
  to the existing pinned restore identity. It refuses unknown IDs, other runs,
  uncommitted archives and corrupted remote data. No upload-cache fallback.
- `hidrive-private-integration.mjs` has sender, receiver and separate restore roles.
  Sender generates fixed artificial bytes; no source path/database/R2 input exists.
  Restore receives only recovery private key, public signing key and reader mTLS
  identity. It independently downloads, checks signature/context, ciphertext hash,
  AEAD, plaintext hash and the exact expected artificial fixture.
- Recovery private key is forbidden on sender/receiver; signing private key is
  forbidden on receiver/restore; OAuth variables are forbidden outside receiver.
- Four new targeted tests pass, including a fresh remote read after removing the
  upload cache, corrupted-object refusal and recovery in a **separate Node process**
  with source plaintext deleted. A simulated HiDrive transport was used locally.
  Targeted ESLint and syntax checks pass. No actual HiDrive integration is claimed.
- Images: `Dockerfile.hidrive-integration` for existing receiver;
  `Dockerfile.hidrive-fixture` for new sender and restore service. These images have
  not yet been built/deployed. Existing default startup remains setup-only.

## Why an exception to "no Production change" is necessary

The only existing OAuth state is
`/state/hidrive-oauth.v1.json.enc` on volume
`00e52dae-7be6-45aa-9e2d-898404b2c17e`, mounted to Production service
`singmotion-backup` (`4dfb0406-e0a0-48b1-aa6b-0e36cd89190a`).
Staging has no such state. Railway's connector cannot read/copy that file or
execute the new adapter inside the existing image. The proposed test therefore
temporarily runs new code **on that same worker with that same volume**. Nothing
is copied to Staging and no new OAuth authorization is requested.

## Exact proposed temporary Production changes

Project `96ab3402-f974-4cdf-b9a3-408443b17025`, environment
`36adc41d-7e54-4396-ad1a-fd432ba0441d` only, after explicit owner approval:

1. Build and pin the reviewed PR commit on the **existing backup worker** using
   `Dockerfile.hidrive-integration`. Keep its `/state` mount and existing HiDrive
   credentials, restart policy NEVER and absence of cron/public domain/TCP proxy.
2. Temporarily replace **only `BACKUP_MODE`** with
   `PRIVATE_SYNTHETIC_V1:<base64-config>`. The allowlisted config contains approval,
   three fresh UUIDs, short-lived server TLS key/certificate, public CA and writer/
   reader fingerprints. It cannot replace OAuth credentials. It becomes effective
   synthetic-only configuration inside the process; no additional Production
   worker variables are created. `BACKUP_ENABLED=false` remains mandatory.
3. Create two temporary services **in the same Production private network**, e.g.
   `backup230-hidrive-sender` and `backup230-hidrive-restore`. No volumes, public
   domains, TCP proxies, cron, payment/provider/CMS/R2 credentials. Set restart
   NEVER and resource limits of 1 vCPU / 0.5 GB each. No existing app or database
   service is redeployed. Their limited credentials are separate from `/state`.
4. Start receiver first and require `HIDRIVE_SYNTHETIC_PRIVATE_RECEIVER_READY`.
   Then run sender and restore once. Do not blindly replay a partial upload;
   a failed attempt needs inspection and a fresh run ID, never overwrite.
5. Success requires BOTH `HIDRIVE_SYNTHETIC_REMOTE_COMMIT_VERIFIED` from worker
   and `HIDRIVE_INDEPENDENT_RESTORE_VERIFIED` from the distinct restore service.
   Deployment status alone is not sufficient. Record IDs/hashes, never secrets.

The receiver listens for at most 10 minutes after readiness; a 15-minute process
watchdog applies to every role. There is no schedule or automatic restart.

## Exact affected data

- One fixed artificial text fixture (run UUID included), its encrypted/signed
  manifest, and a completion receipt: **three new HiDrive files** under the
  existing private `SingMotion-DR` folder, named with fresh `sm-<run>-...` IDs.
- Artifact and manifest are encrypted. Receipt contains only random IDs, sizes
  and ciphertext hashes, not plaintext/user data or credentials.
- Code permits at most two 1 MiB encrypted artifacts plus a small receipt; actual
  fixed fixture output should be only a few KiB. Successful flow uses 3 file PUTs
  and 5 file GETs (verification reads plus independent restore), plus OAuth refresh,
  tokeninfo and private-folder metadata requests. No existing object is deleted,
  overwritten, shared publicly or enumerated.
- Normal OAuth refresh may rotate the token. Its new encrypted value is saved
  **only in the original `/state` volume**. This is an expected state change that
  needs approval, even though it contains no customer backup data. Never restore
  an older token-state copy afterward: it may invalidate the working grant.
- Temporary plaintext exists only in sender/restore ephemeral private directories
  and is removed on normal completion/error; forced process termination relies on
  disposal of the temporary service filesystem. Receiver stores ciphertext only
  outside `/state`.

## Possible costs (not a fixed-price quote)

- Railway: one receiver image build/deployment, two small fixture-service builds/
  deployments, their CPU/RAM usage, and a rollback deployment. New service runtime
  is limited to 15 minutes each (combined maximum 0.5 vCPU-hours / 0.25 GB-hours
  at the proposed limits). Existing receiver also has a 15-minute execution limit;
  its current account resource limits remain unchanged. Builds/rollout and provider
  billing granularity are additional and are not bounded by the in-process timer.
- Public egress only for the small HiDrive upload requests; private Railway
  communication and downloaded ciphertext are separate from public egress.
- HiDrive: three tiny files and the requests above against the existing plan;
  any storage/traffic charges depend on that plan. No new subscription, persistent
  volume, paid provider job or plan upgrade is proposed.
- Exact euro charges cannot be established from the exposed account information.
  Do not promise a numeric price cap. Railway documentation search identified its
  resource-pricing page but page fetching did not return the actual rates.

## Rollback / cleanup

Baseline recorded before any mutation:
- Production worker source `release/production-promoted-20261114`, pinned commit
  `d36acf6d8f5b268ffef907c53f0524c90d7b852f`, Dockerfile `Dockerfile.backup`.
- Existing deployment `997727b4-ab05-4949-8ec7-63d10d3741c1`; restart NEVER;
  original `/state` volume unchanged; no public endpoint/cron.
- Existing mode `SETUP_ONLY_NO_DATA_TRANSFER`, enabled false, previously evidenced
  by setup-only runtime logs. Recheck baseline metadata immediately before applying.

On success OR failure, restore the original source pin/Dockerfile and set
`BACKUP_MODE=SETUP_ONLY_NO_DATA_TRANSFER`; deploy the original setup-only code.
That single-variable restoration also removes the temporary receiver TLS key and
config from active worker variables. Verify setup-ready log and unchanged mount.
Delete only the two newly created, volume-free fixture services after preserving
non-secret evidence; this removes their active test secrets and recurring runtime.
Never delete/detach the existing backup service or `/state`, and never rewind
the freshly rotated OAuth state. Platform-internal config history may still retain
encrypted historical variable values; short-lived TLS credentials expire.

The **three synthetic HiDrive files remain** as test evidence; this proposal does
not silently add delete permission. They are not customer data. Exact remote
storage rollback would additionally require approving deletion of those three
known test filenames, with no prefix/bucket-wide deletion. Their retained storage
is bounded above; no automatic retention cleanup is enabled.

## Subsequent preparation, not activation

- R2: dedicated synthetic prefix with conditional writes, prefix-scoped pagination
  and IfMatch reads; separate read-only credential for real source backup later.
  No full-bucket test against unknown/customer content and no live-source keys on
  the backup/restore workers. Verify bucket separation before provisioning.
- Keys: recovery private key only in independent recovery custody/service; producer
  gets public key; separate signing key/public verification escrow. Version key IDs
  in manifests and retain old recovery keys while their archives are retained.
- Certificates: short-lived, per-role identities; introduce new/old fingerprints
  during a bounded overlap only after tests; then revoke old identities. Expiry and
  renewal failure must alert. Current two-day test PKI is not a production lifecycle.
- Retention: no automatic deletes. Owner must approve retention horizon, legal
  constraints and protected generations; then dry-run a signed inventory-based
  deletion plan. A verified restore is prerequisite to enabling deletion.
- Monitoring: distinct codes for auth, upload/readback, signature/hash, timeout,
  source drift and missed run. Completion means remote commit AND independent
  restore verification, not process start/deployment success. Select an alert
  destination without including credentials, paths or customer records.

No full automatic backup, real customer-data coverage, RPO/RTO or release
attestation is claimed. Approval requested is for this one artificial test only.
