import { composePrompt, validateSelection } from "./domain.ts";
export interface StudioDraftExport {
  version: 1;
  outputFormat?: "9:16" | "16:9";
  formatMode?: "auto" | "9:16" | "16:9";
  owner: string;
  songId: string;
  imageId: string;
  start: number;
  end: number;
  performance: string;
  camera: string;
  customPrompt: string;
}
/** Browser-safe schema: no local paths, session token, media bytes or price. */
export function parseStudioDraft(value: unknown): StudioDraftExport {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid Studio draft export.");
  const v = value as Record<string, unknown>;
  const keys = [
    "version",
    "outputFormat",
    "formatMode",
    "owner",
    "songId",
    "imageId",
    "start",
    "end",
    "performance",
    "camera",
    "customPrompt",
  ];
  if (
    Object.keys(v).some((key) => !keys.includes(key)) ||
    v.version !== 1 ||
    (v.formatMode !== undefined && !["auto", "9:16", "16:9"].includes(String(v.formatMode))) ||
    (v.outputFormat !== undefined &&
      v.outputFormat !== "9:16" &&
      v.outputFormat !== "16:9") ||
    ["owner", "songId", "imageId"].some(
      (key) =>
        typeof v[key] !== "string" ||
        !/^[A-Za-z0-9_-]{1,160}$/.test(v[key] as string),
    ) ||
    typeof v.start !== "number" ||
    typeof v.end !== "number" ||
    typeof v.performance !== "string" ||
    typeof v.camera !== "string" ||
    typeof v.customPrompt !== "string"
  )
    throw new Error("Invalid Studio draft export.");
  validateSelection(v.start, v.end, v.end);
  composePrompt(v.performance, v.camera, v.customPrompt);
  return {
    version: 1,
    ...(v.formatMode ? { formatMode: v.formatMode as "auto" | "9:16" | "16:9" } : {}),
    ...(v.outputFormat
      ? { outputFormat: v.outputFormat as "9:16" | "16:9" }
      : {}),
    owner: v.owner as string,
    songId: v.songId as string,
    imageId: v.imageId as string,
    start: v.start,
    end: v.end,
    performance: v.performance,
    camera: v.camera,
    customPrompt: v.customPrompt,
  };
}
