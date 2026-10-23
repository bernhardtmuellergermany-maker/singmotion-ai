import type { Page } from "./payload-types";
// Shared by the fallback website and new CMS drafts. Existing published pages are never overwritten.
export const homePage: Page = {
  id: 0,
  slug: "home",
  title: "Make your artist sing.",
  description:
    "Turn your music and a single image into a lifelike singing performance with synchronized lip movements, expressive motion and natural stage presence.",
  createdAt: "2026-10-23T00:00:00.000Z",
  updatedAt: "2026-10-23T00:00:00.000Z",
  _status: "published",
  blocks: [
    {
      blockType: "hero",
      eyebrow: "YOUR MUSIC. A NEW PRESENCE.",
      heading: "Make your artist sing.",
      body: "Turn your music and a single image into a lifelike singing performance with synchronized lip movements, expressive motion and natural stage presence.",
      buttonLabel: "Create your music video",
      url: "/studio",
    },
    {
      blockType: "cta",
      heading: "How it works",
      buttonLabel: "See how it works",
      url: "/\u0023how",
    },
    {
      blockType: "cards",
      heading: "One image. Your music. A new performance.",
      items: [
        {
          heading: "Bring your music",
          body: "Upload your song and find its best moment. Trim the exact section you want to bring to life.",
        },
        {
          heading: "Choose your artist",
          body: "Start with a single portrait you have permission to use. Your saved artists are always close at hand.",
        },
        {
          heading: "Give it direction",
          body: "Choose a performance style, review your selection and explore the clearly labeled demo.",
        },
      ],
    },
    {
      blockType: "cards",
      heading: "Made for the music you make.",
      items: [
        {
          heading: "Realistic singing performances",
          body: "Our focus: expressive motion, natural stage presence and lip movements synchronized to your own music. Live rendering is still in preparation.",
        },
        {
          heading: "Lip-sync music videos",
          body: "Give a vocal hook a visual identity. Prepare the image, audio and direction together in one workspace.",
        },
        {
          heading: "Virtual AI artists",
          body: "Develop a visual identity for your music. Save your own artist references and return to them for your next idea.",
        },
        {
          heading: "Social music clips",
          body: "Find the part people will remember. Prepare a short excerpt for your next music-video concept.",
        },
      ],
    },
    {
      blockType: "section",
      heading: "The difference is in the performance.",
      body: "A portrait and a song are the starting point. A convincing singing performance is the goal. We will publish a before-and-after comparison here only when a SingMotion-generated result has been validated. No stock clip or fixed sample stands in for a real result.",
    },
    {
      blockType: "cards",
      heading: "A bigger stage, in time.",
      items: [
        {
          heading: "Cinematic B-roll",
          body: "Future feature · not available. Supporting scenes and visual atmosphere around your performance.",
        },
        {
          heading: "Complete multi-scene music videos",
          body: "Future feature · not available. Bring performances and supporting scenes into a complete music video.",
        },
      ],
    },
    {
      blockType: "cta",
      heading: "Your next idea starts with a song.",
      buttonLabel: "Open the demo studio",
      url: "/studio",
    },
  ],
};
