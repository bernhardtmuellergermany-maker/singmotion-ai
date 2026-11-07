import path from "node:path";
import { homePage } from "../cms/home-page.ts";
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
    if (slug === "home") {
      const artwork = await payload.create({
        collection: "cms-assets",
        data: {
          alt: "Concept artwork: a singer with music and artist cards in purple and blue stage lighting.",
        },
        filePath: path.resolve("public/artwork/singmotion-concert-concept.png"),
      });
      blocks = [...(homePage.blocks || [])];
      blocks.splice(2, 0, {
        blockType: "image",
        image: artwork.id,
        caption: "SingMotion creative concept",
      });
    }
    await payload.create({
      collection: "pages",
      draft: true,
      data: {
        slug: slug as Page["slug"],
        title: slug === "home" ? homePage.title : title,
        description:
          slug === "home" ? homePage.description : old?.intro || title,
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
          links: [{ label: "Open studio", url: "/studio" }],
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
