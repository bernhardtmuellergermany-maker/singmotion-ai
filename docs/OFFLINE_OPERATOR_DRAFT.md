# Offline operator review of a Studio draft

This workflow prepares local private snapshots and an **unpriced, non-authorizable**
review plan. It never creates a row in the generation jobs queue, reserves funds,
uploads to R2 or contacts BytePlus. All live gates stay blocked. No credentials
are needed. The existing paid-test blockers still apply.

## Select the existing draft

Studio keeps its current draft in browser localStorage (`singmotion-studio`).
Open the local Studio using the same browser profile/session that owns the uploads.
The existing selection is restored. Review the image, waveform start/end,
performance/camera preset and composed English prompt. Select a short excerpt of
at least 4 seconds with headroom below the operator's encoded-duration cap.

Click **Export draft for offline review**. On mobile, proceed to the final review
step to see the button. It works independently of Generate demo video, credit
quotes and generation permission. It downloads `singmotion-draft.json` without
making an export HTTP request or enqueuing a job. The file contains only a schema
version, owner ID, selected asset IDs, selection times and prompt settings—not
media bytes, disk paths, a session token, credentials or a price.

The owner ID is a lookup hint from the current authenticated session, not an
authorization credential. The local operator must already have filesystem access
to the same private DATA_DIR. The CLI checks the explicit owner against the
export and resolves **both** assets for that owner in SQLite, ignoring no foreign
ownership boundary. Cross-owner assets or mismatched IDs fail. The CLI has no
remote session impersonation, server lookup or authentication bypass.

A Railway-only draft's files are not on your Windows disk. This workflow does not
fetch them from Railway or R2. Use a draft whose uploads exist in the local app's
DATA_DIR. Missing local assets fail closed; do not fabricate IDs or copy session
cookies to work around this.

## Exact Windows PowerShell commands

Use Node 24 with FFmpeg/ffprobe on PATH. Replace the repository path, and use the
**existing** DATA_DIR of your local app. Do not point to an empty/new directory.
If the app uses the default `.data`, the example below selects it.

```powershell
Set-Location 'C:\path\to\singmotion-ai'
git switch feat/byteplus-omni20-documented-api
git pull --ff-only origin feat/byteplus-omni20-documented-api
$env:DATA_DIR = Join-Path (Get-Location).Path '.data'
$env:DEMO_MODE = 'true'
$env:GENERATIONS_ENABLED = 'false'
$env:ADMIN_DEMO_ENABLED = 'false'
$env:BYTEPLUS_LIVE_TEST_ENABLED = 'false'
node --version
ffmpeg -version
ffprobe -version
```

If the updated local Studio is not already running, start it in this terminal:

```powershell
npm.cmd run dev
```

Open `http://127.0.0.1:3000/studio` in the owning browser profile and export the
draft. Do not click Generate demo video. In a second PowerShell terminal, repeat
the `Set-Location` and environment assignments above (not `npm.cmd run dev`), then:

