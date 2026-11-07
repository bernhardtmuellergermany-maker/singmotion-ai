# Manual private R2 connectivity check (Windows PowerShell)

This check verifies the existing `singmotion-ai-private` bucket using only the required object operations. It does not require bucket listing permissions, create a bucket, modify access policies, or list customer objects. It does not import BytePlus, the web application, the worker or the application database. It reuses the private adapter's server-side configuration/S3 client settings.

The command is never run by build, deployment, startup or the ordinary test suite. Tests call its library with mocks. Invoking it without the explicit confirmation flag makes no requests. **Running the confirmed command below performs real R2 requests** and can incur normal R2 operation charges. It does not perform video generation.

## Exact PowerShell commands

Use Node.js **24.x** and your local repository checkout. Replace only the example repository path. Keep existing staging/demo/generation settings unchanged; no BytePlus credentials or live-mode switches are needed.

```powershell
Set-Location 'C:\path\to\singmotion-ai'
git fetch origin
git switch feat/byteplus-omni20-documented-api
git pull --ff-only origin feat/byteplus-omni20-documented-api
node --version
npm.cmd ci
```

Enter credentials at the masked prompts below, not as literal values in commands or chat. The environment values exist only in this PowerShell process and its child Node process. The script does not load `.env` files. Do not run with PowerShell transcription, HTTP tracing or SDK debug logging enabled.

```powershell
function Read-R2ConnectivitySecret([string]$Prompt) {
    $secureValue = Read-Host $Prompt -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
    try {
        [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
        $secureValue.Dispose()
    }
}

try {
    $env:R2_ACCOUNT_ID = Read-Host 'Cloudflare account ID (32 lowercase hex characters)'
    $env:R2_BUCKET = 'singmotion-ai-private'
    $env:R2_ACCESS_KEY_ID = Read-R2ConnectivitySecret 'R2 Access Key ID'
    $env:R2_SECRET_ACCESS_KEY = Read-R2ConnectivitySecret 'R2 Secret Access Key'

    npm.cmd run r2:check -- --confirm-r2-connectivity-test
    if ($LASTEXITCODE -ne 0) {
        throw 'R2 connectivity check failed. Review the sanitized stage and cleanup result above.'
    }
}
finally {
    Remove-Item Env:R2_ACCOUNT_ID, Env:R2_BUCKET, Env:R2_ACCESS_KEY_ID, Env:R2_SECRET_ACCESS_KEY -ErrorAction SilentlyContinue
    Remove-Item Function:\Read-R2ConnectivitySecret -ErrorAction SilentlyContinue
}
```

The finally block clears these four variables even on a reported failure (including any previous values you had assigned in this shell). Secret values necessarily exist in process memory while signing requests; they are not written to a credential file or logged. Close the shell afterward if desired.

## What the check does

1. Validates the four server-side variables and requires the exact bucket `singmotion-ai-private`. Uses the existing standard R2 account endpoint, region `auto` and single-attempt SDK configuration. EEUR remains a placement location, not a signing region.
2. Generates a fresh 256-bit random key under `connectivity-tests/` and a tiny non-sensitive random payload. Prints only that test key for reconciliation.
3. PUTs it with `If-None-Match: *`, a content integrity header and private/no-store cache policy. No ACL or bucket-public-access call is made. Success verifies write access to the existing bucket without listing it.
4. GETs precisely that key with authenticated S3 access and verifies its SHA-256 hash.
5. Locally signs a GET-only capability for the same object, valid for **60 seconds**, retrieves it using HTTPS with redirects/cookies disabled, and verifies the hash again. The signed URL is never printed or persisted.
6. DELETEs only the confirmed-created test key, using a separate timeout even when an earlier read or URL test failed. It never enumerates or deletes anything else. A successful R2 DELETE acknowledgement is reported; no bucket-wide cleanup is performed.

Each network phase has a 15-second deadline; read bodies are capped at 1 KiB. No operation is automatically retried. Diagnostics expose only a named stage, cleanup status and random test key—never raw SDK/HTTP errors, credentials, authorization headers or signed URLs.

## Results and safe failure handling

Success exits 0 with `ok: true`, `stage: complete`, `cleanup: deleted` and confirmation that both hashes matched. Any failure exits nonzero. Successful access does not prove that public access is disabled; keep the bucket's public access disabled in Cloudflare as already configured.

