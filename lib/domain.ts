export const AUDIO_LIMIT = 50 * 1024 * 1024;
export const IMAGE_LIMIT = 30 * 1024 * 1024;
export const PROVIDER_AUDIO_LIMIT = 15 * 1024 * 1024;
export const performances = [
  "Natural",
  "Emotional",
  "Energetic",
  "Epic",
  "Custom",
] as const;
export const cameras = [
  "Static camera",
  "Orbit left",
  "Tilt up",
  "Tilt down",
  "Pull out",
  "Gentle Handheld",
  "Follow backwards",
] as const;
export const cameraHelp: Record<string, string> = {
  "Static camera": "The camera stays in one fixed position.",
  "Orbit left": "The camera moves in a smooth arc to the left around the singer.",
  "Tilt up": "The camera gently tilts upward.",
  "Tilt down": "The camera gently tilts downward.",
  "Pull out": "The camera moves slowly back to reveal more of the scene.",
  "Gentle Handheld": "Subtle natural handheld motion, without strong shaking.",
  "Follow backwards": "The camera tracks backward in front of the moving singer.",
};
export const cameraPrompt: Record<string, string> = {
  "Static camera": "Keep the camera fixed in a stable shot with no camera movement.",
  "Orbit left": "Move the camera slowly in a smooth arc to the left around the singer, keeping the singer centered.",
  "Tilt up": "Gently tilt the camera upward while keeping the singer visible and in focus.",
  "Tilt down": "Gently tilt the camera downward while keeping the singer visible and in focus.",
  "Pull out": "Slowly move the camera backward, revealing more of the singer and environment.",
  "Gentle Handheld": "Use very subtle, smooth handheld camera movement with no abrupt shake.",
  "Follow backwards": "Track the camera smoothly backward in front of the singer as the singer walks forward, maintaining consistent framing.",
};

export const views = [
  "Front",
  "Three-Quarter",
  "Side",
  "Full Body",
  "Custom",
] as const;
export type JobStatus =
  "queued" | "processing" | "completed" | "failed" | "cancelled";
export interface Asset {
  id: string;
  owner: string;
  kind: "audio" | "image" | "video";
  name: string;
  path: string;
  mime: string;
  bytes: number;
  duration: number | null;
  width: number | null;
  height: number | null;
  created: number;
}
export interface ArtistImage {
  assetId: string;
  label: string;
}
export interface Artist {
  id: string;
  owner: string;
  name: string;
  images: ArtistImage[];
  created: number;
}
export interface Job {
  id: string;
  owner: string;
  requestKey: string;
  songId: string;
  imageId: string;
  artistName: string;
  start: number;
  end: number;
  performance: string;
  camera: string;
  prompt: string;
  price: number;
  status: JobStatus;
  stage: string;
  outputId: string | null;
  error: string | null;
  created: number;
  updated: number;
  saved: boolean;
  demo: true;
}
export class AppError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
export function validateSelection(
  start: number,
  end: number,
  duration: number,
) {
  if (
    ![start, end, duration].every(Number.isFinite) ||
    start < 0 ||
    end <= start ||
    end > duration + 0.02 ||
    end - start > 300
  )
    throw new AppError(
      "Select a valid segment within the song, up to 300 seconds.",
    );
  return Math.round((end - start) * 1000) / 1000;
}
export function quote(
  duration: number,
  centsPerTenSeconds = Number(
    process.env.CUSTOMER_CENTS_PER_TEN_SECONDS || 299,
  ),
) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 300)
    throw new AppError(
      "Duration must be greater than zero and at most 300 seconds.",
    );
  if (!Number.isSafeInteger(centsPerTenSeconds) || centsPerTenSeconds <= 0)
    throw new AppError("Pricing is unavailable.", 503);
  return {
    cents: Math.ceil((duration * centsPerTenSeconds) / 10),
    currency: "EUR" as const,
    duration,
    demo: true,
    tax: "Illustrative total, including German VAT when applicable.",
    minimum: null,
  };
}
export function validateFile(name: string, size: number, kind: string) {
  if (!size || size > (kind === "audio" ? AUDIO_LIMIT : IMAGE_LIMIT))
    throw new AppError(
      kind === "audio"
        ? "Choose an audio file up to 50 MB."
        : "Choose an image up to 30 MB.",
    );
  if (!(kind === "audio" ? /\.(mp3|wav|m4a)$/i : /\.(png|jpe?g)$/i).test(name))
    throw new AppError(
      kind === "audio"
        ? "Only MP3, WAV and audio-only AAC/M4A files are supported."
        : "Only JPEG and PNG images are supported.",
    );
}
export function composePrompt(
  performance: string,
  camera: string,
  custom: string,
) {
  if (
    !performances.includes(performance as (typeof performances)[number]) ||
    !cameras.includes(camera as (typeof cameras)[number])
  )
    throw new AppError("Choose a supported performance and camera preset.");
  if (custom.length > 1500)
    throw new AppError("Keep your custom prompt under 1,500 characters.");
  if (performance === "Custom" && !custom.trim())
    throw new AppError("Enter a custom performance prompt.");
  const performanceDirection = performance === "Custom"
    ? "Natural singing performance."
    : `${performance} singing performance.`;
  const cameraDirection = cameraPrompt[camera];
  const customDirection = custom.trim() ? ` Additional performance direction: ${custom.trim()}.` : "";
  const result = `${performanceDirection} ${cameraDirection} Keep facial identity, lip synchronization, and background consistent.${customDirection}`;
  if (result.length > 1500)
    throw new AppError("Keep the complete composed prompt under 1,500 characters.");
  return result;
}
export function canTransition(from: JobStatus, to: JobStatus) {
  return (
    {
      queued: ["processing", "cancelled"],
      processing: ["completed", "failed"],
      completed: [],
      failed: [],
      cancelled: [],
    } as Record<JobStatus, string[]>
  )[from].includes(to);
}
export function money(cents: number) {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}
export function time(seconds: number) {
  const s = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  return `${Math.floor(s / 60)}:${Math.floor(s % 60)
    .toString()
    .padStart(2, "0")}`;
}