```powershell
$draftFile = Join-Path $env:USERPROFILE 'Downloads\singmotion-draft.json'
$draft = Get-Content -LiteralPath $draftFile -Raw -Encoding UTF8 | ConvertFrom-Json
# Check these IDs and settings against the draft you just exported.
$draft | Select-Object owner, songId, imageId, start, end, performance, camera, customPrompt

# Use --confirm-english only after reviewing the composed prompt in Studio.
$reportJson = & node --env-file-if-exists=.env.local --experimental-strip-types scripts/byteplus-preflight.ts --draft $draftFile --owner $draft.owner --confirm-english
if ($LASTEXITCODE -ne 0) { throw 'Offline preparation failed; no paid test was authorized.' }
$report = ($reportJson -join "`n") | ConvertFrom-Json
$report | Select-Object planId, status, preparedMp3Seconds, estimatedProviderCharge, paidSubmissionEnabled, reviewFile
Start-Process -FilePath $report.reviewFile
```

Alternatively, run the CLI without capturing its JSON:

```powershell
npm.cmd run byteplus:preflight -- --draft $draftFile --owner $draft.owner --confirm-english
```

UTF-8 with or without a BOM, spaces and Unicode in draft file paths are supported.
Exports larger than 32 KiB, unknown fields (including supplied paths/prices),
invalid selections, unsupported presets and foreign assets are rejected. A
custom prompt replaces preset directions exactly as it does in Studio. There is
no automatic translation or language detection: omitting `--confirm-english`
records an unconfirmed prompt. Choose confirmation before first preparation;
changing it later for the same immutable plan is deliberately rejected.

## Review and storage

The local HTML report under `DATA_DIR/operator-reviews/<plan-id>.html` shows:

- The selected image, embedded from the validated snapshot.
- Actual ffprobe-measured encoded MP3 duration, including reported padding.
- The composed English prompt and operator language-confirmation status.
- SHA-256 hashes for both immutable snapshots and the plan ID.
- Explicit unpriced, non-authorizable and no-submission status.

It is a self-contained file with escaped text and a restrictive CSP: no scripts,
forms, external images, fonts or network dependencies. It is not served through
an application route. Existing staging/session controls remain unchanged.
The report contains a private image and prompt: keep it in private local storage,
not a shared/synced/public folder. POSIX permissions are restricted where supported;
on Windows ensure DATA_DIR and Downloads have appropriate NTFS access controls.
Exports and local report copies are independent private artifacts; remove them
manually when no longer needed, including copies outside DATA_DIR.

The original media preparation pipeline is shared with existing-project preflight:
owner-scoped asset lookup, private-path confinement, image decoding/size/aspect
checks, actual MP3 trimming, strict encoded-duration cap, exclusive content-addressed
snapshots and hash revalidation. The new draft identity is derived from canonical
selection/settings; it is not a generation job. Repeating the same export reuses
the same immutable plan and identical report. Report files are never overwritten
with changed contents. Editing a draft produces a new unpriced selection; neither
this nor repeated preparation can authorize generation.

The plan has `contractRevision=null`, `upperBoundMicroUsd=null`, no provider ID,
no reservation and no approval token. Even explicit mock-enabled authorization
refuses unknown billing. Do not edit SQLite to attach a rate or delete reserved
records. The internal same-plan transition is now implemented and mock-tested
in `OperatorWorkflow`; production use still requires verified account billing
and separately reviewed CLI/provider wiring.

## Offline checks and remaining gates

```powershell
npm.cmd run test:byteplus:offline
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
```

The offline integration test uses generated media, blocks network transports and
checks BOM/spaced paths, ownership rejection, deterministic replay, HTML escaping,
hashes, unknown-billing denial and unchanged jobs/customer ledger counts. A
separate Playwright config tests desktop/mobile browser export with mocked APIs
and all generation flags disabled:

```powershell
npm.cmd run build
npx.cmd --no-install playwright test --config playwright.offline.config.ts
```

This requires an installed Playwright Chromium browser (or a valid local
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`). It runs only a local test server with
synthetic session/media metadata, not an external staging site.

Billing minimums, rounding and most unsuccessful-task charges, output hostname/
codec/FPS policy, connection-level output destination protection and the future
approved live operator command remain blocked. Support's 12-hour input requirement
is handled by the existing 13-hour private R2 design, but this workflow never
constructs or invokes that adapter. No Railway setting, deployment or real payment
is changed. See [readiness](BYTEPLUS_TEST_READINESS.md).

The [backend operator lifecycle](BACKEND_OPERATOR_WORKFLOW.md) now implements
same-plan verified-contract pricing and full mock orchestration, including
cancellation and crash recovery. A local read-only `byteplus:operator review`
command is available. Production pricing/approval/submission commands still fail
closed; no environment or contract-file input enables them.
