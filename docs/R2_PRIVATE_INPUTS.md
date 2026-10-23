# R2 private BytePlus input delivery

`lib/live/r2.ts` implements the existing `PrivateInputDelivery` interface with the AWS SDK v3 S3 client and presigner. It is a server-side adapter, not a new public upload/download route. The private bucket and location below are owner-reported; this work does not inspect or change the Cloudflare account.

## Configuration

Set these only in the separate operator process's server-side secret environment, when live testing is separately authorized. Do not put credentials in browser variables, source, build arguments, URLs, issues or logs. No credentials are needed for the mock tests.

| Variable               | Value                                                            |
| ---------------------- | ---------------------------------------------------------------- |
| `R2_ACCOUNT_ID`        | Your Cloudflare account ID (32 lowercase hexadecimal characters) |
| `R2_BUCKET`            | `singmotion-ai-private`                                          |
| `R2_ACCESS_KEY_ID`     | Dedicated bucket-scoped R2 S3 Access Key ID                      |
| `R2_SECRET_ACCESS_KEY` | Matching R2 S3 Secret Access Key                                 |

These are S3 credentials generated for the bucket-scoped Object Read & Write token, not an API bearer token. The adapter has no credential-chain fallback to AWS metadata, shared credentials files or `NEXT_PUBLIC_*` values. It constructs `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`, uses `region: auto`, forces path-style bucket URLs and disables automatic retries/region redirects. **EEUR is the bucket's placement location, not an S3 signing region.** This implementation targets the standard account endpoint; it does not assume an EU-jurisdiction endpoint from an EEUR placement hint.

Keep public bucket access, `r2.dev` access and public custom-domain delivery disabled. Do not add public-read ACLs or public bucket policies. R2 does not support S3 object ACLs; the adapter sends none and contains no bucket-policy, ACL, CORS, lifecycle, create-bucket or public-access mutation. Server-to-server BytePlus retrieval does not require opening browser CORS. The owner reports a successful manual connectivity check (`ok: true`, `stage: complete`, `cleanup: deleted`) with authenticated and presigned downloads and both SHA-256 checks. No account settings were inspected or changed by this implementation; the check does not audit all bucket policies or BytePlus access.

## Approval, immutable content and ownership

The existing `LiveTestRunner` must reserve the approved spend and consume its one-time submission token **before** delivery. The adapter verifies that the durable attempt is `submitting`, its token was consumed, its reservation is positive, and the complete `PreparedMedia` record exactly matches the approved record (owner, source job, paths, hashes, prompt and measured duration). An uploaded file alone or a prepared/unconsumed plan cannot trigger delivery.

The adapter reruns existing media validation, confines snapshots to the configured private `DATA_DIR/media`, then reads bounded buffers and compares their SHA-256 hashes with the approval. Those exact buffers are uploaded; files are not reopened for streaming after validation. The selected JPEG/PNG stays byte-identical and the audio is the previously trimmed MP3. No original full song, extra reference images, raw owner identifiers or local filenames are sent as object names.

Objects use `byteplus-inputs/v1/<owner-hash>/<attempt-id>/<random-delivery-id>/<content-hash>.<extension>`. Each PUT includes the exact Content-Length, detected Content-Type, Content-MD5, `Cache-Control: private, no-store`, and `If-None-Match: *`. Random delivery namespaces and conditional writes prevent overwriting an existing object. No automatic overwrite/retry fallback is implemented.

An additive `live_input_deliveries` table is created by the existing SQLite store. Its unique attempt claim is atomic across connections, so concurrent requests or a restarted process cannot repeat delivery for the same approval. It stores only bucket/object keys, intended expiry and delivery state—never presigned URLs, AK/SK or authorization headers. It uses the existing durable spending database rather than a new database or duplicate job implementation.

## Temporary GET URLs

After both private PUTs succeed, the SDK generates two presigned **GET-only**, object-scoped HTTPS URLs locally. No R2 request is needed for URL signing. The returned `InputLease` carries the exact owner/hashes and an expiry aligned with the signatures. The adapter exposes the exact R2 hostname through `inputHosts` for the existing BytePlus provider's input allowlist. It checks the signed URLs' host, object path, expiry and signature presence before returning them.

Default URL lifetime is **3600 seconds**; an explicit constructor option may choose 60–3600 seconds. This application cap is narrower than R2's documented 1-second to 7-day range. URLs are signed against a timestamp captured before upload, so upload time consumes part of the lease rather than extending it silently. If upload consumes the lease, no URL is returned. The operation observes caller cancellation and has a 60-second upload/signing timeout.

