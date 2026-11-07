# Private MP4 orientation recovery

## Findings and evidence limits

Task 752756881 was reported by the operator as accepted, with MP4/dimension and
then generic output errors. No task media or runtime database was accessed here;
its actual width, height, duration, FPS and codecs have **not** been measured.
The generic error alone cannot establish the task's exact media properties.

Two code defects are reproducible offline:

- Exact ordered width/height equality rejected a 1280×720 MP4 against a 720×1280
  review (and vice versa), including during original-speed tempo restoration.
- The safe dimension-diagnostic regex used `\\d` instead of `\d`. It discarded
  legitimate numeric dimension errors and replaced them with
  `OUTPUT_DOWNLOAD_OR_VALIDATION_FAILED`, hiding the useful mismatch.

Support evidence in BYTEPLUS_SUPPORT_EVIDENCE.md confirms “720p”, not a universal
aspect ratio, FPS or codec. The fix therefore accepts only a transposition of the
**same reviewed 720p rectangle** (short side exactly 720, long side at most 4096).
It keeps the exact same side lengths and pixel count; it does not approve every
720-short-side size. This is a bounded application acceptance rule, not a claim
that support guaranteed any particular aspect ratio. Non-720p reviews remain exact.

FPS, codecs, generated-duration bounds, file-size/transfer caps, MP4 container and
full FFmpeg decode checks remain required. Host approval, pinned-IP HTTPS, TLS,
SSRF protection and no redirects remain unchanged. No policy JSON, stored review,
ledger, reservation or task is rewritten by this change.

The same rectangle rule applies to provider validation, tempo restoration and
crash recovery of the final file. The 0.9× provider audio is still retimed using
measured decoded durations; original MP3 packets are copied back and verified.
Local tests verify portrait/landscape output, wrong sizes/FPS/codecs/durations,
corrupt/oversized files, timing, audio integrity and same-task recovery with its
full reservation retained. Synthetic test metadata is not BytePlus task evidence.

## Recover the existing video after separately deploying this fix

1. Sign into the existing private Super Admin session and open the **existing**
   project for task 752756881. Do not prepare or submit another video.
2. Click **Resume status / retrieve same task**. This route never submits a task.
   It reuses a recent saved result or polls the existing task ID, downloads through
   the protected transport, validates, restores original timing/audio when needed,
   and publishes the private MP4 only after all checks pass.
3. Once complete, use the existing private preview/download controls.
4. If still blocked, retain the new safe diagnostic. A different aspect ratio,
   FPS, codec or duration requires actual media evidence and the appropriate
   reviewed policy; this fix does not override it. If the URL has expired, recovery
   may poll the same task again. BytePlus renewal/retention is not guaranteed;
   provider-side retrieval may be necessary, never a replacement paid submission.

No new Railway variables or migration are needed. No real requests, deployment,
paid generation or runtime-data modifications were performed during development.
