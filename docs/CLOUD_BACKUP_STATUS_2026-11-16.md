# Cloud-only backup: verified state and access blocker, 16 November 2026

Tracking: #230. This is **not** a completed backup implementation or restore proof.
No customer data was transferred, no Production code/configuration was changed,
no new infrastructure was provisioned, and no release attestations were set.

## Current platform evidence

Read from Railway on 16 November 2026, rather than inferred from old issues:

- Project `brilliant-sparkle`, Production `36adc41d-7e54-4396-ad1a-fd432ba0441d`.
- `singmotion-ai`: SUCCESS deployment `caab895b-6bc2-4ad1-b096-711fbb305f3f`;
  source `release/production-promoted-20261114`; volume at `/app/.data`, allocation 5,000 MB.
- `Postgres`: SUCCESS deployment `3e489cc9-aab9-45a2-a6f3-4dd5c3f1f06f`;
  configured PostgreSQL 18 image; volume at `/var/lib/postgresql/data`, allocation 500 MB.
  The image tag is not an independently queried server version.
- `singmotion-backup`: SUCCESS deployment `997727b4-ab05-4949-8ec7-63d10d3741c1`;
  private OAuth volume at `/state`, allocation 128 MB; no cron configured, no public domain.
- Backup logs show `HIDRIVE_SYNTHETIC_ENCRYPTED_ROUNDTRIP_VERIFIED` followed by
  `HIDRIVE_WORKER_SETUP_READY_NO_DATA_TRANSFER`. The previous synthetic probe was
  not repeated. `HIDRIVE_AUTH_CODE` is absent from current variable names.
- The current backup image contains only the OAuth/probe worker. It cannot access
  the app volume. OAuth-connected variable reads expose names, not secret values.
- App configuration contains CMS and R2 variable names. Actual object counts,
  bucket contents and source file sizes remain unverified. Volume allocations are
  **not** used as backup sizes or cost estimates.

## Implemented read-only prerequisite

`npm run backup:inventory` is an explicit command intended for authenticated
Railway SSH into the existing app container once reviewed and available there.
It cannot run from web routes/startup and refuses a non-app runtime or root.
It requires no personal computer and opens no network listener/export endpoint.

- Recursively discovers regular files without following symlinks or hardlinks.
- Identifies SQLite by file header, including unexpected additional databases;
  requires the three known critical databases and fails on invalid/missing ones.
- Uses read-only SQLite transactions for counts, integrity and existing Credit
  ledger invariants; does not instantiate application stores or run migrations.
- Counts local media, `cms-public` Payload assets and WAL/SHM companions. These
  must not be omitted just because R2 is also configured.
- Uses one PostgreSQL read-only repeatable-read transaction for schema/count
  discovery. Inaccessible tables fail the inventory instead of being skipped.
- Enumerates all current R2 objects with continuation tokens, rejects stalled
  pagination/duplicate keys and compares two complete passes for drift.
- Emits aggregate counts and a metadata digest; never emits object keys, private
  filenames, user records, connection strings or secrets. ETags and metadata
  digests are explicitly **not** claimed to be content SHA-256 verification.
- Does not claim a global snapshot across all databases/storage systems or
  historical R2 versions. A real backup still needs a consistency window and
  source-to-manifest coverage verification.

Tested here: 8 new synthetic inventory cases; 24 combined tests including the
existing SQLite encrypted export, independent SQLite restore and HiDrive worker
regressions passed. The complete release-parity suite passed 75/75. TypeScript
and ESLint on all three added code/test files passed. Repository-wide ESLint
failed with 31 errors and 88 warnings in unchanged existing files; no new file
was flagged. These existing lint failures were not mixed into this backup task.
No full application build or deployed staging integration was run for this
isolated diagnostic command. These tests do not access Production.

## Concrete connection blocker

The existing cloud workspace was refreshed to Production head `7ce50e3` in a
separate worktree, preserving the original checkout's changes. Railway CLI
5.74.1 was installed in the cloud environment. `railway whoami --json` reports
unauthorized. `railway login --browserless` cannot create a login challenge:

`https://backboard.railway.com/oauth/device/auth`: CONNECT tunnel rejected (403).

The current cloud network policy allows package-manager/GitHub destinations,
but does not include `backboard.railway.com`. A read-only curl reproduced the
same proxy denial. No credentials were requested in chat or copied from OAuth.
The cloud environment connection offers inspection but no request-changes tool.
The owner must allow this domain in the running cloud environment's network
settings. Then the agent can retry login and provide the device authorization
link, usable on a phone. A personal computer and a new HiDrive login are not
required. Additional Railway SSH hosts will be checked only if actually needed.

## Still required before activation

1. Authenticated private runtime access and actual inventory. No production
   source completeness or independent key custody is asserted yet.
2. Reuse WAL-safe SQLite exporter and existing HiDrive state; implement/review
   cloud-only source delivery without public endpoints or volume remounting.
3. Native PostgreSQL export, complete encrypted R2/local-media coverage,
   authenticated manifests, independent decryption key escrow, safe retention,
   failure alert destination and automated restore checks.
4. First synthetic staging integration and security review; then the owner's
   explicit approval of the actual customer-data transfer and any added costs.
5. Real encrypted HiDrive backup and independent isolated cloud restore of
   SQLite ledger, CMS and owner-protected media/range requests, with measured
   RPO/RTO. Never restore onto Production or start payment/provider workers.
6. Only after that evidence: enable a daily schedule and confirm its first run.

No successful real backup date, retention period, recurring cost or RPO/RTO is
available yet. The user's preferred daily frequency is a target, not an active
schedule. HiDrive destination remains the existing private `SingMotion-DR`
folder; no production archive was uploaded there by this work.