- **configuration:** correct missing variables or the bucket name; no requests were made.
- **upload:** check bucket existence, credentials, scoped Object Read & Write permissions and connectivity. A precondition conflict never deletes the pre-existing object. A timeout/network error may mean the PUT succeeded remotely; `upload-uncertain` explicitly leaves it untouched for manual reconciliation rather than assuming ownership.
- **readback / presigned-get:** check read permissions, connectivity and local clock accuracy. Confirmed-created test objects are still cleaned up. Redirects and mismatched/oversized bodies fail closed.
- **cleanup failed:** deletion could not be confirmed. Keep the printed test key and, in the Cloudflare dashboard, reconcile **only that exact `connectivity-tests/` object**. Do not remove the bucket or customer prefixes. Re-running the check creates a new key and does not clean old keys.

Ctrl+C/SIGTERM requests cancellation and allows cleanup of a confirmed upload with a fresh timeout. Force-killing Node, closing the terminal, power loss or an ambiguous PUT can leave a tiny private test object. The printed random key enables manual reconciliation. No script can guarantee cleanup after abrupt termination or loss of network access. Presigned URL expiry does not delete an object.

No Railway changes, deployments, real R2 requests or BytePlus operations were performed while implementing this check. All automated connectivity tests use mocked S3/HTTP responses and fictional credentials.

Validation for this change: lint, typecheck and all 68 automated tests passed, including 13 connectivity-check scenarios. No live connectivity check was executed.

## Diagnosing a rejected upload (without sharing secrets)

Failures now include `failure.category` and, when an HTTP response exists,
`failure.httpStatus`. Cleanup failures have a separate `cleanupFailure` field.
Raw exceptions, messages, response bodies, headers, credentials and signed URLs
are never included. A missing status means no usable HTTP status was received;
it does not prove the credentials are incorrect.

| Category                              | Meaning / next manual check                                                                                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authentication`                      | R2 reported an invalid key/signature/token or HTTP 401. Check that the S3 key pair belongs to the configured account, without sharing it.                            |
| `clock`                               | R2 reported an expired request or clock skew. Synchronize the Windows clock.                                                                                         |
| `access-denied`                       | AccessDenied or otherwise unclassified HTTP 403. Check account, bucket and scope. A generic 403 cannot distinguish permission problems from authentication failures. |
| `request-parameters`                  | R2 reported unsupported/invalid parameters or HTTP 501. Report only category, stage and status for investigation.                                                    |
| `checksum`                            | R2 reported an invalid digest.                                                                                                                                       |
| `network` / `timeout`                 | Known DNS, connection, TLS or timeout error. Check connectivity, proxy and certificate trust; do not disable TLS validation.                                         |
| `bucket-or-object-not-found`          | HTTP 404; verify the configured account and bucket (or object during readback).                                                                                      |
| `conditional-write-conflict`          | HTTP 412; the conditional PUT was rejected. No deletion is attempted.                                                                                                |
| `throttled` / `service`               | Rate limiting or server failure. The script does not retry automatically.                                                                                            |
| `bad-request` / `unknown` / `aborted` | Insufficient safe detail, malformed request, or cancellation. Do not paste raw SDK errors or enable verbose HTTP logging.                                            |

The previous `upload` + `not-needed` result could represent HTTP 401, 403, 404
or 412. It cannot identify the root cause. Key lengths and token activation
alone cannot establish that the request reached the intended account or that
its signature was accepted.

The actual SDK PUT is regression-tested through an in-memory HTTP handler:
HTTPS account endpoint, path-style bucket/key, region `auto`, S3 SigV4,
`If-None-Match: *`, correct `Content-MD5`, SHA-256 payload hash, fixed content
length and `Cache-Control: private, no-store`. It sends no ACL, optional CRC
checksum headers, checksum trailer or streaming content encoding.
`requestChecksumCalculation` and `responseChecksumValidation` remain
`WHEN_REQUIRED`; `maxAttempts` remains 1. These options are explicit rather
than inherited from a machine's AWS configuration.

Cloudflare's [S3 compatibility table](https://developers.cloudflare.com/r2/api/s3/api/)
lists both conditional PUT (`If-None-Match`) and `Content-MD5` as supported.
Neither header was removed: conditional creation prevents overwriting an
existing object. EEUR is a storage location hint; it does not change the signing
region `auto` or imply the separate EU-jurisdiction endpoint. No real R2 request
was made to validate the owner's account; the root cause remains unconfirmed
until a manual rerun returns the sanitized status/category.

After pulling this branch and setting the process-only environment variables
using the masked-input PowerShell procedure above, retry exactly:

```powershell
npm.cmd run r2:check -- --confirm-r2-connectivity-test
```

The earlier procedure removes environment variables in `finally`; enter them
again using that procedure if necessary. Keep cleanup unchanged: delete only
this run's confirmed upload, never list objects, and reconcile only the reported
random test key when an upload outcome is uncertain.
