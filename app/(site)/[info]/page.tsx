import { HelpFAQ } from "@/components/help-faq";
import { LegalOverview } from "@/components/legal-overview";
import { LegalAdminAccess } from "@/components/legal-admin-access";
import { publishedPage } from "@/cms/content";
import { Website } from "@/components/cms/website";
import { notFound } from "next/navigation";
import { legacyPages as pages } from "@/cms/default-pages";
import type { Page as CMSPage } from "@/cms/payload-types";
export default async function Page({
  params,
}: {
  params: Promise<{ info: string }>;
}) {
  const slug = (await params).info;
  if (slug === "legal") return <LegalOverview />;
  if (slug === "help") {
    // The published CMS "help" page supplies structured FAQ groups through Cards blocks.
    // Until an editor publishes those blocks, preserve the existing curated FAQ.
    const helpPage = await publishedPage("help");
    const groups = (helpPage?.blocks || []).flatMap((block) => {
      if (block.blockType !== "cards" || !block.heading?.trim()) return [];
      const items: [string,string][] = (block.items || [])
        .filter(item => !!item.heading?.trim() && !!item.body?.trim())
        .map(item => [item.heading!, item.body!]);
      return items.length ? [{ heading:block.heading, items }] : [];
    });
    return groups.length ? <HelpFAQ groups={groups} /> : <HelpFAQ />;
  }
  const cms = await publishedPage(slug);
  if (cms) return slug === "legal" ? <div className="legal-refresh"><Website page={cms}/><LegalAdminAccess/></div> : <Website page={cms} />;
  const p = pages[(await params).info];
  if (!p) notFound();
  const fallback: CMSPage = {
    id: 0,
    slug: (await params).info as CMSPage["slug"],
    title: p.title,
    description: p.intro,
    createdAt: "2026-10-23T00:00:00.000Z",
    updatedAt: "2026-10-23T00:00:00.000Z",
    blocks: [
      {
        blockType: "hero",
        eyebrow: "SINGMOTION AI",
        heading: p.title,
        body: p.intro,
      },
      ...p.sections.map(([heading, body]) => ({
        blockType: "section" as const,
        heading,
        body,
      })),
      {
        blockType: "cta",
        heading: "Explore SingMotion",
        buttonLabel: "Explore the demo studio",
        url: "/studio",
      },
      {
        blockType: "cta",
        heading: "Account information",
        buttonLabel: "Sign up information",
        url: "/signup",
      },
    ],
  };
  return slug === "legal" ? <div className="legal-refresh"><Website page={fallback}/><LegalAdminAccess/></div> : <Website page={fallback} />;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ info: string }>;
}) {
  if ((await params).info === "legal") return { title: "Legals & Imprint", description: "Legal notice, privacy and terms of SingMotion AI." };
  if ((await params).info === "help") return { title: "Help & FAQ", description: "Frequently asked questions about SingMotion AI." };
  const page = await publishedPage((await params).info);
  return page ? { title: page.title, description: page.description } : {};
}
