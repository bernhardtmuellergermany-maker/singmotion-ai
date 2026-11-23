/** Uploads are sent through a browser XMLHttpRequest so Studio can show progress.
 * The upload request also waits for FFprobe/FFmpeg and private R2 verification
 * before the server returns an asset. The previous fixed 180s browser timeout
 * aborted valid large uploads before this processing finished (Railway HTTP 499).
 *
 * This does not change Railway's separate 5-minute deadline for receiving the
 * request body; very slow connections will eventually need resumable chunks.
 */
export const SMALL_UPLOAD_TIMEOUT_MS = 3 * 60 * 1000;
export const LARGE_UPLOAD_TIMEOUT_MS = 12 * 60 * 1000;
export const LARGE_UPLOAD_THRESHOLD_BYTES = 8 * 1024 * 1024;

export function uploadRequestTimeoutMs(fileBytes: number): number {
  return fileBytes >= LARGE_UPLOAD_THRESHOLD_BYTES
    ? LARGE_UPLOAD_TIMEOUT_MS
    : SMALL_UPLOAD_TIMEOUT_MS;
}
