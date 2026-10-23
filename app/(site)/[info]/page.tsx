import { publishedPage } from "@/cms/content";
import { Website } from "@/components/cms/website";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Brand } from "@/components/brand";
import { legacyPages as pages } from "@/cms/default-pages";
export default async function Page({
  params,
}: {
  params: Promise<{ info: string }>;
}) {
  const cms = await publishedPage((await params).info);
  if (cms) return <Website page={cms} />;
  const p = pages[(await params).info];
  if (!p) notFound();
  return (
    <div className="info-page" id="content">
      <header>
        <Brand />
        <Link href="/studio" className="button subtle">
          Open studio
        </Link>
      </header>
      <span className="eyebrow">SINGMOTION AI</span>
      <h1>{p.title}</h1>
      <p>{p.intro}</p>
      {p.sections.map(([h, t]) => (
        <section className="content-card" key={h}>
          <h2>{h}</h2>
          <p>{t}</p>
        </section>
      ))}
      <Link
        href="/signup"
        className="button outline"
        style={{ marginRight: 12 }}
      >
        Sign up information
      </Link>
      <Link href="/studio" className="button primary">
        Explore the demo studio →
      </Link>
    </div>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ info: string }>;
}) {
  const page = await publishedPage((await params).info);
  return page ? { title: page.title, description: page.description } : {};
}
