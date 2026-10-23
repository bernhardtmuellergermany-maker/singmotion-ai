/** Documented model limits. Decimal MB is the conservative interpretation because
 * the supplied document does not define MB vs MiB. UI can remain more restrictive.
 */
export function validateOmniImage(info: {
  format: string;
  bytes: number;
  width: number;
  height: number;
}) {
  if (
    !["jpeg", "png", "webp", "bmp", "tiff", "gif", "heic", "heif"].includes(
      info.format,
    ) ||
    !Number.isSafeInteger(info.bytes) ||
    info.bytes <= 0 ||
    info.bytes >= 30_000_000 ||
    !Number.isSafeInteger(info.width) ||
    !Number.isSafeInteger(info.height) ||
    info.width < 300 ||
    info.height < 300 ||
    info.width > 6000 ||
    info.height > 6000 ||
    info.width / info.height < 0.4 ||
    info.width / info.height > 2.5
  )
    throw new Error("Reference exceeds documented OmniHuman 2.0 image limits.");
}
export function validateOmniAudio(info: {
  format: string;
  bytes: number;
  duration: number;
}) {
  if (
    !["mp3", "wav"].includes(info.format) ||
    !Number.isSafeInteger(info.bytes) ||
    info.bytes <= 0 ||
    info.bytes >= 15_000_000 ||
    !Number.isFinite(info.duration) ||
    info.duration < 4 ||
    info.duration > 300
  )
    throw new Error("Audio exceeds documented OmniHuman 2.0 audio limits.");
}
