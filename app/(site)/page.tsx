import { publishedPage } from "@/cms/content";
import { homePage } from "@/cms/home-page";
import { Website } from "@/components/cms/website";
export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const page = (await publishedPage("home")) || homePage;
  return { title: page.title, description: page.description };
}
export default async function Home() {
  return <Website page={(await publishedPage("home")) || homePage} />;
}
