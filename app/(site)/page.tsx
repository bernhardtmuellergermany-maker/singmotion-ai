import { publishedPage } from "@/cms/content";
import { homePage } from "@/cms/home-page";
import { ProductHome } from "@/components/product-home";
export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const page = (await publishedPage("home")) || homePage;
  return { title: page.title, description: page.description };
}
export default async function Home() {
  return <ProductHome page={(await publishedPage("home")) || homePage} />;
}
