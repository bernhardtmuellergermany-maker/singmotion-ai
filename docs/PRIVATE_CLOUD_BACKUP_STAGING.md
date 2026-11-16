# Private cloud backup implementation — #230 / #278

## Scope and activation boundary

This PR now contains an application-context producer and a ciphertext-only
private backup-worker receiver. They are **not connected to production startup**.
The only executable deployment added is `Dockerfile.backup-staging`: a one-shot,
synthetic-only test. Do not set backup/restore release attestations from it.

The Railway connector can inspect services, environment configuration, mounts,
deployment status and logs; configure/build/deploy services; and set variables.
The exposed tool inventory has no runtime exec, file-read, pg_dump, volume
snapshot, or private R2 listing action. No further SSH/CLI/network attempts are
needed for this implementation path.

## Data flow

1. `produceBackup` executes in the application context owning the source volume.
   It discovers SQLite by header, requires the three critical databases, and
   uses Node's SQLite online backup API for every database (including extras).
   It checks snapshot integrity and the commerce Credit ledger. DB/WAL/SHM files
   are never copied as an inconsistent mutable set. Local/Payload media is
   included; symlinks, hardlinks and changed files fail closed.
2. PostgreSQL uses native `pg_dump --format=custom` with read-only transactions,
   a lock timeout and bounded process lifetime. Remote production connections
   require `verify-full`; the synthetic fixture uses an isolated Unix socket.
   Dumps are temporary private files, then encrypted and removed. The native
   client must match/support the source PostgreSQL version (fixture: 18).
3. R2 uses ListObjectsV2 continuation tokens over the entire bucket, rejects
   duplicate keys and stalled tokens, downloads each object with IfMatch, checks
   size, and compares a second full listing for drift before committing.
   This covers current objects, not historical object versions. SDK credentials
   remain in the app. The staging fixture simulates the R2 adapter, not Cloudflare.
4. Every artifact is AES-256-GCM encrypted with a new random key. RSA-OAEP-SHA256
   wraps the key to the recovery public key. AAD binds each object to run/id.
   The encrypted manifest contains plaintext SHA-256, source names and metadata;
   an Ed25519 signature binds its contents to the producer. Worker sees only
   random IDs, ciphertext lengths and ciphertext hashes.
5. The app pushes ciphertext over TLS 1.3 with mutual certificate verification
   to a dedicated worker port. Server pins the client certificate fingerprint;
   client verifies server CA and hostname. No app export route exists.
   Receiver binds only a private IPv6 address (loopback permitted explicitly in
   synthetic tests), never `::`/`0.0.0.0`. Do not attach a public domain/TCP proxy.
   It accepts one run, enforces exclusive IDs, bounds sizes/counts and publishes
   a receipt only when the exact full set and encrypted manifest were received.
6. `hidriveCiphertextSink` adapts the receiver to the existing worker's encrypted
   OAuth state through `existingHiDriveSession`. It has no authorization-code
   exchange/probe/delete path. It uploads exclusive random names, downloads each
   ciphertext to verify SHA-256 and publishes the completion receipt last.
   OAuth renewal remains local to the worker; existing setup behavior is intact.
   No real HiDrive request is made by the new tests.

## Staging isolation

The separate `backup-230-synthetic` service is scoped to Railway **staging**,
uses no mounted volume, no public domain/proxy, no cron and restart policy NEVER.
The test image has Node 24 and PostgreSQL 18; it creates its own temporary PG
cluster and synthetic SQLite/media data. It does not use existing staging PG,
app volumes, HiDrive, Stripe, provider or R2 credentials. The runner refuses
source credential variables and any environment other than staging with
`BACKUP_DATA_CLASS=SYNTHETIC_ONLY`.

Integration restores into separate temporary files/database and verifies four
SQLite databases (including active WAL and Credit purchase/reserve/settle),
native pg_dump/pg_restore with three fixture content rows, local media and 1,001
R2 fixture objects including zero-byte content. It decrypts with the independent
recovery private key and verifies hashes, manifest signature and ledger audit.
Failure tests cover unauthorized TLS client, missing client cert, public bind,
changed R2 listings, bad ciphertext hashes/tags, duplicate uploads and incomplete
commit. Only the synthetic harness has the recovery private key.

## Explicit remaining limits before production

- This is not an atomic snapshot across SQLite databases, PostgreSQL and media.
  Agree/test a cross-store consistency window and application recovery procedure.
- Current receiver limit is 64 MiB per artifact / 10,000 artifacts; exceeding it
  fails, never truncates. Real source sizing, streaming/chunking, resource limits,
  retry/resume and long-run OAuth refresh need review before real large backups.
- Staging TLS transport is between producer/receiver on loopback in one isolated
  container. Cross-service private DNS, IPv6 binding, certificate/key provisioning
  and rotation still require a separate staging integration.
- No production entrypoint is wired, no customer data transfer approved, no
  production secret/volume changed. The existing HiDrive entrypoint still runs
  its prior modes. Private receiver integration and its separate ciphertext spool
  must be reviewed before changing that entrypoint or app deployment.
- Existing OAuth state is not a recovery key. Independent recovery-key custody,
  signing-public-key escrow, retention/deletion policy, alerting, backup cadence,
  cost limits, full CMS/media ownership/range and recovery semantics, and measured
  RPO/RTO are still required. No automatic success flag is set.

The owner's explicit approval is required before the first transfer of actual
customer data. Synthetic tests are implementation evidence only.
