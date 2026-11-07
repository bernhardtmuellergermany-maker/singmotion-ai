import { AppError } from "../lib/domain.ts";
/** Only fixed, public diagnostics: never forward decoder stderr, paths or uploads. */
export type PreparationStage =
  "multipart" | "storage" | "image" | "audio" | "snapshot" | "plan";
export class PreparationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
export function preparationError(
  error: unknown,
  stage: PreparationStage,
): PreparationError {
  if (error instanceof PreparationError) return error;
  if (error instanceof AppError && error.status === 429)
    return new PreparationError(
      "prepare-rate-limit",
      "Request rate limit reached. Wait for the short request window to expire; do not reset storage or repeat paid submissions.",
    );
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (["EACCES", "EPERM", "EROFS"].includes(String(code)))
    return new PreparationError(
      "storage-permission",
      "Private test storage is not readable/writable. Check DATA_DIR volume ownership; do not reset the volume.",
    );
  if (code === "ENOSPC")
    return new PreparationError(
      "storage-full",
      "Private test storage is full. No existing plan or file was removed.",
    );
  if (
    code === "ERR_SQLITE_ERROR" &&
    (error as { errcode?: number }).errcode === 5
  )
    return new PreparationError(
      "database-busy",
      "Private test database is busy. Refresh saved status before retrying preparation.",
    );
  if (
    stage === "audio" &&
    code === "ENOENT" &&
    (error as NodeJS.ErrnoException).path === "ffprobe"
  )
    return new PreparationError(
      "ffprobe-unavailable",
      "Server audio validation is unavailable: ffprobe is missing. Use the configured FFmpeg runtime image.",
    );
  const messages: Record<PreparationStage, string> = {
    multipart:
      "Upload could not be parsed. Select both files again; send a complete multipart image and MP3 upload.",
    storage:
      "Private input files could not be saved. Check DATA_DIR availability and volume permissions.",
    image:
      "Singer image rejected. Use a decodable, single-frame JPEG/PNG, 300–4096 pixels per side, aspect ratio 0.4–2.5, at most 5 MB.",
    audio:
      "Audio validation failed. Upload a decodable MP3 (not renamed WAV/M4A), with actual encoded duration 4–5 seconds and size under 15 MB. The server requires working ffprobe.",
    snapshot:
      "Immutable input verification failed. Refresh saved status and check private storage; existing snapshots have not been replaced.",
    plan: "Private plan or audit record could not be saved/read. Check CMS database and private SQLite availability. Refresh saved status before preparing again.",
  };
  return new PreparationError(`prepare-${stage}`, messages[stage]);
}