Presigned URLs are bearer capabilities: anyone who obtains one can download that one object until expiry. They contain a public key identifier and signature, not the Secret Access Key. Never log, display, persist or include them in user-visible errors. Only the provider submission receives them. Staging/session cookies and the staging password are neither attached nor bypassed; existing application routes remain protected. The separate BytePlus output allowlist is **not** widened by allowing an R2 input hostname.

The sufficient lifetime for BytePlus's actual queue/fetch behavior remains unverified. No automatic lease renewal, repeat upload or paid resubmission is performed. Confirm the provider's input-fetch timing before any live test. The reviewed contract now requires `inputFetchWindowSeconds` (queue plus last fetch/retry and safety margin). Unknown/invalid windows block before delivery; insufficient remaining lease lifetime blocks submission. This is an internal policy field, not a BytePlus API parameter. The one-hour cap is not evidence that BytePlus fetches within one hour. See [test readiness](BYTEPLUS_TEST_READINESS.md).

## Failure handling and retention

The adapter returns no lease if either upload/signing operation fails. Errors are sanitized; raw SDK errors may contain signed URLs or credentials and are not forwarded. Partial or ambiguous PUTs remain recorded as failed (or uploading if the process crashes). They are not automatically replayed or blindly deleted. The runner conservatively retains its uncertain-submission state and spending reservation on failure.

**URL expiry does not delete the objects.** Objects remain private in the bucket until separately removed or expired by a lifecycle rule. Before enabling a real test, review a retention policy for the dedicated `byteplus-inputs/` prefix. A separately authorized prefix-scoped lifecycle rule (for example, deletion after one day if that meets the confirmed provider fetch window and your retention policy) can clean up successful, partial and crash-orphaned inputs. No lifecycle rule is configured by this change. Do not apply a bucket-wide deletion rule that could affect other media. The durable manifest supports manual object-specific reconciliation; deletion revokes any still-valid GET capability. R2 storage/operation charges are separate from the existing BytePlus generation-spending caps.

## Integration status and usage

Future reviewed operator wiring can construct `new R2PrivateInputDelivery(store, dataDir)` and pass it plus `delivery.inputHosts` to the existing `DocumentedBytePlusProvider`. Call `close()` when the operator finishes. The adapter is not imported by the web routes/demo worker and is not wired into a runnable paid command. Production BytePlus transport still fails closed before loading credentials or calling HTTP. No environment value alone enables provider submission.

Railway keeps `DEMO_MODE=true`, `GENERATIONS_ENABLED=false`, `ADMIN_DEMO_ENABLED=false`, `BYTEPLUS_LIVE_TEST_ENABLED=false` and its staging authentication/volume configuration. No Railway variables, Cloudflare settings, deployments, payments or real uploads were changed or performed. Billing verification, output-domain/encoding policy, input-fetch timing and live account validation remain required before a separately approved live test.

## Evidence and tests

Official Cloudflare pages were blocked by the Cloud egress proxy, so their official source repository was consulted:

- [AWS SDK v3 example](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/r2/examples/aws/aws-sdk-js-v3.mdx): S3 endpoint, explicit credentials and region `auto`.
- [Presigned URLs](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/r2/api/s3/presigned-urls.mdx): local signing, operation/object scope and expiry limits.
- [S3 compatibility](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/r2/api/s3/api.mdx): supported conditional PUT, Content-MD5 and unsupported ACLs.

Tests use fictional credentials and the real SDK serializer/signer with a mocked HTTP handler—no R2 network requests. They check exact uploaded bytes and headers, private object naming, independently recomputed GET signatures, rejection of PUT/object-path tampering, cross-owner/changed/unapproved inputs, cancellation before upload, partial failures, durable replay prevention, concurrent claims and the existing runner/provider integration. Normal staging, volume startup and desktop/mobile checks verify preservation of existing behavior.

Validation: lint, typecheck, all 55 automated tests, production build, staging security checks, root-owned volume startup checks and all six desktop/mobile browser tests passed. No real R2 or BytePlus HTTP requests were made.

## Optional manual connectivity check

See [R2 connectivity check for Windows PowerShell](R2_CONNECTIVITY_CHECK.md). The isolated `npm run r2:check -- --confirm-r2-connectivity-test` command checks one tiny non-sensitive object in `connectivity-tests/` and cleans up only that confirmed-created object. It does not use approved customer snapshots or invoke BytePlus. Running it locally is an explicit network operation; implementation and automated tests use mocks only.
