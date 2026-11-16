# Two-service private network integration (#230 / #278)

## Executed evidence — 16 November 2026, 21:23:54 UTC

- Tested code `b0341044558570d1bf6432675463e61aaff66de1`.
- Receiver deployment `ded57dd1-f4fa-4ebe-aa0f-08f7adb29316` logged
  `BACKUP_PRIVATE_RECEIVER_READY` and `BACKUP_PRIVATE_RECEIVER_COMMITTED`.
- Sender deployment `d192ebb7-eaf1-4215-9a6f-ad22a95d53d0` logged
  `BACKUP_TWO_SERVICE_MTLS_VERIFIED` with distinct sender/receiver service IDs,
  `tls:TLSv1.3`, `privateAddress:true`, `addressFamily:6`.
- All six rejection checks passed: absent certificate, incorrect CA, incorrect
  hostname, unpinned client, reader attempting write, writer attempting read.
- `encryptedUpload`, `downloadedCiphertextHash` and
  `independentDownloadedRestore` are true. This is recovery of an artificial
  transport fixture after deleting its local source/ciphertext, not a complete
  cross-store disaster-recovery exercise or a third-service restore.
- `customerData:false`, `hidriveContacted:false`, `r2Contacted:false`.
- Two new local network-role/address tests passed; targeted ESLint passed.
- Initial runtime failures were fixed: private DNS readiness/address family,
  then binding an assigned container interface instead of the service VIP.
  Deployment SUCCESS alone was not treated as proof; the runtime markers above
  are the actual successful evidence. Previous 8/8 test was not repeated.

The previous 8/8 single-container restore suite was not rerun. This adds a
separate, targeted integration of the same ciphertext receiver and sender on
two actual Railway services in staging. Neither the deployed SingMotion web
application nor the existing production HiDrive worker is changed.

## Implementation

- Sender: existing staging test service `backup-230-synthetic`
  (`91dd0814-bcae-4812-9582-135123704219`).
- Receiver: staging-only `backup230-receiver`
  (`ec438b63-880f-46f7-8cb8-dc233936fbe7`).
- Private DNS `backup230-receiver.railway.internal:8443`; receiver resolves and
  waits for private DNS readiness and binds an assigned private IPv4/IPv6
  container interface (the service DNS address may be a virtual address), never a wildcard/public interface.
- TLS 1.3; dedicated two-day test CA and server SAN for the exact private DNS
  name. Client verifies certificate chain and hostname. Server requires a valid
  client certificate and pins exact client fingerprints.
- Distinct writer and restore-reader certificates. Writer uploads/commits;
  reader can only retrieve IDs from the committed run. Unknown identities,
  unfinished runs and arbitrary paths are rejected. This read capability is
  disabled unless a reader fingerprint and storage reader are configured.
- Keys are generated outside the repository, passed directly into scoped Railway
  service variables without printing values, and never baked into the image.
  CA signing key is destroyed after issuing certificates. Receiver never receives
  writer/reader private keys or recovery private key; sender never receives the
  server private key. This is short-lived test provisioning, not production
  certificate lifecycle management.
- The client tests missing certificate, incorrect CA, incorrect server hostname,
  valid-but-unpinned client, reader attempting write and writer attempting read.
- A newly generated artificial fixture is encrypted with the existing envelope
  implementation, uploaded and committed. Local plaintext AND ciphertext are
  deleted, then the restore identity downloads from the other service, verifies
  ciphertext SHA-256, authenticates/decrypts and verifies plaintext SHA-256.
- Both services use `Dockerfile.backup-network`, have no persistent mounts,
  customer/storage credentials, public domains, TCP proxies or schedules, and
  restart policy NEVER. Receiver closes 90 seconds after commit, or fails closed
  after 15 minutes without completion. Temporary files are removed on normal exit.

## Validation and boundaries

New targeted local test `npm run test:backup-network` verifies reader/writer
separation, rejection before commit and isolation by run. Targeted ESLint and
syntax checks pass. The old 8/8 suite is intentionally not part of this command.

This run uses actual Railway private transport and temporary receiver storage.
It does not access HiDrive/R2, perform a production backup, enable a schedule,
or prove full disaster recovery. Production integration, durable key custody,
certificate renewal/revocation, real offsite storage and source-scale handling
remain separate work. The production OAuth state remains untouched.
