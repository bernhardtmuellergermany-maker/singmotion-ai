/** Shared deterministic editor rules; seconds remain identical in saved drafts. */
export function photoFormat(
  width: number | null,
  height: number | null,
): "9:16" | "16:9" {
  return width && height && width > height * 1.1 ? "16:9" : "9:16";
}

export function moveSelection(
  start: number,
  end: number,
  delta: number,
  duration: number,
) {
  const length = end - start;
  const next = Math.max(
    0,
    Math.min(duration - length, Math.round((start + delta) * 100) / 100),
  );
  // Do not round the endpoint independently: even fractional source durations
  // must retain precisely the same selected interval at either boundary.
  return [next, next + length] as const;
}
