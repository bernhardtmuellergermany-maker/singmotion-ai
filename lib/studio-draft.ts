import { composePrompt, validateSelection } from "./domain.ts";
export interface StudioDraftExport {
  version: 1;
  outputFormat?: "9:16" | "16:9";
  formatMode?: "auto" | "9:16" | "16:9";
  /** Original uploaded photo kept separately from the saved crop output. */
  sourceImageId?: string;
  /** Immutable saved Apply result; must match imageId when present. */
  editedImageId?: string;
  appliedOutputFormat?: "9:16" | "16:9";
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
    "sourceImageId",
    "editedImageId",
    "appliedOutputFormat",
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
    (v.formatMode !== undefined &&
      !["auto", "9:16", "16:9"].includes(String(v.formatMode))) ||
    (v.outputFormat !== undefined &&
      v.outputFormat !== "9:16" &&
      v.outputFormat !== "16:9") ||
    (v.editedImageId !== undefined &&
      (typeof v.editedImageId !== "string" ||
        !/^[A-Za-z0-9_-]{1,160}$/.test(v.editedImageId))) ||
    (v.appliedOutputFormat !== undefined &&
      v.appliedOutputFormat !== "9:16" && v.appliedOutputFormat !== "16:9") ||
    (v.sourceImageId !== undefined &&
      (typeof v.sourceImageId !== "string" ||
        !/^[A-Za-z0-9_-]{1,160}$/.test(v.sourceImageId))) ||
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
    ...(v.formatMode
      ? { formatMode: v.formatMode as "auto" | "9:16" | "16:9" }
      : {}),
    ...(v.outputFormat
      ? { outputFormat: v.outputFormat as "9:16" | "16:9" }
      : {}),
    ...(v.sourceImageId ? { sourceImageId: v.sourceImageId as string } : {}),
    ...(v.editedImageId ? { editedImageId: v.editedImageId as string } : {}),
    ...(v.appliedOutputFormat ? { appliedOutputFormat: v.appliedOutputFormat as "9:16" | "16:9" } : {}),
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

/** Saved editing state can be incomplete; paid preparation still uses the strict parser. */
export function parseSavedStudioDraft(value: unknown): StudioDraftExport {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid saved Studio draft.");
  const v = value as Record<string, unknown>;
  const partial = parseStudioDraft({
    ...v,
    songId: v.songId === "" ? "pending-audio" : v.songId,
    imageId: v.imageId === "" ? "pending-image" : v.imageId,
    performance:
      v.performance === "Custom" && v.customPrompt === ""
        ? "Natural"
        : v.performance,
  });
  return {
    ...partial,
    songId: v.songId as string,
    imageId: v.imageId as string,
    performance: v.performance as string,
  };
}
