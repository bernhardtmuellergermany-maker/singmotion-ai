# Recovery of the operator-reported 786 × 1178 output

## Evidence and scope

The owner reports task **752756881**, an existing USD 1.60 reservation, and actual
video dimensions **786 × 1178**, against the saved **720 × 1280** output review.
This explains the dimension rejection: the side lengths differ, not merely their
orientation. The raw media, FPS, codecs and task URL were not accessed during
implementation. Stored support evidence says “720p” but does not specify exact
aspect-ratio handling or promise this rectangle for every task.

786 × 1178 is an even-sized, technically valid H.264 frame size. The owner's
request authorizes local aspect-preserving export to the reviewed target; it does
not establish a new BytePlus contractual guarantee. No additional submission or
provider feature is involved. No evidence of a provider ban on local output
resizing exists in the repository, but the full account contract is unavailable:
contractual compliance cannot be independently certified by these tests.

## Bounded local conversion

The production downloader recognizes **only 786 × 1178 → 720 × 1280**, only with
an existing explicit H.264/AAC output review, square source pixels, no nonzero
rotation metadata and exactly one video/audio stream. Discovery mode and other
source sizes/targets remain unchanged. Unknown or unreviewed codecs are blocked.

Before conversion, the raw MP4 must pass all existing checks except that the
source rectangle is explicitly validated as 786 × 1178: codec, FPS, duration and
maximum duration, container signature and full FFmpeg decode. Private pinned-IP
HTTPS, exact output hosts, no redirects, transfer limits and size caps still apply.
The raw non-target source is never published or accepted by final-file recovery.

FFmpeg scales the image to fit and adds black top/bottom padding. Aspect ratio is
preserved to even-pixel rounding; no crop or stretch to fill is performed. Video
is re-encoded as H.264; audio packets are copied. The conversion has a 60-second
process timeout, two encoding threads, a file-size limit and private scratch
storage. It fully validates the resulting MP4, checks identical frame count,
stream start times (1 ms tolerance), stream lengths (one-frame tolerance), and
identical encoded audio packet hashes. Only then does it atomically replace the
newly downloaded temporary file. Failures delete temporary files, never customer
uploads, existing successful outputs or ledger records.

Existing runner/tempo validation then runs normally. For a 0.9× plan, the video
is restored to the original measured timing and the immutable original MP3
soundtrack is muxed back and checked as before. Existing spending reservations,
task IDs, recovery leases, uncertainty controls and the EUR 50 budget are unchanged.
Conversion failure leaves the existing task recoverable; it never submits another.

## Owner steps after separately deploying this commit

No new Railway variables, policy JSON changes, migrations or budget resets are
required. The existing reviewed target must be 720 × 1280 with H.264/AAC; the
actual source must also satisfy the saved FPS/duration and other checks.

1. Open the existing private project for **752756881** as Super Admin.
2. Click **Resume status / retrieve same task**, not Generate or Start fresh.
3. Recovery downloads the existing result, converts its rectangle if eligible,
   restores original tempo/audio where applicable and exposes the validated
   private preview/download. The task and its reservation remain the same.
4. If blocked, use the precise diagnostic. A codec, FPS, duration, non-square
   pixel, rotation or source-policy mismatch is not automatically waived.

Provider URLs expire; renewed access via polling the same task is not guaranteed
by the supplied documentation. If BytePlus no longer serves the existing result,
provider-side recovery is needed, not another paid generation.

## Offline verification and remaining limits

A synthetic 786 × 1178 H.264/AAC video exercises the actual production downloader
with mock HTTP. Tests inspect 720 × 1280 output and padding, reject nearby
unapproved dimensions, non-square pixels, wrong FPS/codecs/duration and corruption.
The recovery integration test uses a previously submitted mock task, retains the
reservation, converts this rectangle, restores tempo and original audio, and
recovers after restart without submitting a replacement.

No real task media was tested. Numerical timeline/audio checks cannot establish
perceptual lip-sync of the provider's original performance. Final visual/auditory
inspection is still required. Resizing introduces an H.264 encoding generation and
padding; the existing tempo path may add another encode. No real provider/R2
requests, deployment or live-data edits were performed during development.
