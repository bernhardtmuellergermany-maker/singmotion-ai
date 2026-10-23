import { getPayload } from "payload";
import config from "../payload.config.ts";
import { legacyPages } from "../cms/default-pages.ts";
import { pageSlugs } from "../cms/policy.ts";
import type { Page } from "../cms/payload-types";
if (
  process.env.CMS_ENABLED !== "true" ||
  process.env.CMS_SEED_CONFIRM !== "create-missing-drafts"
)
  throw new Error("Explicit CMS draft seeding confirmation required.");
const payload = await getPayload({ config });
try {
  if (!(await payload.count({ collection: "staff" })).totalDocs)
    throw new Error("Provision an administrator first.");
  for (const slug of pageSlugs) {
    if (
      (
        await payload.count({
          collection: "pages",
          where: { slug: { equals: slug } },
        })
      ).totalDocs
    )
      continue;
    const old = legacyPages[slug];
    const title =
      old?.title ||
      {
        home: "Your music. Your artist. Your performance.",
        pricing: "Illustrative pricing",
        faq: "Frequently asked questions",
        about: "A studio in the making.",
      }[slug] ||
      slug;
    let blocks: Page["blocks"] = old?.sections.map(([heading, body]) => ({
      blockType: "section",
      heading,
      body,
    })) || [
      {
        blockType: "section",
        heading: title,
        body: "SingMotion is a private demonstration. Live AI generation, payments and customer accounts are not enabled. Review all business and legal information before publishing.",
      },
    ];
    if (slug === "home")
      blocks = [
        {
          blockType: "hero",
          eyebrow: "A NEW STAGE FOR YOUR MUSIC",
          heading: title,
          body: "Turn the song in your head into a performance you can see. Bring your own music, choose your artist, and make the moment yours.",
          buttonLabel: "Explore the studio",
          url: "/studio",
        },
        {
          blockType: "cards",
          heading: "A little direction. A lot of possibility.",
          items: [
            {
              heading: "Bring your music",
              body: "Upload an MP3 or WAV and find the part that deserves its own moment.",
            },
            {
              heading: "Meet your artist",
              body: "Add your own reference image. Save your artist and come back to them for the next song.",
            },
            {
              heading: "Shape the performance",
              body: "Choose an emotion, set a camera direction, and review every detail before you create.",
            },
          ],
        },
        {
          blockType: "section",
          heading: "A studio in the making.",
          body: "Prices and balances are simulated in this version. No payments. No live AI renders.",
        },
      ];
    await payload.create({
      collection: "pages",
      draft: true,
      data: {
        slug: slug as Page["slug"],
        title,
        description: old?.intro || title,
        blocks,
        _status: "draft",
      },
    });
  }
  const nav = await payload.findGlobal({ slug: "site-navigation" });
  if (!nav.header?.links?.length && !nav.footer?.links?.length)
    await payload.updateGlobal({
      slug: "site-navigation",
      data: {
        header: {
          links: [
            { label: "Pricing", url: "/pricing" },
            { label: "FAQ", url: "/faq" },
            { label: "About", url: "/about" },
          ],
        },
        footer: {
          links: ["privacy", "terms", "legal", "rights", "contact"].map(
            (p) => ({ label: legacyPages[p]?.title || p, url: `/${p}` }),
          ),
        },
        copyright: "SingMotion AI · Development preview",
      },
    });
  console.log(
    "Missing CMS drafts prepared. Existing pages were not overwritten. Review and publish through /admin.",
  );
} finally {
  await payload.destroy();
}

process.exit(0);
