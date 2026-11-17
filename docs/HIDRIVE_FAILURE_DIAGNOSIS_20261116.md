# Offline diagnosis of the 16 November synthetic HiDrive attempt

Baseline: PR #278 commit `71c5f4c`; stored run report and JSON evidence only.
No Railway read/write call, HiDrive request, upload or second live run was performed
for this investigation. Network activity in the new tests is loopback HTTPS only;
HiDrive HTTP construction is exercised with an injected in-memory fetch substitute.

## Findings, with confidence limits

The receiver reached READY after existing OAuth refresh/persistence, token validation
and private-folder verification. Sender then logged only a generic failure; neither
remote commit nor restore success was recorded. Stored narrative records private
8443 traffic and HiDrive HTTPS traffic during the sender attempt. This supports an
upload-stage investigation, but encrypted flow metadata cannot prove which request
failed, its HTTP status, or whether the first synthetic object was created.

Confirmed diagnostic defects:
- Sender's entrypoint discarded the error. Its private transport collapsed HTTP
  403/404/409/422 into one refusal and collapsed timeout/TLS failures into unreachable.
- Receiver caught validation/storage errors and returned empty 422 without a safe
  local diagnostic. Thus an upstream HiDrive denial was indistinguishable from
  spool validation, hash failure or commit validation at the sender.
- HiDrive adapter discarded the upstream rejection status.

Concrete request difference and bounded correction:
- Old successful `syntheticProbe` passed a Buffer to PUT /2.1/file with dir/name.
- Failed adapter passed createReadStream to fetch (duplex=half), no Content-Length;
  this permits chunked transfer. It additionally supplies overwrite=false.
- The bounded adapter now reads the already validated private ciphertext spool into
  a size-checked Buffer and hidriveRequest explicitly sets Content-Length in bytes.
  The approved synthetic path caps each artifact at 1 MiB. No plaintext is buffered
  by the receiver. Larger production backups still need a bounded streaming design.
- Method PUT, bearer header, octet-stream content type, URL-encoded dir/name,
  overwrite=false, redirect refusal and subsequent GET path are retained and tested.
  Removing overwrite protection to make an upload succeed is not an acceptable fix.
- A provider rejection of chunked uploads (e.g. 411) or of the overwrite parameter
  remains a hypothesis. There is no saved response or offline provider specification
  proving either. This is a tested framing correction, NOT a proven historical root
  cause or proof that the next live upload will succeed.

Other possible stages: local fixture/encryption/signing, spool permissions and hash,
DNS/TCP/server certificate/hostname, client authorization, duplicate/busy/wrong-run
conflict, HiDrive transport or HTTP rejection, remote readback size/hash, manifest
upload, receipt upload/readback and commit validation. Existing completed mTLS and
restore suites were not rerun; their prior successes cannot prove this run's result.

## Safe error vocabulary

Only allowlisted phases and codes are rendered. No error message, stack, HTTP body,
URL, path, token, certificate, key or provider header is logged or returned.

Examples:
- BACKUP_ARTIFACT_UPLOAD_TLS_HOSTNAME / TLS_CERTIFICATE / TIMEOUT / TRANSPORT
- BACKUP_ARTIFACT_UPLOAD_AUTH_REFUSED / NOT_FOUND / CONFLICT / RECEIVER_REJECTED
- BACKUP_HIDRIVE_PUT_HTTP_411 versus BACKUP_HIDRIVE_READBACK_HTTP_403
- BACKUP_ARTIFACT_UPLOAD_INTEGRITY / SIZE / SPOOL / VALIDATION
- BACKUP_MANIFEST_UPLOAD_*, BACKUP_COMMIT_*, BACKUP_READ_*, BACKUP_SESSION_*

The sender still receives an empty 422 for storage/validation rejection; only the
receiver's private log distinguishes the underlying allowlisted code. Unknown
provider status/error text falls back to REMOTE_HTTP or UNKNOWN. No retry is added.
The receiver's TLS handshake error listener emits only the same safe vocabulary.

## New local validation

Five targeted tests pass:
1. Real hidriveRequest construction through injected fetch: method, endpoint,
   encoded query, bearer, octet-stream, explicit byte length, no stream duplex,
   redirect refusal. No real request leaves the process.
2. Simulated PUT 411 and readback 403 yield different safe phases; neither commits.
3. Private refusal mapping, TLS/timeout classification and malicious error-text
   suppression.
4. Actual loopback mTLS receiver with failing storage: receiver records safe 411
   diagnostic, HTTP remains empty 422, sender preserves RECEIVER_REJECTED.
5. Corrupt/oversized readback and transport failure cannot commit; transport failure
   does not perform a readback.

Targeted ESLint passes. Old fake-remote fixture was adjusted to accept Buffer bodies
and the typed integrity code; that completed suite was not rerun. Dockerfiles that
copy the shared receiver now include the new error vocabulary module. No image was
deployed or built remotely.

## Future exact-file, read-only residual check — NOT implemented or authorized here

Run `be7fc257-d46d-49d9-92cd-f9cfd85da03e` permits inspection of exactly these names
inside the existing private SingMotion-DR folder, whose account path stays on worker:

- sm-be7fc257-d46d-49d9-92cd-f9cfd85da03e-eaf749d6-2f2a-4bc6-b1dc-1d3189d6013b.enc
- sm-be7fc257-d46d-49d9-92cd-f9cfd85da03e-d9925209-943f-445b-92d5-05f916669408.enc
- sm-be7fc257-d46d-49d9-92cd-f9cfd85da03e-COMMITTED.enc

A separately reviewed inspection-only worker mode should construct these three
literal paths internally and issue exactly one GET /2.1/file per path, without
listing a directory or following redirects. No PUT, DELETE, overwrite, producer,
new sender or restore service. Treat 404 as absent; do not treat 403/5xx/timeout as
absence. For 200, stream at most 1 MiB per artifact (receipt capped at 16 KiB), hash
ciphertext locally, and emit only ordinal, HTTP category, byte count and hash.
Cancel on overflow or unexpected response; never log bodies or full account paths.
Existence or a receipt alone does not prove archive integrity or successful restore.
No recovery key is needed for this inspection; no content leaves the worker except
those synthetic metadata results.

The existing OAuth state must stay on the original /state. OAuth refresh is a POST
and may rotate encrypted token state: file inspection can be read-only, but the
entire session is not strictly state-free. Any future approval must explicitly
include that refresh and temporary worker image/mode change. Existing
existingHiDriveSession is gated as a transfer mode, so do NOT reuse that activation
as if it already were a read-only mode. A dedicated allowlisted inspection entrypoint
must first be implemented/reviewed; this document is not executable authorization.

After any future inspection, restore by reusing original deployment image
997727b4-ab05-4949-8ec7-63d10d3741c1, verify runtime commit d36acf6 and setup-only logs,
keep refreshed OAuth state. Config pin alone was insufficient in the prior rollback.
This task requests no new live approval: resolve offline findings and prepare that
inspection-only implementation before proposing a new concrete Production change.
