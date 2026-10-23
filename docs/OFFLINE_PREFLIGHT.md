# Offline studio-to-preflight rehearsal

Run from the repository with installed dependencies, Node 24, FFmpeg and ffprobe:

```powershell
npm.cmd run test:byteplus:offline
```

On other shells use `npm run test:byteplus:offline`. This test is also included
in `npm test`. It requires no credentials, server, browser, customer uploads or
external storage. It creates and removes a temporary private DATA_DIR containing
SQLite databases, a generated 12-second tone MP3 and a synthetic 512×512 PNG.
It does not read or modify the operator's real project database.

The test blocks fetch, TCP and TLS connections in its process. Both CLI
subprocesses preload an offline guard that fails their process if any network
attempt occurs, even if application code catches the error. BytePlus/R2
credentials are removed from the child environment. No provider adapter is
called and no paid task is submitted. The generated image checks file handling,
not whether a singer's face is suitable for the model.

## What is exercised

1. The same domain selection/prompt functions and owned asset/artist/project
   storage used by the studio: one selected image, 2–7 seconds of audio,
   Natural performance and Slow Push-In camera. A custom English prompt fully
   replaces preset directions, as in the existing UI.
2. Actual FFmpeg MP3 trimming and ffprobe duration/codec measurement. MP3 padding
   can make the encoded duration slightly longer than the waveform selection.
   Preflight now rejects an encoded duration above the operator cap before
   storing that audio snapshot; choose a shorter selection rather than raising
   the cap without review.
3. Content-addressed copies, independent SHA-256 checks, unchanged reference
   bytes, repeatable preparation, prompt-language confirmation and ownership
   rejection. The copied image is now hash-checked and decoded too, guarding
   against a source change during preparation.
4. The real `byteplus-preflight.ts` CLI, twice, with the same plan ID, measured
   duration, hashes, composed prompt and disabled/unpriced state in its JSON
   report. No original paths, session token or credentials are printed.
5. Default authorization denial and refusal of unknown billing. Fictional
   billing in a separate mock record tests the per-job cap, cumulative cap,
   exact confirmation and single-use approval. These terms are not BytePlus
   pricing evidence; this mock record is deleted with the temporary database.
6. The real live-test CLI's hard block. Changing the original reference leaves
   its snapshot intact; modifying the snapshot causes revalidation to fail.

This is an integration test of the local media, persistence and CLI workflow.
It seeds the studio's storage boundary directly; it does not exercise browser
clicks, multipart upload HTTP or staging authentication. Existing automated
suites cover domain limits and security separately. No claim of a new desktop/
mobile browser run or real provider compatibility is made.

Snapshots are immutable approval records enforced through exclusive creation,
content-addressed names and hash revalidation. They are not filesystem WORM:
an operator with filesystem write access can change a file, but the unchanged
approval must then fail validation. Do not manually edit snapshots or the ledger.

## Real operator preflight remains offline

For an existing owned project in the operator's private DATA_DIR:

```powershell
npm.cmd run byteplus:preflight -- --job '<existing-project-id>' --owner '<owning-session-id>' --confirm-english
```

This command reads the existing project and creates local snapshots and a
prepared ledger entry; it does not upload or submit. Run on the machine holding
that private DATA_DIR. `--owner` is the internal owner ID, **not** a browser
session cookie/token. Keep the local prompt/report private. Do not paste
customer media, owner identifiers, prompts or environment files into a PR.
Only use `--confirm-english` after reviewing the composed English prompt.

Keep DEMO_MODE=true and all generation/live flags disabled. The studio supports
one selected artist image and waveform selection, but its general limits are
broader than preflight: OmniHuman preflight requires one decoded still JPEG/PNG,
300–4096 px sides, ratio 0.4–2.5, the conservative model byte limits and an
actual MP3 duration of at least 4 seconds within the configured operator cap.
A valid studio upload/selection is not automatically an eligible live input.
The UI's illustrative EUR quote is never used as a BytePlus USD cost ceiling.

## Missing operator steps / unchanged blockers

- There is no operator project/owner lookup or full approval-review screen.
  Preflight currently takes IDs from an existing privately administered project.
  With Railway `GENERATIONS_ENABLED=false`, creating a new job through the
  generation route is blocked. Do not change that flag for this rehearsal.
  A future separately reviewed draft-only export/preparation flow would be
  needed to prepare a new studio draft without enqueuing generation.
- Local preparation stores an immutable, unpriced plan. Re-running with changed
  prompt confirmation, inputs or contract is intentionally rejected. Decide the
  English confirmation before creating the plan. A reviewed transition from an
  unpriced plan to a priced approval is still missing; do not delete ledger
  rows, create duplicate paid attempts or replace the source ID to bypass it.
  The test's separate fictional record is not an operator workaround.
- Billing minimums, rounding, failed/canceled charges, input queue/fetch lifetime
  and exact output domains/specifications await BytePlus Support. The confirmed
  $0.07/s base price is not an inclusive upper bound.
- Output connection-level destination protection and the isolated authorized
  operator CLI still need completion. R2 connectivity alone does not establish
  BytePlus retrieval. Production transport and `assertBytePlusVerified()` remain
  blocked; no environment setting unlocks them.

See [paid-test readiness](BYTEPLUS_TEST_READINESS.md) for the evidence needed
before any future authorization. This offline rehearsal neither grants that
authorization nor changes Railway, R2, billing or deployment settings.
