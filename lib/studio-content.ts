export type StudioTemplate = { label: string; prompt: string };
export type StudioContent = {
  intro: string;
  headerImageUrl: string | null;
  headerImageAlt: string;
  headerEyebrow: string;
  headerHeadline: string;
  headerSubtitle: string;
  audioReadyHeadline: string;
  audioReadySubtitle: string;
  heroHeading: string;
  heroSubtitle: string;
  heroImageUrl: string | null;
  heroImageAlt: string;
  performanceTemplates: StudioTemplate[];
  cameraTemplates: StudioTemplate[];
};
export function validTemplates(value: unknown): value is StudioTemplate[] {
  return (
    Array.isArray(value) &&
    value.length <= 12 &&
    value.every(
      (t) =>
        t &&
        typeof t.label === "string" &&
        t.label.trim().length > 0 &&
        t.label.length <= 60 &&
        typeof t.prompt === "string" &&
        t.prompt.trim().length > 0 &&
        t.prompt.length <= 300 &&
        Object.keys(t).every((k) => k === "label" || k === "prompt"),
    )
  );
}
export const defaultStudioContent: StudioContent = {
  intro: "Upload an audio file and choose your moment.",
  headerImageUrl: null,
  headerImageAlt: "SingMotion AI studio",
  headerEyebrow: "YOUR MUSIC. YOUR MOMENT.",
  headerHeadline: "Create your music video",
  headerSubtitle: "Turn your music and artist photo into a performance.",
  audioReadyHeadline: "Edit your audio",
  audioReadySubtitle: "Select the perfect moment for your music video.",
  heroHeading: "Studio",
  heroSubtitle: "Create your AI music video",
  heroImageUrl: null,
  heroImageAlt: "Studio artwork",
  performanceTemplates: [
    {
      label: "Natural singing",
      prompt: "Sing naturally, with relaxed expression",
    },
    {
      label: "Walking towards camera",
      prompt: "Walk towards the camera while singing",
    },
    { label: "On a dark stage", prompt: "Perform on a dark cinematic stage" },
    {
      label: "Emotional close-up",
      prompt: "Sing with heartfelt emotion in close-up",
    },
    { label: "Dancing performance", prompt: "Dance gently while performing" },
  ],
  cameraTemplates: [
    { label: "Static close-up", prompt: "Use a static close-up camera" },
    { label: "Slow zoom", prompt: "Use a gentle slow zoom" },
    { label: "Cinematic framing", prompt: "Use cinematic framing" },
  ],
};
