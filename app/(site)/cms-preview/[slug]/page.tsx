import { notFound } from "next/navigation";
import { publishedPage } from "@/cms/content";
import { Website } from "@/components/cms/website";
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };
export default async function Preview({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const page = await publishedPage((await params).slug, true);
  if (!page) notFound();
  return <Website page={page} preview />;
}
