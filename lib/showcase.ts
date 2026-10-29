/** Public, brand-owned showcase assets only. Never source these from private project APIs. */
export const showcase = {
  title: "SingMotion AI Showcase",
  videoUrl: process.env.NEXT_PUBLIC_SHOWCASE_VIDEO_URL || "",
  posterUrl: process.env.NEXT_PUBLIC_SHOWCASE_POSTER_URL || "",
} as const;
